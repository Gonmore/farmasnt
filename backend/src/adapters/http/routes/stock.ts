import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

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

type LockedBalanceRow = {
  id: string
  quantity: string
}

function decimalFromNumber(value: number): string {
  // Postgres DECIMAL: pass as string for precision safety
  return value.toString()
}

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
            quantity: r.quantity,
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
      const batchId = input.batchId ?? null

      const todayUtc = startOfTodayUtc()

      // Validate location rules
      if (input.type === 'IN' && !input.toLocationId) return reply.status(400).send({ message: 'toLocationId is required' })
      if (input.type === 'OUT' && !input.fromLocationId) return reply.status(400).send({ message: 'fromLocationId is required' })
      if (input.type === 'TRANSFER' && (!input.fromLocationId || !input.toLocationId)) {
        return reply.status(400).send({ message: 'fromLocationId and toLocationId are required' })
      }
      if (input.type === 'ADJUSTMENT' && !(input.fromLocationId ?? input.toLocationId)) {
        return reply.status(400).send({ message: 'fromLocationId or toLocationId is required' })
      }

      const quantity = input.quantity
      const qtyStr = decimalFromNumber(quantity)

      try {
        const result = await db.$transaction(async (tx) => {
        // Ensure tenant-bound entities exist
        const product = await tx.product.findFirst({ where: { id: input.productId, tenantId, isActive: true }, select: { id: true } })
        if (!product) {
          const err = new Error('Product not found') as Error & { statusCode?: number }
          err.statusCode = 404
          throw err
        }

        // Expiry rule: block moving stock out of an expired batch.
        const decreasesStock = input.type === 'OUT' || input.type === 'TRANSFER' || (input.type === 'ADJUSTMENT' && !input.toLocationId)
        if (decreasesStock && batchId) {
          const batch = await tx.batch.findFirst({
            where: { id: batchId, tenantId, productId: input.productId },
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

        const fromLocationId = input.fromLocationId ?? null
        const toLocationId = input.toLocationId ?? null

        const ensureLocation = async (locationId: string) => {
          const loc = await tx.location.findFirst({ where: { id: locationId, tenantId, isActive: true }, select: { id: true } })
          if (!loc) {
            const err = new Error('Location not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }
        }

        if (fromLocationId) await ensureLocation(fromLocationId)
        if (toLocationId) await ensureLocation(toLocationId)

        // Lock relevant balances to avoid concurrent updates (FOR UPDATE)
        const lockBalance = async (locationId: string) => {
          const rows = await tx.$queryRaw<LockedBalanceRow[]>`
            SELECT "id", "quantity"
            FROM "InventoryBalance"
            WHERE "tenantId" = ${tenantId} AND "locationId" = ${locationId} AND "productId" = ${input.productId} AND "batchId" ${batchId === null ? 'IS NULL' : `= ${batchId}`}
            FOR UPDATE
          `
          return rows[0] ?? null
        }

        // NOTE: Prisma's tagged template cannot conditionally inject raw SQL safely for batchId.
        // We'll instead lock via two queries depending on null/non-null.
        const lockBalanceSafe = async (locationId: string) => {
          if (batchId === null) {
            const rows = await tx.$queryRaw<LockedBalanceRow[]>`
              SELECT "id", "quantity" FROM "InventoryBalance"
              WHERE "tenantId" = ${tenantId} AND "locationId" = ${locationId} AND "productId" = ${input.productId} AND "batchId" IS NULL
              FOR UPDATE
            `
            return rows[0] ?? null
          }
          const rows = await tx.$queryRaw<LockedBalanceRow[]>`
            SELECT "id", "quantity" FROM "InventoryBalance"
            WHERE "tenantId" = ${tenantId} AND "locationId" = ${locationId} AND "productId" = ${input.productId} AND "batchId" = ${batchId}
            FOR UPDATE
          `
          return rows[0] ?? null
        }

        if (fromLocationId) await lockBalanceSafe(fromLocationId)
        if (toLocationId && toLocationId !== fromLocationId) await lockBalanceSafe(toLocationId)

        const upsertBalance = async (locationId: string, delta: number) => {
          const current = await tx.inventoryBalance.findFirst({
            where: { tenantId, locationId, productId: input.productId, batchId },
            select: { id: true, quantity: true },
          })

          const currentQty = current ? Number(current.quantity) : 0
          const nextQty = currentQty + delta

          if (nextQty < 0) {
            const err = new Error('Insufficient stock') as Error & { statusCode?: number }
            err.statusCode = 409
            throw err
          }

          if (!current) {
            return tx.inventoryBalance.create({
              data: {
                tenantId,
                locationId,
                productId: input.productId,
                batchId,
                quantity: decimalFromNumber(nextQty),
                createdBy: userId,
              },
              select: { id: true, quantity: true, locationId: true, productId: true, batchId: true, version: true, updatedAt: true },
            })
          }

          return tx.inventoryBalance.update({
            where: { id: current.id },
            data: { quantity: decimalFromNumber(nextQty), version: { increment: 1 }, createdBy: userId },
            select: { id: true, quantity: true, locationId: true, productId: true, batchId: true, version: true, updatedAt: true },
          })
        }

        let fromBalance: any = null
        let toBalance: any = null

        if (input.type === 'IN') {
          toBalance = await upsertBalance(toLocationId!, +quantity)
        } else if (input.type === 'OUT') {
          fromBalance = await upsertBalance(fromLocationId!, -quantity)
        } else if (input.type === 'TRANSFER') {
          fromBalance = await upsertBalance(fromLocationId!, -quantity)
          toBalance = await upsertBalance(toLocationId!, +quantity)
        } else if (input.type === 'ADJUSTMENT') {
          const locationId = (toLocationId ?? fromLocationId)!
          // For MVP: ADJUSTMENT acts as delta (positive adds, negative removes) but request.quantity is positive.
          // We treat adjustments as adding to toLocation; if fromLocation provided but no toLocation, we subtract.
          const delta = toLocationId ? +quantity : -quantity
          toBalance = await upsertBalance(locationId, delta)
        }

        const createdMovement = await tx.stockMovement.create({
          data: {
            tenantId,
            type: input.type,
            productId: input.productId,
            batchId,
            fromLocationId,
            toLocationId,
            quantity: qtyStr,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
            note: input.note ?? null,
            createdBy: userId,
          },
          select: {
            id: true,
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

        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'stock.movement.create',
          entityType: 'StockMovement',
          entityId: createdMovement.id,
          after: { movement: createdMovement, fromBalance, toBalance },
        })

        return { createdMovement, fromBalance, toBalance }
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
