import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { parse as parseCsv } from 'csv-parse/sync'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { ensureSystemRolesForTenant } from '../../../application/security/ensureSystemRoles.js'

const uuidLike = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid UUID')

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: uuidLike.optional(),
  q: z.string().trim().min(1).max(200).optional(),
})

const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(200),
  branchCount: z.coerce.number().int().min(1).max(50).default(1),
  adminEmail: z.string().email().max(200),
  adminPassword: z.string().min(6).max(200),
  primaryDomain: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string()
      .trim()
      .min(3)
      .max(255)
      .optional()
      .transform((v) => (v ? v.toLowerCase() : v)),
  ),
  // Subscription fields
  contactName: z.string().trim().min(2).max(200),
  contactEmail: z.string().email().max(200),
  contactPhone: z.string().trim().min(8).max(20),
  subscriptionMonths: z.coerce.number().int().min(1).max(36).default(12), // 1-36 meses
})

const platformTenantAdminCreateSchema = z.object({
  tenantId: uuidLike,
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

function normalizeCsvHeader(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function pickFirstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const v of values) {
    const s = typeof v === 'string' ? v.trim() : ''
    if (s) return s
  }
  return null
}

function extractContactName(input: string | null): string | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null
  // Some rows look like: "NOMBRE CONTACTO - FARMACIA X" -> keep only before '-'
  const beforeDash = raw.split(/\s*-\s*/)[0]?.trim()
  return beforeDash || raw
}

