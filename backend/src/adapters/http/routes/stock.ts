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
  // Allows tenant admins to backdate movements (stored as createdAt).
  createdAt: z.string().datetime().optional(),
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

const completedMovementDocsParamsSchema = z.object({
  id: z.string().uuid(),
})

const completedMovementDocsQuerySchema = z.object({
  type: z.enum(['MOVEMENT', 'BULK_TRANSFER', 'FULFILL_REQUEST', 'RETURN']),
})

function formatWarehouseLabel(wh: { code: string | null; name: string | null } | null | undefined): string {
  const code = String(wh?.code ?? '').trim()
  const name = String(wh?.name ?? '').trim()
  const label = [code, name].filter(Boolean).join(' - ')
  return label || '—'
}

function buildProductLabel(p: { sku: string | null; name: string | null; genericName: string | null } | null | undefined): string {
  const sku = String(p?.sku ?? '—').trim()
  const name = String(p?.name ?? '—').trim()
  const generic = String(p?.genericName ?? '').trim()
  return generic ? `${sku} · ${name} · ${generic}` : `${sku} · ${name}`
}

const bulkFulfillRequestsSchema = z.object({
  fulfillments: z.array(
    z.object({
      requestId: z.string().uuid(),
      items: z.array(
        z.object({
          requestItemId: z.string().uuid().optional(),
          productId: z.string().uuid(),
          batchId: z.string().uuid(),
          quantity: z.coerce.number().positive(),
        })
      ).min(1),
    })
  ).min(1),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
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
  status: z.enum(['OPEN', 'SENT', 'FULFILLED', 'CANCELLED']).optional(),
  city: z.string().trim().max(80).optional(),
  warehouseId: z.string().uuid().optional(),
})

const movementRequestCreateSchema = z.object({
  warehouseId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        presentationId: z.string().uuid(),
        quantity: z.coerce.number().int().positive(),
      }),
    )
    .min(1),
  note: z.string().trim().max(500).optional(),
})

const movementRequestUpdateParamsSchema = z.object({
  id: z.string().uuid(),
})

const movementRequestCancelParamsSchema = z.object({
  id: z.string().uuid(),
})

const movementRequestCancelBodySchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .optional()

const movementRequestConfirmParamsSchema = z.object({
  id: z.string().uuid(),
})

const movementRequestPlanParamsSchema = z.object({
  id: z.string().uuid(),
})

const movementRequestPlanBodySchema = z
  .object({
    fromWarehouseId: z.string().uuid().optional(),
    fromLocationId: z.string().uuid().optional(),
    takePerItem: z.coerce.number().int().min(1).max(200).default(50),
    allowExpired: z.coerce.boolean().optional().default(false),
  })
  .refine((x) => !!x.fromWarehouseId || !!x.fromLocationId, {
    message: 'fromWarehouseId or fromLocationId is required',
  })

const movementRequestConfirmBodySchema = z.object({
  action: z.enum(['ACCEPT', 'REJECT']),
  note: z.string().trim().max(500).optional(),
})

const movementRequestFulfillParamsSchema = z.object({
  id: z.string().uuid(),
})

const movementRequestFulfillBodySchema = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z
        .object({
          requestItemId: z.string().uuid().optional(),
          productId: z.string().uuid(),
          batchId: z.string().uuid().nullable().optional(),
          fromLocationId: z.string().uuid().optional(),
          quantity: z.coerce.number().positive().optional(),
          presentationId: z.string().uuid().optional(),
          presentationQuantity: z.coerce.number().positive().optional(),
          note: z.string().trim().max(500).optional(),
        })
        .refine(
          (x) => {
            const hasPresentation = typeof x.presentationId === 'string' && x.presentationId.length > 0
            if (hasPresentation) {
              const pq = Number(x.presentationQuantity)
              return Number.isFinite(pq) && pq > 0
            }
            const q = Number(x.quantity)
            return Number.isFinite(q) && q > 0
          },
          { message: 'Provide quantity or (presentationId + presentationQuantity)' },
        )
        .refine((x) => !!x.requestItemId || !!x.presentationId, {
          message: 'Provide requestItemId or presentationId to match the request item',
        }),
    )
    .min(1)
    .max(300),
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

function cmpNullableDateAsc(a: Date | null, b: Date | null): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.getTime() - b.getTime()
}

