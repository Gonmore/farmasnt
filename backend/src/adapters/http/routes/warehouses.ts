import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

const updateWarehouseSchema = z.object({
  name: z.string().trim().min(1).max(200),
})

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
})

export async function registerWarehouseRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()

  // List warehouses (keyset by id)
  app.get(
    '/api/v1/warehouses',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId

      const items = await db.warehouse.findMany({
        where: { tenantId },
        take: parsed.data.take,
        ...(parsed.data.cursor
          ? {
              skip: 1,
              cursor: { id: parsed.data.cursor },
            }
          : {}),
        orderBy: { id: 'asc' },
        select: { id: true, code: true, name: true, isActive: true, version: true, updatedAt: true },
      })

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items, nextCursor })
    },
  )

  // Update warehouse
  app.patch(
    '/api/v1/warehouses/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockManage)],
    },
    async (request, reply) => {
      const warehouseId = (request.params as any).id as string
      const parsed = updateWarehouseSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const warehouse = await db.warehouse.findFirst({
        where: { id: warehouseId, tenantId },
        select: { id: true, version: true }
      })

      if (!warehouse) return reply.status(404).send({ message: 'Warehouse not found' })

      const updated = await db.warehouse.update({
        where: {
          id: warehouseId,
          version: warehouse.version // Optimistic locking
        },
        data: {
          name: parsed.data.name,
        },
        select: { id: true, code: true, name: true, isActive: true, version: true, updatedAt: true },
      })

      return reply.send(updated)
    },
  )
  app.get(
    '/api/v1/warehouses/:id/locations',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockRead)],
    },
    async (request, reply) => {
      const warehouseId = (request.params as any).id as string
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId

      const warehouse = await db.warehouse.findFirst({ where: { id: warehouseId, tenantId }, select: { id: true } })
      if (!warehouse) return reply.status(404).send({ message: 'Warehouse not found' })

      const items = await db.location.findMany({
        where: { tenantId, warehouseId },
        take: parsed.data.take,
        ...(parsed.data.cursor
          ? {
              skip: 1,
              cursor: { id: parsed.data.cursor },
            }
          : {}),
        orderBy: { id: 'asc' },
        select: { id: true, warehouseId: true, code: true, type: true, isActive: true, version: true, updatedAt: true },
      })

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items, nextCursor })
    },
  )
}
