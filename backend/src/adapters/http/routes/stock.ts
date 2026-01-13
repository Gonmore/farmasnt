import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { createStockMovementTx } from '../../../application/stock/stockMovementService.js'

const movementCreateSchema = z.object({
  type: z.enum(['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT']),
  productId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  fromLocationId: z.string().uuid().nullable().optional(),
  toLocationId: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().positive(),
  referenceType: z.string().trim().max(50).optional(),
  referenceId: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
})

const expirySummaryQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status: z.enum(['EXPIRED', 'RED', 'YELLOW', 'GREEN']).optional(),
  daysToExpireMax: z.coerce.number().int().optional(),
})

const fefoSuggestionsQuerySchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(50).default(10),
})

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000)
}

function daysToExpire(expiresAt: Date, now: Date): number {
  const ms = expiresAt.getTime() - now.getTime()
  return Math.floor(ms / 86400000)
}

function semaphoreStatusForDays(d: number): 'EXPIRED' | 'RED' | 'YELLOW' | 'GREEN' {
  if (d < 0) return 'EXPIRED'
  if (d <= 30) return 'RED'
  if (d <= 90) return 'YELLOW'
  return 'GREEN'
}

export async function registerStockRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)

  // Expiry dashboard (read-side)
  app.get(
    '/api/v1/stock/expiry/summary',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const parsed = expirySummaryQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const now = new Date()
      const todayUtc = startOfTodayUtc()

      const batchFilters: any[] = [{ expiresAt: { not: null } }]

      if (parsed.data.status) {
        const s = parsed.data.status
        if (s === 'EXPIRED') batchFilters.push({ expiresAt: { lt: todayUtc } })
        if (s === 'RED') batchFilters.push({ expiresAt: { gte: todayUtc, lt: addDaysUtc(todayUtc, 31) } })
        if (s === 'YELLOW') batchFilters.push({ expiresAt: { gte: addDaysUtc(todayUtc, 31), lt: addDaysUtc(todayUtc, 91) } })
        if (s === 'GREEN') batchFilters.push({ expiresAt: { gte: addDaysUtc(todayUtc, 91) } })
      }

      if (typeof parsed.data.daysToExpireMax === 'number' && Number.isFinite(parsed.data.daysToExpireMax)) {
        batchFilters.push({ expiresAt: { lte: addDaysUtc(todayUtc, parsed.data.daysToExpireMax) } })
      }

      const rows = await db.inventoryBalance.findMany({
        where: {
          tenantId,
          quantity: { gt: 0 },
          batchId: { not: null },
          batch: { AND: batchFilters },
          ...(parsed.data.warehouseId ? { location: { warehouseId: parsed.data.warehouseId } } : {}),
        },
        take: parsed.data.take + 1,
        ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
        orderBy: [{ batch: { expiresAt: 'asc' } }, { id: 'asc' }],
        select: {
          id: true,
          quantity: true,
          reservedQuantity: true,
          product: { select: { id: true, sku: true, name: true } },
          batch: { select: { id: true, batchNumber: true, expiresAt: true } },
          location: { select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true } } } },
        },
      })

      const pageRows = rows.slice(0, parsed.data.take)
      const nextCursor = rows.length > parsed.data.take ? rows[rows.length - 1]!.id : null

      const items = pageRows
        .map((r) => {
          const batch = r.batch
          const exp = batch?.expiresAt
          if (!batch || !exp) return null
          const d = daysToExpire(exp, todayUtc)
          const status = semaphoreStatusForDays(d)

          const total = Number(r.quantity || '0')
          const reserved = Number((r as any).reservedQuantity ?? '0')
          const available = Math.max(0, total - Math.max(0, reserved))
          return {
            balanceId: r.id,
            productId: r.product.id,
            sku: r.product.sku,
            name: r.product.name,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            expiresAt: exp.toISOString(),
            daysToExpire: d,
            status,
            quantity: String(r.quantity),
            reservedQuantity: String((r as any).reservedQuantity ?? '0'),
            availableQuantity: String(available),
            warehouseId: r.location.warehouse.id,
            warehouseCode: r.location.warehouse.code,
            warehouseName: r.location.warehouse.name,
            locationId: r.location.id,
            locationCode: r.location.code,
          }
        })
        .filter(Boolean) as any[]

      return reply.send({ items, nextCursor, generatedAt: now.toISOString() })
    },
  )

  // FEFO suggestions: choose batches by soonest expiry with available stock
  app.get(
    '/api/v1/stock/fefo-suggestions',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const parsed = fefoSuggestionsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const todayUtc = startOfTodayUtc()

      if (!parsed.data.locationId && !parsed.data.warehouseId) {
        return reply.status(400).send({ message: 'locationId or warehouseId is required' })
      }

      if (parsed.data.locationId) {
        const rows = await db.inventoryBalance.findMany({
          where: {
            tenantId,
            locationId: parsed.data.locationId,
            productId: parsed.data.productId,
            quantity: { gt: 0 },
            batchId: { not: null },
            batch: {
              OR: [{ expiresAt: null }, { expiresAt: { gte: todayUtc } }],
            },
          },
          take: parsed.data.take,
          orderBy: [{ batch: { expiresAt: 'asc' } }, { id: 'asc' }],
          select: {
            quantity: true,
            batch: { select: { id: true, batchNumber: true, expiresAt: true, status: true } },
          },
        })

        const items = rows.map((r) => ({
          batchId: r.batch!.id,
          batchNumber: r.batch!.batchNumber,
          expiresAt: r.batch!.expiresAt ? r.batch!.expiresAt.toISOString() : null,
          status: r.batch!.status,
          quantity: r.quantity,
        }))

        return reply.send({ items })
      }

      const grouped = await db.inventoryBalance.groupBy({
        by: ['batchId'],
        where: {
          tenantId,
          productId: parsed.data.productId,
          quantity: { gt: 0 },
          batchId: { not: null },
          location: { warehouseId: parsed.data.warehouseId! },
        },
        _sum: { quantity: true },
      })

      const batchIds = grouped.map((g) => g.batchId).filter(Boolean) as string[]
      if (batchIds.length === 0) return reply.send({ items: [] })

      const batches = await db.batch.findMany({
        where: {
          tenantId,
          id: { in: batchIds },
          OR: [{ expiresAt: null }, { expiresAt: { gte: todayUtc } }],
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: parsed.data.take,
        select: { id: true, batchNumber: true, expiresAt: true, status: true },
      })

      const qtyByBatchId = new Map<string, any>()
      for (const g of grouped) {
        if (!g.batchId) continue
        qtyByBatchId.set(g.batchId, g._sum.quantity)
      }

      const items = batches.map((b) => ({
        batchId: b.id,
        batchNumber: b.batchNumber,
        expiresAt: b.expiresAt ? b.expiresAt.toISOString() : null,
        status: b.status,
        quantity: qtyByBatchId.get(b.id) ?? '0',
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/stock/balances',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request) => {
      const tenantId = request.auth!.tenantId
      const query = request.query as any
      const locationId = typeof query.locationId === 'string' ? query.locationId : undefined
      const productId = typeof query.productId === 'string' ? query.productId : undefined

      const items = await db.inventoryBalance.findMany({
        where: {
          tenantId,
          ...(locationId ? { locationId } : {}),
          ...(productId ? { productId } : {}),
        },
        take: 100,
        orderBy: [{ updatedAt: 'desc' }],
        select: {
          id: true,
          locationId: true,
          productId: true,
          batchId: true,
          quantity: true,
          version: true,
          updatedAt: true,
        },
      })

      return { items }
    },
  )

  app.post(
    '/api/v1/stock/movements',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const parsed = movementCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const input = parsed.data

      try {
        const result = await db.$transaction(async (tx) => {
          return createStockMovementTx(tx, {
            tenantId,
            userId,
            type: input.type,
            productId: input.productId,
            batchId: input.batchId ?? null,
            fromLocationId: input.fromLocationId ?? null,
            toLocationId: input.toLocationId ?? null,
            quantity: input.quantity,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
            note: input.note ?? null,
          })
        })

        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'stock.movement.create',
          entityType: 'StockMovement',
          entityId: result.createdMovement.id,
          after: { movement: result.createdMovement, fromBalance: result.fromBalance, toBalance: result.toBalance },
        })

      // Emit realtime events (per tenant room)
      const room = `tenant:${tenantId}`
      app.io?.to(room).emit('stock.movement.created', result.createdMovement)
      if (result.fromBalance) app.io?.to(room).emit('stock.balance.changed', result.fromBalance)
      if (result.toBalance) app.io?.to(room).emit('stock.balance.changed', result.toBalance)

      // Simple alerting rule for MVP: emit low-stock when any resulting balance hits 0
      const hitsZero = (b: any) => b && Number(b.quantity) === 0
      if (hitsZero(result.fromBalance) || hitsZero(result.toBalance)) {
        app.io?.to(room).emit('stock.alert.low', {
          tenantId,
          productId: result.createdMovement.productId,
          batchId: result.createdMovement.batchId,
          at: new Date().toISOString(),
        })
      }

        return reply.status(201).send(result)
      } catch (e: any) {
        if (e?.code === 'BATCH_EXPIRED') {
          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.expiry.blocked',
            entityType: 'Batch',
            entityId: e?.meta?.batchId ?? null,
            metadata: { operation: 'stock.movement.create', movementType: input.type, ...e.meta },
          })
          return reply.status(409).send({ message: 'Batch expired' })
        }
        throw e
      }
    },
  )
}
