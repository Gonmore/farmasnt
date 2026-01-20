import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

const searchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  take: z.coerce.number().int().min(1).max(50).default(20),
})

const checkSkuQuerySchema = z.object({
  sku: z.string().min(1).max(100),
  excludeId: z.string().optional(),
})

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()

  app.get(
    '/api/v1/catalog/search',
    { preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)] },
    async (request, reply) => {
      const parsed = searchQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const { q, take } = parsed.data
      const tenantId = request.auth!.tenantId

      // MVP implementation: ILIKE + indexed columns. We'll upgrade to FTS + trigram in Phase 4.
      const items = await db.product.findMany({
        where: {
          tenantId,
          isActive: true,
          OR: [
            { sku: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
            { genericName: { contains: q, mode: 'insensitive' } },
          ],
        },
        take,
        orderBy: [{ name: 'asc' }],
        select: { id: true, sku: true, name: true, genericName: true },
      })

      return { items }
    },
  )

  // Check SKU uniqueness
  app.get(
    '/api/v1/catalog/products/check-sku',
    { preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)] },
    async (request, reply) => {
      const parsed = checkSkuQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const { sku, excludeId } = parsed.data
      const tenantId = request.auth!.tenantId

      const existing = await db.product.findFirst({
        where: {
          tenantId,
          sku,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      })

      return { exists: !!existing }
    },
  )
}
