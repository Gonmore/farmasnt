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
}
