import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

const customerCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nit: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(300).optional(),
})

const customerUpdateSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  nit: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
})

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
})

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)

  app.post(
    '/api/v1/customers',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const parsed = customerCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const created = await db.customer.create({
        data: {
          tenantId,
          name: parsed.data.name,
          nit: parsed.data.nit ?? null,
          email: parsed.data.email ?? null,
          phone: parsed.data.phone ?? null,
          address: parsed.data.address ?? null,
          createdBy: userId,
        },
        select: { id: true, name: true, nit: true, email: true, phone: true, address: true, isActive: true, version: true, createdAt: true },
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'customer.create',
        entityType: 'Customer',
        entityId: created.id,
        after: created,
      })

      return reply.status(201).send(created)
    },
  )

  app.get(
    '/api/v1/customers',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderRead)],
    },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const q = parsed.data.q

      const items = await db.customer.findMany({
        where: {
          tenantId,
          ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        },
        take: parsed.data.take,
        ...(parsed.data.cursor
          ? {
              skip: 1,
              cursor: { id: parsed.data.cursor },
            }
          : {}),
        orderBy: { id: 'asc' },
        select: { id: true, name: true, nit: true, email: true, phone: true, isActive: true, version: true, updatedAt: true },
      })

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items, nextCursor })
    },
  )

  app.get(
    '/api/v1/customers/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderRead)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const tenantId = request.auth!.tenantId

      const customer = await db.customer.findFirst({
        where: { id, tenantId },
        select: { id: true, name: true, nit: true, email: true, phone: true, address: true, isActive: true, version: true, updatedAt: true },
      })

      if (!customer) return reply.status(404).send({ message: 'Not found' })
      return reply.send(customer)
    },
  )

  app.patch(
    '/api/v1/customers/:id',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const parsed = customerUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId

      const before = await db.customer.findFirst({
        where: { id, tenantId },
        select: { id: true, name: true, nit: true, email: true, phone: true, address: true, isActive: true, version: true },
      })
      if (!before) return reply.status(404).send({ message: 'Not found' })
      if (before.version !== parsed.data.version) return reply.status(409).send({ message: 'Version conflict' })

      const updateData: any = {
        version: { increment: 1 },
        createdBy: userId,
      }
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name
      if (parsed.data.nit !== undefined) updateData.nit = parsed.data.nit
      if (parsed.data.email !== undefined) updateData.email = parsed.data.email
      if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone
      if (parsed.data.address !== undefined) updateData.address = parsed.data.address
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive

      const updated = await db.customer.update({
        where: { id },
        data: updateData,
        select: { id: true, name: true, nit: true, email: true, phone: true, address: true, isActive: true, version: true, updatedAt: true },
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'customer.update',
        entityType: 'Customer',
        entityId: id,
        before,
        after: updated,
      })

      return reply.send(updated)
    },
  )
}
