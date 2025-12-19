import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

const productCreateSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
})

const productUpdateSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
})

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
})

const batchCreateSchema = z.object({
  batchNumber: z.string().trim().min(1).max(80),
  manufacturingDate: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  status: z.string().trim().min(1).max(32).optional(),
})

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)

  // Create product
  app.post(
    '/api/v1/products',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const parsed = productCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      try {
        const description = parsed.data.description ?? null
        const created = await db.product.create({
          data: {
            tenantId,
            sku: parsed.data.sku,
            name: parsed.data.name,
            description,
            createdBy: userId,
          },
          select: { id: true, sku: true, name: true, version: true, createdAt: true },
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
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.CatalogRead)],
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
        select: { id: true, sku: true, name: true, isActive: true, version: true, updatedAt: true },
      })

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items, nextCursor })
    },
  )

  // Get product
  app.get(
    '/api/v1/products/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const tenantId = request.auth!.tenantId

      const product = await db.product.findFirst({
        where: { id, tenantId },
        select: { id: true, sku: true, name: true, description: true, isActive: true, version: true, updatedAt: true },
      })

      if (!product) return reply.status(404).send({ message: 'Not found' })
      return reply.send(product)
    },
  )

  // Update product (optimistic locking via version)
  app.patch(
    '/api/v1/products/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.CatalogWrite)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const parsed = productUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const before = await db.product.findFirst({
        where: { id, tenantId },
        select: { id: true, sku: true, name: true, description: true, isActive: true, version: true },
      })
      if (!before) return reply.status(404).send({ message: 'Not found' })

      if (before.version !== parsed.data.version) {
        return reply.status(409).send({ message: 'Version conflict' })
      }

      const updateData: any = {
        version: { increment: 1 },
        createdBy: userId,
      }
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name
      if (parsed.data.description !== undefined) updateData.description = parsed.data.description
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive

      const updated = await db.product.update({
        where: { id },
        data: updateData,
        select: { id: true, sku: true, name: true, description: true, isActive: true, version: true, updatedAt: true },
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

  // Create batch for product
  app.post(
    '/api/v1/products/:id/batches',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.CatalogWrite)],
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
        const created = await db.batch.create({
          data: {
            tenantId,
            productId,
            batchNumber: parsed.data.batchNumber,
            manufacturingDate,
            expiresAt,
            status: parsed.data.status ?? 'RELEASED',
            createdBy: userId,
          },
          select: { id: true, productId: true, batchNumber: true, expiresAt: true, status: true, version: true, createdAt: true },
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
}
