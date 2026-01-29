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
  // Base quantity (units). If presentationId/presentationQuantity is provided, backend derives this.
  quantity: z.coerce.number().positive().optional(),
  presentationId: z.string().uuid().optional(),
  presentationQuantity: z.coerce.number().positive().optional(),
  referenceType: z.string().trim().max(50).optional(),
  referenceId: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
})

const repackSchema = z.object({
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  locationId: z.string().uuid(),
  sourcePresentationId: z.string().uuid(),
  sourceQuantity: z.coerce.number().positive(),
  targetPresentationId: z.string().uuid(),
  targetQuantity: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional(),
})

function mustResolveMovementQuantity(input: any): {
  baseQuantity: number
  presentationId: string | null
  presentationQuantity: number | null
} {
  const hasPresentation = typeof input.presentationId === 'string' && input.presentationId.length > 0

  if (hasPresentation) {
    const pq = Number(input.presentationQuantity)
    if (!Number.isFinite(pq) || pq <= 0) {
      const err = new Error('presentationQuantity is required when presentationId is provided') as Error & { statusCode?: number }
      err.statusCode = 400
      throw err
    }
    return { baseQuantity: NaN, presentationId: input.presentationId, presentationQuantity: pq }
  }

  const q = Number(input.quantity)
  if (!Number.isFinite(q) || q <= 0) {
    const err = new Error('quantity is required when presentationId is not provided') as Error & { statusCode?: number }
    err.statusCode = 400
    throw err
  }
  return { baseQuantity: q, presentationId: null, presentationQuantity: q }
}

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

const movementRequestsListQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['OPEN', 'FULFILLED', 'CANCELLED']).optional(),
  city: z.string().trim().max(80).optional(),
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

  app.get(
    '/api/v1/stock/movement-requests',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const parsed = movementRequestsListQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const where: any = {
        tenantId,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.city
          ? { requestedCity: { equals: parsed.data.city, mode: 'insensitive' as const } }
          : {}),
      }

      const rows = await db.stockMovementRequest.findMany({
        where,
        take: parsed.data.take,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          items: {
            include: { 
              product: { select: { id: true, sku: true, name: true, genericName: true } },
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
            orderBy: [{ remainingQuantity: 'desc' }],
          },
        },
      })

      const userIds = [...new Set(rows.map((r) => r.requestedBy).filter(Boolean))]
      const users = userIds.length
        ? await db.user.findMany({ where: { tenantId, id: { in: userIds } }, select: { id: true, email: true, fullName: true } })
        : []
      const userMap = new Map(users.map((u) => [u.id, u.fullName || u.email || u.id]))

      return reply.send({
        items: rows.map((r) => ({
          id: r.id,
          status: r.status,
          requestedCity: r.requestedCity,
          quoteId: r.quoteId,
          note: r.note,
          requestedBy: r.requestedBy,
          requestedByName: userMap.get(r.requestedBy) || null,
          fulfilledAt: r.fulfilledAt ? r.fulfilledAt.toISOString() : null,
          fulfilledBy: r.fulfilledBy,
          createdAt: r.createdAt.toISOString(),
          items: r.items.map((it) => ({
            id: it.id,
            productId: it.productId,
            productSku: it.product?.sku ?? null,
            productName: it.product?.name ?? null,
            genericName: it.product?.genericName ?? null,
            requestedQuantity: Number(it.requestedQuantity),
            remainingQuantity: Number(it.remainingQuantity),
            presentationId: it.presentationId,
            presentationQuantity: it.presentationQuantity ? Number(it.presentationQuantity) : null,
            presentationName: it.presentation?.name ?? null,
            unitsPerPresentation: it.presentation?.unitsPerPresentation ?? null,
          })),
        })),
      })
    },
  )

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
          product: { select: { id: true, sku: true, name: true, genericName: true } },
          batch: {
            select: {
              id: true,
              batchNumber: true,
              expiresAt: true,
              presentationId: true,
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
          },
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
            genericName: (r.product as any).genericName ?? null,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            expiresAt: exp.toISOString(),
            daysToExpire: d,
            status,
            quantity: String(r.quantity),
            reservedQuantity: String((r as any).reservedQuantity ?? '0'),
            availableQuantity: String(available),
            presentationId: (batch as any).presentationId ?? null,
            presentationName: (batch as any).presentation?.name ?? null,
            unitsPerPresentation: (batch as any).presentation?.unitsPerPresentation ?? null,
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

  // Get reservations for a balance
  app.get(
    '/api/v1/stock/reservations',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const parsed = z.object({ balanceId: z.string().uuid() }).safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const balanceId = parsed.data.balanceId

      // Get reservations for this balance
      const reservations = await db.salesOrderReservation.findMany({
        where: {
          tenantId,
          inventoryBalanceId: balanceId,
        },
        include: {
          salesOrder: {
            include: {
              customer: true,
            },
          },
          line: {
            include: {
              product: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      // Get user names for createdBy
      const userIds = [...new Set(reservations.map((r) => r.salesOrder.createdBy).filter((v): v is string => !!v))]
      const users = userIds.length > 0 ? await db.user.findMany({
        where: {
          id: { in: userIds },
          tenantId, // Ensure users are from the same tenant
        },
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      }) : []
      const userMap = new Map(users.map(u => [u.id, u.fullName || u.email || 'Unknown']))

      // Format the response
      const formattedReservations = reservations.map((res) => {
        const deliveryDate = res.salesOrder.deliveryDate
        const today = new Date()
        const diffTime = deliveryDate ? deliveryDate.getTime() - today.getTime() : 0
        const deliveryDays = deliveryDate ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 0
        const createdBy = res.salesOrder.createdBy

        return {
          id: res.id,
          seller: createdBy ? (userMap.get(createdBy) || 'Unknown') : 'Unknown',
          client: res.salesOrder.customer.name,
          order: res.salesOrder.number,
          quantity: Number(res.quantity),
          deliveryDays,
          deliveryDate: deliveryDate?.toISOString() || null,
          productName: res.line.product.name,
        }
      })

      return reply.send({ items: formattedReservations })
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
      const resolved = mustResolveMovementQuantity(input)

      try {
        const result = await db.$transaction(async (tx) => {
          let baseQty = resolved.baseQuantity
          let presentationId: string | null = resolved.presentationId
          let presentationQuantity: number | null = resolved.presentationQuantity

          if (presentationId) {
            const pres = await (tx as any).productPresentation.findFirst({
              where: { tenantId, id: presentationId, isActive: true },
              select: { id: true, productId: true, unitsPerPresentation: true },
            })
            if (!pres || pres.productId !== input.productId) {
              const err = new Error('Invalid presentationId for this product') as Error & { statusCode?: number }
              err.statusCode = 400
              throw err
            }
            const factor = Number(pres.unitsPerPresentation)
            if (!Number.isFinite(factor) || factor <= 0) {
              const err = new Error('Invalid unitsPerPresentation') as Error & { statusCode?: number }
              err.statusCode = 400
              throw err
            }
            baseQty = (presentationQuantity ?? 0) * factor
          } else {
            // Store unit-presentation metadata for traceability when client sends base units.
            let unitPres = await (tx as any).productPresentation.findFirst({
              where: { tenantId, productId: input.productId, isActive: true },
              orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
              select: { id: true },
            })
            if (!unitPres) {
              try {
                unitPres = await (tx as any).productPresentation.create({
                  data: {
                    tenantId,
                    productId: input.productId,
                    name: 'Unidad',
                    unitsPerPresentation: '1',
                    isDefault: true,
                    sortOrder: 0,
                    isActive: true,
                    createdBy: userId,
                  },
                  select: { id: true },
                })
              } catch {
                unitPres = await (tx as any).productPresentation.findFirst({
                  where: { tenantId, productId: input.productId, isActive: true },
                  orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
                  select: { id: true },
                })
              }
            }
            presentationId = unitPres?.id ?? null
            presentationQuantity = baseQty
          }

          return createStockMovementTx(tx, {
            tenantId,
            userId,
            type: input.type,
            productId: input.productId,
            batchId: input.batchId ?? null,
            fromLocationId: input.fromLocationId ?? null,
            toLocationId: input.toLocationId ?? null,
            quantity: baseQty,
            presentationId,
            presentationQuantity,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
            note: input.note ?? null,
          })
        })

        // Auto-fulfill movement requests when a transfer ships stock into the requested city.
        if (input.type === 'TRANSFER' && result.createdMovement?.toLocationId) {
          const movementQty = Number(result.createdMovement.quantity)
          if (Number.isFinite(movementQty) && movementQty > 0) {
            const toLoc = await db.location.findFirst({
              where: { id: result.createdMovement.toLocationId, tenantId },
              select: { id: true, warehouse: { select: { id: true, city: true } } },
            })

            const city = (toLoc?.warehouse?.city ?? '').trim()
            if (city) {
              let remainingToApply = movementQty
              const openItems = await db.stockMovementRequestItem.findMany({
                where: {
                  tenantId,
                  productId: result.createdMovement.productId,
                  remainingQuantity: { gt: 0 },
                  request: {
                    status: 'OPEN',
                    requestedCity: { equals: city, mode: 'insensitive' as const },
                  },
                },
                orderBy: [{ request: { createdAt: 'asc' } }, { createdAt: 'asc' }],
                select: { id: true, requestId: true, remainingQuantity: true },
              })

              const touchedRequestIds = new Set<string>()
              for (const it of openItems) {
                if (remainingToApply <= 0) break
                const rem = Number(it.remainingQuantity)
                if (!Number.isFinite(rem) || rem <= 0) continue
                const apply = Math.min(rem, remainingToApply)
                remainingToApply -= apply
                touchedRequestIds.add(it.requestId)
                await db.stockMovementRequestItem.update({
                  where: { id: it.id },
                  data: { remainingQuantity: { decrement: apply } },
                })
              }

              // Mark requests fulfilled if all items are now satisfied.
              const room = `tenant:${tenantId}`
              for (const requestId of touchedRequestIds) {
                const agg = await db.stockMovementRequestItem.aggregate({
                  where: { tenantId, requestId },
                  _sum: { remainingQuantity: true },
                })
                const sumRemaining = Number((agg as any)?._sum?.remainingQuantity ?? 0)
                if (sumRemaining <= 1e-9) {
                  const updatedReq = await db.stockMovementRequest.update({
                    where: { id: requestId },
                    data: { status: 'FULFILLED', fulfilledAt: new Date(), fulfilledBy: userId },
                    select: { id: true, requestedCity: true, quoteId: true, requestedBy: true },
                  })
                  app.io?.to(room).emit('stock.movement_request.fulfilled', updatedReq)
                }
              }
            }
          }
        }

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

  // Repack (armar/desarmar) within same batch + location.
  // Creates OUT + IN movements (and optional remainder IN) atomically.
  app.post(
    '/api/v1/stock/repack',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const parsed = repackSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const input = parsed.data

      try {
        const result = await db.$transaction(async (tx) => {
          const [sourcePres, targetPres] = await Promise.all([
            (tx as any).productPresentation.findFirst({
              where: { tenantId, id: input.sourcePresentationId, isActive: true },
              select: { id: true, productId: true, unitsPerPresentation: true },
            }),
            (tx as any).productPresentation.findFirst({
              where: { tenantId, id: input.targetPresentationId, isActive: true },
              select: { id: true, productId: true, unitsPerPresentation: true },
            }),
          ])

          if (!sourcePres || sourcePres.productId !== input.productId) {
            throw Object.assign(new Error('Invalid sourcePresentationId for this product'), { statusCode: 400 })
          }
          if (!targetPres || targetPres.productId !== input.productId) {
            throw Object.assign(new Error('Invalid targetPresentationId for this product'), { statusCode: 400 })
          }

          const sourceFactor = Number(sourcePres.unitsPerPresentation)
          const targetFactor = Number(targetPres.unitsPerPresentation)
          if (!Number.isFinite(sourceFactor) || sourceFactor <= 0) {
            throw Object.assign(new Error('Invalid source unitsPerPresentation'), { statusCode: 400 })
          }
          if (!Number.isFinite(targetFactor) || targetFactor <= 0) {
            throw Object.assign(new Error('Invalid target unitsPerPresentation'), { statusCode: 400 })
          }

          const baseSource = input.sourceQuantity * sourceFactor
          const baseTarget = input.targetQuantity * targetFactor
          if (!Number.isFinite(baseSource) || baseSource <= 0) {
            throw Object.assign(new Error('Invalid source quantity'), { statusCode: 400 })
          }
          if (!Number.isFinite(baseTarget) || baseTarget <= 0) {
            throw Object.assign(new Error('Invalid target quantity'), { statusCode: 400 })
          }
          if (baseTarget > baseSource + 1e-9) {
            throw Object.assign(new Error('Target exceeds source'), { statusCode: 400 })
          }

          const remainder = Math.max(0, baseSource - baseTarget)

          let unitPres = await (tx as any).productPresentation.findFirst({
            where: { tenantId, productId: input.productId, isActive: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            select: { id: true, name: true, unitsPerPresentation: true },
          })
          if (!unitPres) {
            unitPres = await (tx as any).productPresentation.create({
              data: {
                tenantId,
                productId: input.productId,
                name: 'Unidad',
                unitsPerPresentation: '1',
                isDefault: true,
                sortOrder: 0,
                isActive: true,
                createdBy: userId,
              },
              select: { id: true, name: true, unitsPerPresentation: true },
            })
          }
          const unitFactor = Number(unitPres.unitsPerPresentation)
          if (!Number.isFinite(unitFactor) || unitFactor !== 1) {
            throw Object.assign(new Error('Unit presentation misconfigured'), { statusCode: 500 })
          }

          const referenceType = 'REPACK'
          const referenceId = input.batchId
          const note = input.note ?? null

          const outResult = await createStockMovementTx(tx, {
            tenantId,
            userId,
            type: 'OUT',
            productId: input.productId,
            batchId: input.batchId,
            fromLocationId: input.locationId,
            toLocationId: null,
            quantity: baseSource,
            presentationId: input.sourcePresentationId,
            presentationQuantity: input.sourceQuantity,
            referenceType,
            referenceId,
            note,
          })

          const inTargetResult = await createStockMovementTx(tx, {
            tenantId,
            userId,
            type: 'IN',
            productId: input.productId,
            batchId: input.batchId,
            fromLocationId: null,
            toLocationId: input.locationId,
            quantity: baseTarget,
            presentationId: input.targetPresentationId,
            presentationQuantity: input.targetQuantity,
            referenceType,
            referenceId,
            note,
          })

          const remainderResult = remainder > 1e-9
            ? await createStockMovementTx(tx, {
                tenantId,
                userId,
                type: 'IN',
                productId: input.productId,
                batchId: input.batchId,
                fromLocationId: null,
                toLocationId: input.locationId,
                quantity: remainder,
                presentationId: unitPres.id,
                presentationQuantity: remainder,
                referenceType,
                referenceId,
                note,
              })
            : null

          const balances = [outResult.fromBalance, inTargetResult.toBalance, remainderResult?.toBalance].filter(Boolean)
          const uniqueBalances = Array.from(new Map(balances.map((b: any) => [b.id, b])).values())

          return {
            createdMovements: [outResult.createdMovement, inTargetResult.createdMovement, remainderResult?.createdMovement].filter(Boolean),
            balances: uniqueBalances,
          }
        })

        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'stock.repack.create',
          entityType: 'Batch',
          entityId: input.batchId,
          after: result,
        })

        const room = `tenant:${tenantId}`
        for (const m of result.createdMovements) app.io?.to(room).emit('stock.movement.created', m)
        for (const b of result.balances) app.io?.to(room).emit('stock.balance.changed', b)

        return reply.status(201).send(result)
      } catch (e: any) {
        if (e?.code === 'BATCH_EXPIRED') {
          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.expiry.blocked',
            entityType: 'Batch',
            entityId: e?.meta?.batchId ?? null,
            metadata: { operation: 'stock.repack.create', ...e.meta },
          })
          return reply.status(409).send({ message: 'Batch expired' })
        }
        throw e
      }
    },
  )
}
