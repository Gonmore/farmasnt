import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requirePermission, requireModuleEnabled } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { branchDepartmentsOf, branchDepartmentsOfMissing, branchWarehouseIdOf } from '../../../application/security/branch.js'

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
      const branchWh = branchWarehouseIdOf(request)
      if (branchDepartmentsOfMissing(request)) {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }
      const branchDepartments = branchDepartmentsOf(request)

      const userRow = await db.user.findFirst({
        where: { tenantId, id: userId },
        select: { notificationsLastReadAt: true },
      })

      const lastReadAt = userRow?.notificationsLastReadAt ?? new Date(0)

      const visibleScopeFilter =
        branchWh && branchWh !== '__MISSING__'
          ? {
              OR: [
                { warehouseId: null, department: null },
                 { warehouseId: branchWh },
                 branchDepartments
                   ? { warehouseId: null, department: { in: branchDepartments, mode: 'insensitive' as const } }
                   : {},
               ],
             }
           : branchDepartments
             ? {
                 OR: [
                   { department: null },
                   { department: { in: branchDepartments, mode: 'insensitive' as const } },
                 ],
               }
            : {}

      const where: any = {
        tenantId,
        OR: [
          { targetUserId: userId },
          {
            targetUserId: null,
            ...(request.auth?.isTenantAdmin ? {} : visibleScopeFilter),
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
        db.warehouse.findFirst({ where: { tenantId, id: parsed.data.fromWarehouseId }, select: { id: true, code: true, city: true, department: true } }),
        db.warehouse.findFirst({ where: { tenantId, id: parsed.data.toWarehouseId }, select: { id: true, code: true, city: true, department: true } }),
      ])

      const fromLabel = fromWh?.code ?? fromWh?.department ?? fromWh?.city ?? 'Origen'
      const toLabel = toWh?.code ?? toWh?.department ?? toWh?.city ?? 'Destino'
      const body = `${fromLabel} → ${toLabel}`
      const linkTo = `/stock/completed-movements?highlight=${encodeURIComponent(parsed.data.referenceId)}`

      // Una notification por warehouse (no por ciudad) para que dos sucursales
      // en la misma ciudad no se mezclen. Si falta warehouseId (datos legacy)
      // caemos al comportamiento anterior por ciudad.
      const targetWhIds = new Set<string>()
      if (fromWh?.id) targetWhIds.add(String(fromWh.id))
      if (toWh?.id) targetWhIds.add(String(toWh.id))

      if (targetWhIds.size === 0) {
        await db.notification.create({
          data: {
            tenantId,
            department: null,
            city: null,
            warehouseId: null,
            type: 'stock.bulk_transfer.created',
            title: '📦 Transferencia masiva',
            body,
            linkTo,
            createdBy: userId,
            meta: { kind: 'info', referenceId: parsed.data.referenceId },
          },
        })
      } else {
        const targetDepartments: string[] = []
        if (fromWh?.department) targetDepartments.push(String(fromWh.department))
        if (toWh?.department && (!fromWh?.department || String(toWh.department) !== String(fromWh.department))) {
          targetDepartments.push(String(toWh.department))
        }
        await db.notification.createMany({
          data: Array.from(targetWhIds).map((whId) => {
            const whDept = whId === fromWh?.id ? fromWh?.department : toWh?.department
            const whCity = whId === fromWh?.id ? fromWh?.city : toWh?.city
            return {
              tenantId,
              department: whDept ?? null,
              city: whCity ?? null,
              warehouseId: whId,
              type: 'stock.bulk_transfer.created',
              title: '📦 Transferencia masiva',
              body,
              linkTo,
              createdBy: userId,
              meta: { kind: 'info', referenceId: parsed.data.referenceId },
            }
          }),
        })
      }

      return reply.send({ ok: true })
    },
  )
}
