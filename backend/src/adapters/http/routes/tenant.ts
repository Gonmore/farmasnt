import type { FastifyInstance } from 'fastify'
import { prisma } from '../../db/prisma.js'
import { requireAuth } from '../../../application/security/rbac.js'

function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!v) return null
  const first = v.split(',')[0]?.trim() ?? ''
  return first.replace(/:\d+$/, '')
}

export async function registerTenantRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()

  app.get(
    '/api/v1/public/tenant/branding',
    {
      schema: {
        tags: ['Tenant'],
        summary: 'Get tenant branding (logo/colors/theme) for the current host (no auth)',
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
            },
            required: ['tenantId', 'tenantName', 'defaultTheme'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request) => {
      const host =
        normalizeHost(request.headers['x-forwarded-host']) ??
        normalizeHost(request.headers.host) ??
        normalizeHost((request as any).hostname)

      let tenantId: string | null = null
      if (host) {
        try {
          const domainRow = await db.tenantDomain.findFirst({
            where: { domain: host, verifiedAt: { not: null }, tenant: { isActive: true } },
            select: { tenantId: true },
          })
          tenantId = domainRow?.tenantId ?? null
        } catch (e: any) {
          // Prisma P2021: table does not exist
          if (e?.code !== 'P2021') throw e
          tenantId = null
        }
      }

      if (!tenantId) {
        // If no host-based tenant can be resolved, fall back only when there's a single active tenant.
        const candidates = await db.tenant.findMany({ where: { isActive: true }, select: { id: true }, take: 2 })
        if (candidates.length === 1) tenantId = candidates[0]!.id
      }

      if (!tenantId) {
        const err = new Error('Tenant not found for host') as Error & { statusCode?: number }
        err.statusCode = 404
        throw err
      }

      const tenant = await db.tenant.findFirst({
        where: { id: tenantId, isActive: true },
        select: {
          id: true,
          name: true,
          logoUrl: true,
          brandPrimary: true,
          brandSecondary: true,
          brandTertiary: true,
          defaultTheme: true,
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
      }
    },
  )

  app.get(
    '/api/v1/tenant/branding',
    {
      preHandler: [requireAuth()],
      schema: {
        tags: ['Tenant'],
        summary: 'Get tenant branding (logo/colors/theme)',
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
            },
            required: ['tenantId', 'tenantName', 'defaultTheme'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request) => {
      const tenantId = request.auth!.tenantId

      const tenant = await db.tenant.findFirst({
        where: { id: tenantId, isActive: true },
        select: {
          id: true,
          name: true,
          logoUrl: true,
          brandPrimary: true,
          brandSecondary: true,
          brandTertiary: true,
          defaultTheme: true,
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
      }
    },
  )

  // PATCH /api/v1/tenant/branding - Actualizar branding del tenant
  app.patch(
    '/api/v1/tenant/branding',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const actor = request.auth!
      const { logoUrl, brandPrimary, brandSecondary, brandTertiary, defaultTheme } = request.body as any

      // Validar que al menos un campo esté presente
      if (!logoUrl && !brandPrimary && !brandSecondary && !brandTertiary && !defaultTheme) {
        return reply.status(400).send({ message: 'At least one field must be provided' })
      }

      // Validar defaultTheme si está presente
      if (defaultTheme && !['LIGHT', 'DARK'].includes(defaultTheme)) {
        return reply.status(400).send({ message: 'defaultTheme must be LIGHT or DARK' })
      }

      const updateData: any = {}
      if (logoUrl !== undefined) updateData.logoUrl = logoUrl
      if (brandPrimary !== undefined) updateData.brandPrimary = brandPrimary
      if (brandSecondary !== undefined) updateData.brandSecondary = brandSecondary
      if (brandTertiary !== undefined) updateData.brandTertiary = brandTertiary
      if (defaultTheme !== undefined) updateData.defaultTheme = defaultTheme

      const tenant = await db.tenant.update({
        where: { id: actor.tenantId },
        data: updateData,
        select: {
          id: true,
          name: true,
          logoUrl: true,
          brandPrimary: true,
          brandSecondary: true,
          brandTertiary: true,
          defaultTheme: true,
        },
      })

      return reply.send({
        tenantId: tenant.id,
        tenantName: tenant.name,
        logoUrl: tenant.logoUrl,
        brandPrimary: tenant.brandPrimary,
        brandSecondary: tenant.brandSecondary,
        brandTertiary: tenant.brandTertiary,
        defaultTheme: tenant.defaultTheme,
      })
    },
  )

  // GET /api/v1/tenant/subscription - Ver información de suscripción propia
  app.get(
    '/api/v1/tenant/subscription',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const actor = request.auth!

      const tenant = await db.tenant.findUnique({
        where: { id: actor.tenantId },
        select: {
          id: true,
          name: true,
          branchLimit: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          subscriptionExpiresAt: true,
          _count: {
            select: { users: { where: { isActive: true } } },
          },
        },
      })

      if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })

      // Calcular estado de suscripción
      const now = new Date()
      const expiresAt = tenant.subscriptionExpiresAt
      let status: 'active' | 'expiring_soon' | 'expired' = 'active'
      let daysRemaining: number | null = null

      if (expiresAt) {
        const diff = expiresAt.getTime() - now.getTime()
        daysRemaining = Math.ceil(diff / (1000 * 60 * 60 * 24))
        
        if (daysRemaining < 0) status = 'expired'
        else if (daysRemaining <= 90) status = 'expiring_soon'
      }

      return reply.send({
        id: tenant.id,
        name: tenant.name,
        branchLimit: tenant.branchLimit,
        activeBranches: tenant._count.users, // Simplificado - podría ser conteo de warehouses
        contactName: tenant.contactName,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        subscriptionExpiresAt: expiresAt,
        status,
        daysRemaining,
      })
    },
  )

  // POST /api/v1/tenant/subscription/request-extension - Solicitar extensión
  app.post(
    '/api/v1/tenant/subscription/request-extension',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const actor = request.auth!
      const { branchLimit, subscriptionMonths } = request.body as any

      if (!branchLimit || !subscriptionMonths) {
        return reply.status(400).send({ message: 'branchLimit and subscriptionMonths are required' })
      }

      const tenant = await db.tenant.findUnique({
        where: { id: actor.tenantId },
        select: {
          id: true,
          name: true,
          branchLimit: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          subscriptionExpiresAt: true,
        },
      })

      if (!tenant) return reply.status(404).send({ message: 'Tenant not found' })

      // Determinar acción: mantener, aumentar o reducir
      let action: string
      if (branchLimit > tenant.branchLimit) action = 'aumentar'
      else if (branchLimit < tenant.branchLimit) action = 'reducir'
      else action = 'mantener'

      // Generar mensaje para WhatsApp y Email
      const message = `
🔔 Solicitud de Extensión de Suscripción

📦 Tenant: ${tenant.name}
📧 Contacto: ${tenant.contactName} (${tenant.contactEmail})
📱 Teléfono: ${tenant.contactPhone}

📊 Sucursales actuales: ${tenant.branchLimit}
📊 Sucursales solicitadas: ${branchLimit} (${action})
📅 Tiempo de extensión: ${subscriptionMonths} meses
📅 Vence actualmente: ${tenant.subscriptionExpiresAt ? new Date(tenant.subscriptionExpiresAt).toLocaleDateString() : 'Sin fecha'}

Por favor revisar y aprobar esta solicitud.
      `.trim()

      // TODO: En producción, enviar email y WhatsApp al Platform Admin
      // Por ahora solo retornamos el mensaje preview

      return reply.send({
        message: 'Extension request created successfully',
        preview: {
          to: 'admin@supernovatel.com',
          subject: `Solicitud de Extensión - ${tenant.name}`,
          body: message,
        },
      })
    },
  )
}

