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
  // Customer IDs are strings in Prisma and may be legacy (not strictly UUID).
  customerId: z.string().trim().min(1).max(64),
  validityDays: z.coerce.number().int().min(1).max(365).default(7),
  paymentMode: z.string().trim().min(1).max(50).default('CASH'),
  deliveryDays: z.coerce.number().int().min(0).max(365).default(1),
  deliveryCity: z.string().trim().max(80).optional(),
  deliveryZone: z.string().trim().max(80).optional(),
  deliveryAddress: z.string().trim().max(200).optional(),
  // Google Maps share URLs can be long.
  deliveryMapsUrl: z.string().trim().max(2000).optional(),
  globalDiscountPct: z.coerce.number().min(0).max(100).default(0),
  proposalValue: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        // Base quantity (units). If presentationId/presentationQuantity is provided, backend derives this.
        quantity: z.coerce.number().positive().optional(),
        presentationId: z.string().uuid().optional(),
        presentationQuantity: z.coerce.number().positive().optional(),
        unitPrice: z.coerce.number().min(0).optional(),
        discountPct: z.coerce.number().min(0).max(100).default(0),
      }),
    )
    .min(1),
})

function mustResolveLineQuantity(line: any): { baseQuantity: number; presentationId: string | null; presentationQuantity: number | null } {
  const hasPresentation = typeof line.presentationId === 'string' && line.presentationId.length > 0
  const hasPresentationQty = line.presentationQuantity !== undefined && line.presentationQuantity !== null
  const qty = line.quantity

  if (hasPresentation) {
    const pq = Number(line.presentationQuantity)
    if (!Number.isFinite(pq) || pq <= 0) {
      const err = new Error('presentationQuantity is required when presentationId is provided') as Error & { statusCode?: number }
      err.statusCode = 400
      throw err
    }
    return { baseQuantity: NaN, presentationId: line.presentationId, presentationQuantity: pq }
  }

  const q = Number(qty)
  if (!Number.isFinite(q) || q <= 0) {
    const err = new Error('quantity is required when presentationId is not provided') as Error & { statusCode?: number }
    err.statusCode = 400
    throw err
  }
  return { baseQuantity: q, presentationId: null, presentationQuantity: q }
}

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

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

function addDaysUtc(date: Date, days: number): Date {
  const ms = date.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1000
  return new Date(ms)
}

function toNumber(value: any): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function deriveOrderNumberFromQuoteNumber(quoteNumber: string): string {
  const n = (quoteNumber ?? '').trim()
  if (!n) return 'OV'
  if (n.toUpperCase().startsWith('COT-')) return `OV-${n.slice(4)}`
  if (n.toUpperCase().startsWith('COT')) {
    // Handle legacy formats like COT2026009
    return `OV${n.slice(3)}`
  }
  // Fallback: keep the numeric tail if present.
  const dash = n.indexOf('-')
  if (dash >= 0 && dash < n.length - 1) return `OV-${n.slice(dash + 1)}`
  return `OV-${n}`
}

type InsufficientStockItem = { productId: string; productName: string; required: number; available: number; presentationId?: string; presentationQuantity?: number }

class InsufficientStockCityError extends Error {
  statusCode = 409
  city: string
  items: InsufficientStockItem[]
  constructor(args: { city: string; items: InsufficientStockItem[] }) {
    const names = args.items.map((i) => i.productName).filter(Boolean).join(', ')
    super(`Cantidad de existencias insuficientes en el almacen de: ${args.city} para el o los producto(s): ${names}`)
    this.city = args.city
    this.items = args.items
  }
}

async function computeStockShortagesInCity(
  tx: any,
  args: { tenantId: string; city: string; lines: Array<{ productId: string; productName: string; quantity: any; presentationId?: string; presentationQuantity?: number }> },
): Promise<InsufficientStockItem[]> {
  const todayUtc = startOfTodayUtc()
  const cityRaw = (args.city ?? '').trim()
  const city = cityRaw ? cityRaw : ''
  if (!city) return []

  const sameCityLoc = {
    isActive: true,
    warehouse: {
      isActive: true,
      city: { equals: city, mode: 'insensitive' as const },
    },
  }

  const shortages: InsufficientStockItem[] = []
  for (const line of args.lines) {
    let required = 0
    let presentationId: string | undefined
    let presentationQuantity: number | undefined

    if (line.presentationId && line.presentationQuantity) {
      // Get units per presentation
      const presentation = await tx.productPresentation.findFirst({
        where: { id: line.presentationId, tenantId: args.tenantId },
        select: { unitsPerPresentation: true },
      })
      if (presentation) {
        const unitsPer = toNumber(presentation.unitsPerPresentation)
        required = Math.max(0, toNumber(line.presentationQuantity) * unitsPer)
        presentationId = line.presentationId
        presentationQuantity = toNumber(line.presentationQuantity)
      } else {
        // Fallback to total quantity
        required = Math.max(0, toNumber(line.quantity))
      }
    } else {
      required = Math.max(0, toNumber(line.quantity))
    }

    if (required <= 0) continue

    const balances = await tx.inventoryBalance.findMany({
      where: {
        tenantId: args.tenantId,
        productId: line.productId,
        quantity: { gt: 0 },
        location: sameCityLoc,
        OR: [
          { batchId: null },
          { batch: { status: 'RELEASED', OR: [{ expiresAt: null }, { expiresAt: { gte: todayUtc } }] } },
        ],
      },
      select: { quantity: true, reservedQuantity: true },
    })

    const available = balances.reduce((sum: number, b: any) => {
      const qty = toNumber(b.quantity)
      const reserved = toNumber(b.reservedQuantity)
      return sum + Math.max(0, qty - reserved)
    }, 0)

    if (available + 1e-9 < required) {
      const shortage: InsufficientStockItem = {
        productId: line.productId,
        productName: line.productName,
        required,
        available,
      }
      if (presentationId) {
        shortage.presentationId = presentationId
        if (presentationQuantity !== undefined) {
          shortage.presentationQuantity = presentationQuantity
        }
      }
      shortages.push(shortage)
    }
  }

  return shortages
}

