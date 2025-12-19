import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import crypto from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { getEnv } from '../../../shared/env.js'

const errorResponseSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    issues: { type: 'array', items: {} },
  },
  required: ['message'],
  additionalProperties: true,
} as const

const permissionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    code: { type: 'string' },
    module: { type: 'string' },
    description: { type: 'string', nullable: true },
    isSystem: { type: 'boolean' },
  },
  required: ['id', 'code', 'module', 'isSystem'],
  additionalProperties: false,
} as const

const roleListItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    code: { type: 'string' },
    name: { type: 'string' },
    isSystem: { type: 'boolean' },
    version: { type: 'integer' },
    updatedAt: { type: 'string', format: 'date-time' },
    permissionCodes: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'code', 'name', 'isSystem', 'version', 'permissionCodes'],
  additionalProperties: true,
} as const

const roleRefSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    code: { type: 'string' },
    name: { type: 'string' },
  },
  required: ['id', 'code', 'name'],
  additionalProperties: false,
} as const

const userListItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    fullName: { type: 'string', nullable: true },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    roleIds: { type: 'array', items: { type: 'string' } },
    roles: { type: 'array', items: roleRefSchema },
  },
  required: ['id', 'email', 'isActive', 'createdAt', 'roleIds', 'roles'],
  additionalProperties: true,
} as const

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
})

const roleCreateSchema = z.object({
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(100),
  permissionCodes: z.array(z.string().trim().min(1).max(120)).optional(),
})

const rolePermissionsReplaceSchema = z.object({
  permissionCodes: z.array(z.string().trim().min(1).max(120)),
})

const userCreateSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(200),
  fullName: z.string().trim().max(200).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
})

