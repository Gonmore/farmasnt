import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

const auditActorSchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    fullName: { type: 'string', nullable: true },
  },
  additionalProperties: false,
} as const

const auditEventSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    actorUserId: { type: 'string', nullable: true },
    action: { type: 'string' },
    entityType: { type: 'string' },
    entityId: { type: 'string', nullable: true },
    before: {},
    after: {},
    metadata: {},
    actor: auditActorSchema,
  },
  required: ['id', 'createdAt', 'action', 'entityType'],
  additionalProperties: true,
} as const

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  actorUserId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  entityType: z.string().trim().min(1).max(200).optional(),
  entityId: z.string().trim().min(1).max(200).optional(),
  includePayload: z.coerce.boolean().default(false),
})

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()

  const guard = [requireAuth(), requirePermission(Permissions.AuditRead)]

  app.get(
    '/api/v1/audit/events',
    {
      preHandler: guard,
      schema: {
        tags: ['Audit'],
        summary: 'List audit events (GxP read-side)',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            take: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            cursor: { type: 'string' },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            actorUserId: { type: 'string' },
            action: { type: 'string' },
            entityType: { type: 'string' },
            entityId: { type: 'string' },
            includePayload: { type: 'boolean', default: false },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              items: { type: 'array', items: auditEventSchema },
              nextCursor: { type: 'string', nullable: true },
            },
            required: ['items', 'nextCursor'],
            additionalProperties: false,
          },
          400: {
            type: 'object',
            properties: { message: { type: 'string' }, issues: { type: 'array', items: {} } },
            required: ['message'],
            additionalProperties: true,
          },
        },
      },
    },
    async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const { take, cursor, includePayload, from, to, actorUserId, action, entityType, entityId } = parsed.data

    const createdAtFilter: { gte?: Date; lt?: Date } = {}
    if (from) createdAtFilter.gte = from
    if (to) createdAtFilter.lt = to

    const where = {
      tenantId,
      ...(actorUserId ? { actorUserId } : {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(action ? { action: { contains: action, mode: 'insensitive' as const } } : {}),
      ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
    }

    const items = await db.auditEvent.findMany({
      where,
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        createdAt: true,
        actorUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        ...(includePayload ? { before: true, after: true, metadata: true } : {}),
        actor: { select: { id: true, email: true, fullName: true } },
      },
    })

    const nextCursor = items.length === take ? items[items.length - 1]!.id : null
    return reply.send({ items, nextCursor })
    },
  )

  app.get(
    '/api/v1/audit/events/:id',
    {
      preHandler: guard,
      schema: {
        tags: ['Audit'],
        summary: 'Get audit event by id',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        response: {
          200: auditEventSchema,
          404: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId

    const event = await db.auditEvent.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        createdAt: true,
        actorUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        metadata: true,
        actor: { select: { id: true, email: true, fullName: true } },
      },
    })

    if (!event) return reply.status(404).send({ message: 'Audit event not found' })
    return reply.send(event)
    },
  )
}
