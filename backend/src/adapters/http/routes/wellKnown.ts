import type { FastifyInstance } from 'fastify'
import { prisma } from '../../db/prisma.js'

function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!v) return null
  const first = v.split(',')[0]?.trim() ?? ''
  return first.replace(/:\d+$/, '')
}

export async function registerWellKnownRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()

  // Used to verify that a custom domain is pointing to this deployment.
  // Returns the verification token for the requesting Host.
  app.get('/.well-known/pharmaflow-domain-verification', async (request, reply) => {
    const host = normalizeHost(request.headers['x-forwarded-host']) ?? normalizeHost(request.headers.host)
    if (!host) return reply.status(404).send('not-found')

    let row: { verificationToken: string | null } | null = null
    try {
      row = await db.tenantDomain.findFirst({
        where: {
          domain: host,
          tenant: { isActive: true },
          verifiedAt: null,
          verificationToken: { not: null },
          OR: [{ verificationTokenExpiresAt: null }, { verificationTokenExpiresAt: { gt: new Date() } }],
        },
        select: { verificationToken: true },
      })
    } catch (e: any) {
      if (e?.code !== 'P2021') throw e
      return reply.status(404).send('not-found')
    }

    if (!row?.verificationToken) return reply.status(404).send('not-found')

    reply.header('content-type', 'text/plain; charset=utf-8')
    return reply.send(row.verificationToken)
  })
}
