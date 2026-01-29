import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '../../../generated/prisma/client.js'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

async function findDuplicateCustomerByNit(db: ReturnType<typeof prisma>, tenantId: string, nit: string, excludeId?: string) {
  const cleanNit = nit.trim()
  if (!cleanNit) return null

  type Row = { id: string; nit: string | null }
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.id, c.nit
    FROM "Customer" c
    WHERE c."tenantId" = ${tenantId}
      AND (${excludeId ? Prisma.sql`c.id <> ${excludeId}` : Prisma.sql`TRUE`})
      AND lower(regexp_replace(coalesce(c.nit, ''), '[^0-9a-zA-Z]+', '', 'g')) =
          lower(regexp_replace(${cleanNit}, '[^0-9a-zA-Z]+', '', 'g'))
    LIMIT 1
  `)
  return rows?.[0] ?? null
}

async function findDuplicateCustomerByName(db: ReturnType<typeof prisma>, tenantId: string, name: string, excludeId?: string) {
  const cleanName = name.trim()
  if (!cleanName) return null

  type Row = { id: string; name: string }
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.id, c.name
    FROM "Customer" c
    WHERE c."tenantId" = ${tenantId}
      AND (${excludeId ? Prisma.sql`c.id <> ${excludeId}` : Prisma.sql`TRUE`})
      AND lower(regexp_replace(trim(c.name), '\\s+', ' ', 'g')) =
          lower(regexp_replace(trim(${cleanName}), '\\s+', ' ', 'g'))
    LIMIT 1
  `)
  return rows?.[0] ?? null
}

function resolveCustomerCredit(input: {
  creditEnabled?: boolean | undefined
  creditDays?: number | null | undefined
  creditDays7Enabled?: boolean | undefined
  creditDays14Enabled?: boolean | undefined
}): {
  creditEnabled: boolean
  creditDays: number | null
  // legacy
  creditDays7Enabled: boolean
  creditDays14Enabled: boolean
} {
  const legacyEnabled = !!input.creditDays14Enabled || !!input.creditDays7Enabled
  const enabled = typeof input.creditEnabled === 'boolean' ? input.creditEnabled : legacyEnabled

  const legacyDays = input.creditDays14Enabled ? 14 : input.creditDays7Enabled ? 7 : null
  const daysRaw = input.creditDays !== undefined ? input.creditDays : legacyDays
  const days = daysRaw === null || daysRaw === undefined ? null : Number(daysRaw)

  if (enabled) {
    if (!Number.isFinite(days) || (days as number) <= 0) {
      const err = new Error('creditDays es requerido cuando el crédito está habilitado') as Error & { statusCode?: number }
      err.statusCode = 400
      throw err
    }
    return {
      creditEnabled: true,
      creditDays: Math.trunc(days as number),
      creditDays7Enabled: Math.trunc(days as number) === 7,
      creditDays14Enabled: Math.trunc(days as number) === 14,
    }
  }

  return { creditEnabled: false, creditDays: null, creditDays7Enabled: false, creditDays14Enabled: false }
}

const customerCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  businessName: z.string().trim().max(200).optional(),
  nit: z.string().trim().max(40).optional(),
  contactName: z.string().trim().max(200).optional(),
  contactBirthDay: z.number().int().min(1).max(31).optional(),
  contactBirthMonth: z.number().int().min(1).max(12).optional(),
  contactBirthYear: z.number().int().min(1900).max(2100).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  zone: z.string().trim().min(1).max(120).optional(),
  mapsUrl: z.string().trim().url().max(500).optional(),
  // Legacy flags
  creditDays7Enabled: z.boolean().optional(),
  creditDays14Enabled: z.boolean().optional(),
  // New flexible credit configuration
  creditEnabled: z.boolean().optional(),
  creditDays: z.coerce.number().int().min(1).max(365).optional(),
})

const customerUpdateSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  businessName: z.string().trim().max(200).nullable().optional(),
  nit: z.string().trim().max(40).nullable().optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactBirthDay: z.number().int().min(1).max(31).nullable().optional(),
  contactBirthMonth: z.number().int().min(1).max(12).nullable().optional(),
  contactBirthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
  city: z.string().trim().min(1).max(120).nullable().optional(),
  zone: z.string().trim().min(1).max(120).nullable().optional(),
  mapsUrl: z.string().trim().url().max(500).nullable().optional(),
  // Legacy flags
  creditDays7Enabled: z.boolean().optional(),
  creditDays14Enabled: z.boolean().optional(),
  // New flexible credit configuration
  creditEnabled: z.boolean().optional(),
  creditDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
})

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cities: z.string().optional(),
})

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)

  function branchCityOf(request: any): string | null {
    if (request.auth?.isTenantAdmin) return null
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    const city = String(request.auth?.warehouseCity ?? '').trim()
    return city ? city.toUpperCase() : '__MISSING__'
  }

  // Cities that have at least one active branch (warehouse)
  // Used by Sales/Customers UI to restrict customer.city values
  app.get(
    '/api/v1/customers/branch-cities',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderRead)],
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId

      const rows = await db.warehouse.findMany({
        where: {
          tenantId,
          isActive: true,
          city: { not: null },
        },
        distinct: ['city'],
        select: { city: true },
      })

      const items = Array.from(
        new Set(
          rows
            .map((r) => (r.city ?? '').trim())
            .filter((c) => c.length > 0)
            .map((c) => c.toUpperCase()),
        ),
      ).sort((a, b) => a.localeCompare(b))

      return reply.send({ items })
    },
  )

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
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      if (branchCity) {
        const city = (parsed.data.city ?? '').trim().toUpperCase()
        if (!city || city !== branchCity) {
          return reply.status(403).send({ message: 'Solo puede crear clientes para su sucursal' })
        }
      }

      // Prevent duplicates (tenant-scoped)
      if (parsed.data.nit) {
        const dupNit = await findDuplicateCustomerByNit(db, tenantId, parsed.data.nit)
        if (dupNit) return reply.status(409).send({ message: 'Cliente duplicado: ya existe un cliente con el mismo NIT.' })
      }
      const dupName = await findDuplicateCustomerByName(db, tenantId, parsed.data.name)
      if (dupName) return reply.status(409).send({ message: 'Cliente duplicado: ya existe un cliente con el mismo nombre.' })

      let credit: ReturnType<typeof resolveCustomerCredit>
      try {
        credit = resolveCustomerCredit(parsed.data)
      } catch (e: any) {
        if (e?.statusCode) return reply.status(e.statusCode).send({ message: e.message })
        throw e
      }

      const created = await db.customer.create({
        data: {
          tenantId,
          name: parsed.data.name,
          businessName: parsed.data.businessName ?? null,
          nit: parsed.data.nit ?? null,
          contactName: parsed.data.contactName ?? null,
          contactBirthDay: parsed.data.contactBirthDay ?? null,
          contactBirthMonth: parsed.data.contactBirthMonth ?? null,
          contactBirthYear: parsed.data.contactBirthYear ?? null,
          email: parsed.data.email ?? null,
          phone: parsed.data.phone ?? null,
          address: parsed.data.address ?? null,
          city: parsed.data.city ? parsed.data.city.toUpperCase() : null,
          zone: parsed.data.zone ? parsed.data.zone.toUpperCase() : null,
          mapsUrl: parsed.data.mapsUrl ?? null,
          creditEnabled: credit.creditEnabled,
          creditDays: credit.creditDays,
          creditDays7Enabled: credit.creditDays7Enabled,
          creditDays14Enabled: credit.creditDays14Enabled,
          createdBy: userId,
        },
        select: {
          id: true,
          name: true,
          businessName: true,
          nit: true,
          contactName: true,
          contactBirthDay: true,
          contactBirthMonth: true,
          contactBirthYear: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          zone: true,
          mapsUrl: true,
          isActive: true,
          creditEnabled: true,
          creditDays: true,
          creditDays7Enabled: true,
          creditDays14Enabled: true,
          version: true,
          createdAt: true,
        },
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
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }
      const q = parsed.data.q
      const cities = parsed.data.cities ? parsed.data.cities.split(',').map((c) => c.trim()).filter((c) => c.length > 0) : undefined

      const items = await db.customer.findMany({
        where: {
          tenantId,
          ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
          ...(branchCity
            ? { city: { equals: branchCity, mode: 'insensitive' as const } }
            : cities && cities.length > 0
              ? {
                  OR: cities.map((city) => ({
                    city: { equals: city.toUpperCase(), mode: 'insensitive' as const },
                  })),
                }
              : {}),
        },
        take: parsed.data.take,
        ...(parsed.data.cursor
          ? {
              skip: 1,
              cursor: { id: parsed.data.cursor },
            }
          : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          nit: true,
          email: true,
          phone: true,
          isActive: true,
          city: true,
          zone: true,
          mapsUrl: true,
          creditEnabled: true,
          creditDays: true,
          creditDays7Enabled: true,
          creditDays14Enabled: true,
          version: true,
          updatedAt: true,
        },
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
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const customer = await db.customer.findFirst({
        where: {
          id,
          tenantId,
          ...(branchCity ? { city: { equals: branchCity, mode: 'insensitive' as const } } : {}),
        },
        select: {
          id: true,
          name: true,
          businessName: true,
          nit: true,
          contactName: true,
          contactBirthDay: true,
          contactBirthMonth: true,
          contactBirthYear: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          zone: true,
          mapsUrl: true,
          isActive: true,
          creditEnabled: true,
          creditDays: true,
          creditDays7Enabled: true,
          creditDays14Enabled: true,
          version: true,
          updatedAt: true,
        },
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
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const before = await db.customer.findFirst({
        where: {
          id,
          tenantId,
          ...(branchCity ? { city: { equals: branchCity, mode: 'insensitive' as const } } : {}),
        },
        select: {
          id: true,
          name: true,
          businessName: true,
          nit: true,
          contactName: true,
          contactBirthDay: true,
          contactBirthMonth: true,
          contactBirthYear: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          zone: true,
          mapsUrl: true,
          isActive: true,
          creditEnabled: true,
          creditDays: true,
          creditDays7Enabled: true,
          creditDays14Enabled: true,
          version: true,
        },
      })
      if (!before) return reply.status(404).send({ message: 'Not found' })
      if (before.version !== parsed.data.version) return reply.status(409).send({ message: 'Version conflict' })

      if (branchCity && parsed.data.city !== undefined) {
        const nextCity = parsed.data.city ? String(parsed.data.city).trim().toUpperCase() : ''
        if (!nextCity || nextCity !== branchCity) {
          return reply.status(403).send({ message: 'No puede cambiar el cliente a otra sucursal' })
        }
      }

      // Prevent duplicates when changing identifying fields
      if (parsed.data.nit !== undefined && parsed.data.nit !== null) {
        const dupNit = await findDuplicateCustomerByNit(db, tenantId, parsed.data.nit, id)
        if (dupNit) return reply.status(409).send({ message: 'Cliente duplicado: ya existe otro cliente con el mismo NIT.' })
      }
      if (parsed.data.name !== undefined) {
        const dupName = await findDuplicateCustomerByName(db, tenantId, parsed.data.name, id)
        if (dupName) return reply.status(409).send({ message: 'Cliente duplicado: ya existe otro cliente con el mismo nombre.' })
      }

      const updateData: any = {
        version: { increment: 1 },
        createdBy: userId,
      }
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name
      if (parsed.data.businessName !== undefined) updateData.businessName = parsed.data.businessName
      if (parsed.data.nit !== undefined) updateData.nit = parsed.data.nit
      if (parsed.data.contactName !== undefined) updateData.contactName = parsed.data.contactName
      if (parsed.data.contactBirthDay !== undefined) updateData.contactBirthDay = parsed.data.contactBirthDay
      if (parsed.data.contactBirthMonth !== undefined) updateData.contactBirthMonth = parsed.data.contactBirthMonth
      if (parsed.data.contactBirthYear !== undefined) updateData.contactBirthYear = parsed.data.contactBirthYear
      if (parsed.data.email !== undefined) updateData.email = parsed.data.email
      if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone
      if (parsed.data.address !== undefined) updateData.address = parsed.data.address
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive
      if (parsed.data.city !== undefined) updateData.city = parsed.data.city ? parsed.data.city.toUpperCase() : null
      if (parsed.data.zone !== undefined) updateData.zone = parsed.data.zone ? parsed.data.zone.toUpperCase() : null
      if (parsed.data.mapsUrl !== undefined) updateData.mapsUrl = parsed.data.mapsUrl

      const hasAnyCreditField =
        parsed.data.creditEnabled !== undefined ||
        parsed.data.creditDays !== undefined ||
        parsed.data.creditDays7Enabled !== undefined ||
        parsed.data.creditDays14Enabled !== undefined

      if (hasAnyCreditField) {
        let credit: ReturnType<typeof resolveCustomerCredit>
        try {
          credit = resolveCustomerCredit({
            creditEnabled: parsed.data.creditEnabled ?? before.creditEnabled,
            creditDays: parsed.data.creditDays !== undefined ? parsed.data.creditDays : before.creditDays,
            creditDays7Enabled: parsed.data.creditDays7Enabled ?? before.creditDays7Enabled,
            creditDays14Enabled: parsed.data.creditDays14Enabled ?? before.creditDays14Enabled,
          })
        } catch (e: any) {
          if (e?.statusCode) return reply.status(e.statusCode).send({ message: e.message })
          throw e
        }

        updateData.creditEnabled = credit.creditEnabled
        updateData.creditDays = credit.creditDays
        updateData.creditDays7Enabled = credit.creditDays7Enabled
        updateData.creditDays14Enabled = credit.creditDays14Enabled
      }

      const updated = await db.customer.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          name: true,
          businessName: true,
          nit: true,
          contactName: true,
          contactBirthDay: true,
          contactBirthMonth: true,
          contactBirthYear: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          zone: true,
          mapsUrl: true,
          isActive: true,
          creditEnabled: true,
          creditDays: true,
          creditDays7Enabled: true,
          creditDays14Enabled: true,
          version: true,
          updatedAt: true,
        },
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
