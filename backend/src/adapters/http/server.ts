import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { getEnv } from '../../shared/env.js'
import { prisma } from '../db/prisma.js'
import { verifyAccessToken } from '../../application/auth/tokenService.js'
import { loadUserPermissions } from '../../application/security/rbac.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCatalogRoutes } from './routes/catalog.js'
import { registerProductRoutes } from './routes/products.js'
import { registerStockRoutes } from './routes/stock.js'
import { registerWarehouseRoutes } from './routes/warehouses.js'
import { registerCustomerRoutes } from './routes/customers.js'
import { registerSalesOrderRoutes } from './routes/salesOrders.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerAuditRoutes } from './routes/audit.js'
import { registerReportRoutes } from './routes/reports.js'
import { registerTenantRoutes } from './routes/tenant.js'
import { registerPlatformRoutes } from './routes/platform.js'
import { registerWellKnownRoutes } from './routes/wellKnown.js'

export async function createHttpServer() {
  const env = getEnv()
  const db = prisma()

  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        remove: true,
      },
    },
  })

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow non-browser tools (no Origin) and both localhost/127.0.0.1
      if (!origin) return cb(null, true)

      const configured = (env.WEB_ORIGIN ?? '').trim()
      const variants = new Set<string>()

      // Always allow the default dev frontend origins
      variants.add('http://localhost:6001')
      variants.add('http://127.0.0.1:6001')

      if (configured) {
        variants.add(configured)
        variants.add(configured.replace('localhost', '127.0.0.1'))
        variants.add(configured.replace('127.0.0.1', 'localhost'))
      }

      return cb(null, variants.has(origin))
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
  })

  // OpenAPI / Contracts
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'PharmaFlow Bolivia API',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${env.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/api/v1/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  })

  app.get('/api/v1/openapi.json', async () => {
    // Provided by @fastify/swagger once registered
    return (app as any).swagger()
  })

  // Auth hook: attach request.auth if access token is present
  app.addHook('preHandler', async (request) => {
    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) return

    const token = authHeader.slice('Bearer '.length)
    const claims = await verifyAccessToken(token, env.JWT_ACCESS_SECRET)

    const user = await db.user.findFirst({
      where: { id: claims.sub, tenantId: claims.tenantId, isActive: true, tenant: { isActive: true } },
      select: { id: true, tenantId: true },
    })

    if (!user) return

    const permissions = await loadUserPermissions(db, user.id)
    request.auth = { userId: user.id, tenantId: user.tenantId, permissions }
  })

  app.setErrorHandler((error, _request, reply) => {
    const err = error as any
    const statusCode = err?.statusCode
    const code = typeof statusCode === 'number' ? statusCode : 500
    if (code >= 500) app.log.error({ err }, 'Unhandled error')
    return reply.status(code).send({ message: code === 500 ? 'Internal server error' : (err?.message ?? 'Error') })
  })

  await registerHealthRoutes(app)
  await registerAuthRoutes(app)
  await registerCatalogRoutes(app)
  await registerProductRoutes(app)
  await registerStockRoutes(app)
  await registerWarehouseRoutes(app)
  await registerCustomerRoutes(app)
  await registerSalesOrderRoutes(app)
  await registerWellKnownRoutes(app)
  await registerAdminRoutes(app)
  await registerAuditRoutes(app)
  await registerReportRoutes(app)
  await registerTenantRoutes(app)
  await registerPlatformRoutes(app)

  return app
}
