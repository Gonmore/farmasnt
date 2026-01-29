import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import crypto from 'crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { getEnv } from '../../../shared/env.js'
import { createStockMovementTx } from '../../../application/stock/stockMovementService.js'
import { currentYearUtc, nextSequence } from '../../../application/shared/sequence.js'

const presentationCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    unitsPerPresentation: z.coerce.number().int().min(1).max(1_000_000),
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
    isDefault: z.boolean().optional(),
    priceOverride: z.coerce.number().min(0).nullable().optional(),
    isActive: z.boolean().optional(),
  })

const presentationUpdateSchema = z
  .object({
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    unitsPerPresentation: z.coerce.number().int().min(1).max(1_000_000).optional(),
    sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
    isDefault: z.boolean().optional(),
    priceOverride: z.coerce.number().min(0).nullable().optional(),
    isActive: z.boolean().optional(),
  })

function mapPrismaUniqueToHttp409(e: any): { status: number; message: string } | null {
  if (!e || typeof e !== 'object') return null
  if (typeof (e as any).code !== 'string') return null
  if ((e as any).code !== 'P2002') return null

  const targetRaw = (e as any)?.meta?.target
  const targetText = Array.isArray(targetRaw) ? targetRaw.join(',') : String(targetRaw ?? '')
  const t = targetText.toLowerCase()

  if (t.includes('one_default') || t.includes('default')) {
    return { status: 409, message: 'Solo puede existir una presentación por defecto por producto' }
  }
  if (t.includes('tenantid') && t.includes('productid') && t.includes('name')) {
    return { status: 409, message: 'Ya existe una presentación con ese nombre para este producto' }
  }
  return { status: 409, message: 'Conflicto por restricción única' }
}

const productCreateSchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    // Backwards compatible: older clients send `name`.
    // Preferred: send `commercialName`.
    name: z.string().trim().min(1).max(200).optional(),
    commercialName: z.string().trim().min(1).max(200).optional(),
    genericName: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  presentationWrapper: z.string().trim().min(1).max(64).optional(),
  presentationQuantity: z.coerce.number().positive().optional(),
  presentationFormat: z.string().trim().min(1).max(64).optional(),
  cost: z.coerce.number().positive().optional(),
  price: z.coerce.number().positive().optional(),
  // New: allow defining multiple presentations at product creation.
  presentations: z.array(presentationCreateSchema).optional(),
  })
  .superRefine((v, ctx) => {
    const commercial = (v.commercialName ?? v.name ?? '').trim()
    if (!commercial) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'commercialName (or name) is required', path: ['commercialName'] })
    }

    const pres = v.presentations ?? []
    if (pres.length > 0) {
      const defaults = pres.filter((p) => p.isDefault)
      if (defaults.length > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only one presentation can be default', path: ['presentations'] })
      }

      const seen = new Set<string>()
      for (const p of pres) {
        const key = p.name.trim().toLowerCase()
        if (!key) continue
        if (seen.has(key)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate presentation name: ${p.name}`, path: ['presentations'] })
          break
        }
        seen.add(key)
      }
    }
  })

const productUpdateSchema = z.object({
  version: z.number().int().positive(),
  // Backwards compatible: older clients send `name`.
  // Preferred: send `commercialName`.
  name: z.string().trim().min(1).max(200).optional(),
  commercialName: z.string().trim().min(1).max(200).optional(),
  genericName: z.string().trim().min(1).max(200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  presentationWrapper: z.string().trim().min(1).max(64).nullable().optional(),
  presentationQuantity: z.coerce.number().positive().nullable().optional(),
  presentationFormat: z.string().trim().min(1).max(64).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  photoKey: z.string().trim().min(1).max(800).nullable().optional(),
  cost: z.coerce.number().positive().nullable().optional(),
  price: z.coerce.number().positive().nullable().optional(),
  isActive: z.boolean().optional(),
})

const listQuerySchema = z.object({
  // Some UIs need larger lists (selectors). Keep a reasonable cap.
  take: z.coerce.number().int().min(1).max(200).default(20),
  cursor: z.string().uuid().optional(),
  includePresentations: z.coerce.boolean().optional(),
})

function buildLegacyPresentationName(args: { wrapper?: string | null; qty?: any; format?: string | null }): string | null {
  const wrapper = String(args.wrapper ?? '').trim()
  const format = String(args.format ?? '').trim()
  const qtyNum = Number(args.qty)
  if (!wrapper || !Number.isFinite(qtyNum) || qtyNum <= 1) return null
  const qtyText = String(Math.trunc(qtyNum))
  const fmt = format ? ` ${format}` : ''
  return `${wrapper} x${qtyText}${fmt}`.trim()
}

async function ensureCorePresentationsTx(
  tx: any,
  args: { tenantId: string; userId: string; product: any },
): Promise<void> {
  const existing = await tx.productPresentation.findMany({
    where: { tenantId: args.tenantId, productId: args.product.id, isActive: true },
    select: { id: true },
    take: 1,
  })

  if (existing.length > 0) return

  // Create default unit presentation
  await tx.productPresentation.create({
    data: {
      tenantId: args.tenantId,
      productId: args.product.id,
      name: 'Unidad',
      unitsPerPresentation: '1',
      isDefault: true,
      sortOrder: 0,
      isActive: true,
      createdBy: args.userId,
    },
    select: { id: true },
  })

  // If the product has legacy packaging fields, also create it as a presentation.
  const legacyName = buildLegacyPresentationName({
    wrapper: args.product.presentationWrapper,
    qty: args.product.presentationQuantity,
    format: args.product.presentationFormat,
  })

  if (legacyName) {
    const qtyNum = Math.trunc(Number(args.product.presentationQuantity))
    if (Number.isFinite(qtyNum) && qtyNum > 1) {
      try {
        await tx.productPresentation.create({
          data: {
            tenantId: args.tenantId,
            productId: args.product.id,
            name: legacyName,
            unitsPerPresentation: String(qtyNum),
            isDefault: false,
            sortOrder: 10,
            isActive: true,
            createdBy: args.userId,
          },
          select: { id: true },
        })
      } catch {
        // Ignore if it already exists due to concurrent requests.
      }
    }
  }
}

const batchCreateSchema = z.object({
  batchNumber: z.string().trim().min(1).max(80).optional(),
  manufacturingDate: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  status: z.string().trim().min(1).max(32).optional(),
  initialStock: z
    .object({
      // New preferred input: choose only warehouse; backend resolves an active location.
      warehouseId: z.string().uuid().optional(),
      // Backwards compatible (still accepted): explicit destination location.
      toLocationId: z.string().uuid().optional(),
      // Base units (Unidad). Optional when providing presentationId + presentationQuantity.
      quantity: z.coerce.number().positive().optional(),
      // New: allow indicating the input in a presentation (e.g. 50 cajas).
      presentationId: z.string().uuid().optional(),
      presentationQuantity: z.coerce.number().positive().optional(),
      note: z.string().trim().max(500).optional(),
    })
    .superRefine((v, ctx) => {
      const hasWarehouse = typeof v.warehouseId === 'string' && v.warehouseId.length > 0
      const hasLocation = typeof v.toLocationId === 'string' && v.toLocationId.length > 0
      if (!hasWarehouse && !hasLocation) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'initialStock requires warehouseId or toLocationId' })
      }
      if (hasWarehouse && hasLocation) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide either warehouseId or toLocationId, not both' })
      }

      const hasBaseQty = v.quantity !== undefined && v.quantity !== null
      const hasPresId = typeof v.presentationId === 'string' && v.presentationId.length > 0
      const hasPresQty = v.presentationQuantity !== undefined && v.presentationQuantity !== null
      if (!hasBaseQty && !hasPresId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'initialStock requires quantity or presentationId' })
      }
      if (hasPresId && !hasPresQty) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'presentationQuantity is required when presentationId is provided' })
      }
    })
    .optional(),
})

const batchUpdateStatusSchema = z.object({
  status: z.enum(['RELEASED', 'QUARANTINE']),
  version: z.number().int().min(1),
})

const listBatchesQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
})

const productPhotoPresignSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(200),
})

const recipeItemInputSchema = z
  .object({
    ingredientProductId: z.string().uuid().nullable().optional(),
    ingredientName: z.string().trim().min(1).max(200).nullable().optional(),
    quantity: z.coerce.number().positive(),
    unit: z.string().trim().min(1).max(32),
    sortOrder: z.coerce.number().int().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const hasId = typeof v.ingredientProductId === 'string' && v.ingredientProductId.length > 0
    const hasName = typeof v.ingredientName === 'string' && v.ingredientName.trim().length > 0
    if (!hasId && !hasName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each item must have ingredientProductId or ingredientName',
      })
    }
    if (hasId && hasName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either ingredientProductId or ingredientName, not both',
      })
    }
  })

const recipeUpsertSchema = z.object({
  // Required for updates (optimistic locking), omitted for creates.
  version: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(200),
  outputQuantity: z.coerce.number().positive().nullable().optional(),
  outputUnit: z.string().trim().min(1).max(32).nullable().optional(),
  items: z.array(recipeItemInputSchema).optional(),
})

function httpError(statusCode: number, message: string) {
  const err = new Error(message) as Error & { statusCode?: number }
  err.statusCode = statusCode
  return err
}

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

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)
  const env = getEnv()

  // Create product
  app.post(
    '/api/v1/products',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const parsed = productCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      try {
        const commercialName = (parsed.data.commercialName ?? parsed.data.name ?? '').trim()
        const description = parsed.data.description ?? null
        const presentationWrapper = parsed.data.presentationWrapper ?? null
        const presentationQuantity = parsed.data.presentationQuantity ?? null
        const presentationFormat = parsed.data.presentationFormat ?? null
        const cost = parsed.data.cost ?? null
        const price = parsed.data.price ?? null
        const genericName = parsed.data.genericName ?? null
        const created = await db.$transaction(async (tx: any) => {
          const product = await tx.product.create({
            data: {
              tenantId,
              sku: parsed.data.sku,
              name: commercialName,
              genericName,
              description,
              presentationWrapper,
              presentationQuantity,
              presentationFormat,
              cost,
              price,
              createdBy: userId,
            },
            select: {
              id: true,
              sku: true,
              name: true,
              genericName: true,
              presentationWrapper: true,
              presentationQuantity: true,
              presentationFormat: true,
              version: true,
              createdAt: true,
            },
          })

          const requestedPresentations = (parsed.data.presentations ?? []).slice()

          if (requestedPresentations.length > 0) {
            // Ensure there's always a base "Unidad" presentation.
            const hasUnidad = requestedPresentations.some((p) => p.name.trim().toLowerCase() === 'unidad')
            if (!hasUnidad) {
              requestedPresentations.unshift({
                name: 'Unidad',
                unitsPerPresentation: 1,
                sortOrder: 0,
                isDefault: requestedPresentations.some((p) => p.isDefault) ? false : true,
                priceOverride: null,
                isActive: true,
              })
            }

            // If none marked as default, default to Unidad (if present) or first.
            const anyDefault = requestedPresentations.some((p) => !!p.isDefault)
            if (!anyDefault) {
              const idxUnidad = requestedPresentations.findIndex((p) => p.name.trim().toLowerCase() === 'unidad')
              if (idxUnidad >= 0) requestedPresentations[idxUnidad] = { ...requestedPresentations[idxUnidad]!, isDefault: true }
              else requestedPresentations[0] = { ...requestedPresentations[0]!, isDefault: true }
            }

            // Create presentations; ensure only one default in DB.
            for (let i = 0; i < requestedPresentations.length; i++) {
              const p = requestedPresentations[i]!
              if (p.isDefault) {
                await tx.productPresentation.updateMany({
                  where: { tenantId, productId: product.id },
                  data: { isDefault: false, version: { increment: 1 }, createdBy: userId },
                })
              }
              await tx.productPresentation.create({
                data: {
                  tenantId,
                  productId: product.id,
                  name: p.name,
                  unitsPerPresentation: String(p.unitsPerPresentation),
                  priceOverride: p.priceOverride === undefined ? undefined : p.priceOverride === null ? null : String(p.priceOverride),
                  isDefault: !!p.isDefault,
                  sortOrder: p.sortOrder ?? 0,
                  isActive: p.isActive ?? true,
                  createdBy: userId,
                },
                select: { id: true },
              })
            }
          } else {
            // Backwards compatible behavior.
            await ensureCorePresentationsTx(tx, { tenantId, userId, product })
          }
          return product
        })

        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'product.create',
          entityType: 'Product',
          entityId: created.id,
          after: created,
        })

        return reply.status(201).send(created)
      } catch (e: any) {
        // Unique constraint (tenantId, sku)
        if (typeof e?.code === 'string' && e.code === 'P2002') {
          return reply.status(409).send({ message: 'SKU already exists' })
        }
        throw e
      }
    },
  )

  // List products (keyset by id)
  app.get(
    '/api/v1/products',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const includePresentations = !!parsed.data.includePresentations

      const items = await db.product.findMany({
        where: { tenantId },
        take: parsed.data.take,
        ...(parsed.data.cursor
          ? {
              skip: 1,
              cursor: { id: parsed.data.cursor },
            }
          : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          sku: true,
          name: true,
          genericName: true,
          presentationWrapper: true,
          presentationQuantity: true,
          presentationFormat: true,
          photoUrl: true,
          cost: true,
          price: true,
          isActive: true,
          version: true,
          updatedAt: true,
          ...(includePresentations
            ? {
                presentations: {
                  where: { isActive: true },
                  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                  select: { id: true, name: true, unitsPerPresentation: true, priceOverride: true, isDefault: true, sortOrder: true },
                },
              }
            : {}),
        },
      })

      if (includePresentations && items.length > 0) {
        // Ensure a default unit presentation exists for products that still have none.
        await db.$transaction(async (tx: any) => {
          for (const p of items as any[]) {
            const hasPres = Array.isArray((p as any).presentations) && (p as any).presentations.length > 0
            if (!hasPres) await ensureCorePresentationsTx(tx, { tenantId, userId, product: p })
          }
        })

        // Reload presentations after ensuring.
        const ids = (items as any[]).map((p) => p.id)
        const pres = await db.productPresentation.findMany({
          where: { tenantId, productId: { in: ids }, isActive: true },
          select: { id: true, productId: true, name: true, unitsPerPresentation: true, priceOverride: true, isDefault: true, sortOrder: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        })
        const byProduct = new Map<string, any[]>()
        for (const row of pres) {
          const list = byProduct.get(row.productId) ?? []
          list.push(row)
          byProduct.set(row.productId, list)
        }
        for (const p of items as any[]) {
          ;(p as any).presentations = byProduct.get(p.id) ?? []
        }
      }

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items, nextCursor })
    },
  )

  // List presentations for a product
  app.get(
    '/api/v1/products/:id/presentations',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const productId = (request.params as any).id as string
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const product = await db.product.findFirst({
        where: { id: productId, tenantId },
        select: { id: true, presentationWrapper: true, presentationQuantity: true, presentationFormat: true },
      })
      if (!product) return reply.status(404).send({ message: 'Not found' })

      await db.$transaction(async (tx: any) => {
        await ensureCorePresentationsTx(tx, { tenantId, userId, product })
      })

      const presentations = await db.productPresentation.findMany({
        where: { tenantId, productId, isActive: true },
        select: { id: true, name: true, unitsPerPresentation: true, priceOverride: true, isDefault: true, sortOrder: true, version: true, updatedAt: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })

      return reply.send({ items: presentations })
    },
  )

  // Create presentation for a product
  app.post(
    '/api/v1/products/:id/presentations',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const productId = (request.params as any).id as string
      const parsed = presentationCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const product = await db.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } })
      if (!product) return reply.status(404).send({ message: 'Product not found' })

      try {
        const created = await db.$transaction(async (tx: any) => {
          if (parsed.data.isDefault) {
            await tx.productPresentation.updateMany({ where: { tenantId, productId }, data: { isDefault: false, version: { increment: 1 }, createdBy: userId } })
          }
          return tx.productPresentation.create({
            data: {
              tenantId,
              productId,
              name: parsed.data.name,
              unitsPerPresentation: String(parsed.data.unitsPerPresentation),
              priceOverride: parsed.data.priceOverride === undefined ? undefined : parsed.data.priceOverride === null ? null : String(parsed.data.priceOverride),
              isDefault: !!parsed.data.isDefault,
              sortOrder: parsed.data.sortOrder,
              isActive: parsed.data.isActive ?? true,
              createdBy: userId,
            },
            select: { id: true, name: true, unitsPerPresentation: true, priceOverride: true, isDefault: true, sortOrder: true, version: true, updatedAt: true },
          })
        })

        return reply.status(201).send(created)
      } catch (e: any) {
        // Prisma P2021: table does not exist (migrations not applied)
        if (e?.code === 'P2021') {
          return reply.status(500).send({ message: 'Base de datos no migrada: falta tabla. Ejecuta prisma migrate deploy.' })
        }
        const mapped = mapPrismaUniqueToHttp409(e)
        if (mapped) return reply.status(mapped.status).send({ message: mapped.message })
        throw e
      }
    },
  )

  // Update a presentation
  app.patch(
    '/api/v1/products/presentations/:presentationId',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const presentationId = (request.params as any).presentationId as string
      const parsed = presentationUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const before = await db.productPresentation.findFirst({
        where: { id: presentationId, tenantId },
        select: { id: true, productId: true, version: true },
      })
      if (!before) return reply.status(404).send({ message: 'Not found' })
      if (before.version !== parsed.data.version) return reply.status(409).send({ message: 'Version conflict' })

      try {
        const updated = await db.$transaction(async (tx: any) => {
          if (parsed.data.isDefault === true) {
            await tx.productPresentation.updateMany({ where: { tenantId, productId: before.productId }, data: { isDefault: false, version: { increment: 1 }, createdBy: userId } })
          }

          const data: any = { version: { increment: 1 }, createdBy: userId }
          if (parsed.data.name !== undefined) data.name = parsed.data.name
          if (parsed.data.unitsPerPresentation !== undefined) data.unitsPerPresentation = String(parsed.data.unitsPerPresentation)
          if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder
          if (parsed.data.isDefault !== undefined) data.isDefault = parsed.data.isDefault
          if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive
          if (Object.prototype.hasOwnProperty.call(parsed.data, 'priceOverride')) {
            data.priceOverride = parsed.data.priceOverride === null ? null : parsed.data.priceOverride === undefined ? undefined : String(parsed.data.priceOverride)
          }

          return tx.productPresentation.update({
            where: { id: presentationId },
            data,
            select: { id: true, name: true, unitsPerPresentation: true, priceOverride: true, isDefault: true, sortOrder: true, version: true, updatedAt: true, isActive: true },
          })
        })

        return reply.send(updated)
      } catch (e: any) {
        // Prisma P2021: table does not exist (migrations not applied)
        if (e?.code === 'P2021') {
          return reply.status(500).send({ message: 'Base de datos no migrada: falta tabla. Ejecuta prisma migrate deploy.' })
        }
        const mapped = mapPrismaUniqueToHttp409(e)
        if (mapped) return reply.status(mapped.status).send({ message: mapped.message })
        throw e
      }
    },
  )

  // Delete (deactivate) a presentation
  app.delete(
    '/api/v1/products/presentations/:presentationId',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const presentationId = (request.params as any).presentationId as string
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const before = await db.productPresentation.findFirst({ where: { id: presentationId, tenantId }, select: { id: true } })
      if (!before) return reply.status(404).send({ message: 'Not found' })

      await db.productPresentation.update({
        where: { id: presentationId },
        data: { isActive: false, isDefault: false, version: { increment: 1 }, createdBy: userId },
        select: { id: true },
      })

      return reply.status(204).send()
    },
  )

  // Get product
  app.get(
    '/api/v1/products/:id',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const tenantId = request.auth!.tenantId

      const product = await db.product.findFirst({
        where: { id, tenantId },
        select: { id: true, sku: true, name: true, genericName: true, description: true, presentationWrapper: true, presentationQuantity: true, presentationFormat: true, photoUrl: true, cost: true, price: true, isActive: true, version: true, updatedAt: true },
      })

      if (!product) return reply.status(404).send({ message: 'Not found' })
      return reply.send(product)
    },
  )

  // Get recipe for product
  app.get(
    '/api/v1/products/:id/recipe',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const productId = (request.params as any).id as string
      const tenantId = request.auth!.tenantId

      const product = await db.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } })
      if (!product) return reply.status(404).send({ message: 'Product not found' })

      const recipe = await db.recipe.findFirst({
        where: { tenantId, productId },
        select: {
          id: true,
          productId: true,
          name: true,
          outputQuantity: true,
          outputUnit: true,
          version: true,
          updatedAt: true,
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              ingredientProductId: true,
              ingredientName: true,
              quantity: true,
              unit: true,
              sortOrder: true,
              note: true,
            },
          },
        },
      })

      // Return 200 with null to avoid noisy 404s in the UI when a product simply has no recipe yet.
      if (!recipe) return reply.send(null)
      return reply.send(recipe)
    },
  )

  // Create or update recipe for product
  app.put(
    '/api/v1/products/:id/recipe',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const productId = (request.params as any).id as string
      const parsed = recipeUpsertSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const product = await db.product.findFirst({ where: { id: productId, tenantId }, select: { id: true, name: true } })
      if (!product) return reply.status(404).send({ message: 'Product not found' })

      const items = parsed.data.items ?? []

      const result = await db.$transaction(async (tx) => {
        const existing = await tx.recipe.findFirst({ where: { tenantId, productId }, select: { id: true, version: true } })

        if (existing) {
          if (parsed.data.version === undefined) throw httpError(400, 'version is required for updates')
          if (existing.version !== parsed.data.version) throw httpError(409, 'Version conflict')

          await tx.recipe.update({
            where: { id: existing.id },
            data: {
              name: parsed.data.name,
              outputQuantity: parsed.data.outputQuantity ?? null,
              outputUnit: parsed.data.outputUnit ?? null,
              version: { increment: 1 },
              createdBy: userId,
            },
          })

          await tx.recipeItem.deleteMany({ where: { recipeId: existing.id } })
          if (items.length > 0) {
            await tx.recipeItem.createMany({
              data: items.map((it, idx) => ({
                tenantId,
                recipeId: existing.id,
                ingredientProductId: it.ingredientProductId ?? null,
                ingredientName: it.ingredientName ?? null,
                quantity: it.quantity,
                unit: it.unit,
                sortOrder: it.sortOrder ?? idx,
                note: it.note ?? null,
                createdBy: userId,
              })),
            })
          }

          const updated = await tx.recipe.findFirst({
            where: { tenantId, productId },
            select: {
              id: true,
              productId: true,
              name: true,
              outputQuantity: true,
              outputUnit: true,
              version: true,
              updatedAt: true,
              items: {
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                select: {
                  id: true,
                  ingredientProductId: true,
                  ingredientName: true,
                  quantity: true,
                  unit: true,
                  sortOrder: true,
                  note: true,
                },
              },
            },
          })
          if (!updated) throw httpError(500, 'Failed to load updated recipe')
          return { created: false as const, recipe: updated }
        }

        const createData: any = {
          tenantId,
          productId,
          name: parsed.data.name,
          outputQuantity: parsed.data.outputQuantity ?? null,
          outputUnit: parsed.data.outputUnit ?? null,
          createdBy: userId,
        }
        if (items.length > 0) {
          createData.items = {
            create: items.map((it, idx) => ({
              tenantId,
              ingredientProductId: it.ingredientProductId ?? null,
              ingredientName: it.ingredientName ?? null,
              quantity: it.quantity,
              unit: it.unit,
              sortOrder: it.sortOrder ?? idx,
              note: it.note ?? null,
              createdBy: userId,
            })),
          }
        }

        const created = await tx.recipe.create({
          data: createData,
          select: {
            id: true,
            productId: true,
            name: true,
            outputQuantity: true,
            outputUnit: true,
            version: true,
            updatedAt: true,
            items: {
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true,
                ingredientProductId: true,
                ingredientName: true,
                quantity: true,
                unit: true,
                sortOrder: true,
                note: true,
              },
            },
          },
        })

        return { created: true as const, recipe: created }
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: result.created ? 'recipe.create' : 'recipe.update',
        entityType: 'Recipe',
        entityId: result.recipe.id,
        after: result.recipe,
      })

      return reply.send(result.recipe)
    },
  )

  // Delete recipe for product
  app.delete(
    '/api/v1/products/:id/recipe',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const productId = (request.params as any).id as string
      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const existing = await db.recipe.findFirst({
        where: { tenantId, productId },
        select: { id: true, productId: true, name: true, version: true },
      })

      if (!existing) return reply.status(404).send({ message: 'Not found' })

      await db.recipe.delete({ where: { id: existing.id } })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'recipe.delete',
        entityType: 'Recipe',
        entityId: existing.id,
        before: existing,
      })

      return reply.status(204).send()
    },
  )

  // Update product (optimistic locking via version)
  app.patch(
    '/api/v1/products/:id',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const parsed = productUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const before = await db.product.findFirst({
        where: { id, tenantId },
        select: { id: true, sku: true, name: true, genericName: true, description: true, presentationWrapper: true, presentationQuantity: true, presentationFormat: true, isActive: true, version: true },
      })
      if (!before) return reply.status(404).send({ message: 'Not found' })

      if (before.version !== parsed.data.version) {
        return reply.status(409).send({ message: 'Version conflict' })
      }

      const hasPhotoUrl = Object.prototype.hasOwnProperty.call(parsed.data, 'photoUrl')
      const hasPhotoKey = Object.prototype.hasOwnProperty.call(parsed.data, 'photoKey')
      if (hasPhotoUrl !== hasPhotoKey) {
        return reply.status(400).send({ message: 'photoUrl and photoKey must be provided together' })
      }
      if (hasPhotoUrl && hasPhotoKey) {
        const photoUrl = (parsed.data as any).photoUrl as string | null | undefined
        const photoKey = (parsed.data as any).photoKey as string | null | undefined
        const bothNull = photoUrl === null && photoKey === null
        const bothSet = typeof photoUrl === 'string' && typeof photoKey === 'string'
        if (!bothNull && !bothSet) {
          return reply.status(400).send({ message: 'photoUrl/photoKey must be both null or both strings' })
        }
      }

      const updateData: any = {
        version: { increment: 1 },
        createdBy: userId,
      }
      const hasCommercialName = Object.prototype.hasOwnProperty.call(parsed.data, 'commercialName')
      const hasLegacyName = Object.prototype.hasOwnProperty.call(parsed.data, 'name')
      if (hasCommercialName || hasLegacyName) {
        const commercialName = ((parsed.data as any).commercialName ?? (parsed.data as any).name ?? '').trim()
        if (!commercialName) return reply.status(400).send({ message: 'commercialName (or name) cannot be empty' })
        updateData.name = commercialName
      }

      if (Object.prototype.hasOwnProperty.call(parsed.data, 'genericName')) {
        updateData.genericName = (parsed.data as any).genericName
      }
      if (parsed.data.description !== undefined) updateData.description = parsed.data.description
      if ((parsed.data as any).presentationWrapper !== undefined) updateData.presentationWrapper = (parsed.data as any).presentationWrapper
      if ((parsed.data as any).presentationQuantity !== undefined) updateData.presentationQuantity = (parsed.data as any).presentationQuantity
      if ((parsed.data as any).presentationFormat !== undefined) updateData.presentationFormat = (parsed.data as any).presentationFormat
      if ((parsed.data as any).photoUrl !== undefined) updateData.photoUrl = (parsed.data as any).photoUrl
      if ((parsed.data as any).photoKey !== undefined) updateData.photoKey = (parsed.data as any).photoKey
      if ((parsed.data as any).cost !== undefined) updateData.cost = (parsed.data as any).cost
      if ((parsed.data as any).price !== undefined) updateData.price = (parsed.data as any).price
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive

      const updated = await db.product.update({
        where: { id },
        data: updateData,
        select: { id: true, sku: true, name: true, genericName: true, description: true, presentationWrapper: true, presentationQuantity: true, presentationFormat: true, photoUrl: true, cost: true, price: true, isActive: true, version: true, updatedAt: true },
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'product.update',
        entityType: 'Product',
        entityId: id,
        before,
        after: updated,
      })

      return reply.send(updated)
    },
  )

  // Presign product photo upload
  app.post(
    '/api/v1/products/:id/photo-upload',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const productId = (request.params as any).id as string
      const parsed = productPhotoPresignSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const allowedContentTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
      if (!allowedContentTypes.has(parsed.data.contentType)) {
        return reply.status(400).send({ message: 'Unsupported contentType' })
      }

      assertS3Configured(env)

      const tenantId = request.auth!.tenantId

      const product = await db.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } })
      if (!product) return reply.status(404).send({ message: 'Product not found' })

      const ext = extFromFileName(parsed.data.fileName)
      const safeExt = ext && ext.length <= 8 ? ext : 'png'
      const rand = crypto.randomBytes(8).toString('hex')
      const key = `tenants/${tenantId}/products/${productId}/photo-${Date.now()}-${rand}.${safeExt}`

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

  // Create batch for product
  app.get(
    '/api/v1/products/:id/batches',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const productId = (request.params as any).id as string
      const parsed = listBatchesQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const hasStockRead = request.auth!.permissions.has(Permissions.StockRead)

      const product = await db.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } })
      if (!product) return reply.status(404).send({ message: 'Product not found' })

      const batches = await db.batch.findMany({
        where: { tenantId, productId },
        take: parsed.data.take,
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          batchNumber: true,
          manufacturingDate: true,
          expiresAt: true,
          status: true,
          version: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      const batchIds = batches.map((b) => b.id)
      const balances = hasStockRead && batchIds.length
        ? await db.inventoryBalance.findMany({
            where: { tenantId, productId, batchId: { in: batchIds } },
            select: {
              batchId: true,
              quantity: true,
              reservedQuantity: true,
              location: {
                select: {
                  id: true,
                  code: true,
                  warehouse: { select: { id: true, code: true, name: true } },
                },
              },
            },
          })
        : []

      const balancesByBatch = new Map<string, Array<{ location: any; quantity: string; reservedQuantity: string }>>()
      for (const b of balances as any[]) {
        const key = b.batchId as string
        const arr = balancesByBatch.get(key) ?? []
        arr.push({ location: b.location, quantity: String(b.quantity), reservedQuantity: String(b.reservedQuantity ?? '0') })
        balancesByBatch.set(key, arr)
      }

      const items = batches.map((b) => {
        const locs = balancesByBatch.get(b.id) ?? []
        const total = locs.reduce((acc, x) => acc + Number(x.quantity || '0'), 0)
        const totalReserved = locs.reduce((acc, x) => acc + Number(x.reservedQuantity || '0'), 0)
        const totalAvailable = Math.max(0, total - totalReserved)
        return {
          ...b,
          totalQuantity: hasStockRead ? String(total) : null,
          totalReservedQuantity: hasStockRead ? String(totalReserved) : null,
          totalAvailableQuantity: hasStockRead ? String(totalAvailable) : null,
          locations: hasStockRead
            ? locs.map((x) => ({
                warehouseId: x.location.warehouse.id,
                warehouseCode: x.location.warehouse.code,
                warehouseName: x.location.warehouse.name,
                locationId: x.location.id,
                locationCode: x.location.code,
                quantity: x.quantity,
                reservedQuantity: x.reservedQuantity,
                availableQuantity: String(Math.max(0, Number(x.quantity || '0') - Number(x.reservedQuantity || '0'))),
              }))
            : [],
        }
      })

      return reply.send({ items, hasStockRead })
    },
  )

  app.get(
    '/api/v1/products/:productId/batches/:batchId/movements',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const productId = (request.params as any).productId as string
      const batchId = (request.params as any).batchId as string
      const tenantId = request.auth!.tenantId

      if (!request.auth!.permissions.has(Permissions.StockRead)) {
        return reply.status(403).send({ message: 'Forbidden' })
      }

      const batch = await db.batch.findFirst({ where: { id: batchId, tenantId, productId }, select: { id: true, batchNumber: true } })
      if (!batch) return reply.status(404).send({ message: 'Not found' })

      const movements = await db.stockMovement.findMany({
        where: { tenantId, productId, batchId },
        take: 200,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          number: true,
          numberYear: true,
          createdAt: true,
          type: true,
          quantity: true,
          presentationId: true,
          presentationQuantity: true,
          fromLocationId: true,
          toLocationId: true,
          referenceType: true,
          referenceId: true,
          note: true,
        },
      })

      const presentationIds = new Set<string>()
      for (const m of movements as any[]) {
        if (m.presentationId) presentationIds.add(m.presentationId)
      }

      const presentations = presentationIds.size
        ? await (db as any).productPresentation.findMany({
            where: { tenantId, id: { in: Array.from(presentationIds) } },
            select: { id: true, name: true, unitsPerPresentation: true },
          })
        : []
      const presById = new Map(presentations.map((p: any) => [p.id, p] as const))

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
        const pres = (m as any).presentationId ? presById.get((m as any).presentationId) ?? null : null
        return {
          ...m,
          presentation: pres ? { id: (pres as any).id, name: (pres as any).name, unitsPerPresentation: (pres as any).unitsPerPresentation } : null,
          from: fromLoc
            ? { id: fromLoc.id, code: fromLoc.code, warehouse: fromLoc.warehouse }
            : null,
          to: toLoc ? { id: toLoc.id, code: toLoc.code, warehouse: toLoc.warehouse } : null,
        }
      })

      return reply.send({ batch: { id: batch.id, batchNumber: batch.batchNumber }, items })
    },
  )

  app.post(
    '/api/v1/products/:id/batches',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const productId = (request.params as any).id as string
      const parsed = batchCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const product = await db.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } })
      if (!product) return reply.status(404).send({ message: 'Product not found' })

      try {
        const manufacturingDate = parsed.data.manufacturingDate ? new Date(parsed.data.manufacturingDate) : null
        const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
        const created = await db.$transaction(async (tx) => {
          const batchNumber = parsed.data.batchNumber
            ? parsed.data.batchNumber
            : (await nextSequence(tx, { tenantId, year: currentYearUtc(), key: 'LOT' })).number

          const batch = await tx.batch.create({
            data: {
              tenantId,
              productId,
              batchNumber,
              manufacturingDate,
              expiresAt,
              status: parsed.data.status ?? 'RELEASED',
              createdBy: userId,
            },
            select: { id: true, productId: true, batchNumber: true, expiresAt: true, status: true, version: true, createdAt: true },
          })

          if (parsed.data.initialStock) {
            let resolvedToLocationId: string

            if (parsed.data.initialStock.toLocationId) {
              resolvedToLocationId = parsed.data.initialStock.toLocationId
            } else {
              const warehouseId = parsed.data.initialStock.warehouseId!
              const warehouse = await tx.warehouse.findFirst({
                where: { id: warehouseId, tenantId, isActive: true },
                select: { id: true },
              })
              if (!warehouse) throw httpError(404, 'Warehouse not found')

              const loc = await tx.location.findFirst({
                where: { tenantId, warehouseId, isActive: true },
                orderBy: [{ code: 'asc' }],
                select: { id: true },
              })
              if (!loc) throw httpError(409, 'Warehouse has no active locations')
              resolvedToLocationId = loc.id
            }

              // Resolve quantity. Prefer presentation inputs when provided.
              let baseQty = parsed.data.initialStock.quantity !== undefined ? Number(parsed.data.initialStock.quantity) : NaN
              let presId: string | null = null
              let presQty: number | null = null

              if (parsed.data.initialStock.presentationId) {
                presId = parsed.data.initialStock.presentationId
                presQty = Number(parsed.data.initialStock.presentationQuantity)
                if (!Number.isFinite(presQty) || presQty <= 0) throw httpError(400, 'Invalid presentationQuantity')

                // Validate presentation belongs to this product and tenant.
                const pres = await tx.productPresentation.findFirst({
                  where: { id: presId, tenantId, productId, isActive: true },
                  select: { id: true, unitsPerPresentation: true },
                })
                if (!pres) throw httpError(400, 'Presentation not found')
                const factor = Number(pres.unitsPerPresentation)
                if (!Number.isFinite(factor) || factor <= 0) throw httpError(400, 'Invalid unitsPerPresentation')
                baseQty = presQty * factor
              }

              if (!Number.isFinite(baseQty) || baseQty <= 0) throw httpError(400, 'Invalid quantity')

            await createStockMovementTx(tx, {
              tenantId,
              userId,
              type: 'IN',
              productId,
              batchId: batch.id,
              toLocationId: resolvedToLocationId,
                quantity: baseQty,
                presentationId: presId,
                presentationQuantity: presQty,
              referenceType: 'BATCH',
              referenceId: batch.id,
              note: parsed.data.initialStock.note ?? null,
            })

            // Check for pending stock movement requests that can be fulfilled
            const location = await tx.location.findFirst({
              where: { id: resolvedToLocationId },
              select: { warehouse: { select: { city: true } } },
            })
            if (location?.warehouse?.city) {
              const warehouseCity = location.warehouse.city
              const pendingRequests = await tx.stockMovementRequest.findMany({
                where: {
                  tenantId,
                  status: 'OPEN',
                  requestedCity: warehouseCity,
                  items: {
                    some: {
                      productId,
                      remainingQuantity: { gt: 0 },
                    },
                  },
                },
                select: {
                  id: true,
                  items: {
                    where: { productId, remainingQuantity: { gt: 0 } },
                    select: { id: true, remainingQuantity: true },
                  },
                },
              })

              for (const req of pendingRequests) {
                let totalRemaining = req.items.reduce((sum, item) => sum + Number(item.remainingQuantity), 0)
                if (totalRemaining <= baseQty) {
                  // Fulfill the request
                  await tx.stockMovementRequest.update({
                    where: { id: req.id },
                    data: {
                      status: 'FULFILLED',
                      fulfilledAt: new Date(),
                      fulfilledBy: userId,
                    },
                  })
                  // Update remaining quantities to 0
                  for (const item of req.items) {
                    await tx.stockMovementRequestItem.update({
                      where: { id: item.id },
                      data: { remainingQuantity: 0 },
                    })
                  }
                }
              }
            }
          }

          return batch
        })

        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'batch.create',
          entityType: 'Batch',
          entityId: created.id,
          after: created,
        })

        return reply.status(201).send(created)
      } catch (e: any) {
        if (typeof e?.code === 'string' && e.code === 'P2002') {
          return reply.status(409).send({ message: 'Batch number already exists for product' })
        }
        throw e
      }
    },
  )

  // Update batch status
  app.patch(
    '/api/v1/products/:productId/batches/:batchId/status',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const productId = (request.params as any).productId as string
      const batchId = (request.params as any).batchId as string
      const parsed = batchUpdateStatusSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const batch = await db.batch.findFirst({
        where: { id: batchId, productId, tenantId },
        select: { id: true, batchNumber: true, status: true, version: true },
      })
      if (!batch) return reply.status(404).send({ message: 'Batch not found' })

      if (batch.version !== parsed.data.version) {
        return reply.status(409).send({ message: 'Version conflict' })
      }

      const updated = await db.batch.update({
        where: { id: batchId },
        data: {
          status: parsed.data.status,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
        select: { id: true, batchNumber: true, status: true, version: true, updatedAt: true },
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'batch.update_status',
        entityType: 'Batch',
        entityId: batchId,
        before: { status: batch.status, version: batch.version },
        after: { status: updated.status, version: updated.version },
      })

      return reply.send(updated)
    },
  )
}
