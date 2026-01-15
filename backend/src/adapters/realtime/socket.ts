import { Server } from 'socket.io'
import type { FastifyInstance } from 'fastify'
import { getEnv } from '../../shared/env.js'
import { verifyAccessToken } from '../../application/auth/tokenService.js'

declare module 'fastify' {
  interface FastifyInstance {
    io?: Server
  }
}

export function attachSocketIo(app: FastifyInstance): Server {
  const env = getEnv()

  const io = new Server(app.server, {
    cors: {
      origin: (origin, cb) => {
        // Allow non-browser clients and both localhost/127.0.0.1 for dev
        if (!origin) return cb(null, true)

        const configured = (env.WEB_ORIGIN ?? '').trim()
        const variants = new Set<string>()

        variants.add('http://localhost:6001')
        variants.add('http://127.0.0.1:6001')

        if (configured) {
          variants.add(configured)
          variants.add(configured.replace('localhost', '127.0.0.1'))
          variants.add(configured.replace('127.0.0.1', 'localhost'))
          // Also allow HTTP version if configured origin is HTTPS (for mixed content scenarios)
          if (configured.startsWith('https://')) {
            variants.add(configured.replace('https://', 'http://'))
          }
          // Also allow HTTPS version if configured origin is HTTP
          if (configured.startsWith('http://')) {
            variants.add(configured.replace('http://', 'https://'))
          }
        }

        return cb(null, variants.has(origin))
      },
      credentials: true,
    },
  })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (typeof token !== 'string' || token.length < 10) return next(new Error('Unauthorized'))
      const claims = await verifyAccessToken(token, env.JWT_ACCESS_SECRET)
      ;(socket.data as any).tenantId = claims.tenantId
      ;(socket.data as any).userId = claims.sub
      // Rooms per tenant (and later per warehouse)
      socket.join(`tenant:${claims.tenantId}`)
      return next()
    } catch {
      return next(new Error('Unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    socket.emit('connected', { ok: true })
  })

  // IMPORTANT: Fastify decorators must be added before app.ready()/listen.
  // The caller is responsible for calling this before app.ready().
  app.decorate('io', io)

  return io
}
