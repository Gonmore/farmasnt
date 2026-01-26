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

  function getHostname(origin: string): string | null {
    try {
      return new URL(origin).hostname
    } catch {
      return null
    }
  }

  function parseConfiguredOrigins(raw: string | undefined): string[] {
    const v = (raw ?? '').trim()
    if (!v) return []
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  function isAllowedOrigin(origin: string): boolean {
    // Always allow default dev origins
    if (origin === 'http://localhost:6001' || origin === 'http://127.0.0.1:6001') return true

    const originHost = getHostname(origin)
    if (!originHost) return false

    const configuredOrigins = parseConfiguredOrigins(env.WEB_ORIGIN)
    for (const configured of configuredOrigins) {
      // Allow exact origin match when possible
      if (configured === origin) return true

      const configuredHost = getHostname(configured)
      // Allow same hostname even if scheme/port differs (common behind reverse proxies)
      if (configuredHost && configuredHost === originHost) return true
    }

    return false
  }

  const io = new Server(app.server, {
    cors: {
      origin: (origin, cb) => {
        // Allow non-browser clients and both localhost/127.0.0.1 for dev
        if (!origin) return cb(null, true)

        return cb(null, isAllowedOrigin(origin))
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
      console.log(`Socket ${socket.id} joined room tenant:${claims.tenantId}`)
      return next()
    } catch (e: any) {
      console.warn('Socket auth failed:', e?.message ?? e)
      return next(new Error('Unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`)
    socket.emit('connected', { ok: true })
  })

  // IMPORTANT: Fastify decorators must be added before app.ready()/listen.
  // The caller is responsible for calling this before app.ready().
  app.decorate('io', io)

  return io
}
