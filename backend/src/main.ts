import 'dotenv/config'
import { getEnv } from './shared/env.js'
import { prisma } from './adapters/db/prisma.js'
import { ensureAuditTrailImmutability } from './adapters/db/ensureAuditImmutability.js'
import { ensureSystemRoles } from './application/security/ensureSystemRoles.js'
import { createHttpServer } from './adapters/http/server.js'
import { attachSocketIo } from './adapters/realtime/socket.js'
import { startReportScheduler } from './application/reports/reportScheduler.js'

async function main() {
  const env = getEnv()
  const db = prisma()

  const app = await createHttpServer()

  // Attach Socket.io before Fastify starts
  attachSocketIo(app)

  await app.ready()

  // Ensure audit trail is append-only (after migrations create the table)
  try {
    await ensureAuditTrailImmutability(db)
  } catch {
    // Ignore until DB is migrated
  }

  // Ensure default system roles exist for every tenant
  try {
    await ensureSystemRoles(db)
  } catch {
    // Ignore until DB is migrated
  }

  // Scheduled report emails (best-effort; requires DB + SMTP configured)
  try {
    startReportScheduler(db)
  } catch {
    // Ignore until DB is migrated / configured
  }

  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`Backend listening on http://localhost:${env.PORT}`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
