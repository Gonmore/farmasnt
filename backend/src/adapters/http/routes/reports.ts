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
  take: z.coerce.number().int().min(1).max(200).default(100),
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

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const mailer = getMailer()

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
          product: { select: { sku: true, name: true } },
          batch: { select: { batchNumber: true, expiresAt: true, status: true, version: true } },
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
