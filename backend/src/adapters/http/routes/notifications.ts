import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requirePermission, requireModuleEnabled } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
})

const sendBulkTransferSchema = z.object({
  referenceId: z.string().trim().min(1).max(80),
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.any(),
      }),
    )
    .optional(),
})

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()

  function branchCityOf(request: any): string | null {
    if (request.auth?.isTenantAdmin) return null
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    const city = String(request.auth?.warehouseCity ?? '').trim()
    return city ? city.toUpperCase() : '__MISSING__'
  }

  app.get(
    '/api/v1/notifications',
    {
      preHandler: [requireAuth()],
    },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const userRow = await db.user.findFirst({
        where: { tenantId, id: userId },
        select: { notificationsLastReadAt: true },
      })

      const lastReadAt = userRow?.notificationsLastReadAt ?? new Date(0)

      const visibleCityFilter =
        branchCity && branchCity !== '__MISSING__'
          ? {
              OR: [
                { city: null },
                { city: { equals: branchCity, mode: 'insensitive' as const } },
              ],
            }
          : {}

      const where: any = {
        tenantId,
        OR: [
          { targetUserId: userId },
          {
            targetUserId: null,
            ...(request.auth?.isTenantAdmin ? {} : visibleCityFilter),
          },
        ],
      }

      const items = await db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parsed.data.take,
      })

      return reply.send({
        lastReadAt: lastReadAt.toISOString(),
        items: items.map((n) => ({
          id: n.id,
          createdAt: n.createdAt.toISOString(),
          type: n.type,
          title: n.title,
          body: n.body,
          kind: (n.meta as any)?.kind ?? 'info',
          linkTo: n.linkTo,
          isRead: n.createdAt.getTime() <= lastReadAt.getTime(),
        })),
      })
    },
  )

  app.post(
    '/api/v1/notifications/mark-all-read',
    {
      preHandler: [requireAuth()],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const now = new Date()

      await db.user.updateMany({
        where: { tenantId, id: userId },
        data: { notificationsLastReadAt: now },
      })

      return reply.send({ lastReadAt: now.toISOString() })
    },
  )

  // Used by frontend bulk-transfer flow (best-effort notifications; should not fail the operation)
  app.post(
    '/api/v1/notifications/send-bulk-transfer',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const parsed = sendBulkTransferSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const [fromWh, toWh] = await Promise.all([
        db.warehouse.findFirst({ where: { tenantId, id: parsed.data.fromWarehouseId }, select: { id: true, code: true, city: true } }),
        db.warehouse.findFirst({ where: { tenantId, id: parsed.data.toWarehouseId }, select: { id: true, code: true, city: true } }),
      ])

      const fromLabel = fromWh?.code ?? fromWh?.city ?? 'Origen'
      const toLabel = toWh?.code ?? toWh?.city ?? 'Destino'
      const body = `${fromLabel} → ${toLabel}`
      const linkTo = `/stock/completed-movements?highlight=${encodeURIComponent(parsed.data.referenceId)}`

      const targetCities = new Set<string>()
      if (toWh?.city) targetCities.add(String(toWh.city).toUpperCase())
      if (fromWh?.city) targetCities.add(String(fromWh.city).toUpperCase())

      if (targetCities.size === 0) {
        await db.notification.create({
          data: {
            tenantId,
            city: null,
            type: 'stock.bulk_transfer.created',
            title: '📦 Transferencia masiva',
            body,
            linkTo,
            createdBy: userId,
            meta: { kind: 'info', referenceId: parsed.data.referenceId },
          },
        })
      } else {
        await db.notification.createMany({
          data: Array.from(targetCities).map((city) => ({
            tenantId,
            city,
            type: 'stock.bulk_transfer.created',
            title: '📦 Transferencia masiva',
            body,
            linkTo,
            createdBy: userId,
            meta: { kind: 'info', referenceId: parsed.data.referenceId },
          })),
        })
      }

      return reply.send({ ok: true })
    },
  )
}
