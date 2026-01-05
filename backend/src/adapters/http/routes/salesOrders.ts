import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { currentYearUtc, nextSequence } from '../../../application/shared/sequence.js'

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
})

const orderCreateSchema = z.object({
  customerId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        batchId: z.string().uuid().nullable().optional(),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().min(0).optional(),
      }),
    )
    .min(1)
    .optional(),
})

const orderConfirmSchema = z.object({
  version: z.number().int().positive(),
})

const orderFulfillSchema = z.object({
  version: z.number().int().positive(),
  fromLocationId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
})

type LockedBalanceRow = { id: string; quantity: string }

function decimalFromNumber(value: number): string {
  return value.toString()
}

function generateOrderNumber(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const rand = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')
  return `SO-${y}${m}${day}-${rand}`
}

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

export async function registerSalesOrderRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)

  app.post(
    '/api/v1/sales/orders',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const parsed = orderCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const created = await db.$transaction(async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id: parsed.data.customerId, tenantId, isActive: true }, select: { id: true } })
        if (!customer) {
          const err = new Error('Customer not found') as Error & { statusCode?: number }
          err.statusCode = 404
          throw err
        }

        const number = generateOrderNumber()
        const order = await tx.salesOrder.create({
          data: {
            tenantId,
            number,
            customerId: parsed.data.customerId,
            note: parsed.data.note ?? null,
            createdBy: userId,
          },
          select: { id: true, number: true, customerId: true, status: true, note: true, version: true, createdAt: true },
        })

        const linesInput = parsed.data.lines ?? []
        if (linesInput.length > 0) {
          // Validate products/batches exist under tenant
          for (const line of linesInput) {
            const product = await tx.product.findFirst({ where: { id: line.productId, tenantId, isActive: true }, select: { id: true } })
            if (!product) {
              const err = new Error('Product not found') as Error & { statusCode?: number }
              err.statusCode = 404
              throw err
            }
            const batchId = line.batchId ?? null
            if (batchId) {
              const batch = await tx.batch.findFirst({ where: { id: batchId, tenantId, productId: line.productId }, select: { id: true } })
              if (!batch) {
                const err = new Error('Batch not found') as Error & { statusCode?: number }
                err.statusCode = 404
                throw err
              }
            }
          }

          await tx.salesOrderLine.createMany({
            data: linesInput.map((l) => ({
              tenantId,
              salesOrderId: order.id,
              productId: l.productId,
              batchId: l.batchId ?? null,
              quantity: decimalFromNumber(l.quantity),
              unitPrice: decimalFromNumber(l.unitPrice ?? 0),
              createdBy: userId,
            })),
          })
        }

        const lines = await tx.salesOrderLine.findMany({
          where: { tenantId, salesOrderId: order.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true, productId: true, batchId: true, quantity: true, unitPrice: true },
        })

        return { ...order, lines }
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'sales.order.create',
        entityType: 'SalesOrder',
        entityId: created.id,
        after: created,
      })

      return reply.status(201).send(created)
    },
  )

  app.get(
    '/api/v1/sales/orders',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderRead)],
    },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId

      const items = await db.salesOrder.findMany({
        where: { tenantId, ...(parsed.data.status ? { status: parsed.data.status } : {}) },
        take: parsed.data.take,
        ...(parsed.data.cursor
          ? {
              skip: 1,
              cursor: { id: parsed.data.cursor },
            }
          : {}),
        orderBy: { id: 'asc' },
        select: { id: true, number: true, customerId: true, status: true, note: true, version: true, updatedAt: true },
      })

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items, nextCursor })
    },
  )

  app.get(
    '/api/v1/sales/orders/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderRead)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const tenantId = request.auth!.tenantId

      const order = await db.salesOrder.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          number: true,
          customerId: true,
          status: true,
          note: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          customer: { select: { id: true, name: true, nit: true } },
          lines: { select: { id: true, productId: true, batchId: true, quantity: true, unitPrice: true } },
        },
      })

      if (!order) return reply.status(404).send({ message: 'Not found' })
      return reply.send(order)
    },
  )

  app.post(
    '/api/v1/sales/orders/:id/confirm',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const parsed = orderConfirmSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const before = await db.salesOrder.findFirst({ where: { id, tenantId }, select: { id: true, status: true, version: true } })
      if (!before) return reply.status(404).send({ message: 'Not found' })
      if (before.version !== parsed.data.version) return reply.status(409).send({ message: 'Version conflict' })
      if (before.status !== 'DRAFT') return reply.status(409).send({ message: 'Only DRAFT orders can be confirmed' })

      const updated = await db.salesOrder.update({
        where: { id },
        data: { status: 'CONFIRMED', version: { increment: 1 }, createdBy: userId },
        select: { id: true, number: true, status: true, version: true, updatedAt: true },
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'sales.order.confirm',
        entityType: 'SalesOrder',
        entityId: id,
        before,
        after: updated,
      })

      app.io?.to(`tenant:${tenantId}`).emit('sales.order.confirmed', updated)

      return reply.send(updated)
    },
  )

  app.post(
    '/api/v1/sales/orders/:id/fulfill',
    {
      preHandler: [
        requireAuth(),
        requireModuleEnabled(db, 'SALES'),
        requireModuleEnabled(db, 'WAREHOUSE'),
        requirePermission(Permissions.SalesOrderWrite),
        requirePermission(Permissions.StockMove),
      ],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const parsed = orderFulfillSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const { fromLocationId } = parsed.data

      const todayUtc = startOfTodayUtc()

      try {
        const result = await db.$transaction(async (tx) => {
        const order = await tx.salesOrder.findFirst({
          where: { id, tenantId },
          select: { id: true, number: true, status: true, version: true, customerId: true },
        })
        if (!order) {
          const err = new Error('Not found') as Error & { statusCode?: number }
          err.statusCode = 404
          throw err
        }
        if (order.version !== parsed.data.version) {
          const err = new Error('Version conflict') as Error & { statusCode?: number }
          err.statusCode = 409
          throw err
        }
        if (order.status !== 'CONFIRMED') {
          const err = new Error('Only CONFIRMED orders can be fulfilled') as Error & { statusCode?: number }
          err.statusCode = 409
          throw err
        }

        const location = await tx.location.findFirst({ where: { id: fromLocationId, tenantId, isActive: true }, select: { id: true } })
        if (!location) {
          const err = new Error('Location not found') as Error & { statusCode?: number }
          err.statusCode = 404
          throw err
        }

        const lines = await tx.salesOrderLine.findMany({
          where: { tenantId, salesOrderId: order.id },
          select: { id: true, productId: true, batchId: true, quantity: true },
          orderBy: { createdAt: 'asc' },
        })
        if (lines.length === 0) {
          const err = new Error('Order has no lines') as Error & { statusCode?: number }
          err.statusCode = 409
          throw err
        }

        const selectFefoBatchId = async (productId: string, qty: number): Promise<string | null> => {
          // Prefer batches with an expiry date (soonest first)
          const withExpiry = await tx.inventoryBalance.findMany({
            where: {
              tenantId,
              locationId: fromLocationId,
              productId,
              batchId: { not: null },
              quantity: { gte: qty },
              batch: { expiresAt: { not: null, gte: todayUtc } },
            },
            take: 1,
            orderBy: [{ batch: { expiresAt: 'asc' } }, { id: 'asc' }],
            select: { batchId: true },
          })
          if (withExpiry[0]?.batchId) return withExpiry[0].batchId

          // Then allow batches without expiry date
          const withoutExpiry = await tx.inventoryBalance.findMany({
            where: {
              tenantId,
              locationId: fromLocationId,
              productId,
              batchId: { not: null },
              quantity: { gte: qty },
              batch: { expiresAt: null },
            },
            take: 1,
            orderBy: [{ id: 'asc' }],
            select: { batchId: true },
          })
          return withoutExpiry[0]?.batchId ?? null
        }

        // FEFO auto-pick: if line has no batchId, try selecting a non-expired batch with sufficient stock.
        // If none exists, fall back to batchId=null behavior (legacy/unbatched inventory).
        const effectiveBatchIdByLineId = new Map<string, string | null>()
        for (const line of lines) {
          const qty = Number(line.quantity)
          if (!line.batchId) {
            const chosen = await selectFefoBatchId(line.productId, qty)
            effectiveBatchIdByLineId.set(line.id, chosen)
            if (chosen) {
              await tx.salesOrderLine.update({ where: { id: line.id }, data: { batchId: chosen, createdBy: userId } })
            }
          } else {
            effectiveBatchIdByLineId.set(line.id, line.batchId)
          }
        }

        // Expiry rule: if a line resolves to a batchId (explicit or auto-picked), it must not be expired.
        for (const line of lines) {
          const batchId = effectiveBatchIdByLineId.get(line.id) ?? null
          if (!batchId) continue
          const batch = await tx.batch.findFirst({
            where: { id: batchId, tenantId, productId: line.productId },
            select: { id: true, expiresAt: true, batchNumber: true },
          })
          if (!batch) {
            const err = new Error('Batch not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }
          if (batch.expiresAt && batch.expiresAt < todayUtc) {
            const err = new Error('Batch is expired') as Error & { statusCode?: number; code?: string; meta?: any }
            err.statusCode = 409
            err.code = 'BATCH_EXPIRED'
            err.meta = { batchId: batch.id, batchNumber: batch.batchNumber, expiresAt: batch.expiresAt.toISOString() }
            throw err
          }
        }

        // Lock balances for each (product,batch) in this location
        const lockBalance = async (productId: string, batchId: string | null) => {
          if (batchId === null) {
            const rows = await tx.$queryRaw<LockedBalanceRow[]>`
              SELECT "id", "quantity" FROM "InventoryBalance"
              WHERE "tenantId" = ${tenantId} AND "locationId" = ${fromLocationId} AND "productId" = ${productId} AND "batchId" IS NULL
              FOR UPDATE
            `
            return rows[0] ?? null
          }
          const rows = await tx.$queryRaw<LockedBalanceRow[]>`
            SELECT "id", "quantity" FROM "InventoryBalance"
            WHERE "tenantId" = ${tenantId} AND "locationId" = ${fromLocationId} AND "productId" = ${productId} AND "batchId" = ${batchId}
            FOR UPDATE
          `
          return rows[0] ?? null
        }

        for (const line of lines) {
          const batchId = effectiveBatchIdByLineId.get(line.id) ?? null
          await lockBalance(line.productId, batchId)
        }

        const changedBalances: any[] = []
        const createdMovements: any[] = []
        const year = currentYearUtc()

        for (const line of lines) {
          const batchId = effectiveBatchIdByLineId.get(line.id) ?? null
          const qty = Number(line.quantity)

          const current = await tx.inventoryBalance.findFirst({
            where: { tenantId, locationId: fromLocationId, productId: line.productId, batchId },
            select: { id: true, quantity: true },
          })
          const currentQty = current ? Number(current.quantity) : 0
          const nextQty = currentQty - qty
          if (nextQty < 0) {
            const err = new Error('Insufficient stock') as Error & { statusCode?: number }
            err.statusCode = 409
            throw err
          }

          const balance = current
            ? await tx.inventoryBalance.update({
                where: { id: current.id },
                data: { quantity: decimalFromNumber(nextQty), version: { increment: 1 }, createdBy: userId },
                select: { id: true, locationId: true, productId: true, batchId: true, quantity: true, version: true, updatedAt: true },
              })
            : await tx.inventoryBalance.create({
                data: {
                  tenantId,
                  locationId: fromLocationId,
                  productId: line.productId,
                  batchId,
                  quantity: decimalFromNumber(nextQty),
                  createdBy: userId,
                },
                select: { id: true, locationId: true, productId: true, batchId: true, quantity: true, version: true, updatedAt: true },
              })

          changedBalances.push(balance)

          const seq = await nextSequence(tx, { tenantId, year, key: 'MS' })
          const movement = await tx.stockMovement.create({
            data: {
              tenantId,
              number: seq.number,
              numberYear: year,
              type: 'OUT',
              productId: line.productId,
              batchId,
              fromLocationId,
              toLocationId: null,
              quantity: decimalFromNumber(qty),
              referenceType: 'SALES_ORDER',
              referenceId: order.number,
              note: parsed.data.note ?? null,
              createdBy: userId,
            },
            select: {
              id: true,
              number: true,
              numberYear: true,
              type: true,
              productId: true,
              batchId: true,
              fromLocationId: true,
              toLocationId: true,
              quantity: true,
              createdAt: true,
              referenceType: true,
              referenceId: true,
            },
          })
          createdMovements.push(movement)
        }

        const updatedOrder = await tx.salesOrder.update({
          where: { id: order.id },
          data: { status: 'FULFILLED', version: { increment: 1 }, createdBy: userId },
          select: { id: true, number: true, status: true, version: true, updatedAt: true },
        })

        return { orderBefore: order, updatedOrder, createdMovements, changedBalances }
        })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'sales.order.fulfill',
        entityType: 'SalesOrder',
        entityId: id,
        before: result.orderBefore,
        after: { order: result.updatedOrder, movements: result.createdMovements, balances: result.changedBalances },
      })

      const room = `tenant:${tenantId}`
      app.io?.to(room).emit('sales.order.fulfilled', result.updatedOrder)
      for (const m of result.createdMovements) app.io?.to(room).emit('stock.movement.created', m)
      for (const b of result.changedBalances) app.io?.to(room).emit('stock.balance.changed', b)

      const hitsZero = (b: any) => b && Number(b.quantity) === 0
      if (result.changedBalances.some(hitsZero)) {
        app.io?.to(room).emit('stock.alert.low', { tenantId, at: new Date().toISOString(), reason: 'sales_fulfillment' })
      }

      return reply.send({
        order: result.updatedOrder,
        movements: result.createdMovements,
        balances: result.changedBalances,
      })
      } catch (e: any) {
        if (e?.code === 'BATCH_EXPIRED') {
          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.expiry.blocked',
            entityType: 'Batch',
            entityId: e?.meta?.batchId ?? null,
            metadata: { operation: 'sales.order.fulfill', orderId: id, ...e.meta },
          })
          return reply.status(409).send({ message: 'Batch expired' })
        }
        throw e
      }
    },
  )
}
