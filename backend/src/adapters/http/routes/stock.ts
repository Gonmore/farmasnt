import type { FastifyInstance } from 'fastify'
import { randomBytes, randomUUID } from 'crypto'
import { z } from 'zod'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { createStockMovementTx } from '../../../application/stock/stockMovementService.js'
import { getEnv } from '../../../shared/env.js'

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

const bulkTransferCreateSchema = z.object({
  fromWarehouseId: z.string().uuid().optional(),
  fromLocationId: z.string().uuid(),
  toWarehouseId: z.string().uuid().optional(),
  toLocationId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        batchId: z.string().uuid().nullable().optional(),
        // Optional override per item
        fromLocationId: z.string().uuid().optional(),
        toLocationId: z.string().uuid().optional(),
        quantity: z.coerce.number().positive().optional(),
        presentationId: z.string().uuid().optional(),
        presentationQuantity: z.coerce.number().positive().optional(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(200),
})

const bulkFulfillRequestsSchema = z.object({
  requestIds: z.array(z.string().uuid()).min(1).max(100),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        batchId: z.string().uuid().nullable().optional(),
        fromLocationId: z.string().uuid().optional(),
        quantity: z.coerce.number().positive().optional(),
        presentationId: z.string().uuid().optional(),
        presentationQuantity: z.coerce.number().positive().optional(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(300),
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

const stockReturnPhotoPresignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(100),
})

const stockReturnsListQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(200).default(50),
  warehouseId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

const stockReturnIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const stockReturnCreateSchema = z.object({
  toLocationId: z.string().uuid(),
  sourceType: z.string().trim().max(30).optional(),
  sourceId: z.string().trim().max(80).optional(),
  reason: z.string().trim().min(1).max(500),
  photoKey: z.string().trim().min(1).max(500),
  photoUrl: z.string().trim().min(1).max(2000),
  note: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        batchId: z.string().uuid().nullable().optional(),
        quantity: z.coerce.number().positive().optional(),
        presentationId: z.string().uuid().optional(),
        presentationQuantity: z.coerce.number().positive().optional(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(100),
})

function assertS3Configured(env: ReturnType<typeof getEnv>) {
  const missing: string[] = []
  if (!env.S3_ENDPOINT) missing.push('S3_ENDPOINT')
  if (!env.S3_BUCKET) missing.push('S3_BUCKET')
  if (!env.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID')
  if (!env.S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY')
  if (!env.S3_PUBLIC_BASE_URL) missing.push('S3_PUBLIC_BASE_URL')
  if (missing.length > 0) {
    const err = new Error(`S3 not configured: missing ${missing.join(', ')}`) as Error & { statusCode?: number }
    err.statusCode = 500
    throw err
  }
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return `${b}/${p}`
}

function extFromFileName(fileName: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(fileName)
  return (m?.[1] ?? '').toLowerCase()
}

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

async function resolvePresentationAndBaseQty(tx: any, opts: {
  tenantId: string
  userId: string
  productId: string
  quantityInput: any
}): Promise<{ baseQty: number; presentationId: string | null; presentationQuantity: number | null }> {
  const { tenantId, userId, productId, quantityInput } = opts
  const resolved = mustResolveMovementQuantity(quantityInput)

  let baseQty = resolved.baseQuantity
  let presentationId: string | null = resolved.presentationId
  let presentationQuantity: number | null = resolved.presentationQuantity

  if (presentationId) {
    const pres = await tx.productPresentation.findFirst({
      where: { tenantId, id: presentationId, isActive: true },
      select: { id: true, productId: true, unitsPerPresentation: true },
    })
    if (!pres || pres.productId !== productId) {
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
    return { baseQty, presentationId, presentationQuantity }
  }

  // Store unit-presentation metadata for traceability when client sends base units.
  let unitPres = await tx.productPresentation.findFirst({
    where: { tenantId, productId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  if (!unitPres) {
    try {
      unitPres = await tx.productPresentation.create({
        data: {
          tenantId,
          productId,
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
      unitPres = await tx.productPresentation.findFirst({
        where: { tenantId, productId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
    }
  }

  presentationId = unitPres?.id ?? null
  presentationQuantity = baseQty
  return { baseQty, presentationId, presentationQuantity }
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

const movementRequestCreateSchema = z.object({
  warehouseId: z.string().uuid(),
  requestedByName: z.string().trim().min(1).max(100),
  productId: z.string().uuid(),
  items: z.array(z.object({
    presentationId: z.string().uuid(),
    quantity: z.coerce.number().positive(),
  })).min(1),
  note: z.string().trim().max(500).optional(),
})

const movementRequestConfirmParamsSchema = z.object({
  id: z.string().uuid(),
})

const movementRequestConfirmBodySchema = z.object({
  action: z.enum(['ACCEPT', 'REJECT']),
  note: z.string().trim().max(500).optional(),
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
  const env = getEnv()

  function branchCityOf(request: any): string | null {
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    const city = String(request.auth?.warehouseCity ?? '').trim()
    return city ? city.toUpperCase() : '__MISSING__'
  }

  app.post(
    '/api/v1/stock/returns/photo-upload',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const parsed = stockReturnPhotoPresignSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const allowedContentTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
      if (!allowedContentTypes.has(parsed.data.contentType)) {
        return reply.status(400).send({ message: 'Unsupported contentType' })
      }

      assertS3Configured(env)

      const tenantId = request.auth!.tenantId
      const ext = extFromFileName(parsed.data.fileName)
      const safeExt = ext && ext.length <= 8 ? ext : 'jpg'
      const rand = randomBytes(8).toString('hex')
      const key = `tenants/${tenantId}/stock-returns/photo-${Date.now()}-${rand}.${safeExt}`

      const s3 = new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT!,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID!,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        },
      })

      const cmd = new PutObjectCommand({
        Bucket: env.S3_BUCKET!,
        Key: key,
        ContentType: parsed.data.contentType,
      })

      const expiresInSeconds = 300
      const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds })
      const publicUrl = joinUrl(env.S3_PUBLIC_BASE_URL!, key)

      return reply.send({ uploadUrl, publicUrl, key, expiresInSeconds, method: 'PUT' })
    },
  )

  app.get(
    '/api/v1/stock/returns',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const parsed = stockReturnsListQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const from = parsed.data.from ? new Date(parsed.data.from) : null
      const to = parsed.data.to ? new Date(parsed.data.to) : null

      const rows = await (db as any).stockReturn.findMany({
        where: {
          tenantId,
          ...(parsed.data.warehouseId
            ? {
                toLocation: { warehouseId: parsed.data.warehouseId },
              }
            : {}),
          ...(from ? { createdAt: { gte: from } } : {}),
          ...(to ? { createdAt: { lt: to } } : {}),
          ...(branchCity
            ? {
                toLocation: { warehouse: { city: { equals: branchCity, mode: 'insensitive' as const } } },
              }
            : {}),
        },
        take: parsed.data.take,
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          reason: true,
          note: true,
          sourceType: true,
          sourceId: true,
          photoUrl: true,
          createdAt: true,
          createdBy: true,
          toLocation: { select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true, city: true } } } },
          items: {
            select: {
              id: true,
              productId: true,
              batchId: true,
              quantity: true,
              presentationId: true,
              presentationQuantity: true,
              product: { select: { sku: true, name: true, genericName: true } },
              batch: { select: { batchNumber: true, expiresAt: true } },
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
            orderBy: [{ createdAt: 'asc' }],
          },
        },
      })

      return reply.send({
        items: rows.map((r: any) => ({
          id: r.id,
          reason: r.reason,
          note: r.note ?? null,
          sourceType: r.sourceType ?? null,
          sourceId: r.sourceId ?? null,
          photoUrl: r.photoUrl ?? null,
          createdAt: r.createdAt.toISOString(),
          createdBy: r.createdBy ?? null,
          toLocation: {
            id: r.toLocation.id,
            code: r.toLocation.code,
            warehouse: r.toLocation.warehouse,
          },
          items: (r.items ?? []).map((it: any) => ({
            id: it.id,
            productId: it.productId,
            sku: it.product?.sku ?? null,
            name: it.product?.name ?? null,
            genericName: it.product?.genericName ?? null,
            batchId: it.batchId ?? null,
            batchNumber: it.batch?.batchNumber ?? null,
            expiresAt: it.batch?.expiresAt ? new Date(it.batch.expiresAt).toISOString() : null,
            quantity: String(it.quantity),
            presentationId: it.presentationId ?? null,
            presentationName: it.presentation?.name ?? null,
            unitsPerPresentation: it.presentation?.unitsPerPresentation ?? null,
            presentationQuantity: it.presentationQuantity ? String(it.presentationQuantity) : null,
          })),
        })),
      })
    },
  )

  app.get(
    '/api/v1/stock/returns/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const parsed = stockReturnIdParamsSchema.safeParse(request.params)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid params', issues: parsed.error.issues })

      const row = await (db as any).stockReturn.findFirst({
        where: {
          id: parsed.data.id,
          tenantId,
          ...(branchCity
            ? { toLocation: { warehouse: { city: { equals: branchCity, mode: 'insensitive' as const } } } }
            : {}),
        },
        select: {
          id: true,
          reason: true,
          note: true,
          sourceType: true,
          sourceId: true,
          photoUrl: true,
          createdAt: true,
          createdBy: true,
          toLocation: { select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true, city: true } } } },
          items: {
            select: {
              id: true,
              productId: true,
              batchId: true,
              quantity: true,
              presentationId: true,
              presentationQuantity: true,
              product: { select: { sku: true, name: true, genericName: true } },
              batch: { select: { batchNumber: true, expiresAt: true } },
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
            orderBy: [{ createdAt: 'asc' }],
          },
        },
      })

      if (!row) return reply.status(404).send({ message: 'Return not found' })
      return reply.send({ item: row })
    },
  )

  app.post(
    '/api/v1/stock/returns',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const parsed = stockReturnCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const input = parsed.data

      try {
        const result = await db.$transaction(async (tx: any) => {
          const toLoc = await tx.location.findFirst({
            where: { id: input.toLocationId, tenantId, isActive: true },
            select: { id: true, code: true, warehouse: { select: { id: true, city: true } } },
          })
          if (!toLoc) {
            const err = new Error('toLocationId not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }

          if (branchCity) {
            const city = String(toLoc.warehouse?.city ?? '').trim()
            if (!city) {
              const err = new Error('Destination warehouse has no city') as Error & { statusCode?: number }
              err.statusCode = 409
              throw err
            }
            if (city.toUpperCase() !== branchCity.toUpperCase()) {
              const err = new Error('Forbidden for this branch') as Error & { statusCode?: number }
              err.statusCode = 403
              throw err
            }
          }

          const createdReturn = await tx.stockReturn.create({
            data: {
              tenantId,
              toLocationId: input.toLocationId,
              sourceType: input.sourceType ?? null,
              sourceId: input.sourceId ?? null,
              reason: input.reason,
              photoKey: input.photoKey,
              photoUrl: input.photoUrl,
              note: input.note ?? null,
              createdBy: userId,
            },
            select: { id: true, createdAt: true },
          })

          const movements: any[] = []
          const balances: any[] = []

          for (const it of input.items) {
            const { baseQty, presentationId, presentationQuantity } = await resolvePresentationAndBaseQty(tx, {
              tenantId,
              userId,
              productId: it.productId,
              quantityInput: it,
            })

            await tx.stockReturnItem.create({
              data: {
                tenantId,
                returnId: createdReturn.id,
                productId: it.productId,
                batchId: it.batchId ?? null,
                quantity: baseQty,
                presentationId,
                presentationQuantity,
                createdBy: userId,
              },
              select: { id: true },
            })

            const r = await createStockMovementTx(tx, {
              tenantId,
              userId,
              type: 'IN',
              productId: it.productId,
              batchId: it.batchId ?? null,
              toLocationId: input.toLocationId,
              quantity: baseQty,
              presentationId,
              presentationQuantity,
              referenceType: 'RETURN',
              referenceId: createdReturn.id,
              note: it.note ?? input.note ?? input.reason,
            })

            movements.push(r.createdMovement)
            if (r.toBalance) balances.push(r.toBalance)
          }

          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.return.create',
            entityType: 'StockReturn',
            entityId: createdReturn.id,
            after: { id: createdReturn.id, toLocationId: input.toLocationId, itemsCount: input.items.length },
          })

          return { id: createdReturn.id, createdAt: createdReturn.createdAt, movements, balances }
        })

        const room = `tenant:${tenantId}`
        for (const m of result.movements ?? []) {
          app.io?.to(room).emit('stock.movement.created', m)
        }
        for (const b of result.balances ?? []) {
          app.io?.to(room).emit('stock.balance.changed', b)
        }

        return reply.status(201).send({ id: result.id, createdAt: result.createdAt.toISOString() })
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
      }
    },
  )

  app.get(
    '/api/v1/stock/movement-requests',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }
      const parsed = movementRequestsListQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const where: any = {
        tenantId,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(branchCity
          ? { requestedCity: { equals: branchCity, mode: 'insensitive' as const } }
          : parsed.data.city
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

      const userIds = [...new Set(rows.map((r) => r.requestedBy).filter(Boolean).filter(id => {
        // Check if it looks like a UUID (manual requests have names, quote requests have user IDs)
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      }))]
      const users = userIds.length
        ? await db.user.findMany({ where: { tenantId, id: { in: userIds } }, select: { id: true, email: true, fullName: true } })
        : []
      const userMap = new Map(users.map((u) => [u.id, u.fullName || u.email || u.id]))

      // For non-UUID requestedBy values (manual requests), use the value directly as name
      rows.forEach(r => {
        if (r.requestedBy && !userMap.has(r.requestedBy)) {
          userMap.set(r.requestedBy, r.requestedBy)
        }
      })

      return reply.send({
        items: rows.map((r) => ({
          id: r.id,
          status: r.status,
          confirmationStatus: (r as any).confirmationStatus,
          requestedCity: r.requestedCity,
          quoteId: r.quoteId,
          note: r.note,
          requestedBy: r.requestedBy,
          requestedByName: userMap.get(r.requestedBy) || null,
          fulfilledAt: r.fulfilledAt ? r.fulfilledAt.toISOString() : null,
          fulfilledBy: r.fulfilledBy,
          confirmedAt: (r as any).confirmedAt ? (r as any).confirmedAt.toISOString() : null,
          confirmedBy: (r as any).confirmedBy ?? null,
          confirmationNote: (r as any).confirmationNote ?? null,
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

  app.post(
    '/api/v1/stock/movement-requests',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const parsed = movementRequestCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const input = parsed.data

      try {
        const result = await db.$transaction(async (tx) => {
          // Get warehouse to extract city
          const warehouse = await (tx as any).warehouse.findFirst({
            where: { tenantId, id: input.warehouseId, isActive: true },
            select: { id: true, city: true },
          })
          if (!warehouse) {
            const err = new Error('Warehouse not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }

          if (branchCity) {
            const whCity = String(warehouse.city ?? '').trim().toUpperCase()
            if (!whCity || whCity !== branchCity) {
              const err = new Error('Solo puede solicitar movimientos para su sucursal') as Error & { statusCode?: number }
              err.statusCode = 403
              throw err
            }
          }

          // Validate product exists
          const product = await (tx as any).product.findFirst({
            where: { tenantId, id: input.productId, isActive: true },
            select: { id: true },
          })
          if (!product) {
            const err = new Error('Product not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }

          // Validate presentations and calculate quantities
          const presentationIds = input.items.map(item => item.presentationId)
          const presentations = await (tx as any).productPresentation.findMany({
            where: { tenantId, id: { in: presentationIds }, productId: input.productId, isActive: true },
            select: { id: true, unitsPerPresentation: true },
          })

          if (presentations.length !== presentationIds.length) {
            const err = new Error('One or more presentations not found or invalid for this product') as Error & { statusCode?: number }
            err.statusCode = 400
            throw err
          }

          const presentationMap = new Map(presentations.map((p: any) => [p.id, Number(p.unitsPerPresentation)]))

          // Create the movement request
          const movementRequest = await (tx as any).stockMovementRequest.create({
            data: {
              tenantId,
              requestedCity: warehouse.city,
              requestedBy: input.requestedByName, // Store the provided name directly
              note: input.note,
              items: {
                create: input.items.map(item => {
                  const unitsPerPresentation = presentationMap.get(item.presentationId) ?? 1
                  const requestedQuantity = item.quantity * (unitsPerPresentation as number)
                  return {
                    tenantId,
                    productId: input.productId,
                    presentationId: item.presentationId,
                    presentationQuantity: item.quantity,
                    requestedQuantity,
                    remainingQuantity: requestedQuantity,
                  }
                }),
              },
            },
            include: {
              items: {
                include: {
                  product: { select: { id: true, sku: true, name: true, genericName: true } },
                  presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
                },
              },
            },
          })

          // Audit the creation
          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.movement-request.create',
            entityType: 'StockMovementRequest',
            entityId: movementRequest.id,
            after: {
              requestedByName: input.requestedByName,
              warehouseId: input.warehouseId,
              productId: input.productId,
              itemsCount: input.items.length,
            },
          })

          return movementRequest
        })

        // Get user name for response
        const user = await db.user.findFirst({
          where: { tenantId, id: userId },
          select: { fullName: true, email: true },
        })
        const userName = user?.fullName || user?.email || userId

        return reply.status(201).send({
          id: result.id,
          status: result.status,
          confirmationStatus: (result as any).confirmationStatus,
          requestedCity: result.requestedCity,
          requestedByName: input.requestedByName, // Use the provided name
          confirmedAt: null,
          confirmedBy: null,
          confirmationNote: null,
          createdAt: result.createdAt.toISOString(),
          items: result.items.map((it: any) => ({
            id: it.id,
            productId: it.productId,
            productSku: it.product?.sku ?? null,
            productName: it.product?.name ?? null,
            genericName: it.product?.genericName ?? null,
            requestedQuantity: Number(it.requestedQuantity),
            remainingQuantity: Number(it.remainingQuantity),
            presentationId: it.presentationId,
            presentationQuantity: Number(it.presentationQuantity),
            presentationName: it.presentation?.name ?? null,
            unitsPerPresentation: it.presentation?.unitsPerPresentation ?? null,
          })),
        })
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        console.error('Error creating movement request:', e)
        return reply.status(500).send({ message: 'Internal server error' })
      }
    },
  )

  // Confirm a fulfilled movement request (branch scope)
  app.patch(
    '/api/v1/stock/movement-requests/:id/confirm',
    {
      preHandler: [
        requireAuth(),
        requireModuleEnabled(db, 'WAREHOUSE'),
        requirePermission(Permissions.StockRead),
        requirePermission(Permissions.ScopeBranch),
      ],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const parsedParams = movementRequestConfirmParamsSchema.safeParse((request as any).params)
      if (!parsedParams.success) return reply.status(400).send({ message: 'Invalid params', issues: parsedParams.error.issues })

      const parsedBody = movementRequestConfirmBodySchema.safeParse(request.body)
      if (!parsedBody.success) return reply.status(400).send({ message: 'Invalid request', issues: parsedBody.error.issues })

      const { id } = parsedParams.data
      const { action, note } = parsedBody.data

      try {
        const updated = await db.$transaction(async (tx) => {
          const existing = await (tx as any).stockMovementRequest.findFirst({
            where: { tenantId, id },
            select: {
              id: true,
              status: true,
              requestedCity: true,
              confirmationStatus: true,
            },
          })

          if (!existing) {
            const err = new Error('Not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }

          const reqCity = String(existing.requestedCity ?? '').trim().toUpperCase()
          if (branchCity && reqCity !== branchCity) {
            const err = new Error('Solo puede confirmar solicitudes de su sucursal') as Error & { statusCode?: number }
            err.statusCode = 403
            throw err
          }

          if (existing.status !== 'FULFILLED') {
            const err = new Error('La solicitud todavía no fue atendida') as Error & { statusCode?: number }
            err.statusCode = 409
            throw err
          }

          if (existing.confirmationStatus !== 'PENDING') {
            const err = new Error('La solicitud ya fue confirmada') as Error & { statusCode?: number }
            err.statusCode = 409
            throw err
          }

          const confirmationStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED'
          const row = await (tx as any).stockMovementRequest.update({
            where: { id },
            data: {
              confirmationStatus,
              confirmedAt: new Date(),
              confirmedBy: userId,
              confirmationNote: note ?? null,
            },
            select: {
              id: true,
              status: true,
              confirmationStatus: true,
              requestedCity: true,
              confirmedAt: true,
              confirmedBy: true,
              confirmationNote: true,
            },
          })

          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.movement-request.confirm',
            entityType: 'StockMovementRequest',
            entityId: id,
            after: { action, confirmationStatus, note: note ?? null },
          })

          return row
        })

        const room = `tenant:${tenantId}`
        app.io?.to(room).emit('stock.movement_request.confirmed', {
          id: updated.id,
          status: updated.status,
          confirmationStatus: (updated as any).confirmationStatus,
          requestedCity: updated.requestedCity,
          confirmedAt: (updated as any).confirmedAt ? (updated as any).confirmedAt.toISOString() : null,
          confirmedBy: (updated as any).confirmedBy ?? null,
          confirmationNote: (updated as any).confirmationNote ?? null,
        })

        return reply.send({
          id: updated.id,
          status: updated.status,
          confirmationStatus: (updated as any).confirmationStatus,
          requestedCity: updated.requestedCity,
          confirmedAt: (updated as any).confirmedAt ? (updated as any).confirmedAt.toISOString() : null,
          confirmedBy: (updated as any).confirmedBy ?? null,
          confirmationNote: (updated as any).confirmationNote ?? null,
        })
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
      }
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

        // Auto-apply stock transfers against movement requests by city.
        // NOTE: Explicit request-fulfillment endpoints handle their own allocation and MUST opt-out.
        const skipAutoApply = String(input.referenceType ?? '').toUpperCase() === 'REQUEST_BULK_FULFILL'

        if (!skipAutoApply && input.type === 'TRANSFER' && result.createdMovement?.toLocationId) {
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

  // Bulk transfer (multi-line TRANSFER)
  app.post(
    '/api/v1/stock/bulk-transfers',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const parsed = bulkTransferCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const input = parsed.data

      const referenceType = 'BULK_TRANSFER'
      const referenceId = randomUUID()

      try {
        const result = await db.$transaction(async (tx) => {
          // Validate base locations exist and belong to tenant
          const [baseFromLoc, baseToLoc] = await Promise.all([
            tx.location.findFirst({ where: { id: input.fromLocationId, tenantId }, select: { id: true, warehouseId: true } }),
            tx.location.findFirst({ where: { id: input.toLocationId, tenantId }, select: { id: true, warehouseId: true } }),
          ])
          if (!baseFromLoc) throw Object.assign(new Error('fromLocationId not found'), { statusCode: 404 })
          if (!baseToLoc) throw Object.assign(new Error('toLocationId not found'), { statusCode: 404 })

          if (input.fromWarehouseId && input.fromWarehouseId !== baseFromLoc.warehouseId) {
            throw Object.assign(new Error('fromLocationId does not belong to fromWarehouseId'), { statusCode: 400 })
          }
          if (input.toWarehouseId && input.toWarehouseId !== baseToLoc.warehouseId) {
            throw Object.assign(new Error('toLocationId does not belong to toWarehouseId'), { statusCode: 400 })
          }

          const rows: any[] = []
          for (const it of input.items) {
            const fromLocationId = it.fromLocationId ?? input.fromLocationId
            const toLocationId = it.toLocationId ?? input.toLocationId

            const [fromLoc, toLoc] = await Promise.all([
              tx.location.findFirst({ where: { id: fromLocationId, tenantId }, select: { id: true } }),
              tx.location.findFirst({ where: { id: toLocationId, tenantId }, select: { id: true } }),
            ])
            if (!fromLoc) throw Object.assign(new Error('fromLocationId not found'), { statusCode: 404 })
            if (!toLoc) throw Object.assign(new Error('toLocationId not found'), { statusCode: 404 })

            // Ensure product exists
            const product = await tx.product.findFirst({ where: { tenantId, id: it.productId, isActive: true }, select: { id: true } })
            if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 })

            const { baseQty, presentationId, presentationQuantity } = await resolvePresentationAndBaseQty(tx, {
              tenantId,
              userId,
              productId: it.productId,
              quantityInput: it,
            })

            const created = await createStockMovementTx(tx, {
              tenantId,
              userId,
              type: 'TRANSFER',
              productId: it.productId,
              batchId: it.batchId ?? null,
              fromLocationId,
              toLocationId,
              quantity: baseQty,
              presentationId,
              presentationQuantity,
              referenceType,
              referenceId,
              note: it.note ?? input.note ?? null,
            })
            rows.push(created)
          }

          return rows
        })

        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'stock.bulk-transfer.create',
          entityType: 'StockMovement',
          entityId: referenceId,
          after: { referenceType, referenceId, count: result.length },
        })

        const room = `tenant:${tenantId}`
        for (const r of result) {
          app.io?.to(room).emit('stock.movement.created', r.createdMovement)
          if (r.fromBalance) app.io?.to(room).emit('stock.balance.changed', r.fromBalance)
          if (r.toBalance) app.io?.to(room).emit('stock.balance.changed', r.toBalance)
        }

        return reply.status(201).send({ referenceType, referenceId, items: result })
      } catch (e: any) {
        if (e?.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
      }
    },
  )

  // Bulk fulfill selected movement requests for a branch (multi-line TRANSFER + targeted allocation)
  app.post(
    '/api/v1/stock/movement-requests/bulk-fulfill',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const parsed = bulkFulfillRequestsSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)
      const input = parsed.data

      const referenceType = 'REQUEST_BULK_FULFILL'
      const referenceId = randomUUID()

      try {
        const txResult = await db.$transaction(async (tx) => {
          const toLoc = await tx.location.findFirst({
            where: { id: input.toLocationId, tenantId },
            select: { id: true, warehouse: { select: { id: true, city: true } } },
          })
          if (!toLoc) throw Object.assign(new Error('toLocationId not found'), { statusCode: 404 })
          const destCity = String(toLoc.warehouse?.city ?? '').trim().toUpperCase()
          if (!destCity) throw Object.assign(new Error('Destination warehouse has no city'), { statusCode: 409 })

          if (branchCity === '__MISSING__') {
            throw Object.assign(new Error('Seleccione su sucursal antes de continuar'), { statusCode: 409 })
          }
          if (branchCity && branchCity !== destCity) {
            throw Object.assign(new Error('Solo puede atender solicitudes de su sucursal'), { statusCode: 403 })
          }

          const requests = await tx.stockMovementRequest.findMany({
            where: { tenantId, id: { in: input.requestIds } },
            orderBy: [{ createdAt: 'asc' }],
            select: {
              id: true,
              status: true,
              requestedCity: true,
              createdAt: true,
              items: {
                select: { id: true, productId: true, remainingQuantity: true, createdAt: true },
                orderBy: [{ createdAt: 'asc' }],
              },
            },
          })

          if (requests.length !== input.requestIds.length) {
            throw Object.assign(new Error('One or more requests not found'), { statusCode: 404 })
          }

          for (const r of requests) {
            if (r.status !== 'OPEN') throw Object.assign(new Error('All requests must be OPEN'), { statusCode: 409 })
            const rc = String(r.requestedCity ?? '').trim().toUpperCase()
            if (!rc || rc !== destCity) {
              throw Object.assign(new Error('All requests must belong to the destination city'), { statusCode: 409 })
            }
          }

          // Build a list of target request-items limited to selected requests
          const requestOrder = new Map(requests.map((r, idx) => [r.id, idx]))

          const fetchOpenItemsByProduct = async (productId: string) => {
            const items = await tx.stockMovementRequestItem.findMany({
              where: {
                tenantId,
                productId,
                remainingQuantity: { gt: 0 },
                requestId: { in: input.requestIds },
                request: { status: 'OPEN' },
              },
              select: { id: true, requestId: true, remainingQuantity: true },
            })
            // deterministic order: request creation order then item id
            return items.sort((a, b) => {
              const ao = requestOrder.get(a.requestId) ?? 0
              const bo = requestOrder.get(b.requestId) ?? 0
              if (ao !== bo) return ao - bo
              return a.id.localeCompare(b.id)
            })
          }

          // Create transfers and allocate quantities only to selected requests
          const createdMovements: any[] = []
          const touchedRequestIds = new Set<string>()

          // validate base from location exists
          const baseFromLoc = await tx.location.findFirst({ where: { id: input.fromLocationId, tenantId }, select: { id: true } })
          if (!baseFromLoc) throw Object.assign(new Error('fromLocationId not found'), { statusCode: 404 })

          for (const line of input.lines) {
            const fromLocationId = line.fromLocationId ?? input.fromLocationId
            const fromLoc = await tx.location.findFirst({ where: { id: fromLocationId, tenantId }, select: { id: true } })
            if (!fromLoc) throw Object.assign(new Error('fromLocationId not found'), { statusCode: 404 })

            const product = await tx.product.findFirst({ where: { tenantId, id: line.productId, isActive: true }, select: { id: true } })
            if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 })

            const { baseQty, presentationId, presentationQuantity } = await resolvePresentationAndBaseQty(tx, {
              tenantId,
              userId,
              productId: line.productId,
              quantityInput: line,
            })

            const created = await createStockMovementTx(tx, {
              tenantId,
              userId,
              type: 'TRANSFER',
              productId: line.productId,
              batchId: line.batchId ?? null,
              fromLocationId,
              toLocationId: input.toLocationId,
              quantity: baseQty,
              presentationId,
              presentationQuantity,
              referenceType,
              referenceId,
              note: line.note ?? input.note ?? null,
            })
            createdMovements.push(created)

            let remainingToApply = baseQty
            const targetItems = await fetchOpenItemsByProduct(line.productId)
            for (const it of targetItems) {
              if (remainingToApply <= 0) break
              const rem = Number(it.remainingQuantity)
              if (!Number.isFinite(rem) || rem <= 0) continue
              const apply = Math.min(rem, remainingToApply)
              remainingToApply -= apply
              touchedRequestIds.add(it.requestId)
              await tx.stockMovementRequestItem.update({
                where: { id: it.id },
                data: { remainingQuantity: { decrement: apply } },
              })
            }
          }

          const fulfilledRequestIds: string[] = []
          for (const requestId of touchedRequestIds) {
            const agg = await tx.stockMovementRequestItem.aggregate({
              where: { tenantId, requestId },
              _sum: { remainingQuantity: true },
            })
            const sumRemaining = Number((agg as any)?._sum?.remainingQuantity ?? 0)
            if (sumRemaining <= 1e-9) {
              await tx.stockMovementRequest.update({
                where: { id: requestId },
                data: { status: 'FULFILLED', fulfilledAt: new Date(), fulfilledBy: userId },
              })
              fulfilledRequestIds.push(requestId)
            }
          }

          return { referenceType, referenceId, createdMovements, fulfilledRequestIds, destinationCity: destCity }
        })

        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'stock.movement-request.bulk-fulfill',
          entityType: 'StockMovementRequest',
          entityId: txResult.referenceId,
          after: {
            requestIds: input.requestIds,
            fulfilledRequestIds: txResult.fulfilledRequestIds,
            movementCount: txResult.createdMovements.length,
            destinationCity: txResult.destinationCity,
          },
        })

        const room = `tenant:${tenantId}`
        for (const r of txResult.createdMovements) {
          app.io?.to(room).emit('stock.movement.created', r.createdMovement)
          if (r.fromBalance) app.io?.to(room).emit('stock.balance.changed', r.fromBalance)
          if (r.toBalance) app.io?.to(room).emit('stock.balance.changed', r.toBalance)
        }
        for (const requestId of txResult.fulfilledRequestIds) {
          const updatedReq = await db.stockMovementRequest.findFirst({
            where: { tenantId, id: requestId },
            select: { id: true, requestedCity: true, quoteId: true, requestedBy: true, status: true },
          })
          if (updatedReq) app.io?.to(room).emit('stock.movement_request.fulfilled', updatedReq)
        }

        return reply.status(201).send(txResult)
      } catch (e: any) {
        if (e?.statusCode) return reply.status(e.statusCode).send({ message: e.message })
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
