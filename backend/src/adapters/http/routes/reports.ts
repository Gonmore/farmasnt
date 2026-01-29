import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { getMailer } from '../../../shared/mailer.js'
import { computeNextRunAt } from '../../../application/reports/reportScheduler.js'

const dateRangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

const salesSummaryQuerySchema = dateRangeQuerySchema.extend({
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
})

const salesTopProductsQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
})

const salesByCustomerQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(200).default(25),
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
})

const salesByCityQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(200).default(25),
  status: z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']).optional(),
})

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
  take: z.coerce.number().int().min(1).max(200).default(100),
})

const stockInputsByProductQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(200).default(25),
})

const stockTransfersBetweenWarehousesQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(200).default(50),
})

const stockMovementRequestsOpsQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(500).default(200),
})

const stockReturnsOpsQuerySchema = dateRangeQuerySchema.extend({
  take: z.coerce.number().int().min(1).max(500).default(200),
})

type StockMovementRequestsSummaryRow = {
  total: bigint
  open: bigint
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
  fulfilled: bigint
  cancelled: bigint
  pending: bigint
  accepted: bigint
  rejected: bigint
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
  locationId: string
  locationName: string | null
  lotNumber: string | null
  expiryDate: Date | null
  quantity: string | null
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const mailer = getMailer()

  function branchCityOf(request: any): string | null {
    if (request.auth?.isTenantAdmin) return null
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
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
      const { from, to, status } = parsed.data

      // Note: use createdAt for sales period. Keep it simple: group by day.
      const rows = await db.$queryRaw<SalesSummaryRow[]>`
        SELECT
          to_char(date_trunc('day', so."createdAt"), 'YYYY-MM-DD') as "day",
          count(distinct so.id) as "ordersCount",
          count(sol.id) as "linesCount",
          sum(sol.quantity)::text as "quantity",
          sum(sol.quantity * sol."unitPrice")::text as "amount"
        FROM "SalesOrder" so
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
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
      const { from, to, take, status } = parsed.data

      const rows = await db.$queryRaw<SalesByCustomerRow[]>`
        SELECT
          c.id as "customerId",
          c.name as "customerName",
          c.city as "city",
          count(distinct so.id) as "ordersCount",
          sum(sol.quantity)::text as "quantity",
          sum(sol.quantity * sol."unitPrice")::text as "amount"
        FROM "SalesOrder" so
        JOIN "Customer" c
          ON c.id = so."customerId"
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
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
      const { from, to, take, status } = parsed.data

      // Prefer deliveryCity; fallback to customer.city.
      const rows = await db.$queryRaw<SalesByCityRow[]>`
        SELECT
          COALESCE(NULLIF(so."deliveryCity", ''), NULLIF(c.city, ''), 'Sin ciudad') as "city",
          count(distinct so.id) as "ordersCount",
          sum(sol.quantity)::text as "quantity",
          sum(sol.quantity * sol."unitPrice")::text as "amount"
        FROM "SalesOrder" so
        JOIN "Customer" c
          ON c.id = so."customerId"
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
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
      const parsed = dateRangeQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { from, to } = parsed.data

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
          ) as "ordersCreated",
          (SELECT count(*) FROM "SalesOrder" so
            WHERE so."tenantId" = ${tenantId}
              AND so.status = 'FULFILLED'::"SalesOrderStatus"
              AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
              AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
          ) as "ordersFulfilled",
          (SELECT count(*) FROM "SalesOrder" so
            WHERE so."tenantId" = ${tenantId}
              AND so."paidAt" IS NOT NULL
              AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
              AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
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
      const { from, to, status } = parsed.data

      const rows = await db.$queryRaw<SalesByMonthRow[]>`
        SELECT
          to_char(date_trunc('month', so."createdAt"), 'YYYY-MM') as "month",
          count(distinct so.id) as "ordersCount",
          count(sol.id) as "linesCount",
          sum(sol.quantity)::text as "quantity",
          sum(sol.quantity * sol."unitPrice")::text as "amount"
        FROM "SalesOrder" so
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
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
      const { from, to, take, status } = parsed.data

      const rows = await db.$queryRaw<ProductMarginsRow[]>`
        SELECT
          p.id as "productId",
          p.sku,
          p.name,
          sum(sol.quantity)::text as "qtySold",
          sum(sol.quantity * sol."unitPrice")::text as "revenue",
          p.cost::text as "costPrice",
          (sum(sol.quantity) * COALESCE(p.cost, 0))::text as "costTotal"
        FROM "SalesOrder" so
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        JOIN "Product" p
          ON p.id = sol."productId"
          AND p."tenantId" = sol."tenantId"
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
          l.id as "locationId",
          l.code as "locationName",
          b."batchNumber" as "lotNumber",
          b."expiresAt" as "expiryDate",
          (ib.quantity - ib."reservedQuantity")::text as "quantity"
        FROM "InventoryBalance" ib
        JOIN "Product" p ON p.id = ib."productId" AND p."tenantId" = ib."tenantId"
        JOIN "Location" l ON l.id = ib."locationId" AND l."tenantId" = ib."tenantId"
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      const { from, to, take, status } = parsed.data

      const rows = await db.$queryRaw<TopProductRow[]>`
        SELECT
          p.id as "productId",
          p.sku as "sku",
          p.name as "name",
          sum(sol.quantity)::text as "quantity",
          sum(sol.quantity * sol."unitPrice")::text as "amount"
        FROM "SalesOrder" so
        JOIN "SalesOrderLine" sol
          ON sol."salesOrderId" = so.id
          AND sol."tenantId" = so."tenantId"
        JOIN "Product" p
          ON p.id = sol."productId"
        WHERE so."tenantId" = ${tenantId}
          AND (${status ?? null}::text IS NULL OR so.status = ${status ?? null}::"SalesOrderStatus")
          AND (${from ?? null}::timestamptz IS NULL OR so."createdAt" >= ${from ?? null})
          AND (${to ?? null}::timestamptz IS NULL OR so."createdAt" < ${to ?? null})
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
      const { from, to, take, status } = parsed.data

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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
    },
    async (request, reply) => {
      const parsed = stockBalancesExpandedQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const { warehouseId, locationId, productId, take } = parsed.data

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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
    '/api/v1/reports/stock/transfers-between-warehouses',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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

  // Stock returns (ops) reports
  app.get(
    '/api/v1/reports/stock/returns/summary',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.ReportStockRead)],
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
}