async function reserveForOrderInCityOrFail(
  tx: any,
  args: {
    tenantId: string
    userId: string
    orderId: string
    city: string
    lines: Array<{ id: string; productId: string; productName: string; batchId: string | null; quantity: any }>
  },
): Promise<any[]> {
  const todayUtc = startOfTodayUtc()
  const cityRaw = (args.city ?? '').trim()
  const city = cityRaw ? cityRaw : ''
  if (!city) throw new InsufficientStockCityError({ city: '(sin ciudad)', items: [] })

  const sameCityLoc = {
    isActive: true,
    warehouse: {
      isActive: true,
      city: { equals: city, mode: 'insensitive' as const },
    },
  }

  // Pre-check availability in the customer's city for all lines (fail fast, no partial reservations).
  const shortages: InsufficientStockItem[] = []
  for (const line of args.lines) {
    const required = Math.max(0, toNumber(line.quantity))
    if (required <= 0) continue

    const balances = await tx.inventoryBalance.findMany({
      where: {
        tenantId: args.tenantId,
        productId: line.productId,
        quantity: { gt: 0 },
        location: sameCityLoc,
        OR: [
          { batchId: null },
          { batch: { status: 'RELEASED', OR: [{ expiresAt: null }, { expiresAt: { gte: todayUtc } }] } },
        ],
      },
      select: { quantity: true, reservedQuantity: true },
    })

    const available = balances.reduce((sum: number, b: any) => {
      const qty = toNumber(b.quantity)
      const reserved = toNumber(b.reservedQuantity)
      return sum + Math.max(0, qty - reserved)
    }, 0)

    if (available + 1e-9 < required) {
      shortages.push({ productId: line.productId, productName: line.productName, required, available })
    }
  }
  if (shortages.length > 0) throw new InsufficientStockCityError({ city, items: shortages })

  // Reserve in city only (FEFO-ish ordering).
  const changedBalances: any[] = []
  for (const line of args.lines) {
    let remaining = Math.max(0, toNumber(line.quantity))
    if (remaining <= 0) continue

    const lists: any[][] = []
    if (line.batchId) {
      const sameCity = await tx.inventoryBalance.findMany({
        where: {
          tenantId: args.tenantId,
          productId: line.productId,
          batchId: line.batchId,
          quantity: { gt: 0 },
          location: sameCityLoc,
          batch: { status: 'RELEASED', OR: [{ expiresAt: null }, { expiresAt: { gte: todayUtc } }] },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, quantity: true, reservedQuantity: true },
      })
      lists.push(sameCity)
    } else {
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

    for (const balances of lists) {
      for (const b of balances) {
        if (remaining <= 0) break
        const qty = toNumber(b.quantity)
        const reserved = toNumber(b.reservedQuantity)
        const available = Math.max(0, qty - reserved)
        if (available <= 0) continue

        const take = Math.min(available, remaining)
        remaining -= take

        const updatedBalance = await tx.inventoryBalance.update({
          where: { id: b.id },
          data: { reservedQuantity: { increment: take }, version: { increment: 1 }, createdBy: args.userId },
          select: {
            id: true,
            tenantId: true,
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

    // Race-condition safety: if stock changed after pre-check, fail with a clear message.
    if (remaining > 1e-9) {
      throw new InsufficientStockCityError({
        city,
        items: [
          {
            productId: line.productId,
            productName: line.productName,
            required: Math.max(0, toNumber(line.quantity)),
            available: Math.max(0, toNumber(line.quantity) - remaining),
          },
        ],
      })
    }
  }

  return changedBalances
}

async function resolveUserDisplayName(db: any, tenantId: string, userId?: string | null): Promise<string | null> {
  if (!userId) return null
  const user = await db.user.findFirst({ where: { id: userId, tenantId }, select: { fullName: true, email: true } })
  if (!user) return null
  const name = (user.fullName ?? '').trim()
  if (name) return name
  return user.email
}

export async function salesQuotesRoutes(app: FastifyInstance) {
  const db = prisma()

  function branchCityOf(request: any): string | null {
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    const city = String(request.auth?.warehouseCity ?? '').trim()
    return city ? city.toUpperCase() : '__MISSING__'
  }

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

      const authorIds = Array.from(new Set(items.map((q: any) => q.createdBy).filter(Boolean))) as string[]
      const authors = authorIds.length
        ? await db.user.findMany({ where: { tenantId, id: { in: authorIds } }, select: { id: true, fullName: true, email: true } })
        : []
      const authorMap = new Map(authors.map((u: any) => [u.id, (u.fullName ?? '').trim() || u.email] as const))

      const result = items.map((quote: any) => ({
        id: quote.id,
        number: quote.number,
        customerId: quote.customerId,
        customerName: quote.customer.name,
        status: quote.status,
        quotedBy: quote.createdBy ? authorMap.get(quote.createdBy) ?? null : null,
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

      const {
        customerId,
        validityDays,
        paymentMode,
        deliveryDays,
        deliveryCity,
        deliveryZone,
        deliveryAddress,
        deliveryMapsUrl,
        globalDiscountPct,
        proposalValue,
        note,
        lines,
      } = parsed.data
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const audit = new AuditService(db)
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      // Verify customer exists and belongs to tenant
      const customer = await db.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true, name: true, city: true, zone: true, address: true, mapsUrl: true },
      })
      if (!customer) {
        return reply.code(404).send({ error: 'Customer not found' })
      }

      if (branchCity) {
        const custCity = String(customer.city ?? '').trim().toUpperCase()
        if (!custCity || custCity !== branchCity) {
          return reply.status(403).send({ message: 'Solo puede crear cotizaciones para clientes de su sucursal' })
        }
      }

      // Verify all products exist and belong to tenant
      const productIds = [...new Set(lines.map((line) => line.productId))]
      const products = await db.product.findMany({
        where: { id: { in: productIds }, tenantId },
        select: { id: true, price: true },
      })
      if (products.length !== productIds.length) {
        return reply.code(400).send({ error: 'One or more products not found' })
      }

      const productMap = new Map(products.map((p: any) => [p.id, p]))

      const quote = await db.$transaction(async (tx: any) => {
        // Ensure each product has at least a default unit presentation.
        const existingPres = await tx.productPresentation.findMany({
          where: { tenantId, productId: { in: productIds }, isActive: true },
          select: { id: true, productId: true, isDefault: true, unitsPerPresentation: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        })
        const byProduct = new Map<string, any[]>()
        for (const p of existingPres) {
          const list = byProduct.get(p.productId) ?? []
          list.push(p)
          byProduct.set(p.productId, list)
        }
        for (const pid of productIds) {
          if ((byProduct.get(pid) ?? []).length > 0) continue
          try {
            await tx.productPresentation.create({
              data: {
                tenantId,
                productId: pid,
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
            // ignore if concurrent creation
          }
        }

        // Load presentations referenced by request (if any) and default unit presentation per product.
        const requestedPresentationIds = Array.from(
          new Set(lines.map((l: any) => (typeof (l as any).presentationId === 'string' ? (l as any).presentationId : null)).filter(Boolean)),
        ) as string[]

        type PresentationRef = { id: string; productId: string; unitsPerPresentation: any; priceOverride: any; isDefault: boolean }
        const referencedPresentations: PresentationRef[] = requestedPresentationIds.length
          ? await tx.productPresentation.findMany({
              where: { tenantId, id: { in: requestedPresentationIds }, isActive: true },
              select: { id: true, productId: true, unitsPerPresentation: true, priceOverride: true, isDefault: true },
            })
          : []

        const presentationById = new Map<string, PresentationRef>(referencedPresentations.map((p) => [p.id, p]))
        if (requestedPresentationIds.length && referencedPresentations.length !== requestedPresentationIds.length) {
          const err = new Error('One or more presentations not found') as Error & { statusCode?: number }
          err.statusCode = 400
          throw err
        }

        const defaultUnitByProduct = new Map<string, string | null>()
        const defaults = await tx.productPresentation.findMany({
          where: { tenantId, productId: { in: productIds }, isActive: true },
          select: { id: true, productId: true, isDefault: true, unitsPerPresentation: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        })
        for (const row of defaults) {
          if (defaultUnitByProduct.has(row.productId)) continue
          // Prefer isDefault=true; otherwise first.
          defaultUnitByProduct.set(row.productId, row.id)
        }

        const year = currentYearUtc()
        const seq = await nextSequence(tx, { tenantId, year, key: 'COT' })
        const quoteNumber = seq.number

        const resolvedLines = lines.map((line: any) => {
          const resolved = mustResolveLineQuantity(line)
          let baseQty = resolved.baseQuantity
          let presId: string | null = resolved.presentationId
          let presQty: number | null = resolved.presentationQuantity

          const productUnitPrice = Number((productMap.get(line.productId) as any)?.price ?? 0)
          let resolvedUnitPrice = line.unitPrice ?? productUnitPrice

          if (presId) {
            const pres = presentationById.get(presId)
            const factor = Number(pres?.unitsPerPresentation)
            if (!Number.isFinite(factor) || factor <= 0) {
              const err = new Error('Invalid unitsPerPresentation') as Error & { statusCode?: number }
              err.statusCode = 400
              throw err
            }
            baseQty = (presQty ?? 0) * factor

            // Pricing rule:
            // - Product.price is the base unit price.
            // - If presentation has priceOverride (price per 1 presentation), derive unitPrice = priceOverride / factor.
            // - If client provided unitPrice explicitly, keep it.
            if (line.unitPrice === undefined && pres && pres.priceOverride !== null && pres.priceOverride !== undefined) {
              const presPrice = Number(pres.priceOverride)
              if (Number.isFinite(presPrice) && presPrice >= 0) {
                resolvedUnitPrice = factor > 0 ? presPrice / factor : productUnitPrice
              }
            }
          } else {
            presId = defaultUnitByProduct.get(line.productId) ?? null
            presQty = baseQty
          }

          return {
            productId: line.productId,
            quantity: baseQty,
            presentationId: presId,
            presentationQuantity: presQty,
            unitPrice: resolvedUnitPrice,
            discountPct: clampPct(line.discountPct ?? 0),
          }
        })

        return tx.quote.create({
          data: {
            tenantId,
            number: quoteNumber,
            customerId,
            status: 'CREATED',
            deliveryCity: (deliveryCity ?? customer.city ?? null) ? String(deliveryCity ?? customer.city).trim().toUpperCase() : null,
            deliveryZone: (deliveryZone ?? customer.zone ?? null) ? String(deliveryZone ?? customer.zone).trim().toUpperCase() : null,
            deliveryAddress: (deliveryAddress ?? customer.address ?? null) ? String(deliveryAddress ?? customer.address).trim() : null,
            deliveryMapsUrl: (deliveryMapsUrl ?? customer.mapsUrl ?? null) ? String(deliveryMapsUrl ?? customer.mapsUrl).trim() : null,
            validityDays,
            paymentMode,
            deliveryDays,
            globalDiscountPct: decimalFromNumber(clampPct(globalDiscountPct)),
            proposalValue: proposalValue?.trim() ? proposalValue.trim() : null,
            note: note || null,
            createdBy: userId,
            lines: {
              create: resolvedLines.map((line: any) => ({
                tenantId,
                productId: line.productId,
                quantity: decimalFromNumber(line.quantity),
                presentationId: line.presentationId,
                presentationQuantity: line.presentationQuantity === null ? null : decimalFromNumber(line.presentationQuantity),
                unitPrice: decimalFromNumber(line.unitPrice),
                discountPct: decimalFromNumber(line.discountPct),
                createdBy: userId,
              })),
            },
          },
          include: {
            customer: { select: { name: true } },
            lines: {
              include: {
                product: { select: { name: true, sku: true, genericName: true } },
                presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
              },
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

      const quotedBy = await resolveUserDisplayName(db, tenantId, quote.createdBy)
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
        status: quote.status,
        quotedBy,
        validityDays: quote.validityDays,
        paymentMode: quote.paymentMode,
        deliveryDays: quote.deliveryDays,
        deliveryCity: quote.deliveryCity,
        deliveryZone: quote.deliveryZone,
        deliveryAddress: quote.deliveryAddress,
        deliveryMapsUrl: quote.deliveryMapsUrl,
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
          productGenericName: (line.product as any).genericName ?? null,
          productSku: line.product.sku,
          presentationId: line.presentationId ?? null,
          presentationName: line.presentation?.name ?? null,
          unitsPerPresentation: line.presentation?.unitsPerPresentation ? Number(line.presentation.unitsPerPresentation) : null,
          presentationQuantity: line.presentationQuantity !== null && line.presentationQuantity !== undefined ? Number(line.presentationQuantity) : null,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountPct: Number(line.discountPct ?? 0),
        })),
        createdAt: quote.createdAt.toISOString(),
      }
    },
  )

  app.post(
    '/api/v1/sales/quotes/:id/process',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const rawId = (request.params as any)?.id ?? request.params
      const idStr = typeof rawId === 'string' ? rawId.trim() : String(rawId ?? '').trim()
      const idParsed = z.string().uuid().safeParse(idStr)
      if (!idParsed.success) {
        return reply.status(400).send({
          message: 'Invalid params',
          issues: idParsed.error.issues,
          received: { id: rawId },
        })
      }

      const id = idParsed.data
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const audit = new AuditService(db)
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      let created: any
      try {
        created = await db.$transaction(async (tx: any) => {
          const quote = await tx.quote.findFirst({
            where: { id, tenantId },
            include: {
              customer: { select: { id: true, name: true, city: true } },
              lines: {
                select: {
                  id: true,
                  productId: true,
                  quantity: true,
                  presentationId: true,
                  presentationQuantity: true,
                  unitPrice: true,
                  discountPct: true,
                  product: { select: { name: true, genericName: true } },
                },
              },
            },
          })

          if (!quote) {
            const err = new Error('Quote not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }

          if (branchCity) {
            const custCity = String(quote.customer.city ?? '').trim().toUpperCase()
            if (!custCity || custCity !== branchCity) {
              const err = new Error('Solo puede procesar cotizaciones de su sucursal') as Error & { statusCode?: number }
              err.statusCode = 403
              throw err
            }
          }
          if (quote.status === 'PROCESSED') {
            const err = new Error('Quote already processed') as Error & { statusCode?: number }
            err.statusCode = 409
            throw err
          }

          const city = (quote.customer.city ?? '').trim()
          if (!city) {
            const err = new Error('Customer city is required to reserve stock') as Error & { statusCode?: number }
            err.statusCode = 400
            throw err
          }

          const orderNumber = deriveOrderNumberFromQuoteNumber(String(quote.number ?? ''))

          const todayUtc = startOfTodayUtc()
          const deliveryDate = addDaysUtc(todayUtc, Number(quote.deliveryDays ?? 0))

          const order = await tx.salesOrder.create({
            data: {
              tenantId,
              number: orderNumber,
              customerId: quote.customerId,
              quoteId: quote.id,
              status: 'CONFIRMED',
              // Copy payment terms onto the order so payments can be managed without joining Quote.
              paymentMode: quote.paymentMode ?? 'CASH',
              note: `Desde cotización ${quote.number}`,
              deliveryDate,
              deliveryCity: quote.deliveryCity ?? quote.customer.city ?? null,
              deliveryZone: quote.deliveryZone ?? null,
              deliveryAddress: quote.deliveryAddress ?? null,
              deliveryMapsUrl: quote.deliveryMapsUrl ?? null,
              createdBy: userId,
            },
            select: { id: true, number: true, status: true, version: true, createdAt: true },
          })

          const gd = clampPct(Number(quote.globalDiscountPct ?? 0)) / 100

          // Create lines individually so we can create reservations referencing the line IDs.
          const createdLines: Array<{ id: string; productId: string; productName: string; batchId: string | null; quantity: any }> = []
          for (const l of quote.lines) {
            const disc = clampPct(Number(l.discountPct ?? 0)) / 100
            const unit = Number(l.unitPrice)
            const finalUnit = unit * (1 - disc) * (1 - gd)
            const lineRow = await tx.salesOrderLine.create({
              data: {
                tenantId,
                salesOrderId: order.id,
                productId: l.productId,
                batchId: null,
                quantity: decimalFromNumber(Number(l.quantity)),
                presentationId: (l as any).presentationId ?? null,
                presentationQuantity: (l as any).presentationQuantity === null || (l as any).presentationQuantity === undefined ? null : decimalFromNumber(Number((l as any).presentationQuantity)),
                unitPrice: decimalFromNumber(Number.isFinite(finalUnit) ? finalUnit : 0),
                createdBy: userId,
              },
              select: { id: true, productId: true, quantity: true },
            })
            createdLines.push({
              id: lineRow.id,
              productId: lineRow.productId,
              productName: String((l as any)?.product?.name ?? ''),
              batchId: null,
              quantity: lineRow.quantity,
            })
          }

          // Reserve stock strictly from customer's city.
          const changedBalances = await reserveForOrderInCityOrFail(tx, {
            tenantId,
            userId,
            orderId: order.id,
            city,
            lines: createdLines,
          })

          const reservations = await tx.salesOrderReservation.findMany({
            where: { tenantId, salesOrderId: order.id },
            select: {
              id: true,
              quantity: true,
              line: {
                select: {
                  productId: true,
                  product: { select: { name: true, sku: true, genericName: true } },
                },
              },
              balance: {
                select: {
                  id: true,
                  batchId: true,
                  batch: { select: { batchNumber: true, expiresAt: true } },
                  location: { select: { code: true, warehouse: { select: { code: true, name: true, city: true } } } },
                },
              },
            },
          })

          await tx.quote.update({
            where: { id: quote.id },
            data: { status: 'PROCESSED', processedAt: new Date(), version: { increment: 1 } },
            select: { id: true },
          })

          return {
            order,
            quoteInfo: {
              id: quote.id,
              number: quote.number,
              customerName: quote.customer?.name ?? null,
              paymentMode: quote.paymentMode ?? null,
              deliveryDays: Number(quote.deliveryDays ?? 0),
              deliveryDate: deliveryDate.toISOString(),
              city,
            },
            reservations: reservations.map((r: any) => ({
              quantity: Number(r.quantity),
              productId: r.line?.productId ?? null,
              productSku: r.line?.product?.sku ?? null,
              productName: r.line?.product?.name ?? null,
              batchNumber: r.balance?.batch?.batchNumber ?? null,
              batchExpiresAt: r.balance?.batch?.expiresAt ? r.balance.batch.expiresAt.toISOString() : null,
              warehouseCode: r.balance?.location?.warehouse?.code ?? null,
              warehouseName: r.balance?.location?.warehouse?.name ?? null,
              warehouseCity: r.balance?.location?.warehouse?.city ?? null,
              locationCode: r.balance?.location?.code ?? null,
            })),
            changedBalances,
          }
        })
      } catch (e: any) {
        if (e instanceof InsufficientStockCityError) {
          return reply.status(e.statusCode).send({ message: e.message, city: e.city, items: e.items })
        }
        throw e
      }

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'PROCESS',
        entityType: 'QUOTE',
        entityId: id,
        after: created?.order ?? created,
      })

      // Real-time notifications + stock reservation updates
      const room = `tenant:${tenantId}`
      console.log(`Emitting sales.quote.processed to room ${room}`, {
        quoteId: created?.quoteInfo?.id ?? id,
        orderId: created?.order?.id ?? null,
        orderNumber: created?.order?.number ?? null,
      })
      app.io?.to(room).emit('sales.quote.processed', {
        quoteId: created?.quoteInfo?.id ?? id,
        quoteNumber: created?.quoteInfo?.number ?? null,
        orderId: created?.order?.id ?? null,
        orderNumber: created?.order?.number ?? null,
        customerName: created?.quoteInfo?.customerName ?? null,
        paymentMode: created?.quoteInfo?.paymentMode ?? null,
        deliveryDays: created?.quoteInfo?.deliveryDays ?? null,
        deliveryDate: created?.quoteInfo?.deliveryDate ?? null,
        city: created?.quoteInfo?.city ?? null,
        reservations: Array.isArray(created?.reservations) ? created.reservations : [],
      })

      // Emit order created event if an order was created
      if (created?.order) {
        console.log(`Emitting sales.order.created to room ${room}`, created.order)
        app.io?.to(room).emit('sales.order.created', created.order)
      }

      // Ensure other clients see reserved quantities immediately
      if (Array.isArray(created?.changedBalances)) {
        for (const b of created.changedBalances) app.io?.to(room).emit('stock.balance.changed', b)
      }

      return reply.status(201).send(created.order)
    },
  )

  // Request stock from other users when a quote cannot be processed due to shortages.
  // Persists a request record so Warehouse can manage it.
  app.post(
    '/api/v1/sales/quotes/:id/request-stock',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const rawId = (request.params as any)?.id
      const idStr = typeof rawId === 'string' ? rawId.trim() : String(rawId ?? '').trim()
      const idParsed = z.string().uuid().safeParse(idStr)
      if (!idParsed.success) {
        return reply.status(400).send({ message: 'Invalid params', issues: idParsed.error.issues })
      }

      const id = idParsed.data
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const actor = await db.user.findFirst({
        where: { id: userId, tenantId, isActive: true },
        select: { id: true, email: true },
      })

      const quote = await db.quote.findFirst({
        where: { id, tenantId },
        include: {
          customer: { select: { id: true, city: true } },
          lines: { include: { product: { select: { name: true } } } },
        },
      })

      if (!quote) return reply.status(404).send({ message: 'Quote not found' })

      if (branchCity) {
        const custCity = String(quote.customer?.city ?? '').trim().toUpperCase()
        if (!custCity || custCity !== branchCity) {
          return reply.status(403).send({ message: 'Solo puede solicitar stock para cotizaciones de su sucursal' })
        }
      }

      const city = (quote.customer?.city ?? '').trim()
      if (!city) return reply.status(400).send({ message: 'Customer city is required to request stock' })

      const created = await db.$transaction(async (tx) => {
        const shortages = await computeStockShortagesInCity(tx, {
          tenantId,
          city,
          lines: (quote.lines ?? []).map((l: any) => ({
            productId: String(l.productId),
            productName: String(l.product?.name ?? ''),
            quantity: l.quantity,
            presentationId: l.presentationId,
            presentationQuantity: l.presentationQuantity,
          })),
        })

        const items = shortages
          .map((s) => {
            const missing = Math.max(0, Number(s.required) - Number(s.available))
            return { ...s, missing }
          })
          .filter((s) => s.missing > 0)

        if (items.length === 0) return { request: null as any, items }

        const requestRow = await tx.stockMovementRequest.create({
          data: {
            tenantId,
            requestedCity: city,
            quoteId: quote.id,
            requestedBy: userId,
            note: `Solicitud desde cotización ${quote.number ?? ''}`.trim(),
            items: {
              create: await Promise.all(items.map(async (it) => {
                let presQty: string | undefined
                if (it.presentationId) {
                  const pres = await tx.productPresentation.findFirst({
                    where: { id: it.presentationId, tenantId },
                    select: { unitsPerPresentation: true },
                  })
                  if (pres) {
                    presQty = decimalFromNumber(it.missing / toNumber(pres.unitsPerPresentation))
                  }
                }
                const itemData: any = {
                  tenantId,
                  requestedQuantity: decimalFromNumber(it.missing),
                  remainingQuantity: decimalFromNumber(it.missing),
                  product: { connect: { id: it.productId } },
                  presentationQuantity: presQty,
                }
                if (it.presentationId) {
                  itemData.presentation = { connect: { id: it.presentationId } }
                }
                return itemData
              })),
            },
          },
          select: { id: true, requestedCity: true, status: true, createdAt: true },
        })

        return { request: requestRow, items }
      })

      const room = `tenant:${tenantId}`
      app.io?.to(room).emit('sales.quote.stock_requested', {
        requestId: created.request?.id ?? null,
        actorUserId: actor?.id ?? userId,
        actorEmail: actor?.email ?? null,
        quoteId: quote.id,
        quoteNumber: quote.number ?? null,
        city,
        items: created.items,
      })

      return reply.send({ ok: true, requestId: created.request?.id ?? null, city, items: created.items })
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
            include: {
              product: { select: { name: true, sku: true, genericName: true } },
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
          },
        },
      })

      if (!quote) {
        return reply.code(404).send({ error: 'Quote not found' })
      }

      const quotedBy = await resolveUserDisplayName(db, tenantId, quote.createdBy)
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
        status: quote.status,
        quotedBy,
        customerBusinessName: quote.customer.businessName,
        customerAddress: quote.customer.address,
        customerPhone: quote.customer.phone,
        validityDays: quote.validityDays,
        paymentMode: quote.paymentMode,
        deliveryDays: quote.deliveryDays,
        deliveryCity: quote.deliveryCity,
        deliveryZone: quote.deliveryZone,
        deliveryAddress: quote.deliveryAddress,
        deliveryMapsUrl: quote.deliveryMapsUrl,
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
          productGenericName: (line.product as any).genericName ?? null,
          productSku: line.product.sku,
          presentationId: line.presentationId ?? null,
          presentationName: line.presentation?.name ?? null,
          unitsPerPresentation: line.presentation?.unitsPerPresentation ? Number(line.presentation.unitsPerPresentation) : null,
          presentationQuantity: line.presentationQuantity !== null && line.presentationQuantity !== undefined ? Number(line.presentationQuantity) : null,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountPct: Number(line.discountPct ?? 0),
          total: Number(line.unitPrice) * Number(line.quantity) * (1 - clampPct(Number(line.discountPct ?? 0)) / 100),
        })),
        createdAt: quote.createdAt.toISOString(),
        updatedAt: quote.updatedAt.toISOString(),
        processedAt: quote.processedAt ? quote.processedAt.toISOString() : null,
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
      const {
        customerId,
        validityDays,
        paymentMode,
        deliveryDays,
        deliveryCity,
        deliveryZone,
        deliveryAddress,
        deliveryMapsUrl,
        globalDiscountPct,
        proposalValue,
        note,
        lines,
      } = bodyParsed.data
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

      if (existingQuote.status === 'PROCESSED') {
        return reply.code(409).send({ message: 'Quote already processed' })
      }

      // Verify customer exists and belongs to tenant
      const customer = await db.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true, city: true, zone: true, address: true, mapsUrl: true },
      })
      if (!customer) {
        return reply.code(404).send({ error: 'Customer not found' })
      }

      // Verify all products exist and belong to tenant
      const productIds = [...new Set(lines.map((line) => line.productId))]
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
        // Ensure each product has at least a default unit presentation.
        const existingPres = await tx.productPresentation.findMany({
          where: { tenantId, productId: { in: productIds }, isActive: true },
          select: { id: true, productId: true, isDefault: true, unitsPerPresentation: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        })
        const byProduct = new Map<string, any[]>()
        for (const p of existingPres) {
          const list = byProduct.get(p.productId) ?? []
          list.push(p)
          byProduct.set(p.productId, list)
        }
        for (const pid of productIds) {
          if ((byProduct.get(pid) ?? []).length > 0) continue
          try {
            await tx.productPresentation.create({
              data: {
                tenantId,
                productId: pid,
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
            // ignore if concurrent creation
          }
        }

        // Load presentations referenced by request (if any) and default unit presentation per product.
        const requestedPresentationIds = Array.from(
          new Set(lines.map((l: any) => (typeof (l as any).presentationId === 'string' ? (l as any).presentationId : null)).filter(Boolean)),
        ) as string[]

        type PresentationRef = { id: string; productId: string; unitsPerPresentation: any; isDefault: boolean }
        const referencedPresentations: PresentationRef[] = requestedPresentationIds.length
          ? await tx.productPresentation.findMany({
              where: { tenantId, id: { in: requestedPresentationIds }, isActive: true },
              select: { id: true, productId: true, unitsPerPresentation: true, isDefault: true },
            })
          : []

        const presentationById = new Map<string, PresentationRef>(referencedPresentations.map((p) => [p.id, p]))
        if (requestedPresentationIds.length && referencedPresentations.length !== requestedPresentationIds.length) {
          const err = new Error('One or more presentations not found') as Error & { statusCode?: number }
          err.statusCode = 400
          throw err
        }

        const defaultUnitByProduct = new Map<string, string | null>()
        const defaults = await tx.productPresentation.findMany({
          where: { tenantId, productId: { in: productIds }, isActive: true },
          select: { id: true, productId: true, isDefault: true, unitsPerPresentation: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        })
        for (const row of defaults) {
          if (defaultUnitByProduct.has(row.productId)) continue
          // Prefer isDefault=true; otherwise first.
          defaultUnitByProduct.set(row.productId, row.id)
        }

        const resolvedLines = lines.map((line: any) => {
          const resolved = mustResolveLineQuantity(line)
          let baseQty = resolved.baseQuantity
          let presId: string | null = resolved.presentationId
          let presQty: number | null = resolved.presentationQuantity

          if (presId) {
            const pres = presentationById.get(presId)
            const factor = Number(pres?.unitsPerPresentation)
            if (!Number.isFinite(factor) || factor <= 0) {
              const err = new Error('Invalid unitsPerPresentation') as Error & { statusCode?: number }
              err.statusCode = 400
              throw err
            }
            baseQty = (presQty ?? 0) * factor
          } else {
            presId = defaultUnitByProduct.get(line.productId) ?? null
            presQty = baseQty
          }

          return {
            productId: line.productId,
            quantity: baseQty,
            presentationId: presId,
            presentationQuantity: presQty,
            unitPrice: line.unitPrice ?? Number((productMap.get(line.productId) as any)?.price ?? 0),
            discountPct: clampPct(line.discountPct ?? 0),
          }
        })

        // Delete existing lines
        await tx.quoteLine.deleteMany({ where: { quoteId: id, tenantId } })

        // Update quote
        const updatedQuote = await tx.quote.update({
          where: { id },
          data: {
            customerId,
            deliveryCity: (deliveryCity ?? customer.city ?? null) ? String(deliveryCity ?? customer.city).trim().toUpperCase() : null,
            deliveryZone: (deliveryZone ?? customer.zone ?? null) ? String(deliveryZone ?? customer.zone).trim().toUpperCase() : null,
            deliveryAddress: (deliveryAddress ?? customer.address ?? null) ? String(deliveryAddress ?? customer.address).trim() : null,
            deliveryMapsUrl: (deliveryMapsUrl ?? customer.mapsUrl ?? null) ? String(deliveryMapsUrl ?? customer.mapsUrl).trim() : null,
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
              include: {
                product: { select: { name: true, sku: true, genericName: true } },
                presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
              },
            },
          },
        })

        // Create new lines
        await tx.quoteLine.createMany({
          data: resolvedLines.map((line: any) => ({
            tenantId,
            quoteId: id,
            productId: line.productId,
            quantity: decimalFromNumber(line.quantity),
            presentationId: line.presentationId,
            presentationQuantity: line.presentationQuantity === null ? null : decimalFromNumber(line.presentationQuantity),
            unitPrice: decimalFromNumber(line.unitPrice),
            discountPct: decimalFromNumber(line.discountPct),
            createdBy: userId,
          })),
        })

        // Fetch updated lines
        const updatedLines = await tx.quoteLine.findMany({
          where: { quoteId: id },
          include: {
            product: { select: { name: true, sku: true, genericName: true } },
            presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
          },
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

      const quotedBy = await resolveUserDisplayName(db, tenantId, quote.createdBy)

      return {
        id: quote.id,
        number: quote.number,
        customerId: quote.customerId,
        customerName: quote.customer.name,
        status: quote.status,
        quotedBy,
        validityDays: quote.validityDays,
        paymentMode: quote.paymentMode,
        deliveryDays: quote.deliveryDays,
        deliveryCity: quote.deliveryCity,
        deliveryZone: quote.deliveryZone,
        deliveryAddress: quote.deliveryAddress,
        deliveryMapsUrl: quote.deliveryMapsUrl,
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
          productGenericName: (line.product as any).genericName ?? null,
          productSku: line.product.sku,
          presentationId: line.presentationId ?? null,
          presentationName: line.presentation?.name ?? null,
          unitsPerPresentation: line.presentation?.unitsPerPresentation ? Number(line.presentation.unitsPerPresentation) : null,
          presentationQuantity: line.presentationQuantity !== null && line.presentationQuantity !== undefined ? Number(line.presentationQuantity) : null,
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
