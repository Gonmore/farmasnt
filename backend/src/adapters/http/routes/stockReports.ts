import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requireModuleEnabled } from '../../../application/security/rbac.js'
import { getMailer } from '../../../shared/mailer.js'
import {
  dateRangeQuerySchema,
  locationFilterQuerySchema,
  requireStockReportOrBranchAccess,
  reportEmailBodySchema,
  branchOwnWarehouseIdOf,
  resolveBranchWarehouseId,
  branchDepartmentsOfMissing,
} from './reportsShared.js'

const stockBalancesExpandedQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(5000).default(100),
  includeSamples: z.coerce.boolean().optional().default(false),
})

const stockMovementsExpandedQuerySchema = dateRangeQuerySchema.extend({
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(5000).default(1000),
})

const stockInputsByProductQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(200).default(25),
})

const stockExistenciasQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(5000).default(500),
}).merge(locationFilterQuerySchema)

const stockTransfersBetweenWarehousesQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(200).default(50),
})

const stockMovementRequestsOpsQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(500).default(200),
})

const stockMovementRequestsFulfilledQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(500).default(200),
})

const movementRequestTraceParamsSchema = z.object({
  id: z.string().uuid(),
})

const stockReturnsOpsQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(500).default(200),
})

type StockMovementRequestsSummaryRow = {
  total: bigint
  open: bigint
  sent: bigint
  fulfilled: bigint
  cancelled: bigint
  pending: bigint
  accepted: bigint
  rejected: bigint
}

type StockMovementRequestsByCityRow = {
  city: string | null
  total: bigint
  open: bigint
  sent: bigint
  fulfilled: bigint
  cancelled: bigint
  pending: bigint
  accepted: bigint
  rejected: bigint
}

type StockMovementRequestsFlowRow = {
  fromWarehouseId: string | null
  fromWarehouseCode: string | null
  fromWarehouseName: string | null
  toWarehouseId: string | null
  toWarehouseCode: string | null
  toWarehouseName: string | null
  requestsCount: bigint
  avgMinutes: number | null
}

type StockMovementRequestsFulfilledRow = {
  requestId: string
  requestedCity: string | null
  warehouseId: string | null
  warehouseCode: string | null
  warehouseName: string | null
  requestedBy: string
  requestedByName: string | null
  createdAt: Date
  fulfilledAt: Date
  minutesToFulfill: number
  itemsCount: bigint
  requestedQuantity: string | null
  movementsCount: bigint
  sentQuantity: string | null
  fromWarehouseCodes: string | null
  fromLocationCodes: string | null
  toWarehouseCodes: string | null
  toLocationCodes: string | null
}

type StockMovementRequestTraceMovementRow = {
  id: string
  createdAt: Date
  productId: string
  productSku: string | null
  productName: string | null
  genericName: string | null
  batchId: string | null
  batchNumber: string | null
  expiresAt: Date | null
  quantity: string | null
  presentationId: string | null
  presentationName: string | null
  unitsPerPresentation: string | null
  presentationQuantity: string | null
  fromLocationId: string | null
  fromLocationCode: string | null
  fromWarehouseId: string | null
  fromWarehouseCode: string | null
  fromWarehouseName: string | null
  fromWarehouseCity: string | null
  toLocationId: string | null
  toLocationCode: string | null
  toWarehouseId: string | null
  toWarehouseCode: string | null
  toWarehouseName: string | null
  toWarehouseCity: string | null
}

type StockReturnsSummaryRow = {
  returnsCount: bigint
  itemsCount: bigint
  quantity: string | null
}

type StockReturnsByWarehouseRow = {
  warehouseId: string
  warehouseCode: string | null
  warehouseName: string | null
  warehouseCity: string | null
  returnsCount: bigint
  itemsCount: bigint
  quantity: string | null
}

type StockInputsByProductRow = {
  productId: string
  sku: string
  name: string
  movementsCount: bigint
  quantity: string | null
}

type StockTransfersBetweenWarehousesRow = {
  fromWarehouseId: string | null
  fromWarehouseCode: string | null
  fromWarehouseName: string | null
  toWarehouseId: string | null
  toWarehouseCode: string | null
  toWarehouseName: string | null
  movementsCount: bigint
  quantity: string | null
}

type LowStockRow = {
  productId: string
  sku: string
  name: string
  currentStock: string | null
  minStock: string | null
  avgDailySales: string | null
  daysOfStock: string | null
}

type ExpiryAlertRow = {
  productId: string
  sku: string
  name: string
  warehouseId: string
  warehouseCode: string | null
  warehouseName: string | null
  locationId: string
  locationName: string | null
  lotNumber: string | null
  expiryDate: Date | null
  quantity: string | null
}

type ProviderActivityRow = {
  warehouseId: string
  warehouseCode: string | null
  warehouseName: string | null
  warehouseCity: string | null
  batchesCreated: number
  transfersSent: number
  transfersSentQty: string | null
  adjustments: number
  adjustmentsOutQty: string | null
}

type SalesBranchActivityRow = {
  warehouseId: string
  warehouseCode: string | null
  warehouseName: string | null
  warehouseCity: string | null
  batchesReceived: number
  requestsAccepted: number
  requestsRejected: number
  requestsPending: number
  quotesCreated: number
  ordersCreated: number
  salesAmount: string | null
}

