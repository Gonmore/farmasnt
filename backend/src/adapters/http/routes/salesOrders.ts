import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { currentYearUtc, nextSequence } from '../../../application/shared/sequence.js'

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
  customerId: z.string().trim().min(1).optional(),
  customerSearch: z.string().optional(),
  productId: z.string().uuid().optional(),
  deliveryCity: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

const deliveriesQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'DELIVERED', 'ALL']).default('PENDING'),
  cities: z.string().optional(),
})

const orderCreateSchema = z.object({
  quoteId: z.string().uuid(),
})

const orderConfirmSchema = z.object({
  version: z.number().int().positive(),
})

const orderFulfillSchema = z.object({
  version: z.number().int().positive(),
  fromLocationId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
})

const orderDeliverSchema = z.object({
  version: z.number().int().positive(),
  fromLocationId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
})

type LockedBalanceRow = { id: string; quantity: string }

type LockedBalanceForDeliveryRow = {
  id: string
  quantity: string
  reservedQuantity: string
  locationId: string
  productId: string
  batchId: string | null
}

async function fulfillOrderInTx(
  tx: any,
  args: {
    tenantId: string
    orderId: string
    userId: string
    version: number
    fromLocationId: string
    note?: string
    deliveredAt?: Date
  },
): Promise<{ orderBefore: any; updatedOrder: any; createdMovements: any[]; changedBalances: any[] }> {
  const todayUtc = startOfTodayUtc()

  const order = await tx.salesOrder.findFirst({
    where: { id: args.orderId, tenantId: args.tenantId },
    select: { id: true, number: true, status: true, version: true, customerId: true, paymentMode: true },
  })
  if (!order) {
    const err = new Error('Not found') as Error & { statusCode?: number }
    err.statusCode = 404
    throw err
  }
  if (order.version !== args.version) {
    const err = new Error('Version conflict') as Error & { statusCode?: number }
    err.statusCode = 409
    throw err
  }
  if (order.status !== 'CONFIRMED') {
    const err = new Error('Only CONFIRMED orders can be fulfilled') as Error & { statusCode?: number }
    err.statusCode = 409
    throw err
  }

  // Order is being fulfilled: release reservations first so reservedQuantity doesn't linger.
  await releaseReservationsForOrder(tx, { tenantId: args.tenantId, orderId: order.id, userId: args.userId })

  const location = await tx.location.findFirst({
    where: { id: args.fromLocationId, tenantId: args.tenantId, isActive: true },
    select: { id: true },
  })
  if (!location) {
    const err = new Error('Location not found') as Error & { statusCode?: number }
    err.statusCode = 404
    throw err
  }

  const lines = await tx.salesOrderLine.findMany({
    where: { tenantId: args.tenantId, salesOrderId: order.id },
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
        tenantId: args.tenantId,
        locationId: args.fromLocationId,
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
        tenantId: args.tenantId,
        locationId: args.fromLocationId,
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

  // FEFO auto-pick
  const effectiveBatchIdByLineId = new Map<string, string | null>()
  for (const line of lines) {
    const qty = Number(line.quantity)
    if (!line.batchId) {
      const chosen = await selectFefoBatchId(line.productId, qty)
      effectiveBatchIdByLineId.set(line.id, chosen)
      if (chosen) {
        await tx.salesOrderLine.update({ where: { id: line.id }, data: { batchId: chosen, createdBy: args.userId } })
      }
    } else {
      effectiveBatchIdByLineId.set(line.id, line.batchId)
    }
  }

  // Expiry rule
  for (const line of lines) {
    const batchId = effectiveBatchIdByLineId.get(line.id) ?? null
    if (!batchId) continue
    const batch = await tx.batch.findFirst({
      where: { id: batchId, tenantId: args.tenantId, productId: line.productId },
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
        WHERE "tenantId" = ${args.tenantId} AND "locationId" = ${args.fromLocationId} AND "productId" = ${productId} AND "batchId" IS NULL
        FOR UPDATE
      `
      return rows[0] ?? null
    }
    const rows = await tx.$queryRaw<LockedBalanceRow[]>`
      SELECT "id", "quantity" FROM "InventoryBalance"
      WHERE "tenantId" = ${args.tenantId} AND "locationId" = ${args.fromLocationId} AND "productId" = ${productId} AND "batchId" = ${batchId}
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
      where: { tenantId: args.tenantId, locationId: args.fromLocationId, productId: line.productId, batchId },
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
          data: { quantity: decimalFromNumber(nextQty), version: { increment: 1 }, createdBy: args.userId },
          select: { id: true, locationId: true, productId: true, batchId: true, quantity: true, version: true, updatedAt: true },
        })
      : await tx.inventoryBalance.create({
          data: {
            tenantId: args.tenantId,
            locationId: args.fromLocationId,
            productId: line.productId,
            batchId,
            quantity: decimalFromNumber(nextQty),
            createdBy: args.userId,
          },
          select: { id: true, locationId: true, productId: true, batchId: true, quantity: true, version: true, updatedAt: true },
        })

    changedBalances.push(balance)

    const seq = await nextSequence(tx, { tenantId: args.tenantId, year, key: 'MS' })
    const movement = await tx.stockMovement.create({
      data: {
        tenantId: args.tenantId,
        number: seq.number,
        numberYear: year,
        type: 'OUT',
        productId: line.productId,
        batchId,
        fromLocationId: args.fromLocationId,
        toLocationId: null,
        quantity: decimalFromNumber(qty),
        referenceType: 'SALES_ORDER',
        referenceId: order.number,
        note: args.note ?? null,
        createdBy: args.userId,
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
    data: {
      status: 'FULFILLED',
      ...(args.deliveredAt !== undefined ? { deliveredAt: args.deliveredAt } : {}),
      version: { increment: 1 },
      createdBy: args.userId,
    },
    select: { id: true, number: true, status: true, version: true, paymentMode: true, deliveredAt: true, updatedAt: true },
  })

  return { orderBefore: order, updatedOrder, createdMovements, changedBalances }
}

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

function toNumber(value: any): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function addDaysUtc(date: Date, days: number): Date {
  const ms = date.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1000
  return new Date(ms)
}

function parseCreditDays(paymentMode: string): number {
  const mode = (paymentMode ?? '').trim().toUpperCase()
  if (mode === 'CASH') return 0
  const m = mode.match(/^CREDIT_(\d{1,3})$/)
  if (!m) return 0
  const days = Number(m[1])
  return Number.isFinite(days) ? Math.max(0, days) : 0
}

async function reserveForOrder(
  tx: any,
  args: {
    tenantId: string
    userId: string
    orderId: string
    preferCity?: string | null
    lines: Array<{ id: string; productId: string; batchId: string | null; quantity: any }>
  },
): Promise<void> {
  const todayUtc = startOfTodayUtc()
  const preferCity = typeof args.preferCity === 'string' ? args.preferCity.trim().toUpperCase() : null

  // Reserve from balances across tenant (FEFO). If stock is insufficient, reserve partially.
  for (const line of args.lines) {
    let remaining = Math.max(0, toNumber(line.quantity))
    if (remaining <= 0) continue

    // Important: same balances can appear in multiple passes (sameCity + anyCity).
    // De-duplicate to avoid over-reserving using stale reservedQuantity values.
    const seenBalanceIds = new Set<string>()

    // If line specifies a batch, reserve only from that batch.
    const lists: any[][] = []

    if (line.batchId) {
      if (preferCity) {
        const sameCity = await tx.inventoryBalance.findMany({
          where: {
            tenantId: args.tenantId,
            productId: line.productId,
            batchId: line.batchId,
            quantity: { gt: 0 },
            location: { isActive: true, warehouse: { isActive: true, city: preferCity } },
            batch: { status: 'RELEASED', OR: [{ expiresAt: null }, { expiresAt: { gte: todayUtc } }] },
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          select: { id: true, quantity: true, reservedQuantity: true },
        })
        lists.push(sameCity)
      }

      const anyCity = await tx.inventoryBalance.findMany({
        where: {
          tenantId: args.tenantId,
          productId: line.productId,
          batchId: line.batchId,
          quantity: { gt: 0 },
          location: { isActive: true, warehouse: { isActive: true } },
          batch: { status: 'RELEASED', OR: [{ expiresAt: null }, { expiresAt: { gte: todayUtc } }] },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, quantity: true, reservedQuantity: true },
      })
      lists.push(anyCity)
    } else {
      const locBase = { isActive: true, warehouse: { isActive: true } }

      const sameCityLoc = preferCity ? { isActive: true, warehouse: { isActive: true, city: preferCity } } : null

      if (sameCityLoc) {
        const withExpirySame = await tx.inventoryBalance.findMany({
          where: {
            tenantId: args.tenantId,
            productId: line.productId,
            batchId: { not: null },
            quantity: { gt: 0 },
            location: sameCityLoc,
            batch: { status: 'RELEASED', expiresAt: { not: null, gte: todayUtc } },
          },
          orderBy: [{ batch: { expiresAt: 'asc' } }, { updatedAt: 'desc' }, { id: 'asc' }],
          select: { id: true, quantity: true, reservedQuantity: true },
        })

        const withoutExpirySame = await tx.inventoryBalance.findMany({
          where: {
            tenantId: args.tenantId,
            productId: line.productId,
            batchId: { not: null },
            quantity: { gt: 0 },
            location: sameCityLoc,
            batch: { status: 'RELEASED', expiresAt: null },
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          select: { id: true, quantity: true, reservedQuantity: true },
        })

        const unbatchedSame = await tx.inventoryBalance.findMany({
          where: {
            tenantId: args.tenantId,
            productId: line.productId,
            batchId: null,
            quantity: { gt: 0 },
            location: sameCityLoc,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          select: { id: true, quantity: true, reservedQuantity: true },
        })

        lists.push(withExpirySame, withoutExpirySame, unbatchedSame)
      }

      const withExpiryAny = await tx.inventoryBalance.findMany({
        where: {
          tenantId: args.tenantId,
          productId: line.productId,
          batchId: { not: null },
          quantity: { gt: 0 },
          location: locBase,
          batch: { status: 'RELEASED', expiresAt: { not: null, gte: todayUtc } },
        },
        orderBy: [{ batch: { expiresAt: 'asc' } }, { updatedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, quantity: true, reservedQuantity: true },
      })

      const withoutExpiryAny = await tx.inventoryBalance.findMany({
        where: {
          tenantId: args.tenantId,
          productId: line.productId,
          batchId: { not: null },
          quantity: { gt: 0 },
          location: locBase,
          batch: { status: 'RELEASED', expiresAt: null },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, quantity: true, reservedQuantity: true },
      })

      const unbatchedAny = await tx.inventoryBalance.findMany({
        where: {
          tenantId: args.tenantId,
          productId: line.productId,
          batchId: null,
          quantity: { gt: 0 },
          location: locBase,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, quantity: true, reservedQuantity: true },
      })

      lists.push(withExpiryAny, withoutExpiryAny, unbatchedAny)
    }

    for (const balances of lists) {
      for (const b of balances) {
        if (remaining <= 0) break
        if (seenBalanceIds.has(b.id)) continue
        seenBalanceIds.add(b.id)
        const qty = toNumber(b.quantity)
        const reserved = toNumber(b.reservedQuantity)
        const available = Math.max(0, qty - reserved)
        if (available <= 0) continue

        const take = Math.min(available, remaining)
        remaining -= take

        await tx.inventoryBalance.update({
          where: { id: b.id },
          data: { reservedQuantity: { increment: take }, version: { increment: 1 }, createdBy: args.userId },
          select: { id: true },
        })

        await tx.salesOrderReservation.create({
          data: {
            tenantId: args.tenantId,
            salesOrderId: args.orderId,
            salesOrderLineId: line.id,
            inventoryBalanceId: b.id,
            quantity: decimalFromNumber(take),
            createdBy: args.userId,
          },
          select: { id: true },
        })
      }
      if (remaining <= 0) break
    }
  }
}

async function releaseReservationsForOrder(tx: any, args: { tenantId: string; orderId: string; userId: string }): Promise<void> {
  const reservations = await tx.salesOrderReservation.findMany({
    where: { tenantId: args.tenantId, salesOrderId: args.orderId },
    select: { id: true, inventoryBalanceId: true, quantity: true },
  })
  if (reservations.length === 0) return

  for (const r of reservations) {
    const q = toNumber(r.quantity)
    if (q > 0) {
      await tx.inventoryBalance.update({
        where: { id: r.inventoryBalanceId },
        data: { reservedQuantity: { decrement: q }, version: { increment: 1 }, createdBy: args.userId },
        select: { id: true },
      })
    }
  }

  await tx.salesOrderReservation.updateMany({
    where: { tenantId: args.tenantId, salesOrderId: args.orderId, releasedAt: null },
    data: { releasedAt: new Date() },
  })
}

export async function registerSalesOrderRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)

  function branchCityOf(request: any): string | null {
    if (request.auth?.isTenantAdmin) return null
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    const city = String(request.auth?.warehouseCity ?? '').trim()
    return city ? city.toUpperCase() : '__MISSING__'
  }

  // Deliveries (read-side): orders pending delivery / delivered.
  // Pending maps to DRAFT+CONFIRMED to support older orders created before we set CONFIRMED on quote processing.
  app.get(
    '/api/v1/sales/deliveries',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesDeliveryRead)],
    },
    async (request, reply) => {
      const parsed = deliveriesQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }
      const statuses = parsed.data.status === 'DELIVERED' ? (['FULFILLED'] as const) : parsed.data.status === 'ALL' ? (['DRAFT', 'CONFIRMED', 'FULFILLED'] as const) : (['DRAFT', 'CONFIRMED'] as const)
      const cities = branchCity ? [branchCity] : parsed.data.cities ? parsed.data.cities.split(',').map(c => c.toUpperCase().trim()).filter(c => c) : undefined
      const cityDeliveryFilters = cities?.map((city) => ({ deliveryCity: { equals: city, mode: 'insensitive' as const } }))
      const cityCustomerFilters = cities?.map((city) => ({ customer: { city: { equals: city, mode: 'insensitive' as const } } }))

      const items = await db.salesOrder.findMany({
        where: {
          tenantId,
          status: { in: statuses as any },
          ...(cities
            ? {
                // Keep in sync with reports/sales/by-city logic: prefer order.deliveryCity, fallback to customer.city.
                OR: [
                  { OR: cityDeliveryFilters ?? [] },
                  { AND: [{ OR: [{ deliveryCity: null }, { deliveryCity: '' }] }, { OR: cityCustomerFilters ?? [] }] },
                ],
              }
            : {}),
        },
        take: parsed.data.take,
        ...(parsed.data.cursor
          ? {
              skip: 1,
              cursor: { id: parsed.data.cursor },
            }
          : {}),
        orderBy: [{ deliveryDate: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          number: true,
          status: true,
          version: true,
          updatedAt: true,
          createdBy: true,
          deliveryDate: true,
          deliveryCity: true,
          deliveryZone: true,
          deliveryAddress: true,
          deliveryMapsUrl: true,
          customer: { select: { id: true, name: true } },
        },
      })

      const authorIds = Array.from(new Set(items.map((o: any) => o.createdBy).filter(Boolean))) as string[]
      const authors = authorIds.length
        ? await db.user.findMany({ where: { tenantId, id: { in: authorIds } }, select: { id: true, fullName: true, email: true } })
        : []
      const authorMap = new Map(authors.map((u: any) => [u.id, (u.fullName ?? '').trim() || u.email] as const))

      const mapped = items.map((o: any) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        version: o.version,
        updatedAt: o.updatedAt.toISOString(),
        customerId: o.customer.id,
        customerName: o.customer.name,
        processedBy: o.createdBy ? authorMap.get(o.createdBy) ?? null : null,
        deliveryDate: o.deliveryDate ? o.deliveryDate.toISOString() : null,
        deliveryCity: o.deliveryCity,
        deliveryZone: o.deliveryZone,
        deliveryAddress: o.deliveryAddress,
        deliveryMapsUrl: o.deliveryMapsUrl,
      }))

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items: mapped, nextCursor })
    },
  )

  app.get(
    '/api/v1/sales/quotes/next-number',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const year = currentYearUtc()

      const next = await db.$transaction((tx) => nextSequence(tx, { tenantId, year, key: 'COT' }))
      return reply.send({ number: next.number })
    },
  )

  app.post(
    '/api/v1/sales/orders',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const parsed = orderCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      // New rule: orders must be created from an existing quote.
      // Use POST /api/v1/sales/quotes/:id/process
      return reply.status(400).send({ message: 'Orders must be created from a quote. Use /api/v1/sales/quotes/:id/process' })
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
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const where: any = { tenantId, ...(parsed.data.status ? { status: parsed.data.status } : {}) }
      if (parsed.data.customerId) {
        where.customerId = parsed.data.customerId
      }
      if (parsed.data.customerSearch) {
        where.customer = {
          name: { contains: parsed.data.customerSearch, mode: 'insensitive' },
        }
      }
      if (parsed.data.deliveryCity) {
        const city = parsed.data.deliveryCity.trim()
        if (city.toLowerCase() === 'sin ciudad') {
          where.OR = [
            { deliveryCity: null },
            { deliveryCity: '' },
            { customer: { city: null } },
            { customer: { city: '' } },
          ]
        } else {
          // Keep in sync with reports/sales/by-city logic: prefer order.deliveryCity, fallback to customer.city.
          where.OR = [
            { deliveryCity: city },
            {
              AND: [
                { OR: [{ deliveryCity: null }, { deliveryCity: '' }] },
                { customer: { city } },
              ],
            },
          ]
        }
      }
      if (parsed.data.productId) {
        where.lines = {
          some: {
            productId: parsed.data.productId,
          },
        }
      }
      if (parsed.data.from || parsed.data.to) {
        where.createdAt = {}
        if (parsed.data.from) where.createdAt.gte = parsed.data.from
        if (parsed.data.to) where.createdAt.lt = parsed.data.to
      }
      if (branchCity) {
        where.AND = [
          ...(where.AND ?? []),
          {
            OR: [
              { deliveryCity: { equals: branchCity, mode: 'insensitive' as const } },
              { AND: [{ OR: [{ deliveryCity: null }, { deliveryCity: '' }] }, { customer: { city: { equals: branchCity, mode: 'insensitive' as const } } }] },
            ],
          },
        ]
      }

      const items = await db.salesOrder.findMany({
        where,
        take: parsed.data.take,
        ...(parsed.data.cursor
          ? {
              skip: 1,
              cursor: { id: parsed.data.cursor },
            }
          : {}),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          createdBy: true,
          deliveredAt: true,
          paidAt: true,
          deliveryDate: true,
          deliveryCity: true,
          deliveryZone: true,
          deliveryAddress: true,
          deliveryMapsUrl: true,
          customer: { select: { id: true, name: true } },
          quote: { select: { id: true, number: true } },
          lines: {
            select: {
              quantity: true,
              unitPrice: true,
            },
          },
        },
      })

      const authorIds = Array.from(new Set(items.map((o: any) => o.createdBy).filter(Boolean))) as string[]
      const authors = authorIds.length
        ? await db.user.findMany({ where: { tenantId, id: { in: authorIds } }, select: { id: true, fullName: true, email: true } })
        : []
      const authorMap = new Map(authors.map((u: any) => [u.id, (u.fullName ?? '').trim() || u.email] as const))

      const mapped = items.map((o: any) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
        customerId: o.customer.id,
        customerName: o.customer.name,
        quoteId: o.quote?.id ?? null,
        quoteNumber: o.quote?.number ?? null,
        processedBy: o.createdBy ? authorMap.get(o.createdBy) ?? null : null,
        deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
        paidAt: o.paidAt ? o.paidAt.toISOString() : null,
        deliveryDate: o.deliveryDate ? o.deliveryDate.toISOString() : null,
        deliveryCity: o.deliveryCity,
        deliveryZone: o.deliveryZone,
        deliveryAddress: o.deliveryAddress,
        deliveryMapsUrl: o.deliveryMapsUrl,
        total: o.lines.reduce((sum: number, l: any) => sum + (toNumber(l.quantity) * toNumber(l.unitPrice)), 0),
      }))

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items: mapped, nextCursor })
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
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const order = await db.salesOrder.findFirst({
        where: {
          id,
          tenantId,
          ...(branchCity
            ? {
                OR: [
                  { deliveryCity: { equals: branchCity, mode: 'insensitive' as const } },
                  { AND: [{ OR: [{ deliveryCity: null }, { deliveryCity: '' }] }, { customer: { city: { equals: branchCity, mode: 'insensitive' as const } } }] },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          number: true,
          customerId: true,
          quoteId: true,
          status: true,
          note: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          createdBy: true,
          deliveryDate: true,
          deliveryCity: true,
          deliveryZone: true,
          deliveryAddress: true,
          deliveryMapsUrl: true,
          customer: { select: { id: true, name: true, nit: true } },
          quote: { select: { id: true, number: true } },
          lines: {
            select: {
              id: true,
              productId: true,
              batchId: true,
              quantity: true,
              presentationId: true,
              presentationQuantity: true,
              unitPrice: true,
              product: { select: { sku: true, name: true, genericName: true } },
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
          },
        },
      })

      if (!order) return reply.status(404).send({ message: 'Not found' })

      const processedBy = await (async () => {
        if (!order.createdBy) return null
        const u = await db.user.findFirst({ where: { id: order.createdBy, tenantId }, select: { fullName: true, email: true } })
        if (!u) return null
        return (u.fullName ?? '').trim() || u.email
      })()

      return reply.send({
        ...order,
        processedBy,
        lines: order.lines.map((l: any) => ({
          id: l.id,
          productId: l.productId,
          batchId: l.batchId ?? null,
          quantity: l.quantity,
          presentationId: l.presentationId ?? null,
          presentationName: l.presentation?.name ?? null,
          unitsPerPresentation: l.presentation?.unitsPerPresentation ? Number(l.presentation.unitsPerPresentation) : null,
          presentationQuantity: l.presentationQuantity !== null && l.presentationQuantity !== undefined ? Number(l.presentationQuantity) : null,
          unitPrice: l.unitPrice,
          product: l.product,
        })),
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
      })
    },
  )

  // Read-side: reservations/picking detail for an order.
  app.get(
    '/api/v1/sales/orders/:id/reservations',
    {
      preHandler: [
        requireAuth(),
        requireModuleEnabled(db, 'SALES'),
        requireModuleEnabled(db, 'WAREHOUSE'),
        requirePermission(Permissions.SalesOrderRead),
        requirePermission(Permissions.StockRead),
      ],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const order = await db.salesOrder.findFirst({
        where: {
          id,
          tenantId,
          ...(branchCity
            ? {
                OR: [
                  { deliveryCity: { equals: branchCity, mode: 'insensitive' as const } },
                  { AND: [{ OR: [{ deliveryCity: null }, { deliveryCity: '' }] }, { customer: { city: { equals: branchCity, mode: 'insensitive' as const } } }] },
                ],
              }
            : {}),
        },
        select: { id: true, number: true, createdAt: true, deliveredAt: true, status: true },
      })
      if (!order) return reply.status(404).send({ message: 'Not found' })

      try {
        // Check if order is fulfilled
        const isFulfilled = order.status === 'FULFILLED'

        const reservations = await db.salesOrderReservation.findMany({
          where: {
            tenantId,
            salesOrderId: order.id,
            ...(isFulfilled ? {} : { releasedAt: null }),
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            inventoryBalanceId: true,
            quantity: true,
            createdAt: true,
            releasedAt: true,
            line: {
              select: {
                presentationId: true,
                presentationQuantity: true,
                presentation: { select: { name: true, unitsPerPresentation: true } }
              }
            }
          },
        })

        if (reservations.length > 0) {
          // Show reservations
          const balanceIds = reservations.map(r => r.inventoryBalanceId)
          const balances = balanceIds.length > 0 ? await db.inventoryBalance.findMany({
            where: { id: { in: balanceIds } },
            select: {
              id: true,
              productId: true,
              batchId: true,
              locationId: true,
              product: { 
                select: { 
                  sku: true, 
                  name: true, 
                  genericName: true,
                  presentations: { 
                    select: { name: true, unitsPerPresentation: true }, 
                    where: { isActive: true, isDefault: true }, 
                    take: 1 
                  }
                } 
              },
              batch: { select: { batchNumber: true, expiresAt: true } },
              location: { select: { code: true, warehouse: { select: { id: true, code: true, name: true } } } },
            },
          }) : []

          const balanceMap = new Map(balances.map(b => [b.id, b]))

          return reply.send({
            items: reservations.map((r) => {
              const balance = balanceMap.get(r.inventoryBalanceId)
              const presentation = r.line?.presentation
              return {
                id: r.id,
                inventoryBalanceId: r.inventoryBalanceId,
                quantity: Number(r.quantity ?? 0),
                createdAt: r.createdAt.toISOString(),
                releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
                productId: balance?.productId ?? null,
                productSku: balance?.product?.sku ?? null,
                productName: balance?.product?.name ?? null,
                genericName: balance?.product?.genericName ?? null,
                batchId: balance?.batchId ?? null,
                batchNumber: balance?.batch?.batchNumber ?? null,
                expiresAt: balance?.batch?.expiresAt ? balance.batch.expiresAt.toISOString() : null,
                locationId: balance?.locationId ?? null,
                locationCode: balance?.location?.code ?? null,
                warehouseId: balance?.location?.warehouse?.id ?? null,
                warehouseCode: balance?.location?.warehouse?.code ?? null,
                warehouseName: balance?.location?.warehouse?.name ?? null,
                presentationName: presentation?.name ?? null,
                unitsPerPresentation: presentation ? Number(presentation.unitsPerPresentation) : null,
                presentationQuantity: r.line?.presentationQuantity ? Number(r.line.presentationQuantity) : null,
              }
            }),
          })
        } else {
          // No reservations found.
          // If the order is already delivered, rebuild the picking view from stock movements (source of truth).
          if (isFulfilled) {
            const movements = await db.stockMovement.findMany({
              where: {
                tenantId,
                type: 'OUT',
                referenceType: 'SALES_ORDER',
                referenceId: order.number,
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                productId: true,
                batchId: true,
                fromLocationId: true,
                quantity: true,
                createdAt: true,
                product: { 
                  select: { 
                    sku: true, 
                    name: true, 
                    genericName: true,
                    presentations: { 
                      select: { name: true, unitsPerPresentation: true }, 
                      where: { isActive: true, isDefault: true }, 
                      take: 1 
                    }
                  } 
                },
                batch: { select: { batchNumber: true, expiresAt: true } },
              },
            })

            const locationIds = [...new Set(movements.map((m) => m.fromLocationId).filter((v): v is string => !!v))]
            const locations = locationIds.length
              ? await db.location.findMany({
                  where: { tenantId, id: { in: locationIds } },
                  select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true } } },
                })
              : []
            const locationMap = new Map(locations.map((l) => [l.id, l]))

            return reply.send({
              items: movements.map((m) => {
                const loc = m.fromLocationId ? locationMap.get(m.fromLocationId) : undefined
                const presentation = m.product?.presentations?.[0]
                return {
                  id: m.id,
                  inventoryBalanceId: null,
                  quantity: Number(m.quantity ?? 0),
                  createdAt: m.createdAt.toISOString(),
                  releasedAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
                  productId: m.productId,
                  productSku: m.product?.sku ?? null,
                  productName: m.product?.name ?? null,
                  genericName: m.product?.genericName ?? null,
                  batchId: m.batchId ?? null,
                  batchNumber: m.batch?.batchNumber ?? null,
                  expiresAt: m.batch?.expiresAt ? m.batch.expiresAt.toISOString() : null,
                  locationId: m.fromLocationId ?? null,
                  locationCode: loc?.code ?? null,
                  warehouseId: loc?.warehouse?.id ?? null,
                  warehouseCode: loc?.warehouse?.code ?? null,
                  warehouseName: loc?.warehouse?.name ?? null,
                  presentationName: presentation?.name ?? null,
                  unitsPerPresentation: presentation ? Number(presentation.unitsPerPresentation) : null,
                }
              }),
            })
          }

          // Not delivered and no reservations: show order lines as a fallback summary.
          const lines = await db.salesOrderLine.findMany({
            where: { tenantId, salesOrderId: order.id },
            select: {
              id: true,
              productId: true,
              quantity: true,
              product: { 
                select: { 
                  sku: true, 
                  name: true, 
                  genericName: true,
                  presentations: { 
                    select: { name: true, unitsPerPresentation: true }, 
                    where: { isActive: true, isDefault: true }, 
                    take: 1 
                  }
                } 
              },
            },
          })

          return reply.send({
            items: lines.map((line) => {
              const presentation = line.product?.presentations?.[0]
              return {
                id: line.id,
                inventoryBalanceId: null,
                quantity: Number(line.quantity ?? 0),
                createdAt: order.createdAt.toISOString(),
                releasedAt: null,
                productId: line.productId,
                productSku: line.product?.sku ?? null,
                productName: line.product?.name ?? null,
                genericName: line.product?.genericName ?? null,
                batchId: null,
                batchNumber: null,
                expiresAt: null,
                locationId: null,
                locationCode: null,
                warehouseId: null,
                warehouseCode: null,
                warehouseName: null,
                presentationName: presentation?.name ?? null,
                unitsPerPresentation: presentation ? Number(presentation.unitsPerPresentation) : null,
              }
            }),
          })
        }
      } catch (error) {
        console.error('Error fetching reservations for order', order.id, ':', (error as any).message, (error as any).stack)
        return reply.status(500).send({ message: 'Error interno del servidor al cargar reservas' })
      }
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
      console.log(`Emitted sales.order.confirmed to tenant:${tenantId}`, updated)

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

      try {
        const result = await db.$transaction((tx) =>
          fulfillOrderInTx(tx, {
            tenantId,
            orderId: id,
            userId,
            version: parsed.data.version,
            fromLocationId,
            ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
          }),
        )

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
      console.log(`Emitted sales.order.fulfilled to ${room}`, result.updatedOrder)
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

  // Deliver: fulfill an order by consuming its reservations (reserved -> stock out) and marking it as FULFILLED.
  app.post(
    '/api/v1/sales/orders/:id/deliver',
    {
      preHandler: [
        requireAuth(),
        requireModuleEnabled(db, 'SALES'),
        requireModuleEnabled(db, 'WAREHOUSE'),
        requirePermission(Permissions.SalesDeliveryWrite),
        requirePermission(Permissions.StockDeliver),
      ],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const parsed = orderDeliverSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      try {
        const deliveredAt = new Date()
        const result = await db.$transaction(async (tx) => {
          const order = await tx.salesOrder.findFirst({
            where: {
              id,
              tenantId,
              ...(branchCity
                ? {
                    OR: [
                      { deliveryCity: { equals: branchCity, mode: 'insensitive' as const } },
                      { AND: [{ OR: [{ deliveryCity: null }, { deliveryCity: '' }] }, { customer: { city: { equals: branchCity, mode: 'insensitive' as const } } }] },
                    ],
                  }
                : {}),
            },
            select: { id: true, number: true, status: true, version: true, paymentMode: true },
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
          if (order.status === 'FULFILLED') {
            const err = new Error('Order already delivered') as Error & { statusCode?: number }
            err.statusCode = 409
            throw err
          }
          if (order.status === 'CANCELLED') {
            const err = new Error('Cancelled orders cannot be delivered') as Error & { statusCode?: number }
            err.statusCode = 409
            throw err
          }

          const reservations = await tx.salesOrderReservation.findMany({
            where: { tenantId, salesOrderId: order.id },
            select: { id: true, inventoryBalanceId: true, quantity: true },
          })

          // If there are no reservations, fall back to the classic fulfillment flow (requires fromLocationId).
          if (reservations.length === 0) {
            if (!parsed.data.fromLocationId) {
              const err = new Error('Order has no reservations; provide fromLocationId or use /fulfill') as Error & { statusCode?: number }
              err.statusCode = 409
              throw err
            }
            return fulfillOrderInTx(tx, {
              tenantId,
              orderId: order.id,
              userId,
              version: parsed.data.version,
              fromLocationId: parsed.data.fromLocationId,
              deliveredAt,
              ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
            })
          }

          const todayUtc = startOfTodayUtc()

          const qtyByBalanceId = new Map<string, number>()
          for (const r of reservations) {
            const q = toNumber(r.quantity)
            if (q <= 0) continue
            qtyByBalanceId.set(r.inventoryBalanceId, (qtyByBalanceId.get(r.inventoryBalanceId) ?? 0) + q)
          }
          const balanceIds = Array.from(qtyByBalanceId.keys())

          // Lock balances to avoid concurrent stock/reservation changes.
          const locked: LockedBalanceForDeliveryRow[] = []
          for (const bid of balanceIds) {
            const rows = await tx.$queryRaw<LockedBalanceForDeliveryRow[]>`
              SELECT "id", "quantity", "reservedQuantity", "locationId", "productId", "batchId"
              FROM "InventoryBalance"
              WHERE "tenantId" = ${tenantId} AND "id" = ${bid}
              FOR UPDATE
            `
            if (rows[0]) locked.push(rows[0])
          }

          // Expiry rule: if balance is tied to a batch, it must not be expired.
          for (const b of locked) {
            if (!b.batchId) continue
            const batch = await tx.batch.findFirst({
              where: { id: b.batchId, tenantId, productId: b.productId },
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

          const lockedById = new Map(locked.map((r) => [r.id, r]))

          const changedBalances: any[] = []
          const createdMovements: any[] = []
          const year = currentYearUtc()

          for (const [balanceId, q] of qtyByBalanceId.entries()) {
            const b = lockedById.get(balanceId)
            if (!b) {
              const err = new Error('Inventory balance not found') as Error & { statusCode?: number }
              err.statusCode = 404
              throw err
            }

            const curQty = toNumber(b.quantity)
            const curRes = toNumber(b.reservedQuantity)
            const nextQty = curQty - q
            const nextRes = curRes - q
            if (nextQty < 0) {
              const err = new Error('Insufficient stock') as Error & { statusCode?: number }
              err.statusCode = 409
              throw err
            }
            if (nextRes < 0) {
              const err = new Error('Reserved quantity inconsistency') as Error & { statusCode?: number }
              err.statusCode = 409
              throw err
            }

            const updatedBalance = await tx.inventoryBalance.update({
              where: { id: balanceId },
              data: {
                quantity: decimalFromNumber(nextQty),
                reservedQuantity: decimalFromNumber(nextRes),
                version: { increment: 1 },
                createdBy: userId,
              },
              select: {
                id: true,
                locationId: true,
                productId: true,
                batchId: true,
                quantity: true,
                reservedQuantity: true,
                version: true,
                updatedAt: true,
              },
            })
            changedBalances.push(updatedBalance)

            const seq = await nextSequence(tx, { tenantId, year, key: 'MS' })
            const movement = await tx.stockMovement.create({
              data: {
                tenantId,
                number: seq.number,
                numberYear: year,
                type: 'OUT',
                productId: b.productId,
                batchId: b.batchId,
                fromLocationId: b.locationId,
                toLocationId: null,
                quantity: decimalFromNumber(q),
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

          // Preserve picking history: mark reservations as released instead of deleting them.
          await tx.salesOrderReservation.updateMany({
            where: { tenantId, salesOrderId: order.id, releasedAt: null },
            data: { releasedAt: deliveredAt },
          })

          const updatedOrder = await tx.salesOrder.update({
            where: { id: order.id },
            data: { status: 'FULFILLED', deliveredAt, version: { increment: 1 }, createdBy: userId },
            select: { id: true, number: true, status: true, version: true, paymentMode: true, deliveredAt: true, updatedAt: true },
          })

          return { orderBefore: order, updatedOrder, createdMovements, changedBalances }
        })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'sales.order.deliver',
        entityType: 'SalesOrder',
        entityId: id,
        before: result.orderBefore,
        after: { order: result.updatedOrder, movements: result.createdMovements, balances: result.changedBalances },
      })

      const room = `tenant:${tenantId}`
      console.log(`Emitted sales.order.delivered to ${room}`, result.updatedOrder)
      app.io?.to(room).emit('sales.order.delivered', result.updatedOrder)
      for (const m of result.createdMovements) app.io?.to(room).emit('stock.movement.created', m)
      for (const b of result.changedBalances) app.io?.to(room).emit('stock.balance.changed', b)

      // Payment due notification (accounts receivable)
      const creditDays = parseCreditDays(result.updatedOrder.paymentMode)
      const base = result.updatedOrder.deliveredAt ?? new Date()
      const dueAt = addDaysUtc(base, creditDays)
      app.io?.to(room).emit('sales.order.payment.due', {
        id: result.updatedOrder.id,
        number: result.updatedOrder.number,
        paymentMode: result.updatedOrder.paymentMode,
        deliveredAt: result.updatedOrder.deliveredAt?.toISOString() ?? null,
        creditDays,
        dueAt: dueAt.toISOString(),
      })

      return reply.send({ order: result.updatedOrder })
      } catch (e: any) {
        if (e?.code === 'BATCH_EXPIRED') {
          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.expiry.blocked',
            entityType: 'Batch',
            entityId: e?.meta?.batchId ?? null,
            metadata: { operation: 'sales.order.deliver', orderId: id, ...e.meta },
          })
          return reply.status(409).send({ message: 'Batch expired' })
        }
        throw e
      }
    },
  )
}
