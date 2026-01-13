import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { currentYearUtc, nextSequence } from '../../../application/shared/sequence.js'

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  customerSearch: z.string().optional(),
})

const quoteCreateSchema = z.object({
  customerId: z.string().uuid(),
  validityDays: z.coerce.number().int().min(1).max(365).default(7),
  paymentMode: z.string().trim().min(1).max(50).default('CASH'),
  deliveryDays: z.coerce.number().int().min(0).max(365).default(1),
  globalDiscountPct: z.coerce.number().min(0).max(100).default(0),
  proposalValue: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().min(0).optional(),
        discountPct: z.coerce.number().min(0).max(100).default(0),
      }),
    )
    .min(1),
})

function decimalFromNumber(value: number): string {
  return value.toString()
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

function computeTotals(lines: Array<{ quantity: number; unitPrice: number; discountPct: number }>, globalDiscountPct: number) {
  const subtotal = lines.reduce((sum, l) => {
    const disc = clampPct(l.discountPct) / 100
    return sum + l.unitPrice * l.quantity * (1 - disc)
  }, 0)
  const gd = clampPct(globalDiscountPct) / 100
  const globalDiscountAmount = subtotal * gd
  const totalAfterGlobal = Math.max(0, subtotal - globalDiscountAmount)
  return { subtotal, globalDiscountAmount, totalAfterGlobal }
}

export async function salesQuotesRoutes(app: FastifyInstance) {
  const db = prisma()
  app.get(
    '/api/v1/sales/quotes',
    {
      preHandler: [
        requireAuth(),
        requireModuleEnabled(db, 'SALES'),
        requirePermission(Permissions.SalesOrderRead),
      ],
    },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const { take, cursor, customerSearch } = parsed.data
      const tenantId = request.auth!.tenantId

      const where: any = { tenantId }
      if (customerSearch) {
        where.customer = {
          name: { contains: customerSearch, mode: 'insensitive' },
        }
      }

      const quotes = await db.quote.findMany({
        where,
        take: take + 1,
        ...(cursor && { cursor: { id: cursor } }),
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { name: true } },
          lines: { select: { id: true, unitPrice: true, quantity: true, discountPct: true } },
          _count: { select: { lines: true } },
        },
      })

      const hasMore = quotes.length > take
      const items = hasMore ? quotes.slice(0, -1) : quotes
      const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null

      const result = items.map((quote: any) => ({
        id: quote.id,
        number: quote.number,
        customerId: quote.customerId,
        customerName: quote.customer.name,
        total: computeTotals(
          quote.lines.map((l: any) => ({
            unitPrice: Number(l.unitPrice),
            quantity: Number(l.quantity),
            discountPct: Number(l.discountPct ?? 0),
          })),
          Number(quote.globalDiscountPct ?? 0),
        ).totalAfterGlobal,
        createdAt: quote.createdAt.toISOString(),
        itemsCount: quote._count.lines,
      }))

      return { items: result, nextCursor }
    },
  )

  app.post(
    '/api/v1/sales/quotes',
    {
      preHandler: [
        requireAuth(),
        requireModuleEnabled(db, 'SALES'),
        requirePermission(Permissions.SalesOrderWrite),
      ],
    },
    async (request, reply) => {
      const parsed = quoteCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const { customerId, validityDays, paymentMode, deliveryDays, globalDiscountPct, proposalValue, note, lines } = parsed.data
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const audit = new AuditService(db)

      // Verify customer exists and belongs to tenant
      const customer = await db.customer.findFirst({
        where: { id: customerId, tenantId },
      })
      if (!customer) {
        return reply.code(404).send({ error: 'Customer not found' })
      }

      // Verify all products exist and belong to tenant
      const productIds = lines.map((line) => line.productId)
      const products = await db.product.findMany({
        where: { id: { in: productIds }, tenantId },
        select: { id: true, price: true },
      })
      if (products.length !== productIds.length) {
        return reply.code(400).send({ error: 'One or more products not found' })
      }

      const productMap = new Map(products.map((p: any) => [p.id, p]))

      const quote = await db.$transaction(async (tx: any) => {
        const year = currentYearUtc()
        const seq = await nextSequence(tx, { tenantId, year, key: 'COT' })
        const quoteNumber = seq.number
        return tx.quote.create({
          data: {
            tenantId,
            number: quoteNumber,
            customerId,
            validityDays,
            paymentMode,
            deliveryDays,
            globalDiscountPct: decimalFromNumber(clampPct(globalDiscountPct)),
            proposalValue: proposalValue?.trim() ? proposalValue.trim() : null,
            note: note || null,
            createdBy: userId,
            lines: {
              create: lines.map((line) => ({
                tenantId,
                productId: line.productId,
                quantity: decimalFromNumber(line.quantity),
                unitPrice: decimalFromNumber(line.unitPrice ?? Number((productMap.get(line.productId) as any)?.price ?? 0)),
                discountPct: decimalFromNumber(clampPct(line.discountPct ?? 0)),
                createdBy: userId,
              })),
            },
          },
          include: {
            customer: { select: { name: true } },
            lines: {
              include: { product: { select: { name: true, sku: true } } },
            },
          },
        })
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'CREATE',
        entityType: 'QUOTE',
        entityId: quote.id,
        after: quote,
      })

      const totals = computeTotals(
        quote.lines.map((l: any) => ({
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct ?? 0),
        })),
        Number(quote.globalDiscountPct ?? 0),
      )

      return {
        id: quote.id,
        number: quote.number,
        customerId: quote.customerId,
        customerName: quote.customer.name,
        validityDays: quote.validityDays,
        paymentMode: quote.paymentMode,
        deliveryDays: quote.deliveryDays,
        globalDiscountPct: Number(quote.globalDiscountPct ?? 0),
        proposalValue: quote.proposalValue,
        note: quote.note,
        subtotal: totals.subtotal,
        globalDiscountAmount: totals.globalDiscountAmount,
        total: totals.totalAfterGlobal,
        lines: quote.lines.map((line: any) => ({
          id: line.id,
          productId: line.productId,
          productName: line.product.name,
          productSku: line.product.sku,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountPct: Number(line.discountPct ?? 0),
        })),
        createdAt: quote.createdAt.toISOString(),
      }
    },
  )

  app.get(
    '/api/v1/sales/quotes/:id',
    {
      preHandler: [
        requireAuth(),
        requireModuleEnabled(db, 'SALES'),
        requirePermission(Permissions.SalesOrderRead),
      ],
    },
    async (request, reply) => {
      const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(request.params)
      if (!paramsParsed.success) return reply.status(400).send({ message: 'Invalid params', issues: paramsParsed.error.issues })

      const { id } = paramsParsed.data
      const tenantId = request.auth!.tenantId

      const quote = await db.quote.findFirst({
        where: { id, tenantId },
        include: {
          customer: { select: { name: true, businessName: true, address: true, phone: true } },
          lines: {
            include: { product: { select: { name: true, sku: true } } },
          },
        },
      })

      if (!quote) {
        return reply.code(404).send({ error: 'Quote not found' })
      }

      const totals = computeTotals(
        quote.lines.map((l: any) => ({
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct ?? 0),
        })),
        Number(quote.globalDiscountPct ?? 0),
      )

      return {
        id: quote.id,
        number: quote.number,
        customerId: quote.customerId,
        customerName: quote.customer.name,
        customerBusinessName: quote.customer.businessName,
        customerAddress: quote.customer.address,
        customerPhone: quote.customer.phone,
        validityDays: quote.validityDays,
        paymentMode: quote.paymentMode,
        deliveryDays: quote.deliveryDays,
        globalDiscountPct: Number(quote.globalDiscountPct ?? 0),
        proposalValue: quote.proposalValue,
        note: quote.note,
        subtotal: totals.subtotal,
        globalDiscountAmount: totals.globalDiscountAmount,
        total: totals.totalAfterGlobal,
        lines: quote.lines.map((line: any) => ({
          id: line.id,
          productId: line.productId,
          productName: line.product.name,
          productSku: line.product.sku,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountPct: Number(line.discountPct ?? 0),
          total: Number(line.unitPrice) * Number(line.quantity) * (1 - clampPct(Number(line.discountPct ?? 0)) / 100),
        })),
        createdAt: quote.createdAt.toISOString(),
        updatedAt: quote.updatedAt.toISOString(),
      }
    },
  )

  app.put(
    '/api/v1/sales/quotes/:id',
    {
      preHandler: [
        requireAuth(),
        requireModuleEnabled(db, 'SALES'),
        requirePermission(Permissions.SalesOrderWrite),
      ],
    },
    async (request, reply) => {
      const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(request.params)
      if (!paramsParsed.success) return reply.status(400).send({ message: 'Invalid params', issues: paramsParsed.error.issues })

      const bodyParsed = quoteCreateSchema.safeParse(request.body)
      if (!bodyParsed.success) return reply.status(400).send({ message: 'Invalid request', issues: bodyParsed.error.issues })

      const { id } = paramsParsed.data
      const { customerId, validityDays, paymentMode, deliveryDays, globalDiscountPct, proposalValue, note, lines } = bodyParsed.data
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const audit = new AuditService(db)

      // Verify quote exists and belongs to tenant
      const existingQuote = await db.quote.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      })
      if (!existingQuote) {
        return reply.code(404).send({ error: 'Quote not found' })
      }

      // Verify customer exists and belongs to tenant
      const customer = await db.customer.findFirst({
        where: { id: customerId, tenantId },
      })
      if (!customer) {
        return reply.code(404).send({ error: 'Customer not found' })
      }

      // Verify all products exist and belong to tenant
      const productIds = lines.map((line) => line.productId)
      const products = await db.product.findMany({
        where: { id: { in: productIds }, tenantId },
        select: { id: true, price: true },
      })
      if (products.length !== productIds.length) {
        return reply.code(400).send({ error: 'One or more products not found' })
      }

      const productMap = new Map(products.map((p: any) => [p.id, p]))

      // Update quote in transaction
      const quote = await db.$transaction(async (tx: any) => {
        // Delete existing lines
        await tx.quoteLine.deleteMany({ where: { quoteId: id, tenantId } })

        // Update quote
        const updatedQuote = await tx.quote.update({
          where: { id },
          data: {
            customerId,
            validityDays,
            paymentMode,
            deliveryDays,
            globalDiscountPct: decimalFromNumber(clampPct(globalDiscountPct)),
            proposalValue: proposalValue?.trim() ? proposalValue.trim() : null,
            note: note || null,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
          include: {
            customer: { select: { name: true } },
            lines: {
              include: { product: { select: { name: true, sku: true } } },
            },
          },
        })

        // Create new lines
        await tx.quoteLine.createMany({
          data: lines.map((line) => ({
            tenantId,
            quoteId: id,
            productId: line.productId,
            quantity: decimalFromNumber(line.quantity),
            unitPrice: decimalFromNumber(line.unitPrice ?? Number((productMap.get(line.productId) as any)?.price ?? 0)),
            discountPct: decimalFromNumber(clampPct(line.discountPct ?? 0)),
            createdBy: userId,
          })),
        })

        // Fetch updated lines
        const updatedLines = await tx.quoteLine.findMany({
          where: { quoteId: id },
          include: { product: { select: { name: true, sku: true } } },
        })

        return { ...updatedQuote, lines: updatedLines }
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'UPDATE',
        entityType: 'QUOTE',
        entityId: quote.id,
        before: existingQuote,
        after: quote,
      })

      const totals = computeTotals(
        quote.lines.map((l: any) => ({
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct ?? 0),
        })),
        Number(quote.globalDiscountPct ?? 0),
      )

      return {
        id: quote.id,
        number: quote.number,
        customerId: quote.customerId,
        customerName: quote.customer.name,
        validityDays: quote.validityDays,
        paymentMode: quote.paymentMode,
        deliveryDays: quote.deliveryDays,
        globalDiscountPct: Number(quote.globalDiscountPct ?? 0),
        proposalValue: quote.proposalValue,
        note: quote.note,
        subtotal: totals.subtotal,
        globalDiscountAmount: totals.globalDiscountAmount,
        total: totals.totalAfterGlobal,
        lines: quote.lines.map((line: any) => ({
          id: line.id,
          productId: line.productId,
          productName: line.product.name,
          productSku: line.product.sku,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountPct: Number(line.discountPct ?? 0),
        })),
        createdAt: quote.createdAt.toISOString(),
        updatedAt: quote.updatedAt.toISOString(),
      }
    },
  )

  app.delete(
    '/api/v1/sales/quotes/:id',
    {
      preHandler: [
        requireAuth(),
        requireModuleEnabled(db, 'SALES'),
        requirePermission(Permissions.SalesOrderWrite),
      ],
    },
    async (request, reply) => {
      const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(request.params)
      if (!paramsParsed.success) return reply.status(400).send({ message: 'Invalid params', issues: paramsParsed.error.issues })

      const { id } = paramsParsed.data
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const audit = new AuditService(db)

      const quote = await db.quote.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      })

      if (!quote) {
        return reply.code(404).send({ error: 'Quote not found' })
      }

      await db.quote.delete({ where: { id } })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'DELETE',
        entityType: 'QUOTE',
        entityId: id,
        before: quote,
      })

      return { success: true }
    },
  )
}
