import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

const listPaymentsQuerySchema = z.object({
  status: z.enum(['DUE', 'PAID', 'ALL']).default('DUE'),
  take: z.coerce.number().int().min(1).max(200).default(100),
})

const markPaidSchema = z.object({
  version: z.number().int().positive(),
})

function addDaysUtc(date: Date, days: number): Date {
  const ms = date.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1000
  return new Date(ms)
}

function toNumber(value: any): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function parseCreditDays(paymentMode: string): number {
  const mode = (paymentMode ?? '').trim().toUpperCase()
  if (mode === 'CASH') return 0
  const m = mode.match(/^CREDIT_(\d{1,3})$/)
  if (!m) return 0
  const days = Number(m[1])
  return Number.isFinite(days) ? Math.max(0, days) : 0
}

export function registerSalesPaymentRoutes(app: FastifyInstance) {
  const db = prisma()
  const audit = new AuditService(db)

  function branchCityOf(request: any): string | null {
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    const city = String(request.auth?.warehouseCity ?? '').trim()
    return city ? city.toUpperCase() : '__MISSING__'
  }

  // Accounts receivable: delivered orders pending payment.
  app.get(
    '/api/v1/sales/payments',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderRead)],
    },
    async (request, reply) => {
      const parsed = listPaymentsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const wherePaid =
        parsed.data.status === 'PAID'
          ? { paidAt: { not: null } }
          : parsed.data.status === 'DUE'
            ? { paidAt: null }
            : {}

      const orders = await db.salesOrder.findMany({
        where: {
          tenantId,
          status: 'FULFILLED',
          ...wherePaid,
          ...(branchCity ? { customer: { city: { equals: branchCity, mode: 'insensitive' as const } } } : {}),
        },
        take: parsed.data.take,
        orderBy: [{ deliveryDate: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          number: true,
          version: true,
          paymentMode: true,
          deliveryDate: true,
          deliveredAt: true,
          paidAt: true,
          customer: { select: { id: true, name: true } },
          lines: { select: { quantity: true, unitPrice: true } },
        },
      })

      const items = orders.map((o) => {
        const base = o.deliveredAt ?? o.deliveryDate ?? new Date()
        const creditDays = parseCreditDays(o.paymentMode)
        const dueAt = addDaysUtc(base, creditDays)
        const total = o.lines.reduce((sum, l) => sum + toNumber(l.quantity) * toNumber(l.unitPrice), 0)

        return {
          id: o.id,
          number: o.number,
          version: o.version,
          customerId: o.customer.id,
          customerName: o.customer.name,
          paymentMode: o.paymentMode,
          deliveryDate: o.deliveryDate ? o.deliveryDate.toISOString() : null,
          deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
          dueAt: dueAt.toISOString(),
          total,
          paidAt: o.paidAt ? o.paidAt.toISOString() : null,
        }
      })

      return reply.send({ items })
    },
  )

  app.post(
    '/api/v1/sales/payments/:id/pay',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const parsed = markPaidSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const order = await db.salesOrder.findFirst({
        where: {
          id,
          tenantId,
          ...(branchCity ? { customer: { city: { equals: branchCity, mode: 'insensitive' as const } } } : {}),
        },
        select: { id: true, number: true, status: true, version: true, paidAt: true, customerId: true },
      })
      if (!order) return reply.status(404).send({ message: 'Not found' })
      if (order.version !== parsed.data.version) return reply.status(409).send({ message: 'Version conflict' })
      if (order.status !== 'FULFILLED') return reply.status(409).send({ message: 'Only delivered orders can be paid' })
      if (order.paidAt) return reply.status(409).send({ message: 'Order already paid' })

      const updated = await db.salesOrder.update({
        where: { id: order.id },
        data: { paidAt: new Date(), paidBy: userId, version: { increment: 1 }, createdBy: userId },
        select: { id: true, number: true, status: true, version: true, paidAt: true },
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'sales.order.pay',
        entityType: 'SalesOrder',
        entityId: id,
        before: order,
        after: updated,
      })

      const room = `tenant:${tenantId}`
      app.io?.to(room).emit('sales.order.paid', {
        id: updated.id,
        number: updated.number,
        paidAt: updated.paidAt?.toISOString() ?? null,
      })

      return reply.send({ order: updated })
    },
  )
}
