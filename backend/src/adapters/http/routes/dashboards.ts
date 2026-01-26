import type { FastifyInstance } from 'fastify'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requireModuleEnabled } from '../../../application/security/rbac.js'

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()

  app.get(
    '/api/v1/dashboards/executive-summary',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES')],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId

      // Productos con stock (totales y por ciudad)
      const productsWithStock = await db.product.count({
        where: {
          tenantId,
          isActive: true,
          balances: {
            some: {
              quantity: { gt: 0 },
            },
          },
        },
      })

      const totalProducts = await db.product.count({
        where: { tenantId, isActive: true },
      })

      type ProductStockByCity = { city: string; count: string }
      const productsByCity = await db.$queryRaw<ProductStockByCity[]>`
        SELECT COALESCE(UPPER(w."city"), 'SIN CIUDAD') as city, COUNT(DISTINCT p."id")::text as count
        FROM "Product" p
        INNER JOIN "InventoryBalance" b ON b."productId" = p."id" AND b."quantity" > 0
        INNER JOIN "Location" l ON l."id" = b."locationId"
        INNER JOIN "Warehouse" w ON w."id" = l."warehouseId"
        WHERE p."tenantId" = ${tenantId} AND p."isActive" = true
        GROUP BY w."city"
        ORDER BY count DESC
      `

      // Clientes (totales y por ciudad)
      const totalCustomers = await db.customer.count({
        where: { tenantId, isActive: true },
      })

      type CustomersByCity = { city: string; count: string }
      const customersByCity = await db.$queryRaw<CustomersByCity[]>`
        SELECT COALESCE(UPPER("city"), 'SIN CIUDAD') as city, COUNT("id")::text as count
        FROM "Customer"
        WHERE "tenantId" = ${tenantId} AND "isActive" = true
        GROUP BY "city"
        ORDER BY count DESC
      `

      // Cotizaciones del mes en curso (no procesadas, por ciudad de cliente)
      const now = new Date()
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

      const quotesThisMonth = await db.quote.count({
        where: {
          tenantId,
          status: 'CREATED',
          createdAt: { gte: firstDay, lte: lastDay },
        },
      })

      type QuotesByCity = { city: string; count: string }
      const quotesByCity = await db.$queryRaw<QuotesByCity[]>`
        SELECT COALESCE(UPPER(c."city"), 'SIN CIUDAD') as city, COUNT(q."id")::text as count
        FROM "Quote" q
        INNER JOIN "Customer" c ON c."id" = q."customerId"
        WHERE q."tenantId" = ${tenantId}
          AND q."status" = 'CREATED'
          AND q."createdAt" >= ${firstDay}
          AND q."createdAt" <= ${lastDay}
        GROUP BY c."city"
        ORDER BY count DESC
      `

      // Ventas del mes (cotizaciones procesadas = órdenes creadas este mes)
      const ordersThisMonth = await db.salesOrder.count({
        where: {
          tenantId,
          createdAt: { gte: firstDay, lte: lastDay },
        },
      })

      // Desglose: pendientes de entrega, entregadas, cobradas
      const ordersStats = await db.salesOrder.groupBy({
        by: ['status'],
        where: {
          tenantId,
          createdAt: { gte: firstDay, lte: lastDay },
        },
        _count: true,
      })

      const pending = ordersStats.find((s) => s.status === 'DRAFT' || s.status === 'CONFIRMED')?._count ?? 0
      const fulfilled = ordersStats.find((s) => s.status === 'FULFILLED')?._count ?? 0

      const paidCount = await db.salesOrder.count({
        where: {
          tenantId,
          createdAt: { gte: firstDay, lte: lastDay },
          paidAt: { not: null },
        },
      })

      type OrdersByCity = { city: string; pending: string; fulfilled: string; paid: string }
      const ordersByCity = await db.$queryRaw<OrdersByCity[]>`
        SELECT 
          COALESCE(UPPER(c."city"), 'SIN CIUDAD') as city,
          COUNT(CASE WHEN o."status" IN ('DRAFT', 'CONFIRMED') THEN 1 END)::text as pending,
          COUNT(CASE WHEN o."status" = 'FULFILLED' THEN 1 END)::text as fulfilled,
          COUNT(CASE WHEN o."paidAt" IS NOT NULL THEN 1 END)::text as paid
        FROM "SalesOrder" o
        INNER JOIN "Customer" c ON c."id" = o."customerId"
        WHERE o."tenantId" = ${tenantId}
          AND o."createdAt" >= ${firstDay}
          AND o."createdAt" <= ${lastDay}
        GROUP BY c."city"
        ORDER BY (COUNT(o."id")) DESC
      `

      return reply.send({
        products: {
          withStock: productsWithStock,
          total: totalProducts,
          byCity: productsByCity.map((r) => ({ city: r.city, count: Number(r.count) })),
        },
        customers: {
          total: totalCustomers,
          byCity: customersByCity.map((r) => ({ city: r.city, count: Number(r.count) })),
        },
        quotes: {
          thisMonth: quotesThisMonth,
          byCity: quotesByCity.map((r) => ({ city: r.city, count: Number(r.count) })),
        },
        orders: {
          thisMonth: ordersThisMonth,
          pending,
          fulfilled,
          paid: paidCount,
          byCity: ordersByCity.map((r) => ({
            city: r.city,
            pending: Number(r.pending),
            fulfilled: Number(r.fulfilled),
            paid: Number(r.paid),
          })),
        },
      })
    },
  )
}
