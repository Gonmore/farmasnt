import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '../../../generated/prisma/client.js'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

const createWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(120),
})

const updateWarehouseSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(120).optional(),
})

const createLocationSchema = z.object({
  code: z.string().trim().min(1).max(32),
  type: z.enum(['BIN', 'SHELF', 'FLOOR']).default('BIN'),
})

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
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
        select: { id: true, code: true, name: true, city: true, isActive: true, version: true, updatedAt: true },
      })

      const warehouseIds = items.map((w) => w.id)
      type WarehouseTotalRow = { warehouseId: string; quantity: string | null }
      const totals = warehouseIds.length
        ? await db.$queryRaw<WarehouseTotalRow[]>(Prisma.sql`
            SELECT l."warehouseId" as "warehouseId", COALESCE(SUM(b."quantity"), 0) as "quantity"
            FROM "InventoryBalance" b
            JOIN "Location" l ON l.id = b."locationId"
            WHERE b."tenantId" = ${tenantId}
              AND l."warehouseId" IN (${Prisma.join(warehouseIds)})
            GROUP BY l."warehouseId"
          `)
        : []

      const totalByWarehouseId = new Map((totals ?? []).map((r) => [r.warehouseId, String(r.quantity ?? '0')]))
      const itemsWithTotals = items.map((w) => ({ ...w, totalQuantity: totalByWarehouseId.get(w.id) ?? '0' }))

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items: itemsWithTotals, nextCursor })
    },
  )

  // Create warehouse
  app.post(
    '/api/v1/warehouses',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockManage)],
    },
    async (request, reply) => {
      const parsed = createWarehouseSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const tenant = await db.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true, country: true } })
      if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })
      if (!tenant.country) return reply.status(409).send({ message: 'Tenant country must be configured before creating a branch' })

      try {
        const created = await db.$transaction(async (tx) => {
          // Create warehouse
          const warehouse = await tx.warehouse.create({
            data: {
              tenantId,
              code: parsed.data.code,
              name: parsed.data.name,
              city: parsed.data.city.toUpperCase(),
              createdBy: userId,
            },
            select: { id: true, code: true, name: true, city: true, isActive: true, version: true, updatedAt: true },
          })

          // Create default location (BIN-01)
          await tx.location.create({
            data: {
              tenantId,
              warehouseId: warehouse.id,
              code: 'BIN-01',
              type: 'BIN',
              createdBy: userId,
            },
          })

          return warehouse
        })

        return reply.status(201).send({ ...created, totalQuantity: '0' })
      } catch (e: any) {
        if (typeof e?.code === 'string' && e.code === 'P2002') {
          return reply.status(409).send({ message: 'Warehouse code already exists' })
        }
        throw e
      }
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
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.city !== undefined ? { city: parsed.data.city.toUpperCase() } : {}),
        },
        select: { id: true, code: true, name: true, city: true, isActive: true, version: true, updatedAt: true },
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

  // Create location in warehouse
  app.post(
    '/api/v1/warehouses/:id/locations',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requirePermission(Permissions.StockManage)],
    },
    async (request, reply) => {
      const warehouseId = (request.params as any).id as string
      const parsed = createLocationSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const warehouse = await db.warehouse.findFirst({ where: { id: warehouseId, tenantId }, select: { id: true } })
      if (!warehouse) return reply.status(404).send({ message: 'Warehouse not found' })

      try {
        const created = await db.location.create({
          data: {
            tenantId,
            warehouseId,
            code: parsed.data.code,
            type: parsed.data.type,
            createdBy: userId,
          },
          select: { id: true, warehouseId: true, code: true, type: true, isActive: true, version: true, updatedAt: true },
        })
        return reply.status(201).send(created)
      } catch (e: any) {
        if (typeof e?.code === 'string' && e.code === 'P2002') {
          return reply.status(409).send({ message: 'Location code already exists in this warehouse' })
        }
        throw e
      }
    },
  )
}
