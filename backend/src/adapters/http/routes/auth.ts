import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { generateOpaqueToken, sha256Hex, signAccessToken } from '../../../application/auth/tokenService.js'
import { getEnv } from '../../../shared/env.js'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
})

function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!v) return null
  // x-forwarded-host may contain a list: "host1, host2"
  const first = v.split(',')[0]?.trim() ?? ''
  // remove port
  return first.replace(/:\d+$/, '')
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const env = getEnv()
  const db = prisma()
  const audit = new AuditService(db)

  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const { email, password } = parsed.data

    // Resolve tenant by Host (supports future custom domains and avoids ambiguous same-email across tenants).
    const host =
      normalizeHost(request.headers['x-forwarded-host']) ??
      normalizeHost(request.headers.host) ??
      normalizeHost((request as any).hostname)

    // If DB hasn't been migrated yet (TenantDomain table missing), do not fail login.
    let tenantId: string | undefined
    if (host) {
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

    const user = tenantId
      ? await db.user.findFirst({
          where: { tenantId, email, isActive: true, tenant: { isActive: true } },
          select: { id: true, tenantId: true, passwordHash: true },
        })
      : await db.user.findFirst({
          where: { email, isActive: true, tenant: { isActive: true } },
          select: { id: true, tenantId: true, passwordHash: true },
        })

    if (!user) {
      // If no tenant was resolved from host, check if this email exists in multiple tenants.
      // In that case, we can't safely choose one and we require a host-based tenant.
      if (!tenantId) {
        const count = await db.user.count({ where: { email, isActive: true, tenant: { isActive: true } } })
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
}
