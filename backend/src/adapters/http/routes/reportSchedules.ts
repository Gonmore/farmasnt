import type { FastifyInstance } from 'fastify'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { requireStockReportOrBranchAccess } from './reportsShared.js'
import { computeNextRunAt } from '../../../application/reports/reportScheduler.js'
import {
  reportScheduleBodySchema,
  reportSchedulePatchBodySchema,
  reportScheduleSelect,
  reportScheduleItemSelect,
} from './reportsShared.js'

type ReportType = 'SALES' | 'STOCK'

interface ReportScheduleConfig {
  type: ReportType
  moduleCode: 'SALES' | 'WAREHOUSE'
  requireAccess: () => any[]
}

export async function registerReportScheduleRoutes(
  app: FastifyInstance,
  opts: { segment: 'sales' | 'stock' },
): Promise<void> {
  const db = prisma()
  const config: ReportScheduleConfig =
    opts.segment === 'sales'
      ? {
          type: 'SALES',
          moduleCode: 'SALES',
          requireAccess: () => [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.ReportSalesRead)],
        }
      : {
          type: 'STOCK',
          moduleCode: 'WAREHOUSE',
          requireAccess: () => [requireAuth(), requireModuleEnabled(db, 'WAREHOUSE'), requireStockReportOrBranchAccess()],
        }

  const baseRoute = `/api/v1/reports/${opts.segment}/schedules`

  app.get(
    baseRoute,
    { preHandler: config.requireAccess() },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId
      const items = await db.reportSchedule.findMany({
        where: { tenantId, type: config.type },
        orderBy: [{ createdAt: 'desc' }],
        select: reportScheduleSelect,
      })
      return reply.send({ items })
    },
  )

  app.post(
    baseRoute,
    { preHandler: config.requireAccess() },
    async (request, reply) => {
      const parsed = reportScheduleBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid body', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const now = new Date()
      const nextRunAt = computeNextRunAt({
        now,
        frequency: parsed.data.frequency,
        hour: parsed.data.hour,
        minute: parsed.data.minute,
        dayOfWeek: parsed.data.dayOfWeek ?? null,
        dayOfMonth: parsed.data.dayOfMonth ?? null,
      })

      const item = await db.reportSchedule.create({
        data: {
          tenantId,
          type: config.type,
          reportKey: parsed.data.reportKey,
          params: { status: parsed.data.status ?? null },
          frequency: parsed.data.frequency,
          hour: parsed.data.hour,
          minute: parsed.data.minute,
          dayOfWeek: parsed.data.dayOfWeek ?? null,
          dayOfMonth: parsed.data.dayOfMonth ?? null,
          recipients: parsed.data.recipients,
          enabled: parsed.data.enabled,
          nextRunAt,
          createdBy: userId,
        },
        select: reportScheduleItemSelect,
      })

      return reply.send({ item })
    },
  )

  app.patch(
    `${baseRoute}/:id`,
    { preHandler: config.requireAccess() },
    async (request, reply) => {
      const id = String((request.params as any)?.id ?? '')
      const parsed = reportSchedulePatchBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid body', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const now = new Date()

      const existing = await db.reportSchedule.findFirst({ where: { id, tenantId, type: config.type } })
      if (!existing) return reply.status(404).send({ message: 'Not found' })

      const nextRunAt =
        parsed.data.frequency || parsed.data.hour !== undefined || parsed.data.minute !== undefined || parsed.data.dayOfWeek !== undefined || parsed.data.dayOfMonth !== undefined
          ? computeNextRunAt({
              now,
              frequency: (parsed.data.frequency ?? existing.frequency) as any,
              hour: parsed.data.hour ?? existing.hour,
              minute: parsed.data.minute ?? existing.minute,
              dayOfWeek: parsed.data.dayOfWeek ?? existing.dayOfWeek,
              dayOfMonth: parsed.data.dayOfMonth ?? existing.dayOfMonth,
            })
          : existing.nextRunAt

      const updated = await db.reportSchedule.update({
        where: { id },
        data: {
          ...(parsed.data.reportKey !== undefined ? { reportKey: parsed.data.reportKey } : {}),
          ...(parsed.data.frequency !== undefined ? { frequency: parsed.data.frequency as any } : {}),
          ...(parsed.data.hour !== undefined ? { hour: parsed.data.hour } : {}),
          ...(parsed.data.minute !== undefined ? { minute: parsed.data.minute } : {}),
          ...(parsed.data.dayOfWeek !== undefined ? { dayOfWeek: parsed.data.dayOfWeek } : {}),
          ...(parsed.data.dayOfMonth !== undefined ? { dayOfMonth: parsed.data.dayOfMonth } : {}),
          ...(parsed.data.recipients !== undefined ? { recipients: parsed.data.recipients } : {}),
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          ...(parsed.data.status !== undefined ? { params: { status: parsed.data.status } } : {}),
          nextRunAt,
          version: { increment: 1 },
        },
        select: {
          id: true,
          reportKey: true,
          frequency: true,
          hour: true,
          minute: true,
          dayOfWeek: true,
          dayOfMonth: true,
          recipients: true,
          enabled: true,
          nextRunAt: true,
          lastRunAt: true,
        },
      })

      return reply.send({ item: updated })
    },
  )

  app.delete(
    `${baseRoute}/:id`,
    { preHandler: config.requireAccess() },
    async (request, reply) => {
      const id = String((request.params as any)?.id ?? '')
      const tenantId = request.auth!.tenantId
      const existing = await db.reportSchedule.findFirst({ where: { id, tenantId, type: config.type } })
      if (!existing) return reply.status(404).send({ message: 'Not found' })
      await db.reportSchedule.delete({ where: { id } })
      return reply.send({ ok: true })
    },
  )
}
