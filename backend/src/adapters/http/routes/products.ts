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
  })
  .superRefine((v, ctx) => {
    const commercial = (v.commercialName ?? v.name ?? '').trim()
    if (!commercial) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'commercialName (or name) is required', path: ['commercialName'] })
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
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
})

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
      quantity: z.coerce.number().positive(),
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
        const created = await db.product.create({
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
          select: { id: true, sku: true, name: true, genericName: true, presentationWrapper: true, presentationQuantity: true, presentationFormat: true, version: true, createdAt: true },
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
        select: { id: true, sku: true, name: true, genericName: true, presentationWrapper: true, presentationQuantity: true, presentationFormat: true, photoUrl: true, cost: true, price: true, isActive: true, version: true, updatedAt: true },
      })

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items, nextCursor })
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

      if (!recipe) return reply.status(404).send({ message: 'Not found' })
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
          fromLocationId: true,
          toLocationId: true,
          referenceType: true,
          referenceId: true,
          note: true,
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

            await createStockMovementTx(tx, {
              tenantId,
              userId,
              type: 'IN',
              productId,
              batchId: batch.id,
              toLocationId: resolvedToLocationId,
              quantity: parsed.data.initialStock.quantity,
              referenceType: 'BATCH',
              referenceId: batch.id,
              note: parsed.data.initialStock.note ?? null,
            })
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
