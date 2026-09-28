import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { getMailer } from '../../../shared/mailer.js'
import {
  dateRangeQuerySchema,
  locationFilterQuerySchema,
  reportEmailBodySchema,
  branchDepartmentsOf,
  branchDepartmentsOfMissing,
} from './reportsShared.js'

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

export async function registerSalesReportRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const mailer = getMailer()

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

      if (branchDepartmentsOfMissing(request)) return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      const branchDepartments = branchDepartmentsOf(request)

      const rows = await db.$queryRaw<SalesByCityRow[]>`
        SELECT
          COALESCE(NULLIF(so."deliveryDepartment", ''), NULLIF(c."department", ''), 'Sin ciudad') as "city",
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
          AND (${branchDepartments ?? null}::text[] IS NULL OR
            (so."deliveryDepartment" = ANY(${branchDepartments ?? null}::text[]) OR
             (so."deliveryDepartment" IS NULL OR so."deliveryDepartment" = '') AND c."department" = ANY(${branchDepartments ?? null}::text[])))
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
}