const userRolesReplaceSchema = z.object({
  roleIds: z.array(z.string().uuid()),
})

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color (#RRGGBB)')

const tenantBrandingUpdateSchema = z.object({
  logoUrl: z.string().url().nullable().optional(),
  brandPrimary: hexColorSchema.nullable().optional(),
  brandSecondary: hexColorSchema.nullable().optional(),
  brandTertiary: hexColorSchema.nullable().optional(),
  defaultTheme: z.enum(['LIGHT', 'DARK']).optional(),
})

const tenantLogoPresignSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(200),
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

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)
  const env = getEnv()

  const guard = [requireAuth(), requirePermission(Permissions.AdminUsersManage)]

  app.get(
    '/api/v1/admin/permissions',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'List permissions',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: { items: { type: 'array', items: permissionSchema } },
            required: ['items'],
            additionalProperties: false,
          },
        },
      },
    },
    async () => {
    const items = await db.permission.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, module: true, description: true, isSystem: true },
    })
    return { items }
    },
  )

  app.get(
    '/api/v1/admin/roles',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'List roles',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            take: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            cursor: { type: 'string' },
            q: { type: 'string' },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              items: { type: 'array', items: roleListItemSchema },
              nextCursor: { type: 'string', nullable: true },
            },
            required: ['items', 'nextCursor'],
            additionalProperties: false,
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const q = parsed.data.q

    const items = await db.role.findMany({
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: parsed.data.take,
      ...(parsed.data.cursor ? { skip: 1, cursor: { id: parsed.data.cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        isSystem: true,
        version: true,
        updatedAt: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    })

    const mapped = items.map((r) => ({
      ...r,
      permissionCodes: r.permissions.map((rp) => rp.permission.code),
      permissions: undefined,
    }))

    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items: mapped, nextCursor })
    },
  )

  app.post(
    '/api/v1/admin/roles',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Create role',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
            permissionCodes: { type: 'array', items: { type: 'string' } },
          },
          required: ['code', 'name'],
          additionalProperties: false,
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              code: { type: 'string' },
              name: { type: 'string' },
              isSystem: { type: 'boolean' },
              version: { type: 'integer' },
              createdAt: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'code', 'name', 'isSystem', 'version', 'createdAt'],
            additionalProperties: false,
          },
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const parsed = roleCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    try {
      const created = await db.$transaction(async (tx) => {
        const role = await tx.role.create({
          data: {
            tenantId,
            code: parsed.data.code,
            name: parsed.data.name,
            isSystem: false,
            createdBy: userId,
          },
          select: { id: true, code: true, name: true, isSystem: true, version: true, createdAt: true },
        })

        const permissionCodes = parsed.data.permissionCodes ?? []
        if (permissionCodes.length > 0) {
          const perms = await tx.permission.findMany({ where: { code: { in: permissionCodes } }, select: { id: true, code: true } })
          const foundCodes = new Set(perms.map((p) => p.code))
          const missing = permissionCodes.filter((c) => !foundCodes.has(c))
          if (missing.length > 0) {
            const err = new Error(`Unknown permission codes: ${missing.join(', ')}`) as Error & { statusCode?: number }
            err.statusCode = 400
            throw err
          }

          await tx.rolePermission.createMany({
            data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
          })
        }

        return role
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'admin.role.create',
        entityType: 'Role',
        entityId: created.id,
        after: created,
      })

      return reply.status(201).send(created)
    } catch (e: any) {
      if (typeof e?.code === 'string' && e.code === 'P2002') return reply.status(409).send({ message: 'Role code already exists' })
      throw e
    }
    },
  )

  app.put(
    '/api/v1/admin/roles/:id/permissions',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Replace role permissions',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        body: {
          type: 'object',
          properties: { permissionCodes: { type: 'array', items: { type: 'string' } } },
          required: ['permissionCodes'],
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              code: { type: 'string' },
              name: { type: 'string' },
              version: { type: 'integer' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'code', 'name', 'version', 'updatedAt'],
            additionalProperties: false,
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = rolePermissionsReplaceSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const before = await db.role.findFirst({ where: { id, tenantId }, select: { id: true, code: true, name: true } })
    if (!before) return reply.status(404).send({ message: 'Role not found' })

    const updated = await db.$transaction(async (tx) => {
      const perms = await tx.permission.findMany({ where: { code: { in: parsed.data.permissionCodes } }, select: { id: true, code: true } })
      const foundCodes = new Set(perms.map((p) => p.code))
      const missing = parsed.data.permissionCodes.filter((c) => !foundCodes.has(c))
      if (missing.length > 0) {
        const err = new Error(`Unknown permission codes: ${missing.join(', ')}`) as Error & { statusCode?: number }
        err.statusCode = 400
        throw err
      }

      await tx.rolePermission.deleteMany({ where: { roleId: id } })
      if (perms.length > 0) {
        await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) })
      }

      return tx.role.update({
        where: { id },
        data: { version: { increment: 1 }, createdBy: userId },
        select: { id: true, code: true, name: true, version: true, updatedAt: true },
      })
    })

    await audit.append({
      tenantId,
      actorUserId: userId,
      action: 'admin.role.permissions.replace',
      entityType: 'Role',
      entityId: id,
      before,
      after: { role: updated, permissionCodes: parsed.data.permissionCodes },
    })

    return reply.send(updated)
    },
  )

  app.get(
    '/api/v1/admin/users',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'List users in tenant',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            take: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            cursor: { type: 'string' },
            q: { type: 'string' },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              items: { type: 'array', items: userListItemSchema },
              nextCursor: { type: 'string', nullable: true },
            },
            required: ['items', 'nextCursor'],
            additionalProperties: false,
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const q = parsed.data.q

    const items = await db.user.findMany({
      where: {
        tenantId,
        ...(q ? { email: { contains: q, mode: 'insensitive' } } : {}),
      },
      take: parsed.data.take,
      ...(parsed.data.cursor ? { skip: 1, cursor: { id: parsed.data.cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        createdAt: true,
        roles: { select: { role: { select: { id: true, code: true, name: true } } } },
      },
    })

    const mapped = items.map((u) => ({
      ...u,
      roleIds: u.roles.map((ur) => ur.role.id),
      roles: u.roles.map((ur) => ur.role),
    }))
    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items: mapped, nextCursor })
    },
  )

  app.post(
    '/api/v1/admin/users',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Create user',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
            fullName: { type: 'string' },
            roleIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['email', 'password'],
          additionalProperties: false,
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              fullName: { type: 'string', nullable: true },
              isActive: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'email', 'isActive', 'createdAt'],
            additionalProperties: false,
          },
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const parsed = userCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    try {
      const created = await db.$transaction(async (tx) => {
        const passwordHash = await bcrypt.hash(parsed.data.password, 10)

        const user = await tx.user.create({
          data: {
            tenantId,
            email: parsed.data.email,
            passwordHash,
            fullName: parsed.data.fullName ?? null,
            createdBy: userId,
          },
          select: { id: true, email: true, fullName: true, isActive: true, createdAt: true },
        })

        const roleIds = parsed.data.roleIds ?? []
        if (roleIds.length > 0) {
          const roles = await tx.role.findMany({ where: { id: { in: roleIds }, tenantId }, select: { id: true } })
          if (roles.length !== roleIds.length) {
            const err = new Error('One or more roles not found') as Error & { statusCode?: number }
            err.statusCode = 400
            throw err
          }
          await tx.userRole.createMany({ data: roleIds.map((rid) => ({ userId: user.id, roleId: rid })) })
        }

        return user
      })

      await audit.append({
        tenantId,
        actorUserId: userId,
        action: 'admin.user.create',
        entityType: 'User',
        entityId: created.id,
        after: created,
      })

      return reply.status(201).send(created)
    } catch (e: any) {
      if (typeof e?.code === 'string' && e.code === 'P2002') return reply.status(409).send({ message: 'Email already exists' })
      throw e
    }
    },
  )

  app.put(
    '/api/v1/admin/users/:id/roles',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Replace user roles',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        body: {
          type: 'object',
          properties: { roleIds: { type: 'array', items: { type: 'string' } } },
          required: ['roleIds'],
          additionalProperties: false,
        },
        response: {
          200: userListItemSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = userRolesReplaceSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const actorUserId = request.auth!.userId

    const user = await db.user.findFirst({ where: { id, tenantId }, select: { id: true, email: true } })
    if (!user) return reply.status(404).send({ message: 'User not found' })

    const updated = await db.$transaction(async (tx) => {
      const roles = await tx.role.findMany({ where: { id: { in: parsed.data.roleIds }, tenantId }, select: { id: true } })
      if (roles.length !== parsed.data.roleIds.length) {
        const err = new Error('One or more roles not found') as Error & { statusCode?: number }
        err.statusCode = 400
        throw err
      }

      await tx.userRole.deleteMany({ where: { userId: id } })
      if (parsed.data.roleIds.length > 0) {
        await tx.userRole.createMany({ data: parsed.data.roleIds.map((rid) => ({ userId: id, roleId: rid })) })
      }

      return tx.user.findFirst({
        where: { id, tenantId },
        select: { id: true, email: true, fullName: true, isActive: true, roles: { select: { role: { select: { id: true, code: true } } } } },
      })
    })

    await audit.append({
      tenantId,
      actorUserId,
      action: 'admin.user.roles.replace',
      entityType: 'User',
      entityId: id,
      after: { userId: id, roleIds: parsed.data.roleIds },
    })

    return reply.send(updated)
    },
  )

  // Tenant branding (logo + colors + default theme)
  app.get(
    '/api/v1/admin/tenant/branding',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Get tenant branding',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              tenantId: { type: 'string' },
              tenantName: { type: 'string' },
              logoUrl: { type: 'string', nullable: true },
              brandPrimary: { type: 'string', nullable: true },
              brandSecondary: { type: 'string', nullable: true },
              brandTertiary: { type: 'string', nullable: true },
              defaultTheme: { type: 'string' },
              version: { type: 'integer' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
            required: ['tenantId', 'tenantName', 'defaultTheme', 'version', 'updatedAt'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const tenant = await db.tenant.findFirst({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          logoUrl: true,
          brandPrimary: true,
          brandSecondary: true,
          brandTertiary: true,
          defaultTheme: true,
          version: true,
          updatedAt: true,
        },
      })
      if (!tenant) {
        const err = new Error('Tenant not found') as Error & { statusCode?: number }
        err.statusCode = 404
        throw err
      }
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        logoUrl: tenant.logoUrl,
        brandPrimary: tenant.brandPrimary,
        brandSecondary: tenant.brandSecondary,
        brandTertiary: tenant.brandTertiary,
        defaultTheme: tenant.defaultTheme,
        version: tenant.version,
        updatedAt: tenant.updatedAt.toISOString(),
      }
    },
  )

  app.put(
    '/api/v1/admin/tenant/branding',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Update tenant branding',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            logoUrl: { type: 'string', nullable: true },
            brandPrimary: { type: 'string', nullable: true },
            brandSecondary: { type: 'string', nullable: true },
            brandTertiary: { type: 'string', nullable: true },
            defaultTheme: { type: 'string' },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              tenantId: { type: 'string' },
              version: { type: 'integer' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
            required: ['tenantId', 'version', 'updatedAt'],
            additionalProperties: false,
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = tenantBrandingUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const actorUserId = request.auth!.userId

      const before = await db.tenant.findFirst({
        where: { id: tenantId },
        select: {
          id: true,
          logoUrl: true,
          brandPrimary: true,
          brandSecondary: true,
          brandTertiary: true,
          defaultTheme: true,
          version: true,
        },
      })
      if (!before) {
        const err = new Error('Tenant not found') as Error & { statusCode?: number }
        err.statusCode = 404
        throw err
      }

      const updated = await db.tenant.update({
        where: { id: tenantId },
        data: {
          ...(parsed.data.logoUrl !== undefined ? { logoUrl: parsed.data.logoUrl } : {}),
          ...(parsed.data.brandPrimary !== undefined ? { brandPrimary: parsed.data.brandPrimary } : {}),
          ...(parsed.data.brandSecondary !== undefined ? { brandSecondary: parsed.data.brandSecondary } : {}),
          ...(parsed.data.brandTertiary !== undefined ? { brandTertiary: parsed.data.brandTertiary } : {}),
          ...(parsed.data.defaultTheme !== undefined ? { defaultTheme: parsed.data.defaultTheme as any } : {}),
          version: { increment: 1 },
          createdBy: actorUserId,
        },
        select: { id: true, version: true, updatedAt: true },
      })

      await audit.append({
        tenantId,
        actorUserId,
        action: 'admin.tenant.branding.update',
        entityType: 'Tenant',
        entityId: tenantId,
        before,
        after: { ...parsed.data, version: updated.version },
      })

      return reply.send({ tenantId: updated.id, version: updated.version, updatedAt: updated.updatedAt.toISOString() })
    },
  )

  app.post(
    '/api/v1/admin/tenant/branding/logo-upload',
    {
      preHandler: guard,
      schema: {
        tags: ['Admin'],
        summary: 'Create a presigned upload URL for the tenant logo',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            fileName: { type: 'string' },
            contentType: { type: 'string' },
          },
          required: ['fileName', 'contentType'],
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              uploadUrl: { type: 'string' },
              publicUrl: { type: 'string' },
              key: { type: 'string' },
              expiresInSeconds: { type: 'integer' },
              method: { type: 'string' },
            },
            required: ['uploadUrl', 'publicUrl', 'key', 'expiresInSeconds', 'method'],
            additionalProperties: false,
          },
          400: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = tenantLogoPresignSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const allowedContentTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
      if (!allowedContentTypes.has(parsed.data.contentType)) {
        return reply.status(400).send({ message: 'Unsupported contentType' })
      }

      assertS3Configured(env)

      const tenantId = request.auth!.tenantId
      const ext = extFromFileName(parsed.data.fileName)
      const safeExt = ext && ext.length <= 8 ? ext : 'png'
      const rand = crypto.randomBytes(8).toString('hex')
      const key = `tenants/${tenantId}/branding/logo-${Date.now()}-${rand}.${safeExt}`

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
}