function extractCustomerNameFromContact(input: string | null): string | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null
  const parts = raw.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) return parts.slice(1).join(' - ')
  return null
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
        for (const module of ['WAREHOUSE', 'SALES', 'LABORATORY'] as const) {
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
          Permissions.SalesDeliveryRead,
          Permissions.SalesDeliveryWrite,
          Permissions.ReportSalesRead,
          Permissions.ReportStockRead,
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

        // Ensure all current system roles exist for this tenant (idempotent).
        // This avoids "missing roles" for newly created tenants until backend restart.
        await ensureSystemRolesForTenant(tx, t.id)

        // Create required roles: Ventas + Logística
        const ventasRole = await tx.role.create({
          data: {
            tenantId: t.id,
            code: 'VENTAS',
            name: 'Ventas',
            isSystem: true,
            createdBy: actor.userId,
          },
          select: { id: true },
        })

        const logisticaRole = await tx.role.create({
          data: {
            tenantId: t.id,
            code: 'LOGISTICA',
            name: 'Logística',
            isSystem: true,
            createdBy: actor.userId,
          },
          select: { id: true },
        })

        const ventasPermissionCodes = [
          Permissions.CatalogRead,
          Permissions.StockRead,
          Permissions.SalesOrderRead,
          Permissions.SalesOrderWrite,
          Permissions.SalesDeliveryRead,
          Permissions.ReportSalesRead,
        ]

        const logisticaPermissionCodes = [
          Permissions.StockRead,
          Permissions.StockMove,
          Permissions.SalesOrderRead,
          Permissions.SalesDeliveryRead,
          Permissions.SalesDeliveryWrite,
          Permissions.ReportStockRead,
        ]

        const ventasPerms = await tx.permission.findMany({
          where: { code: { in: ventasPermissionCodes } },
          select: { id: true },
        })
        for (const p of ventasPerms) {
          await tx.rolePermission.create({ data: { roleId: ventasRole.id, permissionId: p.id } })
        }

        const logisticaPerms = await tx.permission.findMany({
          where: { code: { in: logisticaPermissionCodes } },
          select: { id: true },
        })
        for (const p of logisticaPerms) {
          await tx.rolePermission.create({ data: { roleId: logisticaRole.id, permissionId: p.id } })
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

  // Platform: list users (cross-tenant)
  app.get('/api/v1/platform/users', { preHandler: guard }, async (request, reply) => {
    const parsed = z
      .object({
        take: z.coerce.number().int().min(1).max(50).default(20),
        cursor: uuidLike.optional(),
        q: z.string().trim().min(1).max(200).optional(),
        tenantId: uuidLike.optional(),
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

  // --- Bulk import: Customers (CSV) ---
  app.post(
    '/api/v1/platform/tenants/:tenantId/import/customers',
    { preHandler: guard, bodyLimit: 15 * 1024 * 1024 },
    async (request, reply) => {
      const tenantId = (request.params as any)?.tenantId as string | undefined
      if (!tenantId) return reply.status(400).send({ message: 'Invalid tenantId' })

      const bodySchema = z.object({
        csv: z.string().min(1),
        dryRun: z.coerce.boolean().optional().default(true),
      })

      const parsed = bodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const actor = request.auth!

      const tenant = await db.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true, name: true } })
      if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })

      const schema = {
        entity: 'customers' as const,
        required: ['name'] as const,
        optional: ['nit', 'contactName', 'email', 'phone', 'address', 'city', 'zone', 'mapsUrl', 'businessName'] as const,
        notes: [
          'name se toma de la columna "Nombre" (si está vacía, se intenta derivar del texto después de "-" en "Nombre de contacto").',
          'contactName se toma del texto antes de "-" en "Nombre de contacto".',
          'phone usa "Teléfono 1" o "Teléfono móvil" (primer valor no vacío).',
        ],
      }

      let records: any[]
      try {
        records = parseCsv(parsed.data.csv, {
          columns: true,
          skip_empty_lines: true,
          relax_quotes: true,
          relax_column_count: true,
          trim: true,
          bom: true,
        })
      } catch (e: any) {
        return reply.status(400).send({ message: 'CSV inválido', detail: String(e?.message ?? e) })
      }

      if (!Array.isArray(records) || records.length === 0) {
        return reply.status(400).send({ message: 'CSV vacío o sin filas' })
      }

      const headerMap = new Map<string, string>()
      for (const key of Object.keys(records[0] ?? {})) {
        headerMap.set(normalizeCsvHeader(key), key)
      }

      const keyNit = headerMap.get('nit')
      const keyContact = headerMap.get('nombre de contacto')
      const keyName = headerMap.get('nombre')
      const keyAddress = headerMap.get('direccion')
      const keyEmail = headerMap.get('correo electronico')
      const keyZone = headerMap.get('zona')
      const keyPhone1 = headerMap.get('telefono 1')
      const keyPhoneMobile = headerMap.get('telefono movil')
      const keyCity = headerMap.get('ciudad')
      const keyMaps = headerMap.get('ubicacion')

      const errors: Array<{ row: number; message: string }> = []
      const mapped = records.map((r, idx) => {
        const rowNumber = idx + 2 // header is row 1
        const nitRaw = keyNit ? String(r[keyNit] ?? '').trim() : ''
        const contactRaw = keyContact ? String(r[keyContact] ?? '').trim() : ''
        const nameRaw = keyName ? String(r[keyName] ?? '').trim() : ''

        const nameFromContact = extractCustomerNameFromContact(contactRaw) ?? null
        const name = pickFirstNonEmpty(nameRaw, nameFromContact, contactRaw) // last fallback
        if (!name) errors.push({ row: rowNumber, message: 'Falta nombre (Nombre / Nombre de contacto)' })

        const contactName = extractContactName(contactRaw)
        const phone = pickFirstNonEmpty(
          keyPhone1 ? String(r[keyPhone1] ?? '').trim() : '',
          keyPhoneMobile ? String(r[keyPhoneMobile] ?? '').trim() : '',
        )

        const customer = {
          tenantId: tenant.id,
          name: name ?? '(sin nombre)',
          businessName: null as string | null,
          nit: nitRaw || null,
          contactName,
          email: keyEmail ? (String(r[keyEmail] ?? '').trim() || null) : null,
          phone,
          address: keyAddress ? (String(r[keyAddress] ?? '').trim() || null) : null,
          city: keyCity ? (String(r[keyCity] ?? '').trim() || null) : null,
          zone: keyZone ? (String(r[keyZone] ?? '').trim() || null) : null,
          mapsUrl: keyMaps ? (String(r[keyMaps] ?? '').trim() || null) : null,
          isActive: true,
          createdBy: actor.userId,
        }

        return customer
      })

      // Basic duplicate detection (within the file + against DB)
      const seenNit = new Set<string>()
      const seenName = new Set<string>()
      const deduped: typeof mapped = []
      for (let i = 0; i < mapped.length; i++) {
        const c = mapped[i]!
        const nit = (c.nit ?? '').trim()
        const nameKey = c.name.trim().toLowerCase()
        const dupNit = nit && seenNit.has(nit)
        const dupName = !nit && seenName.has(nameKey)
        if (dupNit || dupName) {
          errors.push({ row: i + 2, message: 'Duplicado en el archivo (NIT o nombre)' })
          continue
        }
        if (nit) seenNit.add(nit)
        seenName.add(nameKey)
        deduped.push(c)
      }

      const nits = deduped.map((d) => d.nit).filter((x): x is string => !!x)
      const names = deduped.map((d) => d.name.trim())

      const existingByNit = nits.length
        ? await db.customer.findMany({ where: { tenantId: tenant.id, nit: { in: nits } }, select: { nit: true } })
        : []
      const existingNitSet = new Set(existingByNit.map((x) => (x.nit ?? '').trim()).filter(Boolean))

      const existingByName = await db.customer.findMany({ where: { tenantId: tenant.id, name: { in: names } }, select: { name: true } })
      const existingNameSet = new Set(existingByName.map((x) => x.name.trim().toLowerCase()))

      const toCreate = deduped.filter((d) => {
        const nit = (d.nit ?? '').trim()
        if (nit && existingNitSet.has(nit)) return false
        if (existingNameSet.has(d.name.trim().toLowerCase())) return false
        return true
      })

      const preview = toCreate.slice(0, 10).map((c) => ({
        name: c.name,
        nit: c.nit,
        contactName: c.contactName,
        phone: c.phone,
        city: c.city,
        zone: c.zone,
        address: c.address,
      }))

      if (parsed.data.dryRun) {
        return reply.send({
          schema,
          tenant: { id: tenant.id, name: tenant.name },
          totalRows: records.length,
          parsedRows: mapped.length,
          candidateRows: deduped.length,
          toCreate: toCreate.length,
          skippedExisting: deduped.length - toCreate.length,
          errors: errors.slice(0, 50),
          preview,
        })
      }

      const created = await db.customer.createMany({
        data: toCreate.map((c) => ({
          tenantId: c.tenantId,
          name: c.name,
          businessName: c.businessName,
          nit: c.nit,
          contactName: c.contactName,
          email: c.email,
          phone: c.phone,
          address: c.address,
          city: c.city,
          zone: c.zone,
          mapsUrl: c.mapsUrl,
          isActive: c.isActive,
          createdBy: c.createdBy,
        })),
      })

      await audit.append({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'platform.import.customers',
        entityType: 'Tenant',
        entityId: tenant.id,
        metadata: { totalRows: records.length, createdCount: created.count, skippedExisting: deduped.length - toCreate.length },
      })

      return reply.send({
        schema,
        tenant: { id: tenant.id, name: tenant.name },
        totalRows: records.length,
        createdCount: created.count,
        skippedExisting: deduped.length - toCreate.length,
        errors: errors.slice(0, 50),
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