export async function registerStockRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)
  const env = getEnv()

  function branchCityOf(request: any): string | null {
    if (request.auth?.isTenantAdmin) return null
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    const city = String(request.auth?.warehouseCity ?? '').trim()
    return city ? city.toUpperCase() : '__MISSING__'
  }

  function branchWarehouseIdOf(request: any): string | null {
    if (request.auth?.isTenantAdmin) return null
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    const wid = String(request.auth?.warehouseId ?? '').trim()
    return wid ? wid : '__MISSING__'
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
      const branchWarehouseId = branchWarehouseIdOf(request)
      if (branchWarehouseId === '__MISSING__') {
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

          if (branchWarehouseId && toLoc.warehouse?.id !== branchWarehouseId) {
            const err = new Error('Forbidden for this branch') as Error & { statusCode?: number }
            err.statusCode = 403
            throw err
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
      const debugMovementRequests = process.env.DEBUG_STOCK_MOVEMENT_REQUESTS === '1'

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }
      const parsed = movementRequestsListQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const where: any = {
        tenantId,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      }

      if (parsed.data.warehouseId) {
        if (branchCity && branchCity !== '__MISSING__') {
          const wh = await (db as any).warehouse.findFirst({
            where: { tenantId, id: parsed.data.warehouseId },
            select: { city: true },
          })
          const whCity = String(wh?.city ?? '').trim().toUpperCase()
          if (!whCity || whCity !== branchCity) {
            return reply.status(403).send({ message: 'Solo puede ver solicitudes de su sucursal' })
          }
        }
        where.warehouseId = parsed.data.warehouseId
      } else {
        Object.assign(
          where,
          branchCity
            ? {
                requestedCity: {
                  equals:
                    parsed.data.status === 'OPEN' && parsed.data.city
                      ? parsed.data.city
                      : branchCity,
                  mode: 'insensitive' as const,
                },
              }
            : parsed.data.city
              ? { requestedCity: { equals: parsed.data.city, mode: 'insensitive' as const } }
              : {},
        )
      }

      const rows = await db.stockMovementRequest.findMany({
        where,
        take: parsed.data.take,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          warehouse: { select: { id: true, code: true, name: true, city: true } },
          items: {
            include: { 
              product: { select: { id: true, sku: true, name: true, genericName: true } },
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
            orderBy: [{ remainingQuantity: 'desc' }],
          },
        },
      })

      const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))

      const userIds = [
        ...new Set(
          rows
            .flatMap((r) => [r.requestedBy, r.fulfilledBy, (r as any).confirmedBy])
            .filter(Boolean)
            .filter(isUuid)
            .map((v) => String(v)),
        ),
      ]
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

      // Get movements for all requests
      const requestIds = rows.map(r => r.id)
      const movements = requestIds.length > 0 ? await db.stockMovement.findMany({
        where: {
          tenantId,
          type: 'OUT',
          referenceType: 'MOVEMENT_REQUEST',
          referenceId: { in: requestIds },
        },
        include: {
          batch: { select: { id: true, batchNumber: true, expiresAt: true } },
          product: { select: { id: true, sku: true, name: true, genericName: true } },
          presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
        },
        orderBy: { createdAt: 'asc' }
      }) : []

      // Group movements by requestId
      const movementsByRequest = new Map<string, typeof movements>()
      movements.forEach(m => {
        const requestId = m.referenceId!
        if (!movementsByRequest.has(requestId)) {
          movementsByRequest.set(requestId, [])
        }
        movementsByRequest.get(requestId)!.push(m)
      })

      const fromLocationIds = [
        ...new Set(
          movements
            .map((m: any) => m.fromLocationId)
            .filter(Boolean)
            .map((v: any) => String(v)),
        ),
      ]
      const fromLocations = fromLocationIds.length
        ? await db.location.findMany({
            where: { tenantId, id: { in: fromLocationIds } },
            select: {
              id: true,
              code: true,
              warehouse: { select: { id: true, code: true, name: true, city: true } },
            },
          })
        : []
      const fromLocationMap = new Map(fromLocations.map((l) => [l.id, l]))

      const originWarehouseByRequest = new Map<string, { id: string; code: string; name: string; city: string | null }>()
      const ambiguousOriginRequestIds: string[] = []
      for (const [reqId, ms] of movementsByRequest.entries()) {
        const whMap = new Map<string, { id: string; code: string; name: string; city: string | null }>()
        for (const m of ms as any[]) {
          const locId = m.fromLocationId ? String(m.fromLocationId) : null
          const loc = locId ? fromLocationMap.get(locId) : null
          if (loc?.warehouse?.id) {
            whMap.set(loc.warehouse.id, {
              id: loc.warehouse.id,
              code: loc.warehouse.code,
              name: loc.warehouse.name,
              city: loc.warehouse.city ?? null,
            })
          }
        }
        if (whMap.size === 1) {
          const onlyWarehouse = whMap.values().next().value
          if (onlyWarehouse) originWarehouseByRequest.set(reqId, onlyWarehouse)
        } else if (whMap.size > 1) {
          ambiguousOriginRequestIds.push(reqId)
        }
      }

      if (debugMovementRequests) {
        request.log.info(
          {
            tenantId,
            branchCity,
            status: parsed.data.status ?? null,
            rowCount: rows.length,
            movementCount: movements.length,
            fromLocationCount: fromLocationIds.length,
            ambiguousOriginCount: ambiguousOriginRequestIds.length,
          },
          'stock.movement-requests.list',
        )
      }

      return reply.send({
        items: rows.map((r) => ({
          id: r.id,
          status: r.status,
          confirmationStatus: (r as any).confirmationStatus,
          warehouseId: (r as any).warehouseId ?? null,
          warehouse: (r as any).warehouse
            ? {
                id: (r as any).warehouse.id,
                code: (r as any).warehouse.code,
                name: (r as any).warehouse.name,
                city: (r as any).warehouse.city,
              }
            : null,
          requestedCity: r.requestedCity,
          quoteId: r.quoteId,
          note: r.note,
          requestedBy: r.requestedBy,
          requestedByName: userMap.get(r.requestedBy) || null,
          fulfilledAt: r.fulfilledAt ? r.fulfilledAt.toISOString() : null,
          fulfilledBy: r.fulfilledBy,
          fulfilledByName: r.fulfilledBy ? (userMap.get(r.fulfilledBy) || r.fulfilledBy) : null,
          confirmedAt: (r as any).confirmedAt ? (r as any).confirmedAt.toISOString() : null,
          confirmedBy: (r as any).confirmedBy ?? null,
          confirmedByName: (r as any).confirmedBy ? (userMap.get((r as any).confirmedBy) || (r as any).confirmedBy) : null,
          confirmationNote: (r as any).confirmationNote ?? null,
          createdAt: r.createdAt.toISOString(),
          originWarehouse: originWarehouseByRequest.get(r.id) ?? null,
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
            presentation: it.presentation
              ? { id: it.presentation.id, name: it.presentation.name, unitsPerPresentation: it.presentation.unitsPerPresentation }
              : null,
            presentationName: it.presentation?.name ?? null,
            unitsPerPresentation: it.presentation?.unitsPerPresentation ?? null,
          })),
          movements: (movementsByRequest.get(r.id) || []).map((m) => ({
            id: m.id,
            type: m.type,
            quantity: Number(m.quantity),
            presentationQuantity: m.presentationQuantity ? Number(m.presentationQuantity) : null,
            productId: m.productId,
            productSku: m.product?.sku ?? null,
            productName: m.product?.name ?? null,
            genericName: m.product?.genericName ?? null,
            presentationId: m.presentationId,
            presentation: m.presentation
              ? { id: m.presentation.id, name: m.presentation.name, unitsPerPresentation: m.presentation.unitsPerPresentation }
              : null,
            batchId: m.batchId,
            batch: m.batch
              ? { id: m.batch.id, batchNumber: m.batch.batchNumber, expiresAt: m.batch.expiresAt?.toISOString() ?? null }
              : null,
            fromLocationId: (m as any).fromLocationId ?? null,
            fromLocation: (m as any).fromLocationId
              ? (() => {
                  const loc = fromLocationMap.get(String((m as any).fromLocationId))
                  return loc
                    ? {
                        id: loc.id,
                        code: loc.code,
                        warehouse: loc.warehouse,
                      }
                    : null
                })()
              : null,
            createdAt: m.createdAt.toISOString(),
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

          // Normalize items (merge duplicates)
          const normalizedItemsMap = new Map<string, { productId: string; presentationId: string; quantity: number }>()
          for (const it of input.items) {
            const key = `${it.productId}::${it.presentationId}`
            const prev = normalizedItemsMap.get(key)
            normalizedItemsMap.set(key, prev ? { ...prev, quantity: prev.quantity + it.quantity } : { ...it })
          }
          const normalizedItems = [...normalizedItemsMap.values()]

          // Validate products exist
          const productIds = [...new Set(normalizedItems.map((x) => x.productId))]
          const products = await (tx as any).product.findMany({
            where: { tenantId, id: { in: productIds }, isActive: true },
            select: { id: true },
          })
          if (products.length !== productIds.length) {
            const err = new Error('One or more products not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }

          // Validate presentations belong to the specified products and calculate unitsPerPresentation
          const presentationIds = [...new Set(normalizedItems.map((x) => x.presentationId))]
          const presentations = await (tx as any).productPresentation.findMany({
            where: { tenantId, id: { in: presentationIds }, isActive: true },
            select: { id: true, productId: true, unitsPerPresentation: true },
          })
          type PresentationRow = { id: string; productId: string; unitsPerPresentation: any }
          const presById = new Map<string, PresentationRow>(
            (presentations ?? []).map((p: any) => [String(p.id), p as PresentationRow]),
          )

          for (const it of normalizedItems) {
            const pres = presById.get(it.presentationId)
            if (!pres || pres.productId !== it.productId) {
              const err = new Error('One or more presentations not found or invalid for the selected product') as Error & { statusCode?: number }
              err.statusCode = 400
              throw err
            }
          }

          // Create the movement request
          const movementRequest = await (tx as any).stockMovementRequest.create({
            data: {
              tenantId,
              warehouseId: input.warehouseId,
              requestedCity: warehouse.city,
              requestedBy: userId,
              note: input.note,
              items: {
                create: normalizedItems.map((item) => {
                  const pres = presById.get(item.presentationId)
                  const unitsPerPresentation = Number(pres?.unitsPerPresentation ?? 1)
                  const requestedQuantity = item.quantity * unitsPerPresentation
                  return {
                    tenantId,
                    productId: item.productId,
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
              warehouseId: input.warehouseId,
              itemsCount: normalizedItems.length,
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
          warehouseId: (result as any).warehouseId ?? input.warehouseId,
          requestedCity: result.requestedCity,
          requestedByName: userName,
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
            presentation: it.presentation
              ? { id: it.presentation.id, name: it.presentation.name, unitsPerPresentation: it.presentation.unitsPerPresentation }
              : null,
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

  app.put(
    '/api/v1/stock/movement-requests/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const parsedParams = movementRequestUpdateParamsSchema.safeParse((request as any).params)
      if (!parsedParams.success) return reply.status(400).send({ message: 'Invalid params', issues: parsedParams.error.issues })

      const parsedBody = movementRequestCreateSchema.safeParse(request.body)
      if (!parsedBody.success) return reply.status(400).send({ message: 'Invalid request', issues: parsedBody.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const { id } = parsedParams.data
      const input = parsedBody.data

      try {
        const updated = await db.$transaction(async (tx) => {
          const existing = await (tx as any).stockMovementRequest.findFirst({
            where: {
              tenantId,
              id,
              status: 'OPEN',
              ...(branchCity ? { requestedCity: { equals: branchCity, mode: 'insensitive' as const } } : {}),
            },
            include: { items: true },
          })

          if (!existing) {
            const err = new Error('Movement request not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }

          const hasAnyFulfillment = (existing.items ?? []).some((it: any) => {
            const rq = Number(it.requestedQuantity ?? 0)
            const rem = Number(it.remainingQuantity ?? 0)
            return Number.isFinite(rq) && Number.isFinite(rem) ? rem < rq - 1e-9 : false
          })
          if (hasAnyFulfillment) {
            const err = new Error('No se puede editar una solicitud que ya fue atendida parcialmente') as Error & { statusCode?: number }
            err.statusCode = 409
            throw err
          }

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

          const normalizedItemsMap = new Map<string, { productId: string; presentationId: string; quantity: number }>()
          for (const it of input.items) {
            const key = `${it.productId}::${it.presentationId}`
            const prev = normalizedItemsMap.get(key)
            normalizedItemsMap.set(key, prev ? { ...prev, quantity: prev.quantity + it.quantity } : { ...it })
          }
          const normalizedItems = [...normalizedItemsMap.values()]

          const productIds = [...new Set(normalizedItems.map((x) => x.productId))]
          const products = await (tx as any).product.findMany({
            where: { tenantId, id: { in: productIds }, isActive: true },
            select: { id: true },
          })
          if (products.length !== productIds.length) {
            const err = new Error('One or more products not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }

          const presentationIds = [...new Set(normalizedItems.map((x) => x.presentationId))]
          const presentations = await (tx as any).productPresentation.findMany({
            where: { tenantId, id: { in: presentationIds }, isActive: true },
            select: { id: true, productId: true, unitsPerPresentation: true },
          })
          type PresentationRow = { id: string; productId: string; unitsPerPresentation: any }
          const presById = new Map<string, PresentationRow>((presentations ?? []).map((p: any) => [String(p.id), p as PresentationRow]))

          for (const it of normalizedItems) {
            const pres = presById.get(it.presentationId)
            if (!pres || pres.productId !== it.productId) {
              const err = new Error('One or more presentations not found or invalid for the selected product') as Error & { statusCode?: number }
              err.statusCode = 400
              throw err
            }
          }

          await (tx as any).stockMovementRequestItem.deleteMany({
            where: { tenantId, requestId: id },
          })

          const row = await (tx as any).stockMovementRequest.update({
            where: { id },
            data: {
              warehouseId: input.warehouseId,
              requestedCity: warehouse.city,
              note: input.note,
              items: {
                create: normalizedItems.map((item) => {
                  const pres = presById.get(item.presentationId)
                  const unitsPerPresentation = Number(pres?.unitsPerPresentation ?? 1)
                  const requestedQuantity = item.quantity * unitsPerPresentation
                  return {
                    tenantId,
                    productId: item.productId,
                    presentationId: item.presentationId,
                    presentationQuantity: item.quantity,
                    requestedQuantity,
                    remainingQuantity: requestedQuantity,
                  }
                }),
              },
            },
            select: { id: true, status: true, requestedCity: true, warehouseId: true, note: true, updatedAt: true },
          })

          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.movement-request.update',
            entityType: 'StockMovementRequest',
            entityId: id,
            after: {
              warehouseId: input.warehouseId,
              itemsCount: normalizedItems.length,
            },
          })

          return row
        })

        return reply.send({
          id: updated.id,
          status: updated.status,
          requestedCity: updated.requestedCity,
          warehouseId: (updated as any).warehouseId ?? null,
          note: (updated as any).note ?? null,
          updatedAt: (updated as any).updatedAt ? (updated as any).updatedAt.toISOString?.() ?? String((updated as any).updatedAt) : null,
        })
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
      }
    },
  )

  app.patch(
    '/api/v1/stock/movement-requests/:id/cancel',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const parsedParams = movementRequestCancelParamsSchema.safeParse((request as any).params)
      if (!parsedParams.success) return reply.status(400).send({ message: 'Invalid params', issues: parsedParams.error.issues })

      const parsedBody = movementRequestCancelBodySchema.safeParse(request.body)
      if (!parsedBody.success) return reply.status(400).send({ message: 'Invalid request', issues: parsedBody.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const { id } = parsedParams.data
      const note = parsedBody.data?.note

      try {
        const updated = await db.$transaction(async (tx) => {
          const existing = await (tx as any).stockMovementRequest.findFirst({
            where: {
              tenantId,
              id,
              status: 'OPEN',
              ...(branchCity ? { requestedCity: { equals: branchCity, mode: 'insensitive' as const } } : {}),
            },
            include: { items: true },
          })

          if (!existing) {
            const err = new Error('Movement request not found') as Error & { statusCode?: number }
            err.statusCode = 404
            throw err
          }

          const hasAnyFulfillment = (existing.items ?? []).some((it: any) => {
            const rq = Number(it.requestedQuantity ?? 0)
            const rem = Number(it.remainingQuantity ?? 0)
            return Number.isFinite(rq) && Number.isFinite(rem) ? rem < rq - 1e-9 : false
          })
          if (hasAnyFulfillment) {
            const err = new Error('No se puede cancelar una solicitud que ya fue atendida parcialmente') as Error & { statusCode?: number }
            err.statusCode = 409
            throw err
          }

          const row = await (tx as any).stockMovementRequest.update({
            where: { id },
            data: {
              status: 'CANCELLED',
              note: note ?? existing.note,
            },
            select: { id: true, status: true, requestedCity: true },
          })

          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.movement-request.cancel',
            entityType: 'StockMovementRequest',
            entityId: id,
            after: { note: note ?? null },
          })

          return row
        })

        return reply.send({
          id: updated.id,
          status: updated.status,
          requestedCity: updated.requestedCity,
        })
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
      }
    },
  )

  // Plan picking for a movement request (suggest lots/locations)
  app.post(
    '/api/v1/stock/movement-requests/:id/plan',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)
      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const parsedParams = movementRequestPlanParamsSchema.safeParse((request as any).params)
      if (!parsedParams.success) return reply.status(400).send({ message: 'Invalid params', issues: parsedParams.error.issues })

      const parsedBody = movementRequestPlanBodySchema.safeParse(request.body)
      if (!parsedBody.success) return reply.status(400).send({ message: 'Invalid request', issues: parsedBody.error.issues })

      const now = new Date()
      const todayUtc = startOfTodayUtc()
      const { id } = parsedParams.data
      const input = parsedBody.data

      const req = await db.stockMovementRequest.findFirst({
        where: {
          tenantId,
          id,
          status: 'OPEN',
          ...(branchCity ? { requestedCity: { equals: branchCity, mode: 'insensitive' as const } } : {}),
        },
        include: {
          warehouse: { select: { id: true, code: true, name: true, city: true } },
          items: {
            where: { remainingQuantity: { gt: 0 } },
            include: {
              product: { select: { id: true, sku: true, name: true, genericName: true } },
              presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
            },
            orderBy: [{ remainingQuantity: 'desc' }],
          },
        },
      })

      if (!req) return reply.status(404).send({ message: 'Movement request not found' })

      let fromWarehouseId = input.fromWarehouseId ?? null
      let fromLocationId = input.fromLocationId ?? null

      if (fromLocationId) {
        const loc = await (db as any).location.findFirst({
          where: { tenantId, id: fromLocationId, isActive: true },
          select: { id: true, warehouseId: true },
        })
        if (!loc) return reply.status(404).send({ message: 'Origin location not found' })
        fromWarehouseId = loc.warehouseId
      }

      const originWarehouse = fromWarehouseId
        ? await (db as any).warehouse.findFirst({
            where: { tenantId, id: fromWarehouseId, isActive: true },
            select: { id: true, code: true, name: true, city: true },
          })
        : null
      if (!originWarehouse) return reply.status(404).send({ message: 'Origin warehouse not found' })

      const productIds = [...new Set((req.items ?? []).map((it: any) => it.productId))]
      if (productIds.length === 0) {
        return reply.send({
          requestId: req.id,
          fromWarehouseId: originWarehouse.id,
          fromLocationId,
          generatedAt: now.toISOString(),
          items: [],
        })
      }

      const balances = await db.inventoryBalance.findMany({
        where: {
          tenantId,
          productId: { in: productIds },
          quantity: { gt: 0 },
          location: {
            warehouseId: originWarehouse.id,
            ...(fromLocationId ? { id: fromLocationId } : {}),
          },
        },
        select: {
          id: true,
          productId: true,
          quantity: true,
          reservedQuantity: true,
          location: {
            select: {
              id: true,
              code: true,
              warehouse: { select: { id: true, code: true, name: true } },
            },
          },
          batch: {
            select: {
              id: true,
              batchNumber: true,
              expiresAt: true,
              status: true,
              openedAt: true,
            },
          },
        },
      })

      type BalanceRow = {
        id: string
        productId: string
        quantity: any
        reservedQuantity: any
        location: { id: string; code: string; warehouse: { id: string; code: string; name: string } }
        batch: { id: string; batchNumber: string; expiresAt: Date | null; status: string; openedAt: Date | null } | null
      }

      const usableByProductId = new Map<string, Array<BalanceRow & { available: number }>>()
      for (const b of balances as any as BalanceRow[]) {
        const total = Number(b.quantity ?? '0')
        const reserved = Number((b as any).reservedQuantity ?? '0')
        const available = Math.max(0, total - Math.max(0, reserved))
        if (available <= 0) continue

        const exp = b.batch?.expiresAt ?? null
        if (!input.allowExpired && exp && exp < todayUtc) continue

        const arr = usableByProductId.get(b.productId) ?? []
        arr.push({ ...(b as any), available })
        usableByProductId.set(b.productId, arr)
      }

      // Sort once per product and keep a shared availability map so we don't over-allocate
      // the same balance across multiple request items for the same product.
      const sortedCandidatesByProductId = new Map<string, Array<BalanceRow & { available: number }>>()
      const mutableAvailableByBalanceId = new Map<string, number>()
      for (const [productId, arr] of usableByProductId.entries()) {
        const candidates = [...arr]
        candidates.sort((a, b) => {
          const aOpened = a.batch?.openedAt ? 1 : 0
          const bOpened = b.batch?.openedAt ? 1 : 0
          if (aOpened !== bOpened) return bOpened - aOpened

          const expCmp = cmpNullableDateAsc(a.batch?.expiresAt ?? null, b.batch?.expiresAt ?? null)
          if (expCmp !== 0) return expCmp

          const aNum = String(a.batch?.batchNumber ?? '')
          const bNum = String(b.batch?.batchNumber ?? '')
          if (aNum !== bNum) return aNum.localeCompare(bNum)

          return String(a.id).localeCompare(String(b.id))
        })
        sortedCandidatesByProductId.set(productId, candidates)
        for (const c of candidates) {
          mutableAvailableByBalanceId.set(c.id, c.available)
        }
      }

      const plannedItems = (req.items ?? []).map((it: any) => {
        const remainingUnits = Number(it.remainingQuantity ?? '0')
        const unitsPerPresentation = Number(it.presentation?.unitsPerPresentation ?? it.unitsPerPresentation ?? '1')
        const remainingPresentationQty =
          Number.isFinite(unitsPerPresentation) && unitsPerPresentation > 0 && remainingUnits % unitsPerPresentation === 0
            ? remainingUnits / unitsPerPresentation
            : null

        const candidates = sortedCandidatesByProductId.get(it.productId) ?? []

        let need = Math.max(0, remainingUnits)
        const suggestions: any[] = []

        for (const c of candidates) {
          if (need <= 0) break
          const availNow = mutableAvailableByBalanceId.get(c.id) ?? 0
          const take = Math.min(need, availNow)
          if (take <= 0) continue

          mutableAvailableByBalanceId.set(c.id, availNow - take)

          const suggestedPresentationQuantity =
            Number.isFinite(unitsPerPresentation) && unitsPerPresentation > 0 && take % unitsPerPresentation === 0
              ? take / unitsPerPresentation
              : null

          suggestions.push({
            inventoryBalanceId: c.id,
            locationId: c.location.id,
            locationCode: c.location.code,
            warehouseId: c.location.warehouse.id,
            warehouseCode: c.location.warehouse.code,
            warehouseName: c.location.warehouse.name,
            batchId: c.batch?.id ?? null,
            batchNumber: c.batch?.batchNumber ?? null,
            expiresAt: c.batch?.expiresAt ? c.batch.expiresAt.toISOString() : null,
            openedAt: c.batch?.openedAt ? c.batch.openedAt.toISOString() : null,
            status: c.batch?.status ?? null,
            availableQuantityUnits: c.available,
            suggestedQuantityUnits: take,
            suggestedPresentationQuantity,
          })

          need -= take
          if (suggestions.length >= input.takePerItem) break
        }

        const suggestedTotalUnits = suggestions.reduce((sum, s) => sum + Number(s.suggestedQuantityUnits ?? 0), 0)
        const shortageUnits = Math.max(0, remainingUnits - suggestedTotalUnits)

        return {
          requestItemId: it.id,
          productId: it.productId,
          productSku: it.product?.sku ?? null,
          productName: it.product?.name ?? null,
          genericName: it.product?.genericName ?? null,
          remainingQuantityUnits: remainingUnits,
          remainingPresentationQuantity: remainingPresentationQty,
          presentationId: it.presentationId ?? null,
          presentationQuantity: it.presentationQuantity ? Number(it.presentationQuantity) : null,
          presentation: it.presentation
            ? { id: it.presentation.id, name: it.presentation.name, unitsPerPresentation: it.presentation.unitsPerPresentation }
            : null,
          unitsPerPresentation: it.presentation?.unitsPerPresentation ?? null,
          suggestions,
          suggestedTotalUnits,
          shortageUnits,
        }
      })

      return reply.send({
        requestId: req.id,
        status: req.status,
        confirmationStatus: (req as any).confirmationStatus,
        warehouseId: (req as any).warehouseId ?? null,
        warehouse: (req as any).warehouse ?? null,
        requestedCity: req.requestedCity,
        fromWarehouseId: originWarehouse.id,
        fromWarehouse: originWarehouse,
        fromLocationId,
        generatedAt: now.toISOString(),
        items: plannedItems,
      })
    },
  )

  // Fulfill a single movement request (supports partial fulfillment)
  app.post(
    '/api/v1/stock/movement-requests/:id/fulfill',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchWarehouseId = branchWarehouseIdOf(request)
      if (branchWarehouseId === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const parsedParams = movementRequestFulfillParamsSchema.safeParse((request as any).params)
      if (!parsedParams.success) return reply.status(400).send({ message: 'Invalid params', issues: parsedParams.error.issues })

      const parsedBody = movementRequestFulfillBodySchema.safeParse(request.body)
      if (!parsedBody.success) return reply.status(400).send({ message: 'Invalid request', issues: parsedBody.error.issues })

      const { id } = parsedParams.data
      const input = parsedBody.data

      try {
        const txResult = await db.$transaction(async (tx) => {
          const req = await (tx as any).stockMovementRequest.findFirst({
            where: {
              tenantId,
              id,
              status: 'OPEN',
            },
            include: {
              warehouse: { select: { id: true, code: true, name: true, city: true } },
              items: {
                include: {
                  product: { select: { id: true, sku: true, name: true, genericName: true } },
                  presentation: { select: { id: true, name: true, unitsPerPresentation: true } },
                },
              },
            },
          })
          if (!req) throw Object.assign(new Error('Movement request not found'), { statusCode: 404 })
          if ((req as any).confirmationStatus === 'REJECTED') {
            throw Object.assign(new Error('Request is rejected'), { statusCode: 409 })
          }

          const [fromLoc, toLoc] = await Promise.all([
            (tx as any).location.findFirst({
              where: { tenantId, id: input.fromLocationId },
              select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true, city: true } } },
            }),
            (tx as any).location.findFirst({
              where: { tenantId, id: input.toLocationId },
              select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true, city: true } } },
            }),
          ])
          if (!fromLoc) throw Object.assign(new Error('fromLocationId not found'), { statusCode: 404 })
          if (!toLoc) throw Object.assign(new Error('toLocationId not found'), { statusCode: 404 })

          if (branchWarehouseId && fromLoc.warehouse?.id !== branchWarehouseId) {
            throw Object.assign(new Error('Solo puede atender solicitudes desde su sucursal'), { statusCode: 403 })
          }

          // Enforce destination consistency when request has warehouseId.
          const reqWarehouseId = (req as any).warehouseId ?? null
          if (reqWarehouseId && toLoc.warehouse?.id !== reqWarehouseId) {
            throw Object.assign(new Error('toLocationId does not belong to the requested warehouse'), { statusCode: 400 })
          }
          if (!reqWarehouseId) {
            const toCity = String(toLoc.warehouse?.city ?? '').trim().toUpperCase()
            const reqCity = String(req.requestedCity ?? '').trim().toUpperCase()
            if (toCity && reqCity && toCity !== reqCity) {
              throw Object.assign(new Error('toLocationId city does not match requestedCity'), { statusCode: 400 })
            }
          }

          const itemsById = new Map<string, any>((req.items ?? []).map((it: any) => [it.id, it]))
          const itemsByKey = new Map<string, any>()
          for (const it of req.items ?? []) {
            if (!it.presentationId) continue
            itemsByKey.set(`${it.productId}::${it.presentationId}`, it)
          }

          const createdMovements: any[] = []
          const balances: any[] = []

          for (const line of input.lines) {
            const item =
              line.requestItemId ? itemsById.get(line.requestItemId) : itemsByKey.get(`${line.productId}::${line.presentationId}`)
            if (!item) {
              throw Object.assign(new Error('Request item not found for line'), { statusCode: 400 })
            }
            if (item.productId !== line.productId) {
              throw Object.assign(new Error('Line productId does not match request item'), { statusCode: 400 })
            }

            const itemUnitsPerPresentation = Number(item.presentation?.unitsPerPresentation ?? '1')
            const remaining = Number(item.remainingQuantity ?? '0')
            if (!Number.isFinite(remaining) || remaining <= 0) {
              throw Object.assign(new Error('Request item has no remaining quantity'), { statusCode: 409 })
            }

            const hasPresentation = typeof line.presentationId === 'string' && line.presentationId.length > 0
            let baseQty: number
            let presentationId: string | null
            let presentationQuantity: number | null

            if (hasPresentation) {
              if (!item.presentationId || item.presentationId !== line.presentationId) {
                throw Object.assign(new Error('Line presentationId does not match request item'), { statusCode: 400 })
              }
              const pq = Number(line.presentationQuantity)
              if (!Number.isFinite(pq) || pq <= 0) {
                throw Object.assign(new Error('presentationQuantity is required'), { statusCode: 400 })
              }
              const factor = Number.isFinite(itemUnitsPerPresentation) && itemUnitsPerPresentation > 0 ? itemUnitsPerPresentation : 1
              baseQty = pq * factor
              presentationId = line.presentationId!
              presentationQuantity = pq
            } else {
              const q = Number(line.quantity)
              if (!Number.isFinite(q) || q <= 0) {
                throw Object.assign(new Error('quantity is required'), { statusCode: 400 })
              }
              baseQty = q
              presentationId = item.presentationId ?? null
              presentationQuantity =
                presentationId && Number.isFinite(itemUnitsPerPresentation) && itemUnitsPerPresentation > 0
                  ? q / itemUnitsPerPresentation
                  : null
            }

            if (!Number.isFinite(baseQty) || baseQty <= 0) {
              throw Object.assign(new Error('Invalid quantity'), { statusCode: 400 })
            }
            if (baseQty > remaining + 1e-9) {
              throw Object.assign(new Error('Line exceeds remaining quantity'), { statusCode: 409 })
            }

            const dec = await (tx as any).stockMovementRequestItem.updateMany({
              where: {
                tenantId,
                id: item.id,
                remainingQuantity: { gte: baseQty },
              },
              data: { remainingQuantity: { decrement: baseQty } },
            })
            if (!dec || dec.count !== 1) {
              throw Object.assign(new Error('Concurrent update: remaining quantity changed'), { statusCode: 409 })
            }

            const created = await createStockMovementTx(tx, {
              tenantId,
              userId,
              type: 'TRANSFER',
              productId: line.productId,
              batchId: line.batchId ?? null,
              fromLocationId: line.fromLocationId ?? input.fromLocationId,
              toLocationId: input.toLocationId,
              quantity: baseQty,
              presentationId,
              presentationQuantity,
              referenceType: 'REQUEST_FULFILL',
              referenceId: req.id,
              note: line.note ?? input.note ?? null,
            })

            createdMovements.push(created.createdMovement)
            if (created.fromBalance) balances.push(created.fromBalance)
            if (created.toBalance) balances.push(created.toBalance)
          }

          const agg = await (tx as any).stockMovementRequestItem.aggregate({
            where: { tenantId, requestId: req.id },
            _sum: { remainingQuantity: true },
          })
          const sumRemaining = Number((agg as any)?._sum?.remainingQuantity ?? 0)

          const updatedReq = sumRemaining <= 1e-9
            ? await (tx as any).stockMovementRequest.update({
                where: { id: req.id },
                data: { status: 'FULFILLED', fulfilledAt: new Date(), fulfilledBy: userId },
                select: { id: true, status: true, requestedCity: true, warehouseId: true, fulfilledAt: true, fulfilledBy: true },
              })
            : { id: req.id, status: req.status, requestedCity: req.requestedCity, warehouseId: reqWarehouseId, fulfilledAt: req.fulfilledAt, fulfilledBy: req.fulfilledBy }

          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.movement-request.fulfill',
            entityType: 'StockMovementRequest',
            entityId: req.id,
            after: {
              requestId: req.id,
              linesCount: input.lines.length,
              fromLocationId: input.fromLocationId,
              toLocationId: input.toLocationId,
            },
          })

          return { request: updatedReq, movements: createdMovements, balances }
        })

        const room = `tenant:${tenantId}`
        for (const m of txResult.movements ?? []) {
          if (m) app.io?.to(room).emit('stock.movement.created', m)
        }
        for (const b of txResult.balances ?? []) {
          if (b) app.io?.to(room).emit('stock.balance.changed', b)
        }
        if ((txResult.request as any)?.status === 'FULFILLED') {
          app.io?.to(room).emit('stock.movement_request.fulfilled', txResult.request)
        }

        return reply.status(201).send(txResult)
      } catch (e: any) {
        if (e?.code === 'BATCH_EXPIRED') {
          await audit.append({
            tenantId,
            actorUserId: userId,
            action: 'stock.expiry.blocked',
            entityType: 'Batch',
            entityId: e?.meta?.batchId ?? null,
            metadata: { operation: 'stock.movement-request.fulfill', ...e.meta },
          })
          return reply.status(409).send({ message: 'Batch expired' })
        }
        if (e?.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
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

      const createdAt = input.createdAt ? new Date(input.createdAt) : null
      if (createdAt) {
        if (!request.auth?.isTenantAdmin) {
          return reply.status(403).send({ message: 'Only tenant admin can set movement date' })
        }
        if (!Number.isFinite(createdAt.getTime())) {
          return reply.status(400).send({ message: 'Invalid createdAt' })
        }
        const now = Date.now()
        if (createdAt.getTime() > now + 5 * 60_000) {
          return reply.status(400).send({ message: 'createdAt cannot be in the future' })
        }
      }

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
            ...(createdAt ? { createdAt } : {}),
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

      const branchWarehouseId = branchWarehouseIdOf(request)
      if (branchWarehouseId === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

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

          if (branchWarehouseId && baseFromLoc.warehouseId !== branchWarehouseId) {
            throw Object.assign(new Error('Solo puede transferir desde su sucursal'), { statusCode: 403 })
          }

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

  // Bulk fulfill movement requests (partial fulfillment support)
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
      const input = parsed.data
      const branchWarehouseId = branchWarehouseIdOf(request)

      if (branchWarehouseId === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      try {
        const result = await db.$transaction(async (tx) => {
          // Validate locations exist
          const [fromLoc, toLoc] = await Promise.all([
            tx.location.findFirst({
              where: { tenantId, id: input.fromLocationId },
              select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true, city: true } } },
            }),
            tx.location.findFirst({
              where: { tenantId, id: input.toLocationId },
              select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true, city: true } } },
            }),
          ])
          if (!fromLoc) throw Object.assign(new Error('fromLocationId not found'), { statusCode: 404 })
          if (!toLoc) throw Object.assign(new Error('toLocationId not found'), { statusCode: 404 })

          if (branchWarehouseId && fromLoc.warehouse?.id !== branchWarehouseId) {
            throw Object.assign(new Error('Solo puede enviar stock desde su sucursal'), { statusCode: 403 })
          }

          const createdMovements: any[] = []
          const touchedRequestIds = new Set<string>()

          for (const fulfillment of input.fulfillments) {
            const { requestId, items } = fulfillment

            // Validate request exists and is OPEN
            const req = await tx.stockMovementRequest.findFirst({
              where: { tenantId, id: requestId, status: 'OPEN' },
              select: {
                id: true,
                status: true,
                requestedCity: true,
                warehouseId: true,
                items: {
                  select: {
                    id: true,
                    productId: true,
                    remainingQuantity: true,
                    presentationId: true,
                    presentationQuantity: true,
                    presentation: { select: { id: true, unitsPerPresentation: true } },
                  },
                },
              },
            })
            if (!req) throw Object.assign(new Error(`Request ${requestId} not found or not OPEN`), { statusCode: 404 })

            const reqCity = String(req.requestedCity ?? '').trim().toUpperCase()

            // Check destination consistency
            if (req.warehouseId && toLoc.warehouse?.id !== req.warehouseId) {
              throw Object.assign(new Error('toLocationId does not belong to the requested warehouse'), { statusCode: 400 })
            }
            if (!req.warehouseId) {
              const toCity = String(toLoc.warehouse?.city ?? '').trim().toUpperCase()
              if (toCity && reqCity && toCity !== reqCity) {
                throw Object.assign(new Error('toLocationId city does not match requestedCity'), { statusCode: 400 })
              }
            }

            // Process each item in the fulfillment
            for (const item of items) {
              // Find the matching request item
              const requestItem = item.requestItemId
                ? req.items.find((ri: any) => ri.id === item.requestItemId)
                : req.items.find((ri: any) => ri.productId === item.productId)
              if (!requestItem) {
                throw Object.assign(new Error(`Item not found in request ${requestId}`), { statusCode: 400 })
              }

              if (requestItem.productId !== item.productId) {
                throw Object.assign(new Error(`requestItemId does not match productId for request ${requestId}`), { statusCode: 400 })
              }

              if (Number(requestItem.remainingQuantity) <= 0) {
                throw Object.assign(new Error(`Product ${item.productId} in request ${requestId} has no remaining quantity`), { statusCode: 409 })
              }

              // Validate batch exists and has sufficient stock
              const batch = await tx.batch.findFirst({
                where: { tenantId, id: item.batchId },
                select: { id: true, presentationId: true, presentation: { select: { id: true, unitsPerPresentation: true } } },
              })
              if (!batch) throw Object.assign(new Error(`Batch ${item.batchId} not found`), { statusCode: 404 })

              const totalStock = await tx.inventoryBalance.aggregate({
                where: {
                  tenantId,
                  productId: item.productId,
                  batchId: item.batchId,
                  locationId: input.fromLocationId,
                },
                _sum: { quantity: true },
              })
              const availableStock = Number(totalStock._sum.quantity ?? 0)
              if (availableStock < item.quantity) {
                throw Object.assign(new Error(`Insufficient stock for batch ${item.batchId}. Available: ${availableStock}, Required: ${item.quantity}`), { statusCode: 409 })
              }

              // Create the shipment movement (OUT)
              const movementResult = await createStockMovementTx(tx, {
                tenantId,
                userId,
                type: 'OUT',
                productId: item.productId,
                batchId: item.batchId,
                fromLocationId: input.fromLocationId,
                toLocationId: input.toLocationId, // Store destination for later reception
                quantity: item.quantity,
                presentationId: batch.presentationId ?? requestItem.presentationId,
                presentationQuantity: (() => {
                  const unitsPer = Number(batch.presentation?.unitsPerPresentation ?? 1)
                  if (!Number.isFinite(unitsPer) || unitsPer <= 0) return item.quantity
                  return item.quantity / unitsPer
                })(),
                referenceType: 'MOVEMENT_REQUEST',
                referenceId: requestId,
                note: input.note ?? null,
              })

              createdMovements.push(movementResult)

              // Update remaining quantity
              await tx.stockMovementRequestItem.update({
                where: { id: requestItem.id },
                data: { remainingQuantity: { decrement: item.quantity } },
              })

              touchedRequestIds.add(requestId)
            }
          }

          // Check which requests are now fully sent
          const sentRequestIds: string[] = []
          for (const requestId of touchedRequestIds) {
            const agg = await tx.stockMovementRequestItem.aggregate({
              where: { tenantId, requestId },
              _sum: { remainingQuantity: true },
            })
            const sumRemaining = Number((agg as any)?._sum?.remainingQuantity ?? 0)
            if (sumRemaining <= 1e-9) {
              await tx.stockMovementRequest.update({
                where: { id: requestId },
                data: { status: 'SENT', fulfilledAt: new Date(), fulfilledBy: userId },
              })
              sentRequestIds.push(requestId)
            }
          }

          return { createdMovements, sentRequestIds, touchedRequestIds: Array.from(touchedRequestIds) }
        })

        // Audit the operation
        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'stock.movement-request.bulk-fulfill',
          entityType: 'StockMovementRequest',
          entityId: null,
          after: {
            fulfillments: input.fulfillments.map(f => ({ requestId: f.requestId, itemCount: f.items.length })),
            sentRequestIds: result.sentRequestIds,
            movementCount: result.createdMovements.length,
          },
        })

        // Emit socket events
        const room = `tenant:${tenantId}`
        for (const movement of result.createdMovements) {
          app.io?.to(room).emit('stock.movement.created', movement.createdMovement)
          if (movement.fromBalance) app.io?.to(room).emit('stock.balance.changed', movement.fromBalance)
          if (movement.toBalance) app.io?.to(room).emit('stock.balance.changed', movement.toBalance)
        }

        // Emit request status updates
        for (const requestId of result.sentRequestIds) {
          const updatedReq = await db.stockMovementRequest.findFirst({
            where: { tenantId, id: requestId },
            select: { id: true, requestedCity: true, status: true },
          })
          if (updatedReq) {
            app.io?.to(room).emit('stock.movement_request.updated', {
              id: updatedReq.id,
              status: updatedReq.status,
              requestedCity: updatedReq.requestedCity,
            })
          }
        }

        return reply.send({
          message: 'Solicitudes enviadas exitosamente',
          sentRequestIds: result.sentRequestIds,
          touchedRequestIds: result.touchedRequestIds,
          movementCount: result.createdMovements.length,
        })
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
      }
    },
  )

  app.post(
    '/api/v1/stock/movement-requests/:id/receive',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const debugMovementRequests = process.env.DEBUG_STOCK_MOVEMENT_REQUESTS === '1'

      try {
        const result = await db.$transaction(async (tx) => {
          // Validate request exists and is SENT
          const req = await tx.stockMovementRequest.findFirst({
            where: { tenantId, id, status: 'SENT' },
            select: { id: true, status: true },
          })
          if (!req) throw Object.assign(new Error('Request not found or not SENT'), { statusCode: 404 })

          // Find all OUT movements for this request
          const outMovements = await tx.stockMovement.findMany({
            where: {
              tenantId,
              type: 'OUT',
              referenceType: 'MOVEMENT_REQUEST',
              referenceId: id,
            },
            select: {
              id: true,
              productId: true,
              batchId: true,
              fromLocationId: true,
              quantity: true,
              toLocationId: true,
              presentationId: true,
              presentationQuantity: true,
            },
          })

          const createdMovements: any[] = []

          for (const outMovement of outMovements) {
            // Create IN movement
            const inMovementResult = await createStockMovementTx(tx, {
              tenantId,
              userId,
              type: 'IN',
              productId: outMovement.productId,
              batchId: outMovement.batchId,
              fromLocationId: null,
              toLocationId: outMovement.toLocationId,
              quantity: Number(outMovement.quantity),
              presentationId: outMovement.presentationId,
              presentationQuantity: outMovement.presentationQuantity ? Number(outMovement.presentationQuantity) : null,
              referenceType: 'MOVEMENT_REQUEST',
              referenceId: id,
              note: 'Recepción de envío',
            })

            createdMovements.push(inMovementResult)
          }

          // Mark request as FULFILLED
          await tx.stockMovementRequest.update({
            where: { id },
            data: { status: 'FULFILLED', confirmedAt: new Date(), confirmedBy: userId },
          })

          return {
            createdMovements,
            outMovementCount: outMovements.length,
            fromLocationCount: new Set(outMovements.map((m) => m.fromLocationId).filter(Boolean)).size,
          }
        })

        if (debugMovementRequests) {
          request.log.info(
            {
              tenantId,
              requestId: id,
              actorUserId: userId,
              outMovementCount: (result as any).outMovementCount,
              createdMovementCount: result.createdMovements.length,
              fromLocationCount: (result as any).fromLocationCount,
            },
            'stock.movement-requests.receive',
          )
        }

        // Audit the operation
        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'stock.movement-request.receive',
          entityType: 'StockMovementRequest',
          entityId: id,
          after: {
            movementCount: result.createdMovements.length,
          },
        })

        // Emit socket events
        const room = `tenant:${tenantId}`
        for (const movement of result.createdMovements) {
          app.io?.to(room).emit('stock.movement.created', movement.createdMovement)
          if (movement.fromBalance) app.io?.to(room).emit('stock.balance.changed', movement.fromBalance)
          if (movement.toBalance) app.io?.to(room).emit('stock.balance.changed', movement.toBalance)
        }

        // Emit request status update
        const updatedReq = await db.stockMovementRequest.findFirst({
          where: { tenantId, id },
          select: { id: true, requestedCity: true, status: true },
        })
        if (updatedReq) {
          app.io?.to(room).emit('stock.movement_request.updated', {
            id: updatedReq.id,
            status: updatedReq.status,
            requestedCity: updatedReq.requestedCity,
          })
        }

        return reply.send({ message: 'Recepción confirmada exitosamente' })
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
      }
    },
  )

  // Get completed movements (movements, bulk transfers, fulfilled requests, returns)
  app.get(
    '/api/v1/stock/completed-movements',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId

      const branchWarehouseId = branchWarehouseIdOf(request)
      if (branchWarehouseId === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const branchLocationIds = branchWarehouseId
        ? (
            await db.location.findMany({
              where: { tenantId, warehouseId: branchWarehouseId },
              select: { id: true },
            })
          ).map((l) => l.id)
        : null

      try {
        // Get fulfillments of movement requests (includes partials)
        const movementRequestGroups = await db.stockMovement.groupBy({
          by: ['referenceId'],
          where: {
            tenantId,
            referenceType: 'MOVEMENT_REQUEST',
            referenceId: { not: null },
            // Only shipment movements; reception creates IN movements too.
            // Grouping by OUT avoids double-counting quantities once received.
            type: 'OUT',
            ...(branchLocationIds
              ? { OR: [{ fromLocationId: { in: branchLocationIds } }, { toLocationId: { in: branchLocationIds } }] }
              : {}),
          },
          _max: { createdAt: true },
          _count: { id: true },
          _sum: { quantity: true },
          orderBy: { _max: { createdAt: 'desc' } },
          take: 100,
        })

        // Get bulk transfers (grouped by referenceId)
        const bulkTransfers = await db.stockMovement.groupBy({
          by: ['referenceId', 'referenceType'],
          where: {
            tenantId,
            referenceType: 'BULK_TRANSFER',
            ...(branchLocationIds
              ? { OR: [{ fromLocationId: { in: branchLocationIds } }, { toLocationId: { in: branchLocationIds } }] }
              : {}),
          },
          _max: {
            createdAt: true,
          },
          _count: {
            id: true,
          },
          _sum: {
            quantity: true,
          },
          orderBy: {
            _max: {
              createdAt: 'desc',
            },
          },
          take: 100,
        })

        // Get bulk transfer details
        const bulkTransferDetails = await Promise.all(
          bulkTransfers.map(async (bt) => {
            const movements = await db.stockMovement.findMany({
              where: {
                tenantId,
                referenceId: bt.referenceId,
                referenceType: bt.referenceType,
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 1, // Get first movement for details
            })

            if (movements.length === 0) return null

            const movement = movements[0]!
            
            // Get location and warehouse details separately
            const [fromLocation, toLocation] = await Promise.all([
              movement.fromLocationId ? db.location.findFirst({
                where: { id: movement.fromLocationId, tenantId },
                include: { warehouse: true }
              }) : Promise.resolve(null),
              movement.toLocationId ? db.location.findFirst({
                where: { id: movement.toLocationId, tenantId },
                include: { warehouse: true }
              }) : Promise.resolve(null),
            ])

            const createdBy = movement.createdBy
              ? await db.user.findFirst({
                  where: { tenantId, id: movement.createdBy },
                  select: { fullName: true, email: true },
                })
              : null

            return {
              id: bt.referenceId!,
              type: 'BULK_TRANSFER' as const,
              typeLabel: 'Transferencia masiva',
              createdAt: movement.createdAt,
              completedAt: movement.createdAt,
              fromWarehouseCode: fromLocation?.warehouse?.code,
              toWarehouseCode: toLocation?.warehouse?.code,
              requestedByName: null,
              fulfilledByName: createdBy?.fullName || createdBy?.email,
              totalItems: bt._count.id,
              totalQuantity: Number(bt._sum.quantity),
              canExportPicking: true,
              canExportLabel: true,
            }
          })
        )

        // Get individual movements (non-bulk)
        const individualMovements = await db.stockMovement.findMany({
          where: {
            tenantId,
            referenceType: null, // Individual movements
            type: {
              not: 'IN',
            },
            ...(branchLocationIds
              ? { OR: [{ fromLocationId: { in: branchLocationIds } }, { toLocationId: { in: branchLocationIds } }] }
              : {}),
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 100,
        })

        // Get individual movement details
        const individualMovementDetails = await Promise.all(
          individualMovements.map(async (movement) => {
            // Get location and warehouse details separately
            const [fromLocation, toLocation] = await Promise.all([
              movement.fromLocationId ? db.location.findFirst({
                where: { id: movement.fromLocationId, tenantId },
                include: { warehouse: true }
              }) : null,
              movement.toLocationId ? db.location.findFirst({
                where: { id: movement.toLocationId, tenantId },
                include: { warehouse: true }
              }) : null,
            ])

            const createdBy = movement.createdBy
              ? await db.user.findFirst({
                  where: { tenantId, id: movement.createdBy },
                  select: { fullName: true, email: true },
                })
              : null

            let typeLabel = 'Movimiento'
            switch (movement.type) {
              case 'IN':
                typeLabel = 'Entrada'
                break
              case 'OUT':
                typeLabel = 'Salida'
                break
              case 'TRANSFER':
                typeLabel = 'Transferencia'
                break
              case 'ADJUSTMENT':
                typeLabel = 'Ajuste'
                break
            }

            return {
              id: movement.id,
              type: 'MOVEMENT' as const,
              typeLabel,
              createdAt: movement.createdAt,
              completedAt: movement.createdAt,
              fromWarehouseCode: fromLocation?.warehouse?.code,
              toWarehouseCode: toLocation?.warehouse?.code,
              requestedByName: null,
              fulfilledByName: createdBy?.fullName || createdBy?.email,
              totalItems: 1,
              totalQuantity: Number(movement.quantity),
              canExportPicking: movement.type === 'OUT' || movement.type === 'TRANSFER',
              canExportLabel: movement.type === 'OUT' || movement.type === 'TRANSFER',
            }
          })
        )

        // Get returns
        const returns = await db.stockReturn.findMany({
          where: {
            tenantId,
            ...(branchWarehouseId ? { toLocation: { warehouseId: branchWarehouseId } } : {}),
          },
          include: {
            items: {
              include: {
                product: true,
                batch: true,
                presentation: true,
              },
            },
            toLocation: {
              include: {
                warehouse: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 100,
        })

        // Get return details
        const returnDetails = await Promise.all(
          returns.map(async (returnRecord) => {
            const createdBy = returnRecord.createdBy
              ? await db.user.findFirst({
                  where: { tenantId, id: returnRecord.createdBy },
                  select: { fullName: true, email: true },
                })
              : null

            const totalQuantity = returnRecord.items.reduce((sum, item) => sum + Number(item.quantity), 0)

            return {
              id: returnRecord.id,
              type: 'RETURN' as const,
              typeLabel: 'Devolución',
              createdAt: returnRecord.createdAt,
              completedAt: returnRecord.createdAt,
              fromWarehouseCode: null,
              toWarehouseCode: returnRecord.toLocation.warehouse?.code,
              requestedByName: null,
              fulfilledByName: createdBy?.fullName || createdBy?.email,
              totalItems: returnRecord.items.length,
              totalQuantity,
              canExportPicking: false,
              canExportLabel: false,
            }
          })
        )

        const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ''))

        const movementRequestFulfillmentDetails = await Promise.all(
          movementRequestGroups.map(async (g) => {
            const requestId = g.referenceId as string
            const req = await db.stockMovementRequest.findFirst({
              where: { tenantId, id: requestId },
              select: {
                id: true,
                createdAt: true,
                fulfilledAt: true,
                status: true,
                requestedBy: true,
                fulfilledBy: true,
                warehouse: { select: { id: true, name: true, code: true } },
              },
            })
            if (!req) return null

            // Only show requests that have shipment movements. For OPEN this means partial shipment.
            // Exclude cancelled requests even if they somehow have movements.
            if (req.status === 'CANCELLED') return null

            // IMPORTANT: When a request is later received, it creates IN movements with fromLocationId=null.
            // For the origin warehouse, we must look at the shipment OUT movements.
            const lastOutMovement = await db.stockMovement.findFirst({
              where: { tenantId, referenceType: 'MOVEMENT_REQUEST', referenceId: requestId, type: 'OUT' },
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true, createdBy: true, fromLocationId: true, toLocationId: true },
            })

            const [fromLocation, toLocation] = await Promise.all([
              lastOutMovement?.fromLocationId
                ? db.location.findFirst({ where: { tenantId, id: lastOutMovement.fromLocationId }, include: { warehouse: true } })
                : Promise.resolve(null),
              // Destination can be derived from the request warehouse, but keep this as a fallback.
              lastOutMovement?.toLocationId
                ? db.location.findFirst({ where: { tenantId, id: lastOutMovement.toLocationId }, include: { warehouse: true } })
                : Promise.resolve(null),
            ])

            const requestedByUser = req.requestedBy && isUuid(req.requestedBy)
              ? await db.user.findFirst({ where: { tenantId, id: req.requestedBy }, select: { fullName: true, email: true } })
              : null
            const requestedByName = requestedByUser?.fullName || requestedByUser?.email || (req.requestedBy && !isUuid(req.requestedBy) ? req.requestedBy : null)

            const fulfilledByUser = req.fulfilledBy
              ? await db.user.findFirst({ where: { tenantId, id: req.fulfilledBy }, select: { fullName: true, email: true } })
              : null
            const createdByUser = !req.fulfilledBy && lastOutMovement?.createdBy
              ? await db.user.findFirst({ where: { tenantId, id: lastOutMovement.createdBy }, select: { fullName: true, email: true } })
              : null
            const fulfilledByName = fulfilledByUser?.fullName || fulfilledByUser?.email || createdByUser?.fullName || createdByUser?.email || null

            const completedAt = (req.fulfilledAt ?? g._max.createdAt ?? req.createdAt) as any
            const typeLabel = req.status === 'OPEN' ? 'Atención parcial' : 'Atención de solicitud'

            return {
              id: req.id,
              type: 'FULFILL_REQUEST' as const,
              typeLabel,
              createdAt: req.createdAt,
              completedAt,
              fromWarehouseCode: fromLocation?.warehouse?.code ?? null,
              toWarehouseCode: req.warehouse?.code ?? toLocation?.warehouse?.code ?? null,
              requestedByName,
              fulfilledByName,
              totalItems: g._count.id,
              totalQuantity: Number(g._sum.quantity ?? 0),
              canExportPicking: true,
              canExportLabel: true,
            }
          })
        )

        // Combine all completed movements and sort by completion date
        const allMovements = [
          ...bulkTransferDetails.filter(Boolean),
          ...individualMovementDetails,
          ...returnDetails,
          ...movementRequestFulfillmentDetails.filter(Boolean),
        ].filter(m => m !== null).sort((a, b) => new Date(b!.completedAt).getTime() - new Date(a!.completedAt).getTime())

        return reply.send({
          items: allMovements.slice(0, 100), // Limit to 100 most recent
        })
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
      }
    },
  )

  // Picking data for completed movements
  app.get(
    '/api/v1/stock/completed-movements/:id/picking',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId

      const parsedParams = completedMovementDocsParamsSchema.safeParse((request as any).params)
      if (!parsedParams.success) return reply.status(400).send({ message: 'Invalid params', issues: parsedParams.error.issues })

      const parsedQuery = completedMovementDocsQuerySchema.safeParse((request as any).query)
      if (!parsedQuery.success) return reply.status(400).send({ message: 'Invalid query', issues: parsedQuery.error.issues })

      const { id } = parsedParams.data
      const { type } = parsedQuery.data

      if (type === 'RETURN') return reply.status(409).send({ message: 'Picking not available for returns' })

      // Get movements that will compose the picking
      const movements =
        type === 'FULFILL_REQUEST'
          ? await db.stockMovement.findMany({
              where: { tenantId, type: 'OUT', referenceType: 'MOVEMENT_REQUEST', referenceId: id },
              orderBy: { createdAt: 'asc' },
            })
          : type === 'BULK_TRANSFER'
            ? await db.stockMovement.findMany({
                where: { tenantId, referenceType: 'BULK_TRANSFER', referenceId: id },
                orderBy: { createdAt: 'asc' },
              })
            : await db.stockMovement.findMany({
                where: { tenantId, id },
                orderBy: { createdAt: 'asc' },
              })

      if (!movements.length) return reply.status(404).send({ message: 'Movement not found' })

      if (type === 'MOVEMENT') {
        const m = movements[0]!
        if (!(m.type === 'OUT' || m.type === 'TRANSFER')) {
          return reply.status(409).send({ message: 'Picking not available for this movement type' })
        }
      }

      const productIds = Array.from(new Set(movements.map((m) => m.productId)))
      const batchIds = Array.from(new Set(movements.map((m) => m.batchId).filter(Boolean) as string[]))
      const locationIds = Array.from(
        new Set(
          movements
            .flatMap((m) => [m.fromLocationId, m.toLocationId])
            .filter(Boolean) as string[],
        ),
      )

      const [products, batches, locations] = await Promise.all([
        db.product.findMany({ where: { tenantId, id: { in: productIds } }, select: { id: true, sku: true, name: true, genericName: true } }),
        batchIds.length
          ? db.batch.findMany({
              where: { tenantId, id: { in: batchIds } },
              select: {
                id: true,
                batchNumber: true,
                expiresAt: true,
                presentation: { select: { name: true, unitsPerPresentation: true } },
              },
            })
          : Promise.resolve([]),
        locationIds.length
          ? db.location.findMany({
              where: { tenantId, id: { in: locationIds } },
              select: { id: true, code: true, warehouse: { select: { code: true, name: true, city: true } } },
            })
          : Promise.resolve([]),
      ])

      const productMap = new Map(products.map((p) => [p.id, p]))
      const batchMap = new Map(batches.map((b) => [b.id, b]))
      const locationMap = new Map(locations.map((l) => [l.id, l]))

      const fromWhLabels = new Set<string>()
      const toWhLabels = new Set<string>()
      const fromLocCodes = new Set<string>()
      const toLocCodes = new Set<string>()

      for (const m of movements) {
        const fromLoc = m.fromLocationId ? locationMap.get(m.fromLocationId) : null
        const toLoc = m.toLocationId ? locationMap.get(m.toLocationId) : null

        if (fromLoc) {
          fromLocCodes.add(String(fromLoc.code ?? '—'))
          fromWhLabels.add(formatWarehouseLabel(fromLoc.warehouse))
        }
        if (toLoc) {
          toLocCodes.add(String(toLoc.code ?? '—'))
          toWhLabels.add(formatWarehouseLabel(toLoc.warehouse))
        }
      }

      const fromWarehouseLabel = fromWhLabels.size === 1 ? Array.from(fromWhLabels)[0] : fromWhLabels.size > 1 ? 'MIXED' : '—'
      const toWarehouseLabel = toWhLabels.size === 1 ? Array.from(toWhLabels)[0] : toWhLabels.size > 1 ? 'MIXED' : '—'
      const fromLocationCode = fromLocCodes.size === 1 ? Array.from(fromLocCodes)[0] : fromLocCodes.size > 1 ? 'MIXED' : '—'
      const toLocationCode = toLocCodes.size === 1 ? Array.from(toLocCodes)[0] : toLocCodes.size > 1 ? 'MIXED' : '—'

      let requestedByName: string | null | undefined = undefined
      let requestedItems: Array<{ productLabel: string; quantityUnits: number; presentationLabel: string }> = []
      if (type === 'FULFILL_REQUEST') {
        const req = await db.stockMovementRequest.findFirst({
          where: { tenantId, id },
          select: {
            requestedBy: true,
            items: {
              select: {
                requestedQuantity: true,
                presentation: { select: { name: true, unitsPerPresentation: true } },
                product: { select: { sku: true, name: true, genericName: true } },
              },
            },
          },
        })
        if (req?.requestedBy) {
          const u = await db.user.findFirst({ where: { tenantId, id: req.requestedBy }, select: { fullName: true, email: true } })
          requestedByName = u?.fullName || u?.email || null
        }

        requestedItems = (req?.items ?? []).map((it) => {
          const presName = String(it.presentation?.name ?? '').trim()
          const presUnits = Number(it.presentation?.unitsPerPresentation ?? 1)
          const presentationLabel = presName
            ? Number.isFinite(presUnits) && presUnits > 1
              ? `${presName} (${presUnits}u)`
              : presName
            : '—'

          return {
            productLabel: buildProductLabel({ sku: it.product?.sku ?? null, name: it.product?.name ?? null, genericName: it.product?.genericName ?? null }),
            quantityUnits: Math.ceil(Number(it.requestedQuantity ?? 0)),
            presentationLabel,
          }
        })
      } else {
        const createdBy = movements[0]?.createdBy
        if (createdBy) {
          const u = await db.user.findFirst({ where: { tenantId, id: createdBy }, select: { fullName: true, email: true } })
          requestedByName = u?.fullName || u?.email || null
        }
      }

      const meta = {
        requestId: id,
        generatedAtIso: new Date().toISOString(),
        fromWarehouseLabel,
        fromLocationCode,
        toWarehouseLabel,
        toLocationCode,
        requestedByName,
      }

      const sentLines = movements.map((m) => {
        const loc = m.fromLocationId ? locationMap.get(m.fromLocationId) : null
        const p = productMap.get(m.productId)
        const b = m.batchId ? batchMap.get(m.batchId) : null
        const presName = String(b?.presentation?.name ?? '').trim()
        const presUnits = Number(b?.presentation?.unitsPerPresentation ?? 1)
        const presentationLabel = presName
          ? Number.isFinite(presUnits) && presUnits > 1
            ? `${presName} (${presUnits}u)`
            : presName
          : '—'
        return {
          locationCode: String(loc?.code ?? '—'),
          productLabel: buildProductLabel(p),
          batchNumber: b?.batchNumber ?? null,
          expiresAt: b?.expiresAt ? new Date(b.expiresAt).toISOString() : null,
          quantityUnits: Math.ceil(Number(m.quantity ?? 0)),
          presentationLabel,
        }
      })

      return reply.send({ meta, requestedItems, sentLines })
    },
  )

  // Label data for completed movements
  app.get(
    '/api/v1/stock/completed-movements/:id/label',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockMove)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId

      const parsedParams = completedMovementDocsParamsSchema.safeParse((request as any).params)
      if (!parsedParams.success) return reply.status(400).send({ message: 'Invalid params', issues: parsedParams.error.issues })

      const parsedQuery = completedMovementDocsQuerySchema.safeParse((request as any).query)
      if (!parsedQuery.success) return reply.status(400).send({ message: 'Invalid query', issues: parsedQuery.error.issues })

      const { id } = parsedParams.data
      const { type } = parsedQuery.data

      if (type === 'RETURN') return reply.status(409).send({ message: 'Label not available for returns' })

      const movements =
        type === 'FULFILL_REQUEST'
          ? await db.stockMovement.findMany({
              where: { tenantId, type: 'OUT', referenceType: 'MOVEMENT_REQUEST', referenceId: id },
              orderBy: { createdAt: 'asc' },
            })
          : type === 'BULK_TRANSFER'
            ? await db.stockMovement.findMany({
                where: { tenantId, referenceType: 'BULK_TRANSFER', referenceId: id },
                orderBy: { createdAt: 'asc' },
              })
            : await db.stockMovement.findMany({
                where: { tenantId, id },
                orderBy: { createdAt: 'asc' },
              })

      if (!movements.length) return reply.status(404).send({ message: 'Movement not found' })

      if (type === 'MOVEMENT') {
        const m = movements[0]!
        if (!(m.type === 'OUT' || m.type === 'TRANSFER')) {
          return reply.status(409).send({ message: 'Label not available for this movement type' })
        }
      }

      const locationIds = Array.from(
        new Set(
          movements
            .flatMap((m) => [m.fromLocationId, m.toLocationId])
            .filter(Boolean) as string[],
        ),
      )

      const locations = locationIds.length
        ? await db.location.findMany({
            where: { tenantId, id: { in: locationIds } },
            select: { id: true, code: true, warehouse: { select: { code: true, name: true, city: true } } },
          })
        : []

      const locationMap = new Map(locations.map((l) => [l.id, l]))

      const fromWhLabels = new Set<string>()
      const toWhLabels = new Set<string>()
      const fromLocCodes = new Set<string>()
      const toLocCodes = new Set<string>()

      for (const m of movements) {
        const fromLoc = m.fromLocationId ? locationMap.get(m.fromLocationId) : null
        const toLoc = m.toLocationId ? locationMap.get(m.toLocationId) : null

        if (fromLoc) {
          fromLocCodes.add(String(fromLoc.code ?? '—'))
          fromWhLabels.add(formatWarehouseLabel(fromLoc.warehouse))
        }
        if (toLoc) {
          toLocCodes.add(String(toLoc.code ?? '—'))
          toWhLabels.add(formatWarehouseLabel(toLoc.warehouse))
        }
      }

      const fromWarehouseLabel = fromWhLabels.size === 1 ? Array.from(fromWhLabels)[0] : fromWhLabels.size > 1 ? 'MIXED' : '—'
      const toWarehouseLabel = toWhLabels.size === 1 ? Array.from(toWhLabels)[0] : toWhLabels.size > 1 ? 'MIXED' : '—'
      const fromLocationCode = fromLocCodes.size === 1 ? Array.from(fromLocCodes)[0] : fromLocCodes.size > 1 ? 'MIXED' : '—'
      const toLocationCode = toLocCodes.size === 1 ? Array.from(toLocCodes)[0] : toLocCodes.size > 1 ? 'MIXED' : '—'

      let requestedByName: string | null | undefined = undefined
      let responsable: string = '—'

      const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { country: true } })
      const country = String(tenant?.country ?? 'BOLIVIA')

      let toCity: string | null = null
      let fromCity: string | null = null

      if (type === 'FULFILL_REQUEST') {
        const req = await db.stockMovementRequest.findFirst({
          where: { tenantId, id },
          select: { requestedBy: true, fulfilledBy: true, requestedCity: true, warehouse: { select: { city: true } } },
        })
        if (req?.requestedBy) {
          const u = await db.user.findFirst({ where: { tenantId, id: req.requestedBy }, select: { fullName: true, email: true } })
          requestedByName = u?.fullName || u?.email || null
        }
        if (req?.fulfilledBy) {
          const u = await db.user.findFirst({ where: { tenantId, id: req.fulfilledBy }, select: { fullName: true, email: true } })
          responsable = u?.fullName || u?.email || responsable
        }
        toCity = (req?.warehouse?.city ?? req?.requestedCity ?? null) as any
      } else {
        const createdBy = movements[0]?.createdBy
        if (createdBy) {
          const u = await db.user.findFirst({ where: { tenantId, id: createdBy }, select: { fullName: true, email: true } })
          responsable = u?.fullName || u?.email || responsable
          requestedByName = responsable
        }
      }

      // infer cities from movements locations when possible
      const firstFromLocId = movements.find((m) => m.fromLocationId)?.fromLocationId
      const firstToLocId = movements.find((m) => m.toLocationId)?.toLocationId
      if (firstFromLocId) {
        const loc = locationMap.get(firstFromLocId)
        fromCity = (loc?.warehouse?.city ?? null) as any
      }
      if (!toCity && firstToLocId) {
        const loc = locationMap.get(firstToLocId)
        toCity = (loc?.warehouse?.city ?? null) as any
      }

      const destinationCityCountry = toCity ? `${toCity}, ${country}` : country
      const originCityCountry = fromCity ? `${fromCity}, ${country}` : country

      const data = {
        requestId: id,
        generatedAtIso: new Date().toISOString(),
        fromWarehouseLabel: originCityCountry,
        fromLocationCode,
        toWarehouseLabel: destinationCityCountry,
        toLocationCode,
        requestedByName,
        bultos: '—',
        responsable,
        observaciones: '—',
      }

      return reply.send(data)
    },
  )
}
