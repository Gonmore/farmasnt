import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import crypto from 'crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { generateOpaqueToken, sha256Hex, signAccessToken } from '../../../application/auth/tokenService.js'
import { getEnv } from '../../../shared/env.js'
import { getMailer } from '../../../shared/mailer.js'
import { requireAuth } from '../../../application/security/rbac.js'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
})

const passwordResetRequestSchema = z.object({
  email: z.string().email().max(200),
})

const passwordResetConfirmSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(6).max(200),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6).max(200),
  newPassword: z.string().min(6).max(200),
})

const photoPresignSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(200),
})

const updateMeSchema = z.object({
  version: z.number().int().positive(),
  fullName: z.string().trim().min(1).max(200).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  photoKey: z.string().trim().min(1).max(800).nullable().optional(),
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

let supportsUserPhotoColumns: boolean | null = null

function looksLikeMissingUserPhotoColumn(err: any): boolean {
  const msg = String(err?.message ?? '')
  const code = String(err?.code ?? '')
  // Prisma: P2022 = column does not exist
  if (code === 'P2022') return true
  // Be defensive across drivers/messages
  if (/column/i.test(msg) && /photo(url|key)/i.test(msg)) return true
  if (/photo(url|key)/i.test(msg) && /does not exist|no existe/i.test(msg)) return true
  return false
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!v) return null
  // x-forwarded-host may contain a list: "host1, host2"
  const first = v.split(',')[0]?.trim() ?? ''
  // remove port
  return first.replace(/:\d+$/, '')
}

function isUniversalAuthHost(host: string, nodeEnv: string): boolean {
  // Production universal access is limited to the platform domain.
  if (host === 'farmasnt.supernovatel.com' || host.endsWith('.farmasnt.supernovatel.com')) return true

  // In local/dev environments we commonly access the app via localhost.
  // Treat it as universal to avoid forcing custom Host setup just to login.
  if (nodeEnv !== 'production') {
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true
    if (host.endsWith('.localhost')) return true
  }

  return false
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const env = getEnv()
  const db = prisma()
  const audit = new AuditService(db)
  const mailer = getMailer()

  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const { email, password } = parsed.data
    const normalizedEmail = normalizeEmail(email)

    // Resolve tenant by Host (supports future custom domains and avoids ambiguous same-email across tenants).
    const host =
      normalizeHost(request.headers['x-forwarded-host']) ??
      normalizeHost(request.headers.host) ??
      normalizeHost((request as any).hostname)

    const universalHost = host ? isUniversalAuthHost(host, env.NODE_ENV) : false

    // If DB hasn't been migrated yet (TenantDomain table missing), do not fail login.
    let tenantId: string | undefined
    if (host) {
      // Universal access hosts allow searching across tenants
      if (universalHost) {
        tenantId = undefined // Allow searching across all tenants
      } else {
        try {
          const domainRow = await db.tenantDomain.findFirst({
            where: { domain: host, verifiedAt: { not: null }, tenant: { isActive: true } },
            select: { tenantId: true },
          })
          tenantId = domainRow?.tenantId
        } catch (e: any) {
          // Prisma P2021: table does not exist
          if (e?.code !== 'P2021') throw e
          tenantId = undefined
        }
      }
    }

    const user = tenantId
      ? await db.user.findFirst({
          where: { tenantId, email: normalizedEmail, isActive: true, tenant: { isActive: true } },
          select: { id: true, tenantId: true, passwordHash: true },
        })
      : await db.user.findFirst({
          where: { email: normalizedEmail, isActive: true, tenant: { isActive: true } },
          select: { id: true, tenantId: true, passwordHash: true },
        })

    if (!user) {
      // If no tenant was resolved from host, check if this email exists in multiple tenants.
      // In that case, we can't safely choose one and we require a host-based tenant.
      // Exception: universal hosts allow cross-tenant resolution
      if (!tenantId && !universalHost) {
        const count = await db.user.count({ where: { email: normalizedEmail, isActive: true, tenant: { isActive: true } } })
        if (count > 1) return reply.status(409).send({ message: 'Ambiguous user email across tenants; use the correct tenant domain' })
      }
      return reply.status(401).send({ message: 'Invalid credentials' })
    }
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) return reply.status(401).send({ message: 'Invalid credentials' })

    const accessToken = await signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      secret: env.JWT_ACCESS_SECRET,
    })

    const refreshToken = generateOpaqueToken()
    const refreshTokenHash = sha256Hex(refreshToken)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await db.refreshToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt,
        createdBy: user.id,
      },
    })

    await audit.append({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      metadata: { method: 'password' },
    })

    return {
      accessToken,
      refreshToken,
    }
  })

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tokenHash = sha256Hex(parsed.data.refreshToken)

    const tokenRow = await db.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true, tenant: { isActive: true } },
      },
      select: { id: true, userId: true, tenantId: true },
    })

    if (!tokenRow) return reply.status(401).send({ message: 'Invalid refresh token' })

    // rotate
    await db.refreshToken.update({
      where: { id: tokenRow.id },
      data: { revokedAt: new Date() },
    })

    const accessToken = await signAccessToken({
      userId: tokenRow.userId,
      tenantId: tokenRow.tenantId,
      secret: env.JWT_ACCESS_SECRET,
    })

    const newRefreshToken = generateOpaqueToken()
    await db.refreshToken.create({
      data: {
        tenantId: tokenRow.tenantId,
        userId: tokenRow.userId,
        tokenHash: sha256Hex(newRefreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdBy: tokenRow.userId,
      },
    })

    await audit.append({
      tenantId: tokenRow.tenantId,
      actorUserId: tokenRow.userId,
      action: 'auth.refresh',
      entityType: 'User',
      entityId: tokenRow.userId,
    })

    return { accessToken, refreshToken: newRefreshToken }
  })

  // POST /api/v1/auth/change-password
  app.post('/api/v1/auth/change-password', { preHandler: [requireAuth()] }, async (request, reply) => {
    const actor = request.auth!
    const parsed = changePasswordSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const user = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, tenantId: true, passwordHash: true } })
    if (!user) return reply.status(404).send({ message: 'User not found' })

    const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)
    if (!ok) return reply.status(400).send({ message: 'La contraseña actual es incorrecta' })

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12)

    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: actor.userId }, data: { passwordHash: newHash, version: { increment: 1 }, createdBy: actor.userId } })
      // Revoke all refresh tokens to force re-login on other devices
      await tx.refreshToken.updateMany({ where: { userId: actor.userId, revokedAt: null }, data: { revokedAt: new Date() } })
      await audit.append({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'auth.password.change',
        entityType: 'User',
        entityId: actor.userId,
      })
    })

    return reply.send({ message: 'Password updated' })
  })

  // POST /api/v1/auth/me/photo-upload - Presign avatar upload
  app.post('/api/v1/auth/me/photo-upload', { preHandler: [requireAuth()] }, async (request, reply) => {
    const actor = request.auth!

    if (supportsUserPhotoColumns === false) {
      return reply.status(409).send({ message: 'Actualice la base de datos (migraciones) para habilitar foto de usuario' })
    }

    const parsed = photoPresignSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const allowedContentTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
    if (!allowedContentTypes.has(parsed.data.contentType)) {
      return reply.status(400).send({ message: 'Unsupported contentType' })
    }

    assertS3Configured(env)

    const user = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, tenantId: true } })
    if (!user) return reply.status(404).send({ message: 'User not found' })

    const ext = extFromFileName(parsed.data.fileName)
    const safeExt = ext && ext.length <= 8 ? ext : 'png'
    const rand = crypto.randomBytes(8).toString('hex')
    const key = `tenants/${actor.tenantId}/users/${actor.userId}/avatar-${Date.now()}-${rand}.${safeExt}`

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
  })

  // PATCH /api/v1/auth/me - Update profile fields (fullName/photo)
  app.patch('/api/v1/auth/me', { preHandler: [requireAuth()] }, async (request, reply) => {
    const actor = request.auth!
    const parsed = updateMeSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    if (supportsUserPhotoColumns === false) {
      const touchesPhoto = Object.prototype.hasOwnProperty.call(parsed.data, 'photoUrl') || Object.prototype.hasOwnProperty.call(parsed.data, 'photoKey')
      if (touchesPhoto) {
        return reply.status(409).send({ message: 'Actualice la base de datos (migraciones) para habilitar foto de usuario' })
      }
    }

    let before: any
    try {
      before = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, tenantId: true, version: true, fullName: true, photoUrl: true, photoKey: true } })
      supportsUserPhotoColumns = true
    } catch (e: any) {
      if (!looksLikeMissingUserPhotoColumn(e)) throw e
      supportsUserPhotoColumns = false
      before = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, tenantId: true, version: true, fullName: true } })
    }
    if (!before) return reply.status(404).send({ message: 'User not found' })
    if (before.tenantId !== actor.tenantId) return reply.status(403).send({ message: 'Forbidden' })
    if (before.version !== parsed.data.version) return reply.status(409).send({ message: 'Conflicto de versión. Recargue e intente nuevamente.' })

    const data: any = { version: { increment: 1 }, createdBy: actor.userId }
    if (Object.prototype.hasOwnProperty.call(parsed.data, 'fullName')) data.fullName = parsed.data.fullName
    if (Object.prototype.hasOwnProperty.call(parsed.data, 'photoUrl')) data.photoUrl = parsed.data.photoUrl
    if (Object.prototype.hasOwnProperty.call(parsed.data, 'photoKey')) data.photoKey = parsed.data.photoKey

    let updated: any
    try {
      updated = await db.user.update({
        where: { id: actor.userId },
        data,
        select: { id: true, email: true, tenantId: true, fullName: true, photoUrl: true, photoKey: true, version: true },
      })
      supportsUserPhotoColumns = true
    } catch (e: any) {
      if (!looksLikeMissingUserPhotoColumn(e)) throw e
      supportsUserPhotoColumns = false
      updated = await db.user.update({
        where: { id: actor.userId },
        data,
        select: { id: true, email: true, tenantId: true, fullName: true, version: true },
      })
    }

    await audit.append({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'auth.me.update',
      entityType: 'User',
      entityId: actor.userId,
      before,
      after: updated,
    })

    return reply.send({ user: updated })
  })

  // POST /api/v1/auth/password-reset/request
  // Always returns 200 to avoid leaking whether a user exists.
  app.post('/api/v1/auth/password-reset/request', async (request, reply) => {
    const parsed = passwordResetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const normalizedEmail = normalizeEmail(parsed.data.email)

    const host =
      normalizeHost(request.headers['x-forwarded-host']) ??
      normalizeHost(request.headers.host) ??
      normalizeHost((request as any).hostname)

    let tenantId: string | undefined
    if (host) {
      try {
        const domainRow = await db.tenantDomain.findFirst({
          where: { domain: host, verifiedAt: { not: null }, tenant: { isActive: true } },
          select: { tenantId: true },
        })
        tenantId = domainRow?.tenantId
      } catch (e: any) {
        if (e?.code !== 'P2021') throw e
        tenantId = undefined
      }
    }

    // If host doesn't resolve tenant and email exists multiple times across tenants, do nothing.
    if (!tenantId) {
      const count = await db.user.count({ where: { email: normalizedEmail, isActive: true, tenant: { isActive: true } } })
      if (count > 1) return reply.send({ message: 'If the email exists, instructions were sent' })
    }

    const user = tenantId
      ? await db.user.findFirst({
          where: { tenantId, email: normalizedEmail, isActive: true, tenant: { isActive: true } },
          select: { id: true, tenantId: true, email: true, tenant: { select: { name: true } } },
        })
      : await db.user.findFirst({
          where: { email: normalizedEmail, isActive: true, tenant: { isActive: true } },
          select: { id: true, tenantId: true, email: true, tenant: { select: { name: true } } },
        })

    if (!user) return reply.send({ message: 'If the email exists, instructions were sent' })

    const token = generateOpaqueToken()
    const tokenHash = sha256Hex(token)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 min

    await db.passwordResetToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash,
        expiresAt,
        createdBy: user.id,
      },
      select: { id: true },
    })

    await audit.append({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: 'auth.password.reset.request',
      entityType: 'User',
      entityId: user.id,
      metadata: { delivery: 'email', expiresAt: expiresAt.toISOString() },
    })

    // Build reset URL.
    // Prefer WEB_ORIGIN, but if not set and Host is available, infer local origin.
    const baseOrigin = (env.WEB_ORIGIN ?? '').trim() || (host ? `http://${host}:6001` : 'http://localhost:6001')
    const resetUrl = `${baseOrigin.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`

    try {
      await mailer.sendPasswordResetEmail({ to: user.email, resetUrl, tenantName: user.tenant?.name })
    } catch (e: any) {
      // Do not leak existence; log server-side.
      request.log.error({ err: e, email: normalizedEmail }, 'Failed to send password reset email')
    }

    return reply.send({ message: 'If the email exists, instructions were sent' })
  })

  // POST /api/v1/auth/password-reset/confirm
  app.post('/api/v1/auth/password-reset/confirm', async (request, reply) => {
    const parsed = passwordResetConfirmSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tokenHash = sha256Hex(parsed.data.token)
    const now = new Date()

    const tokenRow = await db.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
        user: { isActive: true, tenant: { isActive: true } },
      },
      select: { id: true, tenantId: true, userId: true },
    })

    if (!tokenRow) return reply.status(400).send({ message: 'Invalid or expired token' })

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: tokenRow.userId },
        data: { passwordHash, version: { increment: 1 } },
        select: { id: true },
      })
      await tx.passwordResetToken.update({
        where: { id: tokenRow.id },
        data: { usedAt: now },
        select: { id: true },
      })
      await tx.refreshToken.updateMany({ where: { userId: tokenRow.userId, revokedAt: null }, data: { revokedAt: now } })
    })

    await audit.append({
      tenantId: tokenRow.tenantId,
      actorUserId: tokenRow.userId,
      action: 'auth.password.reset.confirm',
      entityType: 'User',
      entityId: tokenRow.userId,
    })

    return reply.send({ message: 'Password updated' })
  })

  // GET /api/v1/auth/me - Obtener información del usuario autenticado incluyendo permisos
  app.get('/api/v1/auth/me', { preHandler: [requireAuth()] }, async (request, reply) => {
    const actor = request.auth!

    let user: any
    try {
      user = await db.user.findUnique({
        where: { id: actor.userId },
        select: {
          id: true,
          email: true,
          tenantId: true,
          fullName: true,
          photoUrl: true,
          version: true,
          tenant: {
            select: {
              id: true,
              name: true,
              isActive: true,
            },
          },
          roles: {
            select: {
              role: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  permissions: {
                    select: {
                      permission: {
                        select: {
                          id: true,
                          code: true,
                          description: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
      supportsUserPhotoColumns = true
    } catch (e: any) {
      if (!looksLikeMissingUserPhotoColumn(e)) throw e
      supportsUserPhotoColumns = false
      user = await db.user.findUnique({
        where: { id: actor.userId },
        select: {
          id: true,
          email: true,
          tenantId: true,
          fullName: true,
          version: true,
          tenant: {
            select: {
              id: true,
              name: true,
              isActive: true,
            },
          },
          roles: {
            select: {
              role: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  permissions: {
                    select: {
                      permission: {
                        select: {
                          id: true,
                          code: true,
                          description: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
    }

    if (!user) return reply.status(404).send({ message: 'User not found' })

    // Extraer permisos únicos de todos los roles
    const permissionsMap = new Map<string, { id: string; code: string; description: string | null }>()
    for (const userRole of user.roles) {
      for (const rolePerm of userRole.role.permissions) {
        if (!permissionsMap.has(rolePerm.permission.code)) {
          permissionsMap.set(rolePerm.permission.code, rolePerm.permission)
        }
      }
    }

    const permissions = Array.from(permissionsMap.values())
    const permissionCodes = permissions.map((p) => p.code)

    // Determinar si es Platform Admin
    const isPlatformAdmin = permissionCodes.includes('platform:tenants:manage')

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        fullName: user.fullName,
        photoUrl: user.photoUrl ?? null,
        version: user.version,
        tenant: user.tenant,
      },
      roles: user.roles.map((ur: any) => ({
        id: ur.role.id,
        code: ur.role.code,
        name: ur.role.name,
      })),
      permissions,
      permissionCodes,
      isPlatformAdmin,
    })
  })
}

