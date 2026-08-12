import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { getMailer } from '../../../shared/mailer.js'
import { computeNextRunAt } from '../../../application/reports/reportScheduler.js'

function requireStockReportOrBranchAccess() {
  return async function (request: any): Promise<void> {
    const perms = request.auth?.permissions
    if (!request.auth) {
      const err = new Error('Unauthorized') as Error & { statusCode?: number }
      err.statusCode = 401
      throw err
    }

    // Allow if user has ReportStockRead permission OR has scope:branch + stock:read
    const hasReportStockRead = perms?.has(Permissions.ReportStockRead)
    const hasScopeBranch = perms?.has(Permissions.ScopeBranch)
    const hasStockRead = perms?.has(Permissions.StockRead)

    if (!hasReportStockRead && !(hasScopeBranch && hasStockRead)) {
      const err = new Error('Forbidden') as Error & { statusCode?: number }
      err.statusCode = 403
      throw err
    }
  }
}

const dateRangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

const locationFilterQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
})

const salesSummaryQuerySchema = dateRangeQuerySchema.extend({
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
}).merge(locationFilterQuerySchema)

const salesTopProductsQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(1000).default(10),
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
}).merge(locationFilterQuerySchema)

const salesByCustomerQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(1000).default(25),
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
}).merge(locationFilterQuerySchema)

const salesByCityQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(1000).default(25),
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
}).merge(locationFilterQuerySchema)

const reportEmailBodySchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
  pdfBase64: z.string().min(10),
  message: z.string().optional(),
})

const reportScheduleBodySchema = z.object({
  reportKey: z.string().min(1),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  hour: z.coerce.number().int().min(0).max(23).default(8),
  minute: z.coerce.number().int().min(0).max(59).default(0),
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
  recipients: z.array(z.string().email()).min(1),
  // Saved as params for links / context.
  status: z.string().optional(),
  enabled: z.coerce.boolean().optional().default(true),
})

const reportSchedulePatchBodySchema = reportScheduleBodySchema
  .partial()
  .extend({ reportKey: z.string().min(1).optional(), frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional() })

const stockBalancesExpandedQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(5000).default(100),
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

type SalesSummaryRow = {
  day: string
  ordersCount: bigint
  linesCount: bigint
  quantity: string | null
  amount: string | null
}

type TopProductRow = {
  productId: string
  sku: string
  name: string
  quantity: string | null
  amount: string | null
}

type TopProductByPresentationRow = {
  productId: string
  sku: string
  name: string
  presentationId: string | null
  presentationName: string | null
  quantity: string | null
  amount: string | null
}

type SalesByCustomerRow = {
  customerId: string
  customerName: string
  city: string | null
  ordersCount: bigint
  quantity: string | null
  amount: string | null
}

type SalesByCityRow = {
  city: string | null
  ordersCount: bigint
  quantity: string | null
  amount: string | null
}

