import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { geoService } from '../../../application/geo/geoService.js'
import { requireAuth, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'

const searchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  take: z.coerce.number().int().min(1).max(50).default(20),
})

const countryCodeQuerySchema = z.object({
  countryCode: z.string().trim().min(2).max(2).toUpperCase(),
})

const adminLevel1QuerySchema = z.object({
  countryCode: z.string().trim().min(2).max(2).toUpperCase(),
  q: z.string().trim().max(100).optional(),
  take: z.coerce.number().int().min(1).max(50).default(50),
})

const citiesQuerySchema = z.object({
  countryCode: z.string().trim().min(2).max(2).toUpperCase(),
  adminLevel1Code: z.string().trim().max(10).optional(),
  q: z.string().trim().max(100).optional(),
  take: z.coerce.number().int().min(1).max(50).default(50),
})

const reverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})

const countryParamSchema = z.object({
  code: z.string().trim().min(2).max(2).toUpperCase(),
})

const resolveDepartmentQuerySchema = z.object({
  city: z.string().trim().min(1).max(120),
  countryCode: z.string().trim().min(2).max(2).toUpperCase().optional(),
})

export async function registerGeoRoutes(app: FastifyInstance): Promise<void> {
  const tenantId = 'default'

  app.get(
    '/api/v1/geo/countries',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const parsed = searchQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const results = await geoService.searchCountries(parsed.data.q ?? '', tenantId)
      return reply.send({ items: results.slice(0, parsed.data.take) })
    },
  )

  app.get(
    '/api/v1/geo/countries/:code',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const params = countryParamSchema.safeParse(request.params)
      if (!params.success) return reply.status(400).send({ message: 'Invalid params', issues: params.error.issues })

      const country = await geoService.getCountryByCode(params.data.code, tenantId)
      if (!country) return reply.status(404).send({ message: 'Country not found' })
      return reply.send(country)
    },
  )

  app.get(
    '/api/v1/geo/admin-level1',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const parsed = adminLevel1QuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const results = await geoService.searchAdminLevel1(
        parsed.data.countryCode,
        parsed.data.q ?? '',
        tenantId,
      )
      return reply.send({ items: results.slice(0, parsed.data.take) })
    },
  )

  app.get(
    '/api/v1/geo/cities',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const parsed = citiesQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const results = await geoService.searchCities(
        parsed.data.countryCode,
        parsed.data.q ?? '',
        parsed.data.adminLevel1Code,
        tenantId,
      )
      return reply.send({ items: results.slice(0, parsed.data.take) })
    },
  )

  app.get(
    '/api/v1/geo/reverse',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const parsed = reverseQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const result = await geoService.reverseGeocode(parsed.data.lat, parsed.data.lng, tenantId)
      if (!result) return reply.status(404).send({ message: 'No address found for coordinates' })
      return reply.send(result)
    },
  )

  app.get(
    '/api/v1/geo/currency/:code',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const params = countryParamSchema.safeParse(request.params)
      if (!params.success) return reply.status(400).send({ message: 'Invalid params', issues: params.error.issues })

      const currency = await geoService.getCurrencyByCountry(params.data.code)
      return reply.send({ currency })
    },
  )

  app.get(
    '/api/v1/geo/resolve-department',
    {
      preHandler: [requireAuth(), requirePermission(Permissions.CatalogRead)],
    },
    async (request, reply) => {
      const parsed = resolveDepartmentQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const department = await geoService.resolveDepartmentForCity(parsed.data.city, parsed.data.countryCode)
      return reply.send({ department: department ?? null })
    },
  )
}
