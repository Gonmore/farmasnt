import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { AuditService } from '../../../application/audit/auditService.js'

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
})

const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(200),
  branchCount: z.coerce.number().int().min(1).max(50).default(1),
  adminEmail: z.string().email().max(200),
  adminPassword: z.string().min(6).max(200),
  primaryDomain: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : v)),
  // Subscription fields
  contactName: z.string().trim().min(2).max(200),
  contactEmail: z.string().email().max(200),
  contactPhone: z.string().trim().min(8).max(20),
  subscriptionMonths: z.coerce.number().int().min(1).max(36).default(12), // 1-36 meses
})

  const platformTenantAdminCreateSchema = z.object({
    tenantId: z.string().uuid(),
    email: z.string().email().max(200),
    password: z.string().min(6).max(200),
    fullName: z.string().trim().max(200).optional(),
  })

  const platformUserStatusUpdateSchema = z.object({
    isActive: z.coerce.boolean(),
  })

  const platformUserResetPasswordSchema = z.object({
    newPassword: z.string().min(6).max(200).optional(),
  })

  function normalizeEmail(raw: string): string {
    return raw.trim().toLowerCase()
  }

  function generateTempPassword(): string {
    return crypto.randomBytes(12).toString('base64url')
  }

function normalizeDomain(input: string): string {
  const v = input.trim().toLowerCase()
  // Strip protocol and path if user pasted a URL.
  const noProto = v.replace(/^https?:\/\//, '')
  const hostOnly = noProto.split('/')[0] ?? noProto
  // Strip port
  return hostOnly.replace(/:\d+$/, '')
}

function isIpLiteral(host: string): boolean {
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true
  // very rough IPv6 literal detection
  if (host.includes(':')) return true
  return false
}

function validateCustomDomain(domain: string): { ok: true } | { ok: false; message: string } {
  const d = normalizeDomain(domain)
  if (d.length < 3 || d.length > 255) return { ok: false, message: 'Invalid domain length' }
  if (d === 'localhost') return { ok: false, message: 'Invalid domain' }
  if (d.endsWith('.local')) return { ok: false, message: 'Invalid domain' }
  if (isIpLiteral(d)) return { ok: false, message: 'IP literals are not allowed' }
  if (!d.includes('.')) return { ok: false, message: 'Domain must be a FQDN' }
  if (!/^[a-z0-9.-]+$/.test(d)) return { ok: false, message: 'Domain contains invalid characters' }
  if (d.startsWith('.') || d.endsWith('.') || d.includes('..')) return { ok: false, message: 'Invalid domain format' }

  // Validate each label
  for (const label of d.split('.')) {
    if (!label) return { ok: false, message: 'Invalid domain format' }
    if (label.length > 63) return { ok: false, message: 'Invalid domain format' }
    if (label.startsWith('-') || label.endsWith('-')) return { ok: false, message: 'Invalid domain format' }
  }

  return { ok: true }
}

function makeVerificationToken(): string {
  return crypto.randomBytes(24).toString('hex')
}

async function fetchVerificationToken(domain: string, timeoutMs = 6000): Promise<string | null> {
  const path = '/.well-known/pharmaflow-domain-verification'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Try HTTPS first, fallback to HTTP (useful in early setup / before cert issuance).
    for (const scheme of ['https', 'http'] as const) {
      try {
        const res = await fetch(`${scheme}://${domain}${path}`, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'error',
        })
        if (!res.ok) continue
        const text = (await res.text()).trim()
        if (text) return text
      } catch {
        // keep trying next scheme
      }
    }
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const createTenantDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .transform((v) => normalizeDomain(v)),
  isPrimary: z.coerce.boolean().optional().default(false),
})

const verifyTenantDomainSchema = z.object({
  // optional override for early setups
  timeoutMs: z.coerce.number().int().min(1000).max(20000).optional(),
})