type SalesFunnelRow = {
  quotesCreated: bigint
  quotesProcessed: bigint
  ordersCreated: bigint
  ordersFulfilled: bigint
  ordersPaid: bigint
  amountFulfilled: string | null
  amountPaid: string | null
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

type SalesByMonthRow = {
  month: string
  ordersCount: bigint
  linesCount: bigint
  quantity: string | null
  amount: string | null
}

type ProductMarginsRow = {
  productId: string
  sku: string
  name: string
  qtySold: string | null
  revenue: string | null
  costPrice: string | null
  costTotal: string | null
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

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const mailer = getMailer()

  function branchCityOf(request: any): string | null {
    if (request.auth?.isTenantAdmin) return null
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    // Sucursales de tipo PROVEEDOR ven inventario de todas las ciudades (solo lectura).
    if (request.auth?.warehouseType === 'PROVIDER') return null
    const city = String(request.auth?.warehouseCity ?? '').trim()
    return city ? city.toUpperCase() : '__MISSING__'
  }

  // SALES reports
  app.get(
    '/api/v1/reports/sales/summary',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = salesSummaryQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, status, warehouseId, locationId } = parsed.data

      // Note: use createdAt for sales period. Keep it simple: group by day.
      const rows = await db.$queryRaw<SalesSummaryRow[]>`
        SELECT
          to_char(date_trunc('day', so."createdAt"), 'YYYY-MM-DD') as "day",
          count(distinct so.id) as "ordersCount",
          count(sol.id) as "linesCount",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity ELSE COALESCE(loc_match."matchedQty", 0) END)::text as "quantity",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity * sol."unitPrice" ELSE COALESCE(loc_match."matchedQty", 0) * sol."unitPrice" END)::text as "amount"
        FROM "SalesOrder" so
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        LEFT JOIN LATERAL (
          SELECT SUM(sm.quantity) as "matchedQty"
          FROM "StockMovement" sm
          JOIN "Location" l ON l.id = sm."fromLocationId"
          WHERE sm."tenantId" = so."tenantId"
            AND sm."referenceType" = 'SALES_ORDER'
            AND sm."referenceId" = so."number"
            AND sm."productId" = sol."productId"
            AND (${warehouseId ?? null}::text IS NULL OR l."warehouseId" = ${warehouseId ?? null})
            AND (${locationId ?? null}::text IS NULL OR sm."fromLocationId" = ${locationId ?? null})
        ) loc_match ON true
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
          AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            WHERE sm."tenantId" = so."tenantId"
              AND sm."referenceType" = 'SALES_ORDER'
              AND sm."referenceId" = so."number"
              AND l."warehouseId" = ${warehouseId ?? null}
          ))
          AND (${locationId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm2
            WHERE sm2."tenantId" = so."tenantId"
              AND sm2."referenceType" = 'SALES_ORDER'
              AND sm2."referenceId" = so."number"
              AND sm2."fromLocationId" = ${locationId ?? null}
          ))
        GROUP BY 1
        ORDER BY 1 ASC
      `

      const items = rows.map((r) => ({
        day: r.day,
        ordersCount: Number(r.ordersCount),
        linesCount: Number(r.linesCount),
        quantity: r.quantity ?? '0',
        amount: r.amount ?? '0',
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/sales/by-customer',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = salesByCustomerQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, take, status, warehouseId, locationId } = parsed.data

      const rows = await db.$queryRaw<SalesByCustomerRow[]>`
        SELECT
          c.id as "customerId",
          c.name as "customerName",
          c.city as "city",
          count(distinct so.id) as "ordersCount",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity ELSE COALESCE(loc_match."matchedQty", 0) END)::text as "quantity",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity * sol."unitPrice" ELSE COALESCE(loc_match."matchedQty", 0) * sol."unitPrice" END)::text as "amount"
        FROM "SalesOrder" so
        JOIN "Customer" c
          ON c.id = so."customerId"
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        LEFT JOIN LATERAL (
          SELECT SUM(sm.quantity) as "matchedQty"
          FROM "StockMovement" sm
          JOIN "Location" l ON l.id = sm."fromLocationId"
          WHERE sm."tenantId" = so."tenantId"
            AND sm."referenceType" = 'SALES_ORDER'
            AND sm."referenceId" = so."number"
            AND sm."productId" = sol."productId"
            AND (${warehouseId ?? null}::text IS NULL OR l."warehouseId" = ${warehouseId ?? null})
            AND (${locationId ?? null}::text IS NULL OR sm."fromLocationId" = ${locationId ?? null})
        ) loc_match ON true
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
          AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            WHERE sm."tenantId" = so."tenantId"
              AND sm."referenceType" = 'SALES_ORDER'
              AND sm."referenceId" = so."number"
              AND l."warehouseId" = ${warehouseId ?? null}
          ))
          AND (${locationId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm2
            WHERE sm2."tenantId" = so."tenantId"
              AND sm2."referenceType" = 'SALES_ORDER'
              AND sm2."referenceId" = so."number"
              AND sm2."fromLocationId" = ${locationId ?? null}
          ))
        GROUP BY c.id, c.name, c.city
        ORDER BY sum(sol.quantity * sol."unitPrice") DESC NULLS LAST
        LIMIT ${take}
      `

      const items = rows.map((r) => ({
        customerId: r.customerId,
        customerName: r.customerName,
        city: r.city,
        ordersCount: Number(r.ordersCount),
        quantity: r.quantity ?? '0',
        amount: r.amount ?? '0',
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/sales/by-city',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = salesByCityQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, take, status, warehouseId, locationId } = parsed.data

      // Prefer deliveryCity; fallback to customer.city.
      const rows = await db.$queryRaw<SalesByCityRow[]>`
        SELECT
          COALESCE(NULLIF(so."deliveryCity", ''), NULLIF(c.city, ''), 'Sin ciudad') as "city",
          count(distinct so.id) as "ordersCount",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity ELSE COALESCE(loc_match."matchedQty", 0) END)::text as "quantity",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity * sol."unitPrice" ELSE COALESCE(loc_match."matchedQty", 0) * sol."unitPrice" END)::text as "amount"
        FROM "SalesOrder" so
        JOIN "Customer" c
          ON c.id = so."customerId"
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        LEFT JOIN LATERAL (
          SELECT SUM(sm.quantity) as "matchedQty"
          FROM "StockMovement" sm
          JOIN "Location" l ON l.id = sm."fromLocationId"
          WHERE sm."tenantId" = so."tenantId"
            AND sm."referenceType" = 'SALES_ORDER'
            AND sm."referenceId" = so."number"
            AND sm."productId" = sol."productId"
            AND (${warehouseId ?? null}::text IS NULL OR l."warehouseId" = ${warehouseId ?? null})
            AND (${locationId ?? null}::text IS NULL OR sm."fromLocationId" = ${locationId ?? null})
        ) loc_match ON true
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
          AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            WHERE sm."tenantId" = so."tenantId"
              AND sm."referenceType" = 'SALES_ORDER'
              AND sm."referenceId" = so."number"
              AND l."warehouseId" = ${warehouseId ?? null}
          ))
          AND (${locationId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm2
            WHERE sm2."tenantId" = so."tenantId"
              AND sm2."referenceType" = 'SALES_ORDER'
              AND sm2."referenceId" = so."number"
              AND sm2."fromLocationId" = ${locationId ?? null}
          ))
        GROUP BY 1
        ORDER BY sum(sol.quantity * sol."unitPrice") DESC NULLS LAST
        LIMIT ${take}
      `

      const items = rows.map((r) => ({
        city: r.city ?? 'Sin ciudad',
        ordersCount: Number(r.ordersCount),
        quantity: r.quantity ?? '0',
        amount: r.amount ?? '0',
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/sales/funnel',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = dateRangeQuerySchema.merge(locationFilterQuerySchema).safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, warehouseId, locationId } = parsed.data

      const rows = await db.$queryRaw<SalesFunnelRow[]>`
        SELECT
          (SELECT count(*) FROM "Quote" q
            WHERE q."tenantId" = ${tenantId}
              AND (${from ?? null}::timestamptz IS NULL OR q."createdAt" >= ${from ?? null})
              AND (${to ?? null}::timestamptz IS NULL OR q."createdAt" < ${to ?? null})
          ) as "quotesCreated",
          (SELECT count(*) FROM "Quote" q
            WHERE q."tenantId" = ${tenantId}
              AND q.status = 'PROCESSED'::"QuoteStatus"
              AND (${from ?? null}::timestamptz IS NULL OR q."createdAt" >= ${from ?? null})
              AND (${to ?? null}::timestamptz IS NULL OR q."createdAt" < ${to ?? null})
          ) as "quotesProcessed",
          (SELECT count(*) FROM "SalesOrder" so
            WHERE so."tenantId" = ${tenantId}
              AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
              AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
              AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm
                JOIN "Location" l ON l.id = sm."fromLocationId"
                WHERE sm."tenantId" = so."tenantId" AND sm."referenceType" = 'SALES_ORDER' AND sm."referenceId" = so."number" AND l."warehouseId" = ${warehouseId ?? null}
              ))
              AND (${locationId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm2
                WHERE sm2."tenantId" = so."tenantId" AND sm2."referenceType" = 'SALES_ORDER' AND sm2."referenceId" = so."number" AND sm2."fromLocationId" = ${locationId ?? null}
              ))
          ) as "ordersCreated",
          (SELECT count(*) FROM "SalesOrder" so
            WHERE so."tenantId" = ${tenantId}
              AND so.status = 'FULFILLED'::"SalesOrderStatus"
              AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
              AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
              AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm
                JOIN "Location" l ON l.id = sm."fromLocationId"
                WHERE sm."tenantId" = so."tenantId" AND sm."referenceType" = 'SALES_ORDER' AND sm."referenceId" = so."number" AND l."warehouseId" = ${warehouseId ?? null}
              ))
              AND (${locationId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm2
                WHERE sm2."tenantId" = so."tenantId" AND sm2."referenceType" = 'SALES_ORDER' AND sm2."referenceId" = so."number" AND sm2."fromLocationId" = ${locationId ?? null}
              ))
          ) as "ordersFulfilled",
          (SELECT count(*) FROM "SalesOrder" so
            WHERE so."tenantId" = ${tenantId}
              AND so."paidAt" IS NOT NULL
              AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
              AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
              AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm
                JOIN "Location" l ON l.id = sm."fromLocationId"
                WHERE sm."tenantId" = so."tenantId" AND sm."referenceType" = 'SALES_ORDER' AND sm."referenceId" = so."number" AND l."warehouseId" = ${warehouseId ?? null}
              ))
              AND (${locationId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm2
                WHERE sm2."tenantId" = so."tenantId" AND sm2."referenceType" = 'SALES_ORDER' AND sm2."referenceId" = so."number" AND sm2."fromLocationId" = ${locationId ?? null}
              ))
          ) as "ordersPaid",
          (SELECT sum(sol.quantity * sol."unitPrice")::text
            FROM "SalesOrder" so
            JOIN "SalesOrderLine" sol
              ON sol."salesOrderId" = so.id
              AND sol."tenantId" = so."tenantId"
            WHERE so."tenantId" = ${tenantId}
              AND so.status = 'FULFILLED'::"SalesOrderStatus"
              AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
              AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
              AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm
                JOIN "Location" l ON l.id = sm."fromLocationId"
                WHERE sm."tenantId" = so."tenantId" AND sm."referenceType" = 'SALES_ORDER' AND sm."referenceId" = so."number" AND l."warehouseId" = ${warehouseId ?? null}
              ))
              AND (${locationId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm2
                WHERE sm2."tenantId" = so."tenantId" AND sm2."referenceType" = 'SALES_ORDER' AND sm2."referenceId" = so."number" AND sm2."fromLocationId" = ${locationId ?? null}
              ))
          ) as "amountFulfilled",
          (SELECT sum(sol.quantity * sol."unitPrice")::text
            FROM "SalesOrder" so
            JOIN "SalesOrderLine" sol
              ON sol."salesOrderId" = so.id
              AND sol."tenantId" = so."tenantId"
            WHERE so."tenantId" = ${tenantId}
              AND so."paidAt" IS NOT NULL
              AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
              AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
              AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm
                JOIN "Location" l ON l.id = sm."fromLocationId"
                WHERE sm."tenantId" = so."tenantId" AND sm."referenceType" = 'SALES_ORDER' AND sm."referenceId" = so."number" AND l."warehouseId" = ${warehouseId ?? null}
              ))
              AND (${locationId ?? null}::text IS NULL OR EXISTS (
                SELECT 1 FROM "StockMovement" sm2
                WHERE sm2."tenantId" = so."tenantId" AND sm2."referenceType" = 'SALES_ORDER' AND sm2."referenceId" = so."number" AND sm2."fromLocationId" = ${locationId ?? null}
              ))
          ) as "amountPaid"
      `

      const r = rows[0]
      return reply.send({
        items: [
          { key: 'quotesCreated', label: 'Cotizaciones creadas', value: Number(r?.quotesCreated ?? 0n) },
          { key: 'quotesProcessed', label: 'Cotizaciones procesadas', value: Number(r?.quotesProcessed ?? 0n) },
          { key: 'ordersCreated', label: 'Órdenes creadas', value: Number(r?.ordersCreated ?? 0n) },
          { key: 'ordersFulfilled', label: 'Entregas (FULFILLED)', value: Number(r?.ordersFulfilled ?? 0n) },
          { key: 'ordersPaid', label: 'Cobros (pagadas)', value: Number(r?.ordersPaid ?? 0n) },
        ],
        totals: {
          amountFulfilled: r?.amountFulfilled ?? '0',
          amountPaid: r?.amountPaid ?? '0',
        },
      })
    },
  )

  // Sales by month for comparison report
  app.get(
    '/api/v1/reports/sales/by-month',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = salesSummaryQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, status, warehouseId, locationId } = parsed.data

      const rows = await db.$queryRaw<SalesByMonthRow[]>`
        SELECT
          to_char(date_trunc('month', so."createdAt"), 'YYYY-MM') as "month",
          count(distinct so.id) as "ordersCount",
          count(sol.id) as "linesCount",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity ELSE COALESCE(loc_match."matchedQty", 0) END)::text as "quantity",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity * sol."unitPrice" ELSE COALESCE(loc_match."matchedQty", 0) * sol."unitPrice" END)::text as "amount"
        FROM "SalesOrder" so
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        LEFT JOIN LATERAL (
          SELECT SUM(sm.quantity) as "matchedQty"
          FROM "StockMovement" sm
          JOIN "Location" l ON l.id = sm."fromLocationId"
          WHERE sm."tenantId" = so."tenantId"
            AND sm."referenceType" = 'SALES_ORDER'
            AND sm."referenceId" = so."number"
            AND sm."productId" = sol."productId"
            AND (${warehouseId ?? null}::text IS NULL OR l."warehouseId" = ${warehouseId ?? null})
            AND (${locationId ?? null}::text IS NULL OR sm."fromLocationId" = ${locationId ?? null})
        ) loc_match ON true
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
          AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            WHERE sm."tenantId" = so."tenantId"
              AND sm."referenceType" = 'SALES_ORDER'
              AND sm."referenceId" = so."number"
              AND l."warehouseId" = ${warehouseId ?? null}
          ))
          AND (${locationId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm2
            WHERE sm2."tenantId" = so."tenantId"
              AND sm2."referenceType" = 'SALES_ORDER'
              AND sm2."referenceId" = so."number"
              AND sm2."fromLocationId" = ${locationId ?? null}
          ))
        GROUP BY 1
        ORDER BY 1 ASC
      `

      const items = rows.map((r) => ({
        month: r.month,
        orderCount: Number(r.ordersCount),
        linesCount: Number(r.linesCount),
        quantity: r.quantity ?? '0',
        total: Number(r.amount ?? '0'),
      }))

      return reply.send({ items })
    },
  )

  // Product margins report
  app.get(
    '/api/v1/reports/sales/margins',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = salesTopProductsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, take, status, warehouseId, locationId } = parsed.data

      const rows = await db.$queryRaw<ProductMarginsRow[]>`
        SELECT
          p.id as "productId",
          p.sku,
          p.name,
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity ELSE COALESCE(loc_match."matchedQty", 0) END)::text as "qtySold",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity * sol."unitPrice" ELSE COALESCE(loc_match."matchedQty", 0) * sol."unitPrice" END)::text as "revenue",
          p.cost::text as "costPrice",
          (sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity ELSE COALESCE(loc_match."matchedQty", 0) END) * COALESCE(p.cost, 0))::text as "costTotal"
        FROM "SalesOrder" so
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        JOIN "Product" p
          ON p.id = sol."productId"
          AND p."tenantId" = sol."tenantId"
        LEFT JOIN LATERAL (
          SELECT SUM(sm.quantity) as "matchedQty"
          FROM "StockMovement" sm
          JOIN "Location" l ON l.id = sm."fromLocationId"
          WHERE sm."tenantId" = so."tenantId"
            AND sm."referenceType" = 'SALES_ORDER'
            AND sm."referenceId" = so."number"
            AND sm."productId" = sol."productId"
            AND (${warehouseId ?? null}::text IS NULL OR l."warehouseId" = ${warehouseId ?? null})
            AND (${locationId ?? null}::text IS NULL OR sm."fromLocationId" = ${locationId ?? null})
        ) loc_match ON true
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
          AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            WHERE sm."tenantId" = so."tenantId"
              AND sm."referenceType" = 'SALES_ORDER'
              AND sm."referenceId" = so."number"
              AND l."warehouseId" = ${warehouseId ?? null}
          ))
          AND (${locationId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm2
            WHERE sm2."tenantId" = so."tenantId"
              AND sm2."referenceType" = 'SALES_ORDER'
              AND sm2."referenceId" = so."number"
              AND sm2."fromLocationId" = ${locationId ?? null}
          ))
        GROUP BY p.id, p.sku, p.name, p.cost
        ORDER BY sum(sol.quantity * sol."unitPrice") DESC
        LIMIT ${take}
      `

      const items = rows.map((r) => {
        const revenue = Number(r.revenue ?? '0')
        const costTotal = Number(r.costTotal ?? '0')
        const profit = revenue - costTotal
        const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0

        return {
          productId: r.productId,
          sku: r.sku,
          name: r.name,
          qtySold: Number(r.qtySold ?? '0'),
          revenue,
          costPrice: Number(r.costPrice ?? '0'),
          costTotal,
          profit,
          marginPct,
        }
      })

      const totals = items.reduce(
        (acc, i) => ({
          revenue: acc.revenue + i.revenue,
          costTotal: acc.costTotal + i.costTotal,
          profit: acc.profit + i.profit,
        }),
        { revenue: 0, costTotal: 0, profit: 0 },
      )
      const avgMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0

      return reply.send({ items, totals: { ...totals, avgMargin } })
    },
  )

  // Low stock / stock alerts report
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

      // Get current stock and compare with a default minStock of 10 (or less for products with low sales)
      // TODO: Add minStock field to Product model for configurable thresholds
      const rows = await db.$queryRaw<LowStockRow[]>`
        WITH current_stock AS (
          SELECT
            ib."productId",
            sum(ib.quantity - ib."reservedQuantity") as total_stock
          FROM "InventoryBalance" ib
          WHERE ib."tenantId" = ${tenantId}
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

  // Expiry alerts report
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

      // Get current balances for batches that are expiring soon
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

  // Stock rotation report
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
          WHERE sm."tenantId" = ${tenantId}
            AND (${from ?? null}::timestamptz IS NULL OR sm."createdAt" >= ${from ?? null})
            AND (${to ?? null}::timestamptz IS NULL OR sm."createdAt" < ${to ?? null})
          GROUP BY sm."productId"
        ),
        current_stock AS (
          SELECT
            ib."productId",
            sum(ib.quantity - ib."reservedQuantity")::text as total_stock
          FROM "InventoryBalance" ib
          WHERE ib."tenantId" = ${tenantId}
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

  app.post(
    '/api/v1/reports/sales/email',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = reportEmailBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid body', issues: parsed.error.issues })

      const { to, subject, filename, pdfBase64, message } = parsed.data

      try {
        await mailer.sendReportEmail({
          to,
          subject: subject ?? 'Reporte de ventas',
          text: (message ?? '').trim() || 'Adjunto encontrarás el reporte solicitado.',
          attachment: { filename: filename ?? 'reporte-ventas.pdf', contentBase64: pdfBase64 },
        })
      } catch (e: any) {
        const msg = typeof e?.message === 'string' ? e.message : 'Failed to send email'
        return reply.status(400).send({ message: msg })
      }

      return reply.send({ ok: true })
    },
  )

  app.get(
    '/api/v1/reports/sales/schedules',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const items = await db.reportSchedule.findMany({
        where: { tenantId, type: 'SALES' },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          type: true,
          reportKey: true,
          params: true,
          frequency: true,
          hour: true,
          minute: true,
          dayOfWeek: true,
          dayOfMonth: true,
          recipients: true,
          enabled: true,
          lastRunAt: true,
          nextRunAt: true,
          createdAt: true,
        },
      })
      return reply.send({ items })
    },
  )

  app.post(
    '/api/v1/reports/sales/schedules',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = reportScheduleBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid body', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const now = new Date()
      const nextRunAt = computeNextRunAt({
        now,
        frequency: parsed.data.frequency,
        hour: parsed.data.hour,
        minute: parsed.data.minute,
        dayOfWeek: parsed.data.dayOfWeek ?? null,
        dayOfMonth: parsed.data.dayOfMonth ?? null,
      })

      const item = await db.reportSchedule.create({
        data: {
          tenantId,
          type: 'SALES',
          reportKey: parsed.data.reportKey,
          params: { status: parsed.data.status ?? null },
          frequency: parsed.data.frequency,
          hour: parsed.data.hour,
          minute: parsed.data.minute,
          dayOfWeek: parsed.data.dayOfWeek ?? null,
          dayOfMonth: parsed.data.dayOfMonth ?? null,
          recipients: parsed.data.recipients,
          enabled: parsed.data.enabled,
          nextRunAt,
          createdBy: userId,
        },
        select: {
          id: true,
          reportKey: true,
          frequency: true,
          hour: true,
          minute: true,
          dayOfWeek: true,
          dayOfMonth: true,
          recipients: true,
          enabled: true,
          nextRunAt: true,
          createdAt: true,
        },
      })

      return reply.send({ item })
    },
  )

  app.patch(
    '/api/v1/reports/sales/schedules/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const id = String((request.params as any)?.id ?? '')
      const parsed = reportSchedulePatchBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid body', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const now = new Date()

      const existing = await db.reportSchedule.findFirst({ where: { id, tenantId, type: 'SALES' } })
      if (!existing) return reply.status(404).send({ message: 'Not found' })

      const nextRunAt =
        parsed.data.frequency || parsed.data.hour !== undefined || parsed.data.minute !== undefined || parsed.data.dayOfWeek !== undefined || parsed.data.dayOfMonth !== undefined
          ? computeNextRunAt({
              now,
              frequency: (parsed.data.frequency ?? existing.frequency) as any,
              hour: parsed.data.hour ?? existing.hour,
              minute: parsed.data.minute ?? existing.minute,
              dayOfWeek: parsed.data.dayOfWeek ?? existing.dayOfWeek,
              dayOfMonth: parsed.data.dayOfMonth ?? existing.dayOfMonth,
            })
          : existing.nextRunAt

      const updated = await db.reportSchedule.update({
        where: { id },
        data: {
          ...(parsed.data.reportKey !== undefined ? { reportKey: parsed.data.reportKey } : {}),
          ...(parsed.data.frequency !== undefined ? { frequency: parsed.data.frequency as any } : {}),
          ...(parsed.data.hour !== undefined ? { hour: parsed.data.hour } : {}),
          ...(parsed.data.minute !== undefined ? { minute: parsed.data.minute } : {}),
          ...(parsed.data.dayOfWeek !== undefined ? { dayOfWeek: parsed.data.dayOfWeek } : {}),
          ...(parsed.data.dayOfMonth !== undefined ? { dayOfMonth: parsed.data.dayOfMonth } : {}),
          ...(parsed.data.recipients !== undefined ? { recipients: parsed.data.recipients } : {}),
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          ...(parsed.data.status !== undefined ? { params: { status: parsed.data.status } } : {}),
          nextRunAt,
          version: { increment: 1 },
        },
        select: {
          id: true,
          reportKey: true,
          frequency: true,
          hour: true,
          minute: true,
          dayOfWeek: true,
          dayOfMonth: true,
          recipients: true,
          enabled: true,
          nextRunAt: true,
          lastRunAt: true,
        },
      })

      return reply.send({ item: updated })
    },
  )

  app.delete(
    '/api/v1/reports/sales/schedules/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const id = String((request.params as any)?.id ?? '')
      const tenantId = request.auth!.tenantId
      const existing = await db.reportSchedule.findFirst({ where: { id, tenantId, type: 'SALES' } })
      if (!existing) return reply.status(404).send({ message: 'Not found' })
      await db.reportSchedule.delete({ where: { id } })
      return reply.send({ ok: true })
    },
  )

  app.get(
    '/api/v1/reports/sales/top-products',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = salesTopProductsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, take, status, warehouseId, locationId } = parsed.data

      const rows = await db.$queryRaw<TopProductRow[]>`
        SELECT
          p.id as "productId",
          p.sku as "sku",
          p.name as "name",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity ELSE COALESCE(loc_match."matchedQty", 0) END)::text as "quantity",
          sum(CASE WHEN ${warehouseId ?? null}::text IS NULL AND ${locationId ?? null}::text IS NULL THEN sol.quantity * sol."unitPrice" ELSE COALESCE(loc_match."matchedQty", 0) * sol."unitPrice" END)::text as "amount"
        FROM "SalesOrder" so
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        JOIN "Product" p
          ON p.id = sol."productId"
        LEFT JOIN LATERAL (
          SELECT SUM(sm.quantity) as "matchedQty"
          FROM "StockMovement" sm
          JOIN "Location" l ON l.id = sm."fromLocationId"
          WHERE sm."tenantId" = so."tenantId"
            AND sm."referenceType" = 'SALES_ORDER'
            AND sm."referenceId" = so."number"
            AND sm."productId" = sol."productId"
            AND (${warehouseId ?? null}::text IS NULL OR l."warehouseId" = ${warehouseId ?? null})
            AND (${locationId ?? null}::text IS NULL OR sm."fromLocationId" = ${locationId ?? null})
        ) loc_match ON true
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
          AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            WHERE sm."tenantId" = so."tenantId"
              AND sm."referenceType" = 'SALES_ORDER'
              AND sm."referenceId" = so."number"
              AND l."warehouseId" = ${warehouseId ?? null}
          ))
          AND (${locationId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm2
            WHERE sm2."tenantId" = so."tenantId"
              AND sm2."referenceType" = 'SALES_ORDER'
              AND sm2."referenceId" = so."number"
              AND sm2."fromLocationId" = ${locationId ?? null}
          ))
        GROUP BY p.id, p.sku, p.name
        ORDER BY sum(sol.quantity * sol."unitPrice") DESC NULLS LAST
        LIMIT ${take}
      `

      const items = rows.map((r) => ({
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        quantity: r.quantity ?? '0',
        amount: r.amount ?? '0',
      }))

      return reply.send({ items })
    },
  )

  app.get(
    '/api/v1/reports/sales/top-products-by-presentation',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
    },
    async (request, reply) => {
      const parsed = salesTopProductsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to, take, status, warehouseId, locationId } = parsed.data

      const rows = await db.$queryRaw<TopProductByPresentationRow[]>`
        SELECT
          p.id as "productId",
          p.sku as "sku",
          p.name as "name",
          pp.id as "presentationId",
          COALESCE(pp.name, 'Unidad') as "presentationName",
          sum(COALESCE(sol."presentationQuantity", sol.quantity))::text as "quantity",
          sum(sol.quantity * sol."unitPrice")::text as "amount"
        FROM "SalesOrder" so
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        JOIN "Product" p
          ON p.id = sol."productId"
        LEFT JOIN "ProductPresentation" pp
          ON pp.id = sol."presentationId"
          AND pp."tenantId" = sol."tenantId"
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
          AND (${warehouseId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm
            JOIN "Location" l ON l.id = sm."fromLocationId"
            WHERE sm."tenantId" = so."tenantId"
              AND sm."referenceType" = 'SALES_ORDER'
              AND sm."referenceId" = so."number"
              AND l."warehouseId" = ${warehouseId ?? null}
          ))
          AND (${locationId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM "StockMovement" sm2
            WHERE sm2."tenantId" = so."tenantId"
              AND sm2."referenceType" = 'SALES_ORDER'
              AND sm2."referenceId" = so."number"
              AND sm2."fromLocationId" = ${locationId ?? null}
          ))
        GROUP BY p.id, p.sku, p.name, pp.id, COALESCE(pp.name, 'Unidad')
        ORDER BY sum(sol.quantity * sol."unitPrice") DESC NULLS LAST
        LIMIT ${take}
      `

      const items = rows.map((r) => ({
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        presentationId: r.presentationId,
        presentationName: r.presentationName ?? 'Unidad',
        quantity: r.quantity ?? '0',
        amount: r.amount ?? '0',
      }))

      return reply.send({ items })
    },
  )

  // STOCK reports
  app.get(
    '/api/v1/reports/stock/balances-expanded',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockBalancesExpandedQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)
      const { warehouseId, locationId, productId, take } = parsed.data

      // For branch-scoped users, restrict to their branch warehouses unless a specific warehouse is requested
      let allowedWarehouseIds: string[] | undefined
      if (branchCity && !request.auth?.isTenantAdmin) {
        if (warehouseId) {
          // Verify the requested warehouse belongs to their branch
          const wh = await db.warehouse.findFirst({
            where: { tenantId, id: warehouseId },
            select: { city: true },
          })
          const whCity = String(wh?.city ?? '').trim().toUpperCase()
          if (!whCity || whCity !== branchCity) {
            return reply.status(403).send({ message: 'Solo puede ver inventario de su sucursal' })
          }
        } else {
          // Get warehouses for their branch
          const branchWarehouses = await db.warehouse.findMany({
            where: { tenantId, city: { equals: branchCity, mode: 'insensitive' as const } },
            select: { id: true },
          })
          allowedWarehouseIds = branchWarehouses.map(w => w.id)
        }
      }

      const items = await db.inventoryBalance.findMany({
        where: {
          tenantId,
          ...(productId ? { productId } : {}),
          ...(locationId ? { locationId } : {}),
          ...(warehouseId
            ? {
                location: {
                  warehouseId,
                },
              }
            : allowedWarehouseIds
              ? {
                  location: {
                    warehouseId: { in: allowedWarehouseIds },
                  },
                }
              : {}),
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
    '/api/v1/reports/stock/existencias',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = stockExistenciasQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

      const { from, to, take, warehouseId, locationId } = parsed.data

      let allowedWarehouseIds: string[] | undefined
      if (branchCity && !request.auth?.isTenantAdmin) {
        const branchWarehouses = await db.warehouse.findMany({
          where: { tenantId, city: { equals: branchCity, mode: 'insensitive' as const } },
          select: { id: true },
        })
        allowedWarehouseIds = branchWarehouses.map((warehouse) => warehouse.id)
      }

      // Merge explicit warehouseId filter (from report selector) with the branch-scoped restriction, if any.
      if (warehouseId) {
        allowedWarehouseIds = allowedWarehouseIds ? allowedWarehouseIds.filter((id) => id === warehouseId) : [warehouseId]
      }

      let allowedLocationIds: string[] | undefined
      if (allowedWarehouseIds) {
        const allowedLocations = await db.location.findMany({
          where: { tenantId, warehouseId: { in: allowedWarehouseIds } },
          select: { id: true },
        })
        allowedLocationIds = allowedLocations.map((location) => location.id)
      }

      // Merge explicit locationId filter (sub-almacén selector) with whatever the warehouse/branch scope allows.
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

  // Stock movement requests (ops) reports
  app.get(
    '/api/v1/reports/stock/movement-requests/summary',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

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
          AND (${branchCity ?? null}::text IS NULL OR upper(coalesce(smr."requestedCity", '')) = upper(${branchCity ?? null}))
      `

      const r = rows[0] ?? {
        total: BigInt(0),
        open: BigInt(0),
        fulfilled: BigInt(0),
        cancelled: BigInt(0),
        pending: BigInt(0),
        accepted: BigInt(0),
        rejected: BigInt(0),
      }

      return reply.send({
        total: Number(r.total),
        open: Number(r.open),
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
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

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
          AND (${branchCity ?? null}::text IS NULL OR upper(coalesce(smr."requestedCity", '')) = upper(${branchCity ?? null}))
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
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

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
            AND (${branchCity ?? null}::text IS NULL OR upper(coalesce(smr."requestedCity", '')) = upper(${branchCity ?? null}))
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
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

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
            AND (${branchCity ?? null}::text IS NULL OR upper(coalesce(smr."requestedCity", '')) = upper(${branchCity ?? null}))
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
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

      const parsedParams = movementRequestTraceParamsSchema.safeParse((request as any).params)
      if (!parsedParams.success) return reply.status(400).send({ message: 'Invalid params', issues: parsedParams.error.issues })
      const { id } = parsedParams.data

      const req = await db.stockMovementRequest.findFirst({
        where: {
          tenantId,
          id,
          ...(branchCity ? { requestedCity: { equals: branchCity, mode: 'insensitive' as const } } : {}),
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

  // Stock returns (ops) reports
  app.get(
    '/api/v1/reports/stock/returns/summary',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

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
          AND (${branchCity ?? null}::text IS NULL OR upper(coalesce(w."city", '')) = upper(${branchCity ?? null}))
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
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })

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
          AND (${branchCity ?? null}::text IS NULL OR upper(coalesce(w."city", '')) = upper(${branchCity ?? null}))
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
    '/api/v1/reports/stock/schedules',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const items = await db.reportSchedule.findMany({
        where: { tenantId, type: 'STOCK' },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          type: true,
          reportKey: true,
          params: true,
          frequency: true,
          hour: true,
          minute: true,
          dayOfWeek: true,
          dayOfMonth: true,
          recipients: true,
          enabled: true,
          lastRunAt: true,
          nextRunAt: true,
          createdAt: true,
        },
      })
      return reply.send({ items })
    },
  )

  app.post(
    '/api/v1/reports/stock/schedules',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const parsed = reportScheduleBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid body', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const now = new Date()
      const nextRunAt = computeNextRunAt({
        now,
        frequency: parsed.data.frequency,
        hour: parsed.data.hour,
        minute: parsed.data.minute,
        dayOfWeek: parsed.data.dayOfWeek ?? null,
        dayOfMonth: parsed.data.dayOfMonth ?? null,
      })

      const item = await db.reportSchedule.create({
        data: {
          tenantId,
          type: 'STOCK',
          reportKey: parsed.data.reportKey,
          params: { status: parsed.data.status ?? null },
          frequency: parsed.data.frequency,
          hour: parsed.data.hour,
          minute: parsed.data.minute,
          dayOfWeek: parsed.data.dayOfWeek ?? null,
          dayOfMonth: parsed.data.dayOfMonth ?? null,
          recipients: parsed.data.recipients,
          enabled: parsed.data.enabled,
          nextRunAt,
          createdBy: userId,
        },
        select: {
          id: true,
          reportKey: true,
          frequency: true,
          hour: true,
          minute: true,
          dayOfWeek: true,
          dayOfMonth: true,
          recipients: true,
          enabled: true,
          nextRunAt: true,
          createdAt: true,
        },
      })

      return reply.send({ item })
    },
  )

  app.patch(
    '/api/v1/reports/stock/schedules/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const id = String((request.params as any)?.id ?? '')
      const parsed = reportSchedulePatchBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid body', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const now = new Date()

      const existing = await db.reportSchedule.findFirst({ where: { id, tenantId, type: 'STOCK' } })
      if (!existing) return reply.status(404).send({ message: 'Not found' })

      const nextRunAt =
        parsed.data.frequency || parsed.data.hour !== undefined || parsed.data.minute !== undefined || parsed.data.dayOfWeek !== undefined || parsed.data.dayOfMonth !== undefined
          ? computeNextRunAt({
              now,
              frequency: (parsed.data.frequency ?? existing.frequency) as any,
              hour: parsed.data.hour ?? existing.hour,
              minute: parsed.data.minute ?? existing.minute,
              dayOfWeek: parsed.data.dayOfWeek ?? existing.dayOfWeek,
              dayOfMonth: parsed.data.dayOfMonth ?? existing.dayOfMonth,
            })
          : existing.nextRunAt

      const updated = await db.reportSchedule.update({
        where: { id },
        data: {
          ...(parsed.data.reportKey !== undefined ? { reportKey: parsed.data.reportKey } : {}),
          ...(parsed.data.frequency !== undefined ? { frequency: parsed.data.frequency as any } : {}),
          ...(parsed.data.hour !== undefined ? { hour: parsed.data.hour } : {}),
          ...(parsed.data.minute !== undefined ? { minute: parsed.data.minute } : {}),
          ...(parsed.data.dayOfWeek !== undefined ? { dayOfWeek: parsed.data.dayOfWeek } : {}),
          ...(parsed.data.dayOfMonth !== undefined ? { dayOfMonth: parsed.data.dayOfMonth } : {}),
          ...(parsed.data.recipients !== undefined ? { recipients: parsed.data.recipients } : {}),
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          ...(parsed.data.status !== undefined ? { params: { status: parsed.data.status } } : {}),
          nextRunAt,
          version: { increment: 1 },
        },
        select: {
          id: true,
          reportKey: true,
          frequency: true,
          hour: true,
          minute: true,
          dayOfWeek: true,
          dayOfMonth: true,
          recipients: true,
          enabled: true,
          nextRunAt: true,
          lastRunAt: true,
        },
      })

      return reply.send({ item: updated })
    },
  )

  app.delete(
    '/api/v1/reports/stock/schedules/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
    },
    async (request, reply) => {
      const id = String((request.params as any)?.id ?? '')
      const tenantId = request.auth!.tenantId
      const existing = await db.reportSchedule.findFirst({ where: { id, tenantId, type: 'STOCK' } })
      if (!existing) return reply.status(404).send({ message: 'Not found' })
      await db.reportSchedule.delete({ where: { id } })
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
      const { from, to, productId, locationId, take } = parsed.data

      const createdAtFilter: { gte?: Date; lt?: Date } = {}
      if (from) createdAtFilter.gte = from
      if (to) createdAtFilter.lt = to

      const movements = await db.stockMovement.findMany({
        where: {
          tenantId,
          ...(productId ? { productId } : {}),
          ...(locationId
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

      const locations = locationIds.size
        ? await db.location.findMany({
            where: { tenantId, id: { in: Array.from(locationIds) } },
            select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true } } },
          })
        : []

      const locById = new Map(locations.map((l) => [l.id, l]))

      const items = movements.map((m) => {
        const fromLoc = m.fromLocationId ? locById.get(m.fromLocationId) ?? null : null
        const toLoc = m.toLocationId ? locById.get(m.toLocationId) ?? null : null

        return {
          ...m,
          quantity: m.quantity.toString(),
          fromLocation: fromLoc ? { id: fromLoc.id, code: fromLoc.code, warehouse: fromLoc.warehouse } : null,
          toLocation: toLoc ? { id: toLoc.id, code: toLoc.code, warehouse: toLoc.warehouse } : null,
        }
      })

      return reply.send({ items })
    },
  )

  // Branch activity reports (filtered by warehouse type)
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
              AND sm."referenceType" = 'RECEIPT'
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
              AND sm."referenceType" = 'REQUEST_FULFILL'
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

  // Fix: by-month siempre aplica take=1000 y status opcional incluye todos los estados
  // El schema salesSummaryQuerySchema ya soporta status opcional, pero el endpoint
  // original no aplicaba LIMIT. Se mantiene el endpoint existente, pero se asegura
  // que el frontend envíe take=1000.
}