export async function registerStockReportRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const mailer = getMailer()

  app.get(
    '/api/v1/reports/stock/balances-expanded',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockBalancesExpandedQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { locationId, productId, take, includeSamples } = parsed.data

      const resolvedWarehouseId = resolveBranchWarehouseId(request, parsed.data.warehouseId, { allowProviderAll: true })
      if (resolvedWarehouseId === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }
      const warehouseId = resolvedWarehouseId ?? undefined

      const items = await db.inventoryBalance.findMany({
        where: {
          tenantId,
          ...(productId ? { productId } : {}),
          ...(locationId ? { locationId } : {}),
          location: {
            ...(warehouseId ? { warehouseId } : {}),
            ...(!includeSamples ? { type: { not: 'SAMPLES' } } : {}),
          },
        },
        take,
        orderBy: [{ updatedAt: 'desc' }],
        select: {
          id: true,
          quantity: true,
          reservedQuantity: true,
          updatedAt: true,
          productId: true,
          batchId: true,
          locationId: true,
          product: { select: { sku: true, name: true, genericName: true, presentationWrapper: true, presentationQuantity: true, presentationFormat: true, presentations: { select: { id: true, name: true, unitsPerPresentation: true, isDefault: true } } } },
          batch: {
            select: {
              id: true,
              batchNumber: true,
              expiresAt: true,
              status: true,
              version: true,
              presentationId: true,
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
          },
          location: {
            select: {
              id: true,
              code: true,
              type: true,
              warehouse: { select: { id: true, code: true, name: true } },
            },
          },
        },
      })

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/stock/inputs-by-product',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockInputsByProductQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, take } = parsed.data

      const rows = await db.$queryRaw<StockInputsByProductRow[]>`
        SELECT
          p.id as "productId",
          p.sku as "sku",
          p.name as "name",
          count(sm.id) as "movementsCount",
          sum(sm.quantity)::text as "quantity"
        FROM "StockMovement" sm
        JOIN "Product" p
          ON p.id = sm."productId"
        WHERE sm."tenantId" = ${tenantId}
          AND sm.type = 'IN'::"StockMovementType"
          AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null})
        GROUP BY p.id, p.sku, p.name
        ORDER BY sum(sm.quantity) DESC NULLS LAST
        LIMIT ${take}
      `

      const items = rows.map((r) => ({
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        movementsCount: Number(r.movementsCount),
        quantity: r.quantity ?? '0',
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/stock/low-stock',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = z.object({ take: z.coerce.number().int().min(1).max(200).default(50) }).safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { take } = parsed.data

      const resolvedWarehouseId = resolveBranchWarehouseId(request, undefined)
      const ownWhId = resolvedWarehouseId === '__MISSING__' ? null : resolvedWarehouseId

      const rows = await db.$queryRaw<LowStockRow[]>`
        WITH current_stock AS (
          SELECT
            ib."productId",
            sum(ib.quantity - ib."reservedQuantity") as total_stock
          FROM "InventoryBalance" ib
          JOIN "Location" loc ON loc.id = ib."locationId" AND loc."tenantId" = ib."tenantId"
          WHERE ib."tenantId" = ${tenantId}
            AND (${ownWhId ?? null}::text IS NULL OR loc."warehouseId" = ${ownWhId ?? null})
          GROUP BY ib."productId"
        ),
        daily_sales AS (
          SELECT
            sol."productId",
            sum(sol.quantity) / 30.0 as avg_daily
          FROM "SalesOrder" so
          JOIN "SalesOrderLine" sol
            ON sol."salesOrderId" = so.id
            AND sol."tenantId" = so."tenantId"
          WHERE so."tenantId" = ${tenantId}
            AND so.status = 'FULFILLED'::"SalesOrderStatus"
            AND so."createdAt" >= now() - interval '30 days'
          GROUP BY sol."productId"
        )
        SELECT
          p.id as "productId",
          p.sku,
          p.name,
          COALESCE(cs.total_stock, 0)::text as "currentStock",
          10::text as "minStock",
          COALESCE(ds.avg_daily, 0)::text as "avgDailySales",
          CASE
            WHEN COALESCE(ds.avg_daily, 0) > 0 THEN (COALESCE(cs.total_stock, 0) / ds.avg_daily)::text
            ELSE null
          END as "daysOfStock"
        FROM "Product" p
        LEFT JOIN current_stock cs ON cs."productId" = p.id
        LEFT JOIN daily_sales ds ON ds."productId" = p.id
        WHERE p."tenantId" = ${tenantId}
          AND p."isActive" = true
          AND (
            COALESCE(cs.total_stock, 0) <= 10
            OR COALESCE(cs.total_stock, 0) < COALESCE(ds.avg_daily * 7, 0)
          )
        ORDER BY COALESCE(cs.total_stock, 0) ASC, p.name ASC
        LIMIT ${take}
      `

      const items = rows.map((r) => ({
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        currentStock: Number(r.currentStock ?? '0'),
        minStock: Number(r.minStock ?? '0'),
        avgDailySales: Number(r.avgDailySales ?? '0'),
        daysOfStock: r.daysOfStock ? Number(r.daysOfStock) : null,
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/stock/expiry-alerts',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = z
        .object({
          daysAhead: z.coerce.number().int().min(1).max(365).default(30),
          take: z.coerce.number().int().min(1).max(200).default(50),
        })
        .safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { daysAhead, take } = parsed.data

      const resolvedWarehouseId = resolveBranchWarehouseId(request, undefined)
      const ownWhId = resolvedWarehouseId === '__MISSING__' ? null : resolvedWarehouseId

      const rows = await db.$queryRaw<ExpiryAlertRow[]>`
        SELECT
          p.id as "productId",
          p.sku,
          p.name,
          w.id as "warehouseId",
          w.code as "warehouseCode",
          w.name as "warehouseName",
          l.id as "locationId",
          l.code as "locationName",
          b."batchNumber" as "lotNumber",
          b."expiresAt" as "expiryDate",
          (ib.quantity - ib."reservedQuantity")::text as "quantity"
        FROM "InventoryBalance" ib
        JOIN "Product" p ON p.id = ib."productId" AND p."tenantId" = ib."tenantId"
        JOIN "Location" l ON l.id = ib."locationId" AND l."tenantId" = ib."tenantId"
        JOIN "Warehouse" w ON w.id = l."warehouseId" AND w."tenantId" = l."tenantId"
        JOIN "Batch" b ON b.id = ib."batchId" AND b."tenantId" = ib."tenantId"
        WHERE ib."tenantId" = ${tenantId}
          AND (${ownWhId ?? null}::text IS NULL OR w.id = ${ownWhId ?? null})
          AND ib."batchId" IS NOT NULL
          AND (ib.quantity - ib."reservedQuantity") > 0
          AND b."expiresAt" IS NOT NULL
          AND b."expiresAt" <= now() + interval '1 day' * ${daysAhead}
        ORDER BY b."expiresAt" ASC
        LIMIT ${take}
      `

      const items = rows.map((r) => ({
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        warehouseId: r.warehouseId,
        warehouseCode: r.warehouseCode,
        warehouseName: r.warehouseName,
        locationId: r.locationId,
        locationName: r.locationName,
        lotNumber: r.lotNumber,
        expiryDate: r.expiryDate?.toISOString().split('T')[0] ?? null,
        quantity: Number(r.quantity ?? '0'),
        daysUntilExpiry: r.expiryDate
          ? Math.ceil((new Date(r.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null,
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/stock/rotation',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = dateRangeQuerySchema.extend({ take: z.coerce.number().int().min(1).max(200).default(50) }).safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, take } = parsed.data

      const resolvedWarehouseId = resolveBranchWarehouseId(request, undefined)
      const ownWhId = resolvedWarehouseId === '__MISSING__' ? null : resolvedWarehouseId

      const rows = await db.$queryRaw<
        {
          productId: string
          sku: string
          name: string
          movementsIn: bigint
          movementsOut: bigint
          qtyIn: string | null
          qtyOut: string | null
          currentStock: string | null
        }[]
      >`
        WITH movement_stats AS (
          SELECT
            sm."productId",
            count(*) FILTER (
              WHERE sm.type = 'IN'::"StockMovementType"
                OR (sm.type = 'ADJUSTMENT'::"StockMovementType" AND sm."toLocationId" IS NOT NULL)
            ) as "movementsIn",
            count(*) FILTER (
              WHERE sm.type = 'OUT'::"StockMovementType"
                OR (sm.type = 'ADJUSTMENT'::"StockMovementType" AND sm."toLocationId" IS NULL)
            ) as "movementsOut",
            sum(sm.quantity) FILTER (
              WHERE sm.type = 'IN'::"StockMovementType"
                OR (sm.type = 'ADJUSTMENT'::"StockMovementType" AND sm."toLocationId" IS NOT NULL)
            )::text as "qtyIn",
            sum(sm.quantity) FILTER (
              WHERE sm.type = 'OUT'::"StockMovementType"
                OR (sm.type = 'ADJUSTMENT'::"StockMovementType" AND sm."toLocationId" IS NULL)
            )::text as "qtyOut"
          FROM "StockMovement" sm
          JOIN "Location" sml ON sml.id = COALESCE(sm."fromLocationId", sm."toLocationId") AND sml."tenantId" = sm."tenantId"
          WHERE sm."tenantId" = ${tenantId}
            AND (${ownWhId ?? null}::text IS NULL OR sml."warehouseId" = ${ownWhId ?? null})
            AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null})
            AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null})
          GROUP BY sm."productId"
        ),
        current_stock AS (
          SELECT
            ib."productId",
            sum(ib.quantity - ib."reservedQuantity")::text as total_stock
          FROM "InventoryBalance" ib
          JOIN "Location" ibloc ON ibloc.id = ib."locationId" AND ibloc."tenantId" = ib."tenantId"
          WHERE ib."tenantId" = ${tenantId}
            AND (${ownWhId ?? null}::text IS NULL OR ibloc."warehouseId" = ${ownWhId ?? null})
          GROUP BY ib."productId"
        )
        SELECT
          p.id as "productId",
          p.sku,
          p.name,
          COALESCE(ms."movementsIn", 0) as "movementsIn",
          COALESCE(ms."movementsOut", 0) as "movementsOut",
          ms."qtyIn",
          ms."qtyOut",
          cs.total_stock as "currentStock"
        FROM "Product" p
        LEFT JOIN movement_stats ms ON ms."productId" = p.id
        LEFT JOIN current_stock cs ON cs."productId" = p.id
        WHERE p."tenantId" = ${tenantId}
          AND p."isActive" = true
          AND (ms."movementsIn" > 0 OR ms."movementsOut" > 0 OR cs.total_stock IS NOT NULL)
        ORDER BY COALESCE(ms."movementsOut", 0) + COALESCE(ms."movementsIn", 0) DESC
        LIMIT ${take}
      `

      const items = rows.map((r) => {
        const movementsIn = Number(r.movementsIn)
        const movementsOut = Number(r.movementsOut)
        const totalMovements = movementsIn + movementsOut
        return {
          productId: r.productId,
          sku: r.sku,
          name: r.name,
          movementsIn,
          movementsOut,
          totalMovements,
          qtyIn: Number(r.qtyIn ?? '0'),
          qtyOut: Number(r.qtyOut ?? '0'),
          currentStock: Number(r.currentStock ?? '0'),
        }
      })

      const avgMovements = items.length > 0 ? items.reduce((s, i) => s + i.totalMovements, 0) / items.length : 0

      return reply.send({ items, avgMovements })
    },
  )

  app.get(
    '/api/v1/reports/stock/existencias',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockExistenciasQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId

      const { from, to, take, locationId } = parsed.data

      const resolvedWarehouseId = resolveBranchWarehouseId(request, parsed.data.warehouseId)
      if (resolvedWarehouseId === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      const warehouseId = resolvedWarehouseId

      let allowedWarehouseIds: string[] | undefined
      if (warehouseId) allowedWarehouseIds = [warehouseId]

      let allowedLocationIds: string[] | undefined
      if (allowedWarehouseIds) {
        const allowedLocations = await db.location.findMany({
          where: { tenantId, warehouseId: { in: allowedWarehouseIds } },
          select: { id: true },
        })
        allowedLocationIds = allowedLocations.map((location) => location.id)
      }

      if (locationId) {
        allowedLocationIds = allowedLocationIds ? allowedLocationIds.filter((id) => id === locationId) : [locationId]
      }

      const createdAtFilter: { gte?: Date; lt?: Date } = {}
      if (from) createdAtFilter.gte = from
      if (to) createdAtFilter.lt = to

      const balances = await db.inventoryBalance.findMany({
        where: {
          tenantId,
          ...(allowedLocationIds
            ? { locationId: { in: allowedLocationIds } }
            : allowedWarehouseIds
              ? {
                  location: {
                    warehouseId: { in: allowedWarehouseIds },
                  },
                }
              : {}),
        },
        select: {
          productId: true,
          quantity: true,
          reservedQuantity: true,
          product: { select: { sku: true, name: true } },
          location: {
            select: {
              warehouse: { select: { id: true, code: true, name: true } },
            },
          },
        },
      })

      const movements = await db.stockMovement.findMany({
        where: {
          tenantId,
          ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
          ...(allowedLocationIds
            ? {
                OR: [
                  { fromLocationId: { in: allowedLocationIds } },
                  { toLocationId: { in: allowedLocationIds } },
                ],
              }
            : {}),
        },
        select: {
          productId: true,
          type: true,
          quantity: true,
          referenceType: true,
          fromLocationId: true,
          toLocationId: true,
          product: { select: { sku: true, name: true } },
        },
      })

      const movementLocationIds = Array.from(
        new Set(
          movements.flatMap((movement) => [movement.fromLocationId, movement.toLocationId].filter((id): id is string => !!id)),
        ),
      )
      const movementLocations = movementLocationIds.length
        ? await db.location.findMany({
            where: { tenantId, id: { in: movementLocationIds } },
            select: { id: true, warehouse: { select: { id: true, code: true, name: true } } },
          })
        : []
      const movementLocationMap = new Map(movementLocations.map((location) => [location.id, location]))

      type ExistenciaMetrics = {
        productId: string
        sku: string
        name: string
        currentPhysical: number
        currentReserved: number
        currentAvailable: number
        periodInputs: number
        periodOutputs: number
        salesOutputs: number
        discardOutputs: number
        sampleOutputs: number
        transferIn: number
        transferOut: number
        adjustmentIn: number
        adjustmentOut: number
      }

      const createMetrics = (productId: string, sku: string, name: string): ExistenciaMetrics => ({
        productId,
        sku,
        name,
        currentPhysical: 0,
        currentReserved: 0,
        currentAvailable: 0,
        periodInputs: 0,
        periodOutputs: 0,
        salesOutputs: 0,
        discardOutputs: 0,
        sampleOutputs: 0,
        transferIn: 0,
        transferOut: 0,
        adjustmentIn: 0,
        adjustmentOut: 0,
      })

      const productMap = new Map<string, ExistenciaMetrics>()
      const warehouseMap = new Map<string, { warehouseId: string; warehouseCode: string | null; warehouseName: string | null; items: Map<string, ExistenciaMetrics> }>()

      const ensureProductMetrics = (productId: string, sku: string, name: string) => {
        const existing = productMap.get(productId)
        if (existing) return existing
        const created = createMetrics(productId, sku, name)
        productMap.set(productId, created)
        return created
      }

      const ensureWarehouseMetrics = (warehouse: { id: string; code: string | null; name: string | null } | null | undefined, productId: string, sku: string, name: string) => {
        if (!warehouse?.id) return null
        const warehouseEntry = warehouseMap.get(warehouse.id) ?? {
          warehouseId: warehouse.id,
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          items: new Map<string, ExistenciaMetrics>(),
        }
        const metrics = warehouseEntry.items.get(productId) ?? createMetrics(productId, sku, name)
        warehouseEntry.items.set(productId, metrics)
        warehouseMap.set(warehouse.id, warehouseEntry)
        return metrics
      }

      for (const balance of balances) {
        const sku = balance.product.sku
        const name = balance.product.name
        const physical = Number(balance.quantity ?? '0')
        const reserved = Number(balance.reservedQuantity ?? '0')
        const available = Math.max(0, physical - reserved)

        const consolidated = ensureProductMetrics(balance.productId, sku, name)
        consolidated.currentPhysical += physical
        consolidated.currentReserved += reserved
        consolidated.currentAvailable += available

        const warehouseMetrics = ensureWarehouseMetrics(balance.location?.warehouse, balance.productId, sku, name)
        if (warehouseMetrics) {
          warehouseMetrics.currentPhysical += physical
          warehouseMetrics.currentReserved += reserved
          warehouseMetrics.currentAvailable += available
        }
      }

      for (const movement of movements) {
        const qty = Number(movement.quantity ?? '0')
        if (!Number.isFinite(qty) || qty <= 0) continue

        const sku = movement.product.sku
        const name = movement.product.name
        const referenceType = String(movement.referenceType ?? '').trim().toUpperCase()
        const fromWarehouse = movement.fromLocationId ? movementLocationMap.get(movement.fromLocationId)?.warehouse ?? null : null
        const toWarehouse = movement.toLocationId ? movementLocationMap.get(movement.toLocationId)?.warehouse ?? null : null
        const consolidated = ensureProductMetrics(movement.productId, sku, name)

        if (movement.type === 'IN') {
          consolidated.periodInputs += qty
          const warehouseMetrics = ensureWarehouseMetrics(toWarehouse, movement.productId, sku, name)
          if (warehouseMetrics) warehouseMetrics.periodInputs += qty
          continue
        }

        if (movement.type === 'OUT') {
          consolidated.periodOutputs += qty
          if (referenceType === 'MANUAL_SALE' || referenceType === 'SALES_ORDER') consolidated.salesOutputs += qty
          if (referenceType === 'MANUAL_DISCARD') consolidated.discardOutputs += qty
          if (referenceType === 'PRODUCT_SAMPLE') consolidated.sampleOutputs += qty

          const warehouseMetrics = ensureWarehouseMetrics(fromWarehouse, movement.productId, sku, name)
          if (warehouseMetrics) {
            warehouseMetrics.periodOutputs += qty
            if (referenceType === 'MANUAL_SALE' || referenceType === 'SALES_ORDER') warehouseMetrics.salesOutputs += qty
            if (referenceType === 'MANUAL_DISCARD') warehouseMetrics.discardOutputs += qty
            if (referenceType === 'PRODUCT_SAMPLE') warehouseMetrics.sampleOutputs += qty
          }
          continue
        }

        if (movement.type === 'TRANSFER') {
          consolidated.transferOut += qty
          consolidated.transferIn += qty

          const fromWarehouseMetrics = ensureWarehouseMetrics(fromWarehouse, movement.productId, sku, name)
          if (fromWarehouseMetrics) fromWarehouseMetrics.transferOut += qty
          const toWarehouseMetrics = ensureWarehouseMetrics(toWarehouse, movement.productId, sku, name)
          if (toWarehouseMetrics) toWarehouseMetrics.transferIn += qty
          continue
        }

        if (movement.type === 'ADJUSTMENT') {
          if (toWarehouse) {
            consolidated.periodInputs += qty
            consolidated.adjustmentIn += qty
            const warehouseMetrics = ensureWarehouseMetrics(toWarehouse, movement.productId, sku, name)
            if (warehouseMetrics) {
              warehouseMetrics.periodInputs += qty
              warehouseMetrics.adjustmentIn += qty
            }
          } else {
            consolidated.periodOutputs += qty
            consolidated.adjustmentOut += qty
            const warehouseMetrics = ensureWarehouseMetrics(fromWarehouse, movement.productId, sku, name)
            if (warehouseMetrics) {
              warehouseMetrics.periodOutputs += qty
              warehouseMetrics.adjustmentOut += qty
            }
          }
        }
      }

      const items = Array.from(productMap.values())
        .filter((item) => item.currentPhysical > 0 || item.currentReserved > 0 || item.periodInputs > 0 || item.periodOutputs > 0 || item.transferIn > 0 || item.transferOut > 0)
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .slice(0, take)

      const includedIds = new Set(items.map((item) => item.productId))

      const warehouses = Array.from(warehouseMap.values())
        .map((warehouse) => ({
          warehouseId: warehouse.warehouseId,
          warehouseCode: warehouse.warehouseCode,
          warehouseName: warehouse.warehouseName,
          items: Array.from(warehouse.items.values())
            .filter((item) => includedIds.has(item.productId))
            .filter((item) => item.currentPhysical > 0 || item.currentReserved > 0 || item.periodInputs > 0 || item.periodOutputs > 0 || item.transferIn > 0 || item.transferOut > 0)
            .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        }))
        .filter((warehouse) => warehouse.items.length > 0)
        .sort((a, b) => `${a.warehouseCode ?? ''} ${a.warehouseName ?? ''}`.trim().localeCompare(`${b.warehouseCode ?? ''} ${b.warehouseName ?? ''}`.trim(), 'es'))

      return reply.send({ items, warehouses })
    },
  )

  app.get(
    '/api/v1/reports/stock/transfers-between-warehouses',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockTransfersBetweenWarehousesQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, take } = parsed.data

      const resolvedWarehouseId = resolveBranchWarehouseId(request, undefined)
      const ownWhId = resolvedWarehouseId === '__MISSING__' ? null : resolvedWarehouseId

      const rows = await db.$queryRaw<StockTransfersBetweenWarehousesRow[]>`
        SELECT
          wf.id as "fromWarehouseId",
          wf.code as "fromWarehouseCode",
          wf.name as "fromWarehouseName",
          wt.id as "toWarehouseId",
          wt.code as "toWarehouseCode",
          wt.name as "toWarehouseName",
          count(sm.id) as "movementsCount",
          sum(sm.quantity)::text as "quantity"
        FROM "StockMovement" sm
        LEFT JOIN "Location" lf ON lf.id = sm."fromLocationId"
        LEFT JOIN "Warehouse" wf ON wf.id = lf."warehouseId"
        LEFT JOIN "Location" lt ON lt.id = sm."toLocationId"
        LEFT JOIN "Warehouse" wt ON wt.id = lt."warehouseId"
        WHERE sm."tenantId" = ${tenantId}
          AND sm.type = 'TRANSFER'::"StockMovementType"
          AND (${ownWhId ?? null}::text IS NULL OR wf.id = ${ownWhId ?? null} OR wt.id = ${ownWhId ?? null})
          AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null})
        GROUP BY wf.id, wf.code, wf.name, wt.id, wt.code, wt.name
        ORDER BY sum(sm.quantity) DESC NULLS LAST
        LIMIT ${take}
      `

      const items = rows.map((r) => ({
        fromWarehouse: r.fromWarehouseId
          ? { id: r.fromWarehouseId, code: r.fromWarehouseCode, name: r.fromWarehouseName }
          : null,
        toWarehouse: r.toWarehouseId ? { id: r.toWarehouseId, code: r.toWarehouseCode, name: r.toWarehouseName } : null,
        movementsCount: Number(r.movementsCount),
        quantity: r.quantity ?? '0',
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/stock/movement-requests/summary',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchOwnWh = branchOwnWarehouseIdOf(request)
      if (branchDepartmentsOfMissing(request)) return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

      const { from, to } = parsed.data
      const rows = await db.$queryRaw<StockMovementRequestsSummaryRow[]>`
        SELECT
          count(*) as total,
          count(*) FILTER (WHERE smr.status = 'OPEN'::"StockMovementRequestStatus") as open,
          count(*) FILTER (WHERE smr.status = 'SENT'::"StockMovementRequestStatus") as sent,
          count(*) FILTER (WHERE smr.status = 'FULFILLED'::"StockMovementRequestStatus") as fulfilled,
          count(*) FILTER (WHERE smr.status = 'CANCELLED'::"StockMovementRequestStatus") as cancelled,
          count(*) FILTER (WHERE smr."confirmationStatus" = 'PENDING'::"StockMovementRequestConfirmationStatus") as pending,
          count(*) FILTER (WHERE smr."confirmationStatus" = 'ACCEPTED'::"StockMovementRequestConfirmationStatus") as accepted,
          count(*) FILTER (WHERE smr."confirmationStatus" = 'REJECTED'::"StockMovementRequestConfirmationStatus") as rejected
        FROM "StockMovementRequest" smr
        WHERE smr."tenantId" = ${tenantId}
          AND (${from ?? null}::timestamptz IS NULL OR smr."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR smr."createdAt" < ${to ?? null})
          AND (${branchOwnWh ?? null}::text IS NULL OR smr."warehouseId" = ${branchOwnWh ?? null}::text)
      `

      const r = rows[0] ?? {
        total: BigInt(0),
        open: BigInt(0),
        sent: BigInt(0),
        fulfilled: BigInt(0),
        cancelled: BigInt(0),
        pending: BigInt(0),
        accepted: BigInt(0),
        rejected: BigInt(0),
      }

      return reply.send({
        total: Number(r.total),
        open: Number(r.open),
        sent: Number(r.sent),
        fulfilled: Number(r.fulfilled),
        cancelled: Number(r.cancelled),
        pending: Number(r.pending),
        accepted: Number(r.accepted),
        rejected: Number(r.rejected),
      })
    },
  )

  app.get(
    '/api/v1/reports/stock/movement-requests/by-city',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockMovementRequestsOpsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchOwnWh = branchOwnWarehouseIdOf(request)
      if (branchDepartmentsOfMissing(request)) return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

      const { from, to, take } = parsed.data
      const rows = await db.$queryRaw<StockMovementRequestsByCityRow[]>`
        SELECT
          smr."requestedCity" as city,
          count(*) as total,
          count(*) FILTER (WHERE smr.status = 'OPEN'::"StockMovementRequestStatus") as open,
          count(*) FILTER (WHERE smr.status = 'SENT'::"StockMovementRequestStatus") as sent,
          count(*) FILTER (WHERE smr.status = 'FULFILLED'::"StockMovementRequestStatus") as fulfilled,
          count(*) FILTER (WHERE smr.status = 'CANCELLED'::"StockMovementRequestStatus") as cancelled,
          count(*) FILTER (WHERE smr."confirmationStatus" = 'PENDING'::"StockMovementRequestConfirmationStatus") as pending,
          count(*) FILTER (WHERE smr."confirmationStatus" = 'ACCEPTED'::"StockMovementRequestConfirmationStatus") as accepted,
          count(*) FILTER (WHERE smr."confirmationStatus" = 'REJECTED'::"StockMovementRequestConfirmationStatus") as rejected
        FROM "StockMovementRequest" smr
        WHERE smr."tenantId" = ${tenantId}
          AND (${from ?? null}::timestamptz IS NULL OR smr."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR smr."createdAt" < ${to ?? null})
          AND (${branchOwnWh ?? null}::text IS NULL OR smr."warehouseId" = ${branchOwnWh ?? null}::text)
        GROUP BY smr."requestedCity"
        ORDER BY count(*) DESC NULLS LAST
        LIMIT ${take}
      `

      return reply.send({
        items: rows.map((r) => ({
          city: r.city,
          total: Number(r.total),
          open: Number(r.open),
          fulfilled: Number(r.fulfilled),
          cancelled: Number(r.cancelled),
          pending: Number(r.pending),
          accepted: Number(r.accepted),
          rejected: Number(r.rejected),
        })),
      })
    },
  )

  app.get(
    '/api/v1/reports/stock/movement-requests/flows',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockMovementRequestsFulfilledQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchOwnWh = branchOwnWarehouseIdOf(request)
      if (branchDepartmentsOfMissing(request)) return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

      const { from, to, take } = parsed.data

      const rows = await db.$queryRaw<StockMovementRequestsFlowRow[]>`
        WITH req AS (
          SELECT
            smr.id as "requestId",
            smr."createdAt" as "createdAt",
            smr."fulfilledAt" as "fulfilledAt",
            string_agg(distinct wf.id::text, ',' ORDER BY wf.id) FILTER (WHERE wf.id IS NOT NULL) as "fromWarehouseIds",
            string_agg(distinct wf.code, ',' ORDER BY wf.code) FILTER (WHERE wf.code IS NOT NULL) as "fromWarehouseCodes",
            string_agg(distinct wf.name, ',' ORDER BY wf.name) FILTER (WHERE wf.name IS NOT NULL) as "fromWarehouseNames",
            string_agg(distinct wt.id::text, ',' ORDER BY wt.id) FILTER (WHERE wt.id IS NOT NULL) as "toWarehouseIds",
            string_agg(distinct wt.code, ',' ORDER BY wt.code) FILTER (WHERE wt.code IS NOT NULL) as "toWarehouseCodes",
            string_agg(distinct wt.name, ',' ORDER BY wt.name) FILTER (WHERE wt.name IS NOT NULL) as "toWarehouseNames"
          FROM "StockMovementRequest" smr
          LEFT JOIN "StockMovement" sm
            ON sm."tenantId" = smr."tenantId"
            AND sm."referenceType" = 'REQUEST_FULFILL'
            AND sm."referenceId" = smr.id
            AND sm.type = 'TRANSFER'::"StockMovementType"
          LEFT JOIN "Location" lf ON lf.id = sm."fromLocationId"
          LEFT JOIN "Warehouse" wf ON wf.id = lf."warehouseId"
          LEFT JOIN "Location" lt ON lt.id = sm."toLocationId"
          LEFT JOIN "Warehouse" wt ON wt.id = lt."warehouseId"
          WHERE smr."tenantId" = ${tenantId}
            AND smr.status = 'FULFILLED'::"StockMovementRequestStatus"
            AND smr."fulfilledAt" IS NOT NULL
            AND (${from ?? null}::timestamptz IS NULL OR smr."createdAt" >= ${from ?? null})
            AND (${to ?? null}::timestamptz IS NULL OR smr."createdAt" < ${to ?? null})
            AND (${branchOwnWh ?? null}::text IS NULL OR smr."warehouseId" = ${branchOwnWh ?? null}::text)
          GROUP BY smr.id
        ), normalized AS (
          SELECT
            CASE
              WHEN "fromWarehouseIds" IS NULL THEN NULL
              WHEN strpos("fromWarehouseIds", ',') = 0 THEN "fromWarehouseIds"
              ELSE NULL
            END as "fromWarehouseId",
            CASE
              WHEN "fromWarehouseCodes" IS NULL THEN NULL
              WHEN strpos("fromWarehouseCodes", ',') = 0 THEN "fromWarehouseCodes"
              ELSE 'MIXED'
            END as "fromWarehouseCode",
            CASE
              WHEN "fromWarehouseNames" IS NULL THEN NULL
              WHEN strpos("fromWarehouseNames", ',') = 0 THEN "fromWarehouseNames"
              ELSE 'MIXED'
            END as "fromWarehouseName",
            CASE
              WHEN "toWarehouseIds" IS NULL THEN NULL
              WHEN strpos("toWarehouseIds", ',') = 0 THEN "toWarehouseIds"
              ELSE NULL
            END as "toWarehouseId",
            CASE
              WHEN "toWarehouseCodes" IS NULL THEN NULL
              WHEN strpos("toWarehouseCodes", ',') = 0 THEN "toWarehouseCodes"
              ELSE 'MIXED'
            END as "toWarehouseCode",
            CASE
              WHEN "toWarehouseNames" IS NULL THEN NULL
              WHEN strpos("toWarehouseNames", ',') = 0 THEN "toWarehouseNames"
              ELSE 'MIXED'
            END as "toWarehouseName",
            EXTRACT(EPOCH FROM ("fulfilledAt" - "createdAt")) / 60.0 as "minutes"
          FROM req
        )
        SELECT
          n."fromWarehouseId" as "fromWarehouseId",
          n."fromWarehouseCode" as "fromWarehouseCode",
          n."fromWarehouseName" as "fromWarehouseName",
          n."toWarehouseId" as "toWarehouseId",
          n."toWarehouseCode" as "toWarehouseCode",
          n."toWarehouseName" as "toWarehouseName",
          count(*) as "requestsCount",
          avg(n."minutes") as "avgMinutes"
        FROM normalized n
        GROUP BY n."fromWarehouseId", n."fromWarehouseCode", n."fromWarehouseName", n."toWarehouseId", n."toWarehouseCode", n."toWarehouseName"
        ORDER BY count(*) DESC NULLS LAST
        LIMIT ${take}
      `

      return reply.send({
        items: rows.map((r) => ({
          fromWarehouse: r.fromWarehouseCode || r.fromWarehouseName
            ? {
                id: r.fromWarehouseId,
                code: r.fromWarehouseCode,
                name: r.fromWarehouseName,
              }
            : null,
          toWarehouse: r.toWarehouseCode || r.toWarehouseName
            ? {
                id: r.toWarehouseId,
                code: r.toWarehouseCode,
                name: r.toWarehouseName,
              }
            : null,
          requestsCount: Number(r.requestsCount),
          avgMinutes: r.avgMinutes === null || r.avgMinutes === undefined ? null : Number(r.avgMinutes),
        })),
      })
    },
  )

  app.get(
    '/api/v1/reports/stock/movement-requests/fulfilled',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockMovementRequestsFulfilledQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchOwnWh = branchOwnWarehouseIdOf(request)
      if (branchDepartmentsOfMissing(request)) return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

      const { from, to, take } = parsed.data

      const rows = await db.$queryRaw<StockMovementRequestsFulfilledRow[]>`
        WITH req AS (
          SELECT
            smr.id as "requestId",
            smr."requestedCity" as "requestedCity",
            smr."warehouseId" as "warehouseId",
            w.code as "warehouseCode",
            w.name as "warehouseName",
            smr."requestedBy" as "requestedBy",
            coalesce(u."fullName", u.email, smr."requestedBy") as "requestedByName",
            smr."createdAt" as "createdAt",
            smr."fulfilledAt" as "fulfilledAt",
            EXTRACT(EPOCH FROM (smr."fulfilledAt" - smr."createdAt")) / 60.0 as "minutesToFulfill"
          FROM "StockMovementRequest" smr
          LEFT JOIN "User" u ON u.id = smr."requestedBy" AND u."tenantId" = smr."tenantId"
          LEFT JOIN "Warehouse" w ON w.id = smr."warehouseId"
          WHERE smr."tenantId" = ${tenantId}
            AND smr.status = 'FULFILLED'::"StockMovementRequestStatus"
            AND smr."fulfilledAt" IS NOT NULL
            AND (${from ?? null}::timestamptz IS NULL OR smr."fulfilledAt" >= ${from ?? null})
            AND (${to ?? null}::timestamptz IS NULL OR smr."fulfilledAt" < ${to ?? null})
            AND (${branchOwnWh ?? null}::text IS NULL OR smr."warehouseId" = ${branchOwnWh ?? null}::text)
          ORDER BY smr."fulfilledAt" DESC
          LIMIT ${take}
        ), itemsAgg AS (
          SELECT
            smri."requestId" as "requestId",
            count(*) as "itemsCount",
            sum(smri."requestedQuantity")::text as "requestedQuantity"
          FROM "StockMovementRequestItem" smri
          WHERE smri."tenantId" = ${tenantId}
            AND smri."requestId" IN (SELECT "requestId" FROM req)
          GROUP BY smri."requestId"
        ), movAgg AS (
          SELECT
            sm."referenceId" as "requestId",
            count(sm.id) as "movementsCount",
            sum(sm.quantity)::text as "sentQuantity",
            string_agg(distinct wf.code, ',' ORDER BY wf.code) FILTER (WHERE wf.code IS NOT NULL) as "fromWarehouseCodes",
            string_agg(distinct lf.code, ',' ORDER BY lf.code) FILTER (WHERE lf.code IS NOT NULL) as "fromLocationCodes",
            string_agg(distinct wt.code, ',' ORDER BY wt.code) FILTER (WHERE wt.code IS NOT NULL) as "toWarehouseCodes",
            string_agg(distinct lt.code, ',' ORDER BY lt.code) FILTER (WHERE lt.code IS NOT NULL) as "toLocationCodes"
          FROM "StockMovement" sm
          LEFT JOIN "Location" lf ON lf.id = sm."fromLocationId"
          LEFT JOIN "Warehouse" wf ON wf.id = lf."warehouseId"
          LEFT JOIN "Location" lt ON lt.id = sm."toLocationId"
          LEFT JOIN "Warehouse" wt ON wt.id = lt."warehouseId"
          WHERE sm."tenantId" = ${tenantId}
            AND sm.type = 'TRANSFER'::"StockMovementType"
            AND sm."referenceType" = 'REQUEST_FULFILL'
            AND sm."referenceId" IN (SELECT "requestId" FROM req)
          GROUP BY sm."referenceId"
        )
        SELECT
          r.*,
          coalesce(i."itemsCount", 0) as "itemsCount",
          i."requestedQuantity" as "requestedQuantity",
          coalesce(m."movementsCount", 0) as "movementsCount",
          m."sentQuantity" as "sentQuantity",
          m."fromWarehouseCodes" as "fromWarehouseCodes",
          m."fromLocationCodes" as "fromLocationCodes",
          m."toWarehouseCodes" as "toWarehouseCodes",
          m."toLocationCodes" as "toLocationCodes"
        FROM req r
        LEFT JOIN itemsAgg i ON i."requestId" = r."requestId"
        LEFT JOIN movAgg m ON m."requestId" = r."requestId"
        ORDER BY r."fulfilledAt" DESC
      `

      return reply.send({
        items: rows.map((r) => ({
          id: r.requestId,
          requestedCity: r.requestedCity,
          destinationWarehouse: r.warehouseId ? { id: r.warehouseId, code: r.warehouseCode, name: r.warehouseName } : null,
          requestedByName: r.requestedByName,
          createdAt: r.createdAt.toISOString(),
          fulfilledAt: r.fulfilledAt.toISOString(),
          minutesToFulfill: Number(r.minutesToFulfill ?? 0),
          itemsCount: Number(r.itemsCount ?? 0),
          requestedQuantity: r.requestedQuantity ?? '0',
          movementsCount: Number(r.movementsCount ?? 0),
          sentQuantity: r.sentQuantity ?? '0',
          fromWarehouseCodes: r.fromWarehouseCodes ?? null,
          fromLocationCodes: r.fromLocationCodes ?? null,
          toWarehouseCodes: r.toWarehouseCodes ?? null,
          toLocationCodes: r.toLocationCodes ?? null,
        })),
      })
    },
  )

  app.get(
    '/api/v1/reports/stock/movement-requests/:id/trace',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const branchOwnWh = branchOwnWarehouseIdOf(request)
      if (branchDepartmentsOfMissing(request)) return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

      const parsedParams = movementRequestTraceParamsSchema.safeParse((request as any).params)
      if (!parsedParams.success) return reply.status(400).send({ message: 'Invalid params', issues: parsedParams.error.issues })
      const { id } = parsedParams.data

      const req = await db.stockMovementRequest.findFirst({
        where: {
          tenantId,
          id,
          ...(branchOwnWh ? { warehouseId: branchOwnWh } : {}),
        },
        include: {
          warehouse: { select: { id: true, code: true, name: true, city: true } },
          toLocation: { select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true, city: true } } } },
          items: {
            include: {
              product: { select: { id: true, sku: true, name: true, genericName: true } },
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
            orderBy: [{ createdAt: 'asc' }],
          },
        },
      })

      if (!req) return reply.status(404).send({ message: 'Movement request not found' })

      const userIds = [req.requestedBy, req.fulfilledBy].filter(Boolean) as string[]
      const users = userIds.length
        ? await db.user.findMany({ where: { tenantId, id: { in: userIds } }, select: { id: true, email: true, fullName: true } })
        : []
      const userMap = new Map(users.map((u) => [u.id, u.fullName || u.email || u.id]))
      if (req.requestedBy && !userMap.has(req.requestedBy)) userMap.set(req.requestedBy, req.requestedBy)
      if (req.fulfilledBy && !userMap.has(req.fulfilledBy)) userMap.set(req.fulfilledBy, req.fulfilledBy)

      const sentLines = await db.$queryRaw<StockMovementRequestTraceMovementRow[]>`
        SELECT
          sm.id as "id",
          sm."createdAt" as "createdAt",
          sm."productId" as "productId",
          p.sku as "productSku",
          p.name as "productName",
          p."genericName" as "genericName",
          sm."batchId" as "batchId",
          b."batchNumber" as "batchNumber",
          b."expiresAt" as "expiresAt",
          sm.quantity::text as "quantity",
          sm."presentationId" as "presentationId",
          pp.name as "presentationName",
          pp."unitsPerPresentation"::text as "unitsPerPresentation",
          sm."presentationQuantity"::text as "presentationQuantity",
          sm."fromLocationId" as "fromLocationId",
          lf.code as "fromLocationCode",
          wf.id as "fromWarehouseId",
          wf.code as "fromWarehouseCode",
          wf.name as "fromWarehouseName",
          wf.city as "fromWarehouseCity",
          sm."toLocationId" as "toLocationId",
          lt.code as "toLocationCode",
          wt.id as "toWarehouseId",
          wt.code as "toWarehouseCode",
          wt.name as "toWarehouseName",
          wt.city as "toWarehouseCity"
        FROM "StockMovement" sm
        LEFT JOIN "Product" p ON p.id = sm."productId"
        LEFT JOIN "Batch" b ON b.id = sm."batchId"
        LEFT JOIN "ProductPresentation" pp ON pp.id = sm."presentationId"
        LEFT JOIN "Location" lf ON lf.id = sm."fromLocationId"
        LEFT JOIN "Warehouse" wf ON wf.id = lf."warehouseId"
        LEFT JOIN "Location" lt ON lt.id = sm."toLocationId"
        LEFT JOIN "Warehouse" wt ON wt.id = lt."warehouseId"
        WHERE sm."tenantId" = ${tenantId}
          AND sm.type = 'TRANSFER'::"StockMovementType"
          AND sm."referenceType" = 'REQUEST_FULFILL'
          AND sm."referenceId" = ${id}
        ORDER BY sm."createdAt" ASC
      `

      return reply.send({
        request: {
          id: req.id,
          status: req.status,
          confirmationStatus: (req as any).confirmationStatus,
          requestedCity: req.requestedCity,
          warehouseId: (req as any).warehouseId ?? null,
          warehouse: (req as any).warehouse ?? null,
          toLocationId: (req as any).toLocationId ?? null,
          toLocation: (req as any).toLocation ?? null,
          note: req.note ?? null,
          createdAt: req.createdAt.toISOString(),
          requestedBy: req.requestedBy,
          requestedByName: userMap.get(req.requestedBy) ?? null,
          fulfilledAt: req.fulfilledAt ? req.fulfilledAt.toISOString() : null,
          fulfilledBy: req.fulfilledBy ?? null,
          fulfilledByName: req.fulfilledBy ? userMap.get(req.fulfilledBy) ?? null : null,
        },
        requestedItems: (req.items ?? []).map((it: any) => ({
          id: it.id,
          productId: it.productId,
          productSku: it.product?.sku ?? null,
          productName: it.product?.name ?? null,
          genericName: it.product?.genericName ?? null,
          requestedQuantity: Number(it.requestedQuantity ?? 0),
          presentation: it.presentation
            ? { id: it.presentation.id, name: it.presentation.name, unitsPerPresentation: it.presentation.unitsPerPresentation }
            : null,
          unitsPerPresentation: it.presentation?.unitsPerPresentation ?? null,
        })),
        sentLines: sentLines.map((m) => ({
          id: m.id,
          createdAt: m.createdAt.toISOString(),
          productId: m.productId,
          productSku: m.productSku,
          productName: m.productName,
          genericName: m.genericName,
          batchId: m.batchId,
          batchNumber: m.batchNumber,
          expiresAt: m.expiresAt ? m.expiresAt.toISOString() : null,
          quantity: Number(m.quantity ?? 0),
          presentation: m.presentationId
            ? {
                id: m.presentationId,
                name: m.presentationName,
                unitsPerPresentation: m.unitsPerPresentation === null ? null : Number(m.unitsPerPresentation),
              }
            : null,
          presentationQuantity: m.presentationQuantity === null ? null : Number(m.presentationQuantity),
          fromLocation: m.fromLocationId
            ? {
                id: m.fromLocationId,
                code: m.fromLocationCode,
                warehouse: m.fromWarehouseId
                  ? {
                      id: m.fromWarehouseId,
                      code: m.fromWarehouseCode,
                      name: m.fromWarehouseName,
                      city: m.fromWarehouseCity,
                    }
                  : null,
              }
            : null,
          toLocation: m.toLocationId
            ? {
                id: m.toLocationId,
                code: m.toLocationCode,
                warehouse: m.toWarehouseId
                  ? {
                      id: m.toWarehouseId,
                      code: m.toWarehouseCode,
                      name: m.toWarehouseName,
                      city: m.toWarehouseCity,
                    }
                  : null,
              }
            : null,
        })),
      })
    },
  )

  app.get(
    '/api/v1/reports/stock/returns/summary',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId

      const resolvedWarehouseId = resolveBranchWarehouseId(request, undefined)
      if (resolvedWarehouseId === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      const ownWhId = resolvedWarehouseId

      const { from, to } = parsed.data
      const rows = await db.$queryRaw<StockReturnsSummaryRow[]>`
        SELECT
          count(distinct sr.id) as "returnsCount",
          count(sri.id) as "itemsCount",
          sum(sri.quantity)::text as quantity
        FROM "StockReturn" sr
        JOIN "Location" l ON l.id = sr."toLocationId"
        JOIN "Warehouse" w ON w.id = l."warehouseId"
        LEFT JOIN "StockReturnItem" sri ON sri."returnId" = sr.id AND sri."tenantId" = sr."tenantId"
        WHERE sr."tenantId" = ${tenantId}
          AND (${from ?? null}::timestamptz IS NULL OR sr."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR sr."createdAt" < ${to ?? null})
          AND (${ownWhId ?? null}::text IS NULL OR w.id = ${ownWhId ?? null})
      `

      const r = rows[0] ?? { returnsCount: BigInt(0), itemsCount: BigInt(0), quantity: '0' }
      return reply.send({
        returnsCount: Number(r.returnsCount),
        itemsCount: Number(r.itemsCount),
        quantity: r.quantity ?? '0',
      })
    },
  )

  app.get(
    '/api/v1/reports/stock/returns/by-warehouse',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockReturnsOpsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId

      const resolvedWarehouseId = resolveBranchWarehouseId(request, undefined)
      if (resolvedWarehouseId === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      const ownWhId = resolvedWarehouseId

      const { from, to, take } = parsed.data
      const rows = await db.$queryRaw<StockReturnsByWarehouseRow[]>`
        SELECT
          w.id as "warehouseId",
          w.code as "warehouseCode",
          w.name as "warehouseName",
          w.city as "warehouseCity",
          count(distinct sr.id) as "returnsCount",
          count(sri.id) as "itemsCount",
          sum(sri.quantity)::text as quantity
        FROM "StockReturn" sr
        JOIN "Location" l ON l.id = sr."toLocationId"
        JOIN "Warehouse" w ON w.id = l."warehouseId"
        LEFT JOIN "StockReturnItem" sri ON sri."returnId" = sr.id AND sri."tenantId" = sr."tenantId"
        WHERE sr."tenantId" = ${tenantId}
          AND (${from ?? null}::timestamptz IS NULL OR sr."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR sr."createdAt" < ${to ?? null})
          AND (${ownWhId ?? null}::text IS NULL OR w.id = ${ownWhId ?? null})
        GROUP BY w.id, w.code, w.name, w.city
        ORDER BY count(distinct sr.id) DESC NULLS LAST
        LIMIT ${take}
      `

      return reply.send({
        items: rows.map((r) => ({
          warehouse: { id: r.warehouseId, code: r.warehouseCode, name: r.warehouseName, city: r.warehouseCity },
          returnsCount: Number(r.returnsCount),
          itemsCount: Number(r.itemsCount),
          quantity: r.quantity ?? '0',
        })),
      })
    },
  )

  app.post(
    '/api/v1/reports/stock/email',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = reportEmailBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid body', issues: parsed.error.issues })

      const { to, subject, filename, pdfBase64, message } = parsed.data

      try {
        await mailer.sendReportEmail({
          to,
          subject: subject ?? 'Reporte de stock',
          text: (message ?? '').trim() || 'Adjunto encontrarás el reporte solicitado.',
          attachment: { filename: filename ?? 'reporte-stock.pdf', contentBase64: pdfBase64 },
        })
      } catch (e: any) {
        const msg = typeof e?.message === 'string' ? e.message : 'Failed to send email'
        return reply.status(400).send({ message: msg })
      }

      return reply.send({ ok: true })
    },
  )

  app.get(
    '/api/v1/reports/stock/movements-expanded',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockMovementsExpandedQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId

      const resolvedWarehouseId = resolveBranchWarehouseId(request, undefined)
      if (resolvedWarehouseId === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      const ownWhId = resolvedWarehouseId

      let scopeLocationIds: string[] | undefined
      if (ownWhId) {
        const whLocations = await db.location.findMany({
          where: { tenantId, warehouseId: ownWhId },
          select: { id: true },
        })
        scopeLocationIds = whLocations.map((l) => l.id)
      }

      const { from, to, productId, locationId, take } = parsed.data

      const createdAtFilter: { gte?: Date; lt?: Date } = {}
      if (from) createdAtFilter.gte = from
      if (to) createdAtFilter.lt = to

      const movements = await db.stockMovement.findMany({
        where: {
          tenantId,
          ...(productId ? { productId } : {}),
          ...(scopeLocationIds
            ? {
                OR: [
                  { fromLocationId: { in: scopeLocationIds } },
                  { toLocationId: { in: scopeLocationIds } },
                ],
              }
            : locationId
              ? {
                  OR: [{ fromLocationId: locationId }, { toLocationId: locationId }],
                }
              : {}),
          ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
        },
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          createdAt: true,
          type: true,
          productId: true,
          batchId: true,
          fromLocationId: true,
          toLocationId: true,
          quantity: true,
          referenceType: true,
          referenceId: true,
          note: true,
          product: { select: { sku: true, name: true } },
          batch: { select: { batchNumber: true, expiresAt: true, status: true } },
        },
      })

      const locationIds = new Set<string>()
      for (const m of movements) {
        if (m.fromLocationId) locationIds.add(m.fromLocationId)
        if (m.toLocationId) locationIds.add(m.toLocationId)
      }

      const locations =
        locationIds.size > 0
          ? await db.location.findMany({
              where: { tenantId, id: { in: Array.from(locationIds) } },
              select: {
                id: true,
                code: true,
                type: true,
                warehouse: { select: { id: true, code: true, name: true } },
              },
            })
          : []
      const locationMap = new Map(locations.map((l) => [l.id, l]))

      return reply.send({
        items: movements.map((m) => ({
          id: m.id,
          createdAt: m.createdAt.toISOString(),
          type: m.type,
          productId: m.productId,
          batchId: m.batchId,
          fromLocation: m.fromLocationId
            ? {
                id: m.fromLocationId,
                code: locationMap.get(m.fromLocationId)?.code ?? null,
                warehouse: locationMap.get(m.fromLocationId)?.warehouse ?? null,
              }
            : null,
          toLocation: m.toLocationId
            ? {
                id: m.toLocationId,
                code: locationMap.get(m.toLocationId)?.code ?? null,
                warehouse: locationMap.get(m.toLocationId)?.warehouse ?? null,
              }
            : null,
          quantity: Number(m.quantity),
          referenceType: m.referenceType,
          referenceId: m.referenceId,
          note: m.note,
          product: m.product,
          batch: m.batch,
        })),
      })
    },
  )

  app.get(
    '/api/v1/reports/stock/provider-activity',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to } = parsed.data

      const rows = await db.$queryRaw<ProviderActivityRow[]>`
        WITH provider_warehouses AS (
          SELECT id, code, name, city
          FROM "Warehouse"
          WHERE "tenantId" = ${tenantId}
            AND type = 'PROVIDER'::"WarehouseType"
            AND "isActive" = true
        )
        SELECT
          pw.id as "warehouseId",
          pw.code as "warehouseCode",
          pw.name as "warehouseName",
          pw.city as "warehouseCity",
          (SELECT count(*) FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."toLocationId"
            JOIN provider_warehouses pw2 ON pw2."id" = l."warehouseId"
            WHERE sm."tenantId" = ${tenantId}
              AND sm.type = 'IN'::"StockMovementType"
              AND sm."referenceType" = 'RECEIPT"
              AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null}::timestamptz)
              AND l."warehouseId" = pw.id
          )::int as "batchesCreated",
          (SELECT count(*) FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            JOIN provider_warehouses pw2 ON pw2."id" = l."warehouseId"
            WHERE sm."tenantId" = ${tenantId}
              AND sm.type = 'TRANSFER'::"StockMovementType"
              AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null}::timestamptz)
              AND l."warehouseId" = pw.id
          )::int as "transfersSent",
          (SELECT sum(sm.quantity)::text FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            JOIN provider_warehouses pw2 ON pw2."id" = l."warehouseId"
            WHERE sm."tenantId" = ${tenantId}
              AND sm.type = 'TRANSFER'::"StockMovementType"
              AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null}::timestamptz)
              AND l."warehouseId" = pw.id
          ) as "transfersSentQty",
          (SELECT count(*) FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            JOIN provider_warehouses pw2 ON pw2."id" = l."warehouseId"
            WHERE sm."tenantId" = ${tenantId}
              AND sm.type = 'ADJUSTMENT'::"StockMovementType"
              AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null}::timestamptz)
              AND l."warehouseId" = pw.id
          )::int as "adjustments",
          (SELECT sum(sm.quantity)::text FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            JOIN provider_warehouses pw2 ON pw2."id" = l."warehouseId"
            WHERE sm."tenantId" = ${tenantId}
              AND sm.type = 'ADJUSTMENT'::"StockMovementType"
              AND sm."toLocationId" IS NULL
              AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null}::timestamptz)
              AND l."warehouseId" = pw.id
          ) as "adjustmentsOutQty"
        FROM provider_warehouses pw
        ORDER BY pw.code ASC
      `

      const items = rows.map((r) => ({
        warehouseId: r.warehouseId,
        warehouseCode: r.warehouseCode,
        warehouseName: r.warehouseName,
        warehouseCity: r.warehouseCity,
        batchesCreated: Number(r.batchesCreated ?? 0),
        transfersSent: Number(r.transfersSent ?? 0),
        transfersSentQty: r.transfersSentQty ?? '0',
        adjustments: Number(r.adjustments ?? 0),
        adjustmentsOutQty: r.adjustmentsOutQty ?? '0',
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/stock/sales-branch-activity',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to } = parsed.data

      const rows = await db.$queryRaw<SalesBranchActivityRow[]>`
        WITH sales_warehouses AS (
          SELECT id, code, name, city
          FROM "Warehouse"
          WHERE "tenantId" = ${tenantId}
            AND type = 'SALES'::"WarehouseType"
            AND "isActive" = true
        )
        SELECT
          sw.id as "warehouseId",
          sw.code as "warehouseCode",
          sw.name as "warehouseName",
          sw.city as "warehouseCity",
          (SELECT count(*) FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."toLocationId"
            JOIN sales_warehouses sw2 ON sw2."id" = l."warehouseId"
            WHERE sm."tenantId" = ${tenantId}
              AND sm.type = 'TRANSFER'::"StockMovementType"
              AND sm."referenceType" = 'REQUEST_FULFILL"
              AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null}::timestamptz)
              AND l."warehouseId" = sw.id
          )::int as "batchesReceived",
          (SELECT count(*) FROM "StockMovementRequest" smr
            WHERE smr."tenantId" = ${tenantId}
              AND smr."confirmationStatus" = 'ACCEPTED'::"StockMovementRequestConfirmationStatus"
              AND (${from ?? null}::timestamptz IS NULL OR smr."confirmedAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR smr."confirmedAt" < ${to ?? null}::timestamptz)
              AND EXISTS (
                SELECT 1 FROM "Warehouse" w
                WHERE w.id = smr."warehouseId" AND w."tenantId" = ${tenantId}
                  AND w.type = 'SALES'::"WarehouseType"
                  AND w.id = sw.id
              )
          )::int as "requestsAccepted",
          (SELECT count(*) FROM "StockMovementRequest" smr
            WHERE smr."tenantId" = ${tenantId}
              AND smr."confirmationStatus" = 'REJECTED'::"StockMovementRequestConfirmationStatus"
              AND (${from ?? null}::timestamptz IS NULL OR smr."confirmedAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR smr."confirmedAt" < ${to ?? null}::timestamptz)
              AND EXISTS (
                SELECT 1 FROM "Warehouse" w
                WHERE w.id = smr."warehouseId" AND w."tenantId" = ${tenantId}
                  AND w.type = 'SALES'::"WarehouseType"
                  AND w.id = sw.id
              )
          )::int as "requestsRejected",
          (SELECT count(*) FROM "StockMovementRequest" smr
            WHERE smr."tenantId" = ${tenantId}
              AND smr."confirmationStatus" = 'PENDING'::"StockMovementRequestConfirmationStatus"
              AND (${from ?? null}::timestamptz IS NULL OR smr."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR smr."createdAt" < ${to ?? null}::timestamptz)
              AND EXISTS (
                SELECT 1 FROM "Warehouse" w
                WHERE w.id = smr."warehouseId" AND w."tenantId" = ${tenantId}
                  AND w.type = 'SALES'::"WarehouseType"
                  AND w.id = sw.id
              )
          )::int as "requestsPending",
          (SELECT count(*) FROM "Quote" q
            LEFT JOIN "Location" ql ON ql.id = q."locationId"
            WHERE q."tenantId" = ${tenantId}
               AND (${from ?? null}::timestamptz IS NULL OR q."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR q."createdAt" < ${to ?? null}::timestamptz)
              AND ql."warehouseId" = sw.id
          )::int as "quotesCreated",
          (SELECT count(*) FROM "SalesOrder" so
            JOIN "StockMovement" sm ON sm."referenceType" = 'SALES_ORDER' AND sm."referenceId" = so."number"
            JOIN "Location" l ON l.id = sm."fromLocationId"
            JOIN sales_warehouses sw2 ON sw2."id" = l."warehouseId"
            WHERE so."tenantId" = ${tenantId}
              AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null}::timestamptz)
              AND l."warehouseId" = sw.id
          )::int as "ordersCreated",
          (SELECT sum(sol.quantity * sol."unitPrice")::text FROM "SalesOrder" so
            JOIN "SalesOrderLine" sol ON sol."salesOrderId" = so."id" AND sol."tenantId" = so."tenantId"
            JOIN "StockMovement" sm ON sm."referenceType" = 'SALES_ORDER' AND sm."referenceId" = so."number"
            JOIN "Location" l ON l.id = sm."fromLocationId"
            JOIN sales_warehouses sw2 ON sw2."id" = l."warehouseId"
            WHERE so."tenantId" = ${tenantId}
              AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null}::timestamptz)
              AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null}::timestamptz)
              AND l."warehouseId" = sw.id
          ) as "salesAmount"
        FROM sales_warehouses sw
        ORDER BY sw.code ASC
      `

      const items = rows.map((r) => ({
        warehouseId: r.warehouseId,
        warehouseCode: r.warehouseCode,
        warehouseName: r.warehouseName,
        warehouseCity: r.warehouseCity,
        batchesReceived: Number(r.batchesReceived ?? 0),
        requestsAccepted: Number(r.requestsAccepted ?? 0),
        requestsRejected: Number(r.requestsRejected ?? 0),
        requestsPending: Number(r.requestsPending ?? 0),
        quotesCreated: Number(r.quotesCreated ?? 0),
        ordersCreated: Number(r.ordersCreated ?? 0),
        salesAmount: r.salesAmount ?? '0',
      }))

      return reply.send({ items })
    },
  )
}