export async function registerPlatformRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)

  const guard = [requireAuth(), requirePermission(Permissions.PlatformTenantsManage)]

  app.get(
    '/api/v1/platform/tenants',
    { preHandler: guard },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const q = parsed.data.q

      const items = await db.tenant.findMany({
        where: {
          ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        },
        take: parsed.data.take,
        ...(parsed.data.cursor ? { skip: 1, cursor: { id: parsed.data.cursor } } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          isActive: true,
          branchLimit: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          subscriptionExpiresAt: true,
          createdAt: true,
          updatedAt: true,
          domains: { select: { domain: true, isPrimary: true, verifiedAt: true } },
        },
      })

      const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
      return reply.send({ items, nextCursor })
    },
  )

  app.post(
    '/api/v1/platform/tenants',
    { preHandler: guard },
    async (request, reply) => {
      const parsed = createTenantSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const actor = request.auth!
        const { name, branchCount, adminEmail, adminPassword, contactName, contactEmail, contactPhone, subscriptionMonths } = parsed.data
      const primaryDomain = parsed.data.primaryDomain ? normalizeDomain(parsed.data.primaryDomain) : null

        const normalizedAdminEmail = normalizeEmail(adminEmail)

        // Prevent duplicate emails across the whole system.
        const anyExisting = await db.user.findFirst({ where: { email: normalizedAdminEmail }, select: { id: true } })
        if (anyExisting) return reply.status(409).send({ message: 'Admin email already exists' })

      if (primaryDomain) {
        const exists = await db.tenantDomain.findFirst({ where: { domain: primaryDomain }, select: { id: true } })
        if (exists) return reply.status(409).send({ message: 'Domain already in use' })
      }

      // Calculate subscription expiration
      const now = new Date()
      const subscriptionExpiresAt = new Date(now.getFullYear(), now.getMonth() + subscriptionMonths, now.getDate())

      const passwordHash = await bcrypt.hash(adminPassword, 12)

      const tenant = await db.$transaction(async (tx) => {
        const t = await tx.tenant.create({
          data: {
            name,
            branchLimit: branchCount,
            contactName,
            contactEmail,
            contactPhone,
            subscriptionExpiresAt,
            createdBy: actor.userId,
          },
          select: { id: true, name: true, subscriptionExpiresAt: true },
        })

        // Enable default modules
        for (const module of ['WAREHOUSE', 'SALES'] as const) {
          await tx.tenantModule.create({
            data: { tenantId: t.id, module, enabled: true, createdBy: actor.userId },
          })
        }

        // Create default tenant admin role
        const role = await tx.role.create({
          data: {
            tenantId: t.id,
            code: 'TENANT_ADMIN',
            name: 'Tenant Admin',
            isSystem: true,
            createdBy: actor.userId,
          },
          select: { id: true },
        })

        // Attach standard permissions (exclude platform permission)
        const permissionCodes = [
          Permissions.CatalogRead,
          Permissions.CatalogWrite,
          Permissions.StockRead,
          Permissions.StockManage,
          Permissions.StockMove,
          Permissions.SalesOrderRead,
          Permissions.SalesOrderWrite,
          Permissions.AdminUsersManage,
          Permissions.AuditRead,
        ]

        const perms = await tx.permission.findMany({
          where: { code: { in: permissionCodes } },
          select: { id: true },
        })

        for (const p of perms) {
          await tx.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } })
        }

        // Create tenant admin user
        const user = await tx.user.create({
          data: {
            tenantId: t.id,
            email: normalizedAdminEmail,
            passwordHash,
            isActive: true,
            createdBy: actor.userId,
          },
          select: { id: true },
        })

  // Platform: list users (cross-tenant)
  app.get('/api/v1/platform/users', { preHandler: guard }, async (request, reply) => {
    const parsed = z
      .object({
        take: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().uuid().optional(),
        q: z.string().trim().min(1).max(200).optional(),
        tenantId: z.string().uuid().optional(),
      })
      .safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const where: any = {}
    if (parsed.data.tenantId) where.tenantId = parsed.data.tenantId
    if (parsed.data.q) where.email = { contains: parsed.data.q, mode: 'insensitive' }

    const items = await db.user.findMany({
      where,
      take: parsed.data.take,
      ...(parsed.data.cursor ? { skip: 1, cursor: { id: parsed.data.cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        createdAt: true,
        tenant: { select: { id: true, name: true } },
        roles: { select: { role: { select: { id: true, code: true, name: true } } } },
      },
    })

    const mapped = items.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      isActive: u.isActive,
      createdAt: u.createdAt,
      tenant: u.tenant,
      roles: u.roles.map((ur) => ur.role),
    }))

    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items: mapped, nextCursor })
  })

  // Platform: create tenant admin user in a tenant
  app.post('/api/v1/platform/tenant-admins', { preHandler: guard }, async (request, reply) => {
    const parsed = platformTenantAdminCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const actor = request.auth!
    const email = normalizeEmail(parsed.data.email)

    const anyExisting = await db.user.findFirst({ where: { email }, select: { id: true } })
    if (anyExisting) return reply.status(409).send({ message: 'Email already exists' })

    const tenant = await db.tenant.findFirst({ where: { id: parsed.data.tenantId }, select: { id: true, isActive: true } })
    if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })

    const role = await db.role.findFirst({ where: { tenantId: tenant.id, code: 'TENANT_ADMIN' }, select: { id: true } })
    if (!role) return reply.status(404).send({ message: 'TENANT_ADMIN role not found for tenant' })

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)

    const created = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          fullName: parsed.data.fullName ?? null,
          isActive: true,
          createdBy: actor.userId,
        },
        select: { id: true, email: true },
      })
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } })
      return user
    })

    await audit.append({
      tenantId: tenant.id,
      actorUserId: actor.userId,
      action: 'platform.tenant_admin.create',
      entityType: 'User',
      entityId: created.id,
      metadata: { email: created.email },
    })

    return reply.status(201).send({ id: created.id, email: created.email })
  })

  // Platform: activate/deactivate user
  app.patch('/api/v1/platform/users/:id/status', { preHandler: guard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = platformUserStatusUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const actor = request.auth!
    const user = await db.user.findFirst({ where: { id }, select: { id: true, tenantId: true, email: true, isActive: true } })
    if (!user) return reply.status(404).send({ message: 'User not found' })

    const updated = await db.user.update({ where: { id }, data: { isActive: parsed.data.isActive, version: { increment: 1 }, createdBy: actor.userId } })
    await db.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })

    await audit.append({
      tenantId: user.tenantId,
      actorUserId: actor.userId,
      action: 'platform.user.status.update',
      entityType: 'User',
      entityId: id,
      before: { isActive: user.isActive },
      after: { isActive: updated.isActive },
      metadata: { email: user.email },
    })

    return reply.send({ id: updated.id, isActive: updated.isActive })
  })

  // Platform: reset user password
  app.post('/api/v1/platform/users/:id/reset-password', { preHandler: guard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = platformUserResetPasswordSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const actor = request.auth!
    const user = await db.user.findFirst({ where: { id }, select: { id: true, tenantId: true, email: true } })
    if (!user) return reply.status(404).send({ message: 'User not found' })

    const tempPassword = parsed.data.newPassword ?? generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, 12)
    const now = new Date()

    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash, version: { increment: 1 }, createdBy: actor.userId } })
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } })
    })

    await audit.append({
      tenantId: user.tenantId,
      actorUserId: actor.userId,
      action: 'platform.user.password.reset',
      entityType: 'User',
      entityId: id,
      metadata: { email: user.email },
    })

    return reply.send({ userId: id, temporaryPassword: tempPassword })
  })

        await tx.userRole.create({ data: { userId: user.id, roleId: role.id } })

        // Create branches as warehouses
        for (let i = 1; i <= branchCount; i++) {
          const code = `BR-${String(i).padStart(2, '0')}`
          const wh = await tx.warehouse.create({
            data: {
              tenantId: t.id,
              code,
              name: `Sucursal ${i}`,
              createdBy: actor.userId,
            },
            select: { id: true },
          })

          await tx.location.create({
            data: {
              tenantId: t.id,
              warehouseId: wh.id,
              code: 'BIN-01',
              type: 'BIN',
              createdBy: actor.userId,
            },
          })
        }

        if (primaryDomain) {
          await tx.tenantDomain.create({
            data: {
              tenantId: t.id,
              domain: primaryDomain,
              isPrimary: true,
              verifiedAt: new Date(),
              createdBy: actor.userId,
            },
          })
        }

        return t
      })

      await audit.append({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'platform.tenant.create',
        entityType: 'Tenant',
        entityId: tenant.id,
        metadata: { 
          name: tenant.name, 
          branchCount, 
          primaryDomain, 
          contactName, 
          contactEmail, 
          contactPhone, 
          subscriptionMonths,
          subscriptionExpiresAt: tenant.subscriptionExpiresAt,
        },
      })

      return reply.status(201).send({ 
        id: tenant.id, 
        name: tenant.name,
        subscriptionExpiresAt: tenant.subscriptionExpiresAt,
      })
    },
  )

  // --- Tenant domain management (future-facing, but ready) ---
  app.get(
    '/api/v1/platform/tenants/:tenantId/domains',
    { preHandler: guard },
    async (request, reply) => {
      const tenantId = (request.params as any)?.tenantId as string | undefined
      if (!tenantId) return reply.status(400).send({ message: 'Invalid tenantId' })

      const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { id: true } })
      if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })

      const items = await db.tenantDomain.findMany({
        where: { tenantId },
        orderBy: [{ isPrimary: 'desc' }, { domain: 'asc' }],
        select: {
          id: true,
          domain: true,
          isPrimary: true,
          verifiedAt: true,
          verificationTokenExpiresAt: true,
          createdAt: true,
        },
      })
      return reply.send({ items })
    },
  )

  app.post(
    '/api/v1/platform/tenants/:tenantId/domains',
    { preHandler: guard },
    async (request, reply) => {
      const actor = request.auth!
      const tenantId = (request.params as any)?.tenantId as string | undefined
      if (!tenantId) return reply.status(400).send({ message: 'Invalid tenantId' })

      const parsed = createTenantDomainSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const domain = parsed.data.domain
      const validity = validateCustomDomain(domain)
      if (!validity.ok) return reply.status(400).send({ message: validity.message })

      const tenant = await db.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true } })
      if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })

      const existing = await db.tenantDomain.findFirst({ where: { domain }, select: { id: true, tenantId: true } })
      if (existing) return reply.status(409).send({ message: 'Domain already in use' })

      const token = makeVerificationToken()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

      const created = await db.$transaction(async (tx) => {
        if (parsed.data.isPrimary) {
          await tx.tenantDomain.updateMany({ where: { tenantId }, data: { isPrimary: false } })
        }

        return tx.tenantDomain.create({
          data: {
            tenantId,
            domain,
            isPrimary: parsed.data.isPrimary,
            verifiedAt: null,
            verificationToken: token,
            verificationTokenExpiresAt: expiresAt,
            createdBy: actor.userId,
          },
          select: {
            id: true,
            tenantId: true,
            domain: true,
            isPrimary: true,
            verifiedAt: true,
            verificationTokenExpiresAt: true,
          },
        })
      })

      await audit.append({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'platform.tenant.domain.create',
        entityType: 'TenantDomain',
        entityId: created.id,
        metadata: { tenantId, domain, isPrimary: created.isPrimary, tokenExpiresAt: expiresAt.toISOString() },
      })

      // Return token so operator can instruct customer what to do. This is platform-only.
      return reply.status(201).send({
        ...created,
        verification: {
          token,
          url: `https://${domain}/.well-known/pharmaflow-domain-verification`,
          expiresAt,
        },
      })
    },
  )

  app.post(
    '/api/v1/platform/tenants/:tenantId/domains/:domain/verify',
    { preHandler: guard },
    async (request, reply) => {
      const actor = request.auth!
      const tenantId = (request.params as any)?.tenantId as string | undefined
      const domainRaw = (request.params as any)?.domain as string | undefined
      if (!tenantId || !domainRaw) return reply.status(400).send({ message: 'Invalid params' })

      const domain = normalizeDomain(domainRaw)
      const validity = validateCustomDomain(domain)
      if (!validity.ok) return reply.status(400).send({ message: validity.message })

      const parsedBody = verifyTenantDomainSchema.safeParse(request.body ?? {})
      if (!parsedBody.success) return reply.status(400).send({ message: 'Invalid request', issues: parsedBody.error.issues })

      const row = await db.tenantDomain.findFirst({
        where: { tenantId, domain },
        select: {
          id: true,
          verifiedAt: true,
          verificationToken: true,
          verificationTokenExpiresAt: true,
        },
      })

      if (!row) return reply.status(404).send({ message: 'Domain not found' })
      if (row.verifiedAt) return reply.send({ ok: true, verifiedAt: row.verifiedAt })
      if (!row.verificationToken) return reply.status(409).send({ message: 'Domain has no active verification token' })
      if (row.verificationTokenExpiresAt && row.verificationTokenExpiresAt <= new Date()) {
        return reply.status(409).send({ message: 'Verification token expired' })
      }

      const observed = await fetchVerificationToken(domain, parsedBody.data.timeoutMs)
      if (!observed) return reply.status(409).send({ message: 'Verification URL not reachable or empty' })
      if (observed !== row.verificationToken) {
        return reply.status(409).send({ message: 'Verification token mismatch', observed })
      }

      const verifiedAt = new Date()
      await db.tenantDomain.update({
        where: { id: row.id },
        data: {
          verifiedAt,
          verificationToken: null,
          verificationTokenExpiresAt: null,
        },
      })

      await audit.append({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'platform.tenant.domain.verify',
        entityType: 'TenantDomain',
        entityId: row.id,
        metadata: { tenantId, domain },
      })

      return reply.send({ ok: true, verifiedAt })
    },
  )

  // --- Update tenant (isActive, branchLimit) ---
  app.patch(
    '/api/v1/platform/tenants/:tenantId',
    { preHandler: guard },
    async (request, reply) => {
      const actor = request.auth!
      const tenantId = (request.params as any)?.tenantId as string | undefined
      if (!tenantId) return reply.status(400).send({ message: 'Invalid tenantId' })

      const bodySchema = z.object({
        isActive: z.boolean().optional(),
        branchLimit: z.coerce.number().int().min(1).max(100).optional(),
      })

      const parsed = bodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const { isActive, branchLimit } = parsed.data
      if (isActive === undefined && branchLimit === undefined) {
        return reply.status(400).send({ message: 'At least one field must be provided' })
      }

      const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { id: true, name: true } })
      if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })

      const updated = await db.tenant.update({
        where: { id: tenantId },
        data: {
          ...(isActive !== undefined ? { isActive } : {}),
          ...(branchLimit !== undefined ? { branchLimit } : {}),
        },
        select: {
          id: true,
          name: true,
          isActive: true,
          branchLimit: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          subscriptionExpiresAt: true,
          createdAt: true,
          updatedAt: true,
          domains: { select: { domain: true, isPrimary: true, verifiedAt: true } },
        },
      })

      await audit.append({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'platform.tenant.update',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: { isActive, branchLimit },
      })

      return reply.send(updated)
    },
  )

  // --- Extend tenant subscription ---
  app.patch(
    '/api/v1/platform/tenants/:tenantId/subscription',
    { preHandler: guard },
    async (request, reply) => {
      const actor = request.auth!
      const tenantId = (request.params as any)?.tenantId as string | undefined
      if (!tenantId) return reply.status(400).send({ message: 'Invalid tenantId' })

      const bodySchema = z.object({
        extensionMonths: z.coerce.number().int().min(1).max(48),
      })

      const parsed = bodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const { extensionMonths } = parsed.data

      const tenant = await db.tenant.findFirst({
        where: { id: tenantId },
        select: { id: true, name: true, subscriptionExpiresAt: true },
      })
      if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })

      // Extend from current expiration (or now if expired)
      const baseDate = tenant.subscriptionExpiresAt && tenant.subscriptionExpiresAt > new Date()
        ? tenant.subscriptionExpiresAt
        : new Date()

      const newExpiration = new Date(baseDate.getFullYear(), baseDate.getMonth() + extensionMonths, baseDate.getDate())

      const updated = await db.tenant.update({
        where: { id: tenantId },
        data: { subscriptionExpiresAt: newExpiration },
        select: {
          id: true,
          name: true,
          isActive: true,
          branchLimit: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          subscriptionExpiresAt: true,
          createdAt: true,
          updatedAt: true,
          domains: { select: { domain: true, isPrimary: true, verifiedAt: true } },
        },
      })

      await audit.append({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'platform.tenant.subscription.extend',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: { 
          extensionMonths, 
          previousExpiration: tenant.subscriptionExpiresAt, 
          newExpiration,
        },
      })

      return reply.send(updated)
    },
  )
}
