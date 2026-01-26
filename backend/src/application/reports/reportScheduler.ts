import { getEnv } from '../../shared/env.js'
import { getMailer } from '../../shared/mailer.js'
import type { PrismaClient } from '../../generated/prisma/client.js'

function clampDayOfMonth(year: number, monthIndex: number, dayOfMonth: number): number {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  return Math.min(Math.max(dayOfMonth, 1), lastDay)
}

export function computeNextRunAt(input: {
  now: Date
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  hour: number
  minute: number
  dayOfWeek?: number | null
  dayOfMonth?: number | null
}): Date {
  const now = input.now
  const hour = Math.min(Math.max(input.hour, 0), 23)
  const minute = Math.min(Math.max(input.minute, 0), 59)

  if (input.frequency === 'DAILY') {
    const candidate = new Date(now)
    candidate.setHours(hour, minute, 0, 0)
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1)
    return candidate
  }

  if (input.frequency === 'WEEKLY') {
    const targetDow = Number.isFinite(input.dayOfWeek as number) ? (input.dayOfWeek as number) : 1
    const candidate = new Date(now)
    candidate.setHours(hour, minute, 0, 0)
    const currentDow = candidate.getDay()
    let delta = (targetDow - currentDow + 7) % 7
    if (delta === 0 && candidate.getTime() <= now.getTime()) delta = 7
    candidate.setDate(candidate.getDate() + delta)
    return candidate
  }

  const targetDom = Number.isFinite(input.dayOfMonth as number) ? (input.dayOfMonth as number) : 1
  const y = now.getFullYear()
  const m = now.getMonth()

  const candidateDom = clampDayOfMonth(y, m, targetDom)
  const candidate = new Date(y, m, candidateDom, hour, minute, 0, 0)
  if (candidate.getTime() <= now.getTime()) {
    const ny = new Date(y, m + 1, 1)
    const nm = ny.getMonth()
    const nny = ny.getFullYear()
    const dom2 = clampDayOfMonth(nny, nm, targetDom)
    return new Date(nny, nm, dom2, hour, minute, 0, 0)
  }
  return candidate
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function computePeriod(now: Date, frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'): { from: string; to: string } {
  // We use [from, to) semantics
  if (frequency === 'DAILY') {
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const from = new Date(to)
    from.setDate(from.getDate() - 1)
    return { from: toIsoDate(from), to: toIsoDate(to) }
  }

  if (frequency === 'WEEKLY') {
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const from = new Date(to)
    from.setDate(from.getDate() - 7)
    return { from: toIsoDate(from), to: toIsoDate(to) }
  }

  // Previous full month
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return { from: toIsoDate(startOfPrevMonth), to: toIsoDate(startOfThisMonth) }
}

function buildReportLink(input: {
  base: string
  type: 'SALES' | 'STOCK'
  reportKey: string
  from: string
  to: string
  status?: string
}): string {
  const path = input.type === 'SALES' ? '/reports/sales' : '/reports/stock'
  const params = new URLSearchParams({ tab: input.reportKey, from: input.from, to: input.to })
  if ((input.status ?? '').trim()) params.set('status', input.status!)
  return `${input.base}${path}?${params}`
}

export function startReportScheduler(db: PrismaClient): { stop: () => void } {
  const env = getEnv()
  const mailer = getMailer()

  let stopped = false
  let inFlight = false

  const tick = async () => {
    if (stopped) return
    if (inFlight) return
    inFlight = true

    try {
      const now = new Date()

      const due = await db.reportSchedule.findMany({
        where: {
          enabled: true,
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
        },
        take: 50,
        orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
      })

      for (const s of due) {
        const period = computePeriod(now, s.frequency)
        const params = (s.params ?? {}) as any
        const status = typeof params?.status === 'string' ? params.status : undefined

        // Ensure nextRunAt exists even if it's the first run.
        const nextRunAt = computeNextRunAt({
          now,
          frequency: s.frequency,
          hour: s.hour,
          minute: s.minute,
          dayOfWeek: s.dayOfWeek,
          dayOfMonth: s.dayOfMonth,
        })

        // Only run if truly due.
        if (s.nextRunAt && s.nextRunAt.getTime() > now.getTime()) {
          // Not due, just ensure it has a nextRunAt.
          await db.reportSchedule.update({
            where: { id: s.id },
            data: { nextRunAt },
          })
          continue
        }

        const link = buildReportLink({
          base: env.WEB_ORIGIN,
          type: s.type,
          reportKey: s.reportKey,
          from: period.from,
          to: period.to,
          status,
        })

        const subject = `Reporte programado: ${s.type === 'SALES' ? 'Ventas' : 'Stock'} (${s.frequency})`
        const text =
          `Hola,\n\n` +
          `Aquí tienes tu reporte programado (${s.reportKey}).\n` +
          `Periodo: ${period.from} a ${period.to}\n\n` +
          `Abrir reporte: ${link}\n\n` +
          `Tip: desde la vista puedes exportar a PDF y enviarlo.\n`

        // Best-effort: send to all recipients.
        for (const to of s.recipients ?? []) {
          const email = String(to ?? '').trim()
          if (!email) continue
          try {
            await mailer.sendEmail({ to: email, subject, text })
          } catch {
            // ignore individual failures
          }
        }

        const nextAfterRun = computeNextRunAt({
          now: new Date(now.getTime() + 1000),
          frequency: s.frequency,
          hour: s.hour,
          minute: s.minute,
          dayOfWeek: s.dayOfWeek,
          dayOfMonth: s.dayOfMonth,
        })

        await db.reportSchedule.update({
          where: { id: s.id },
          data: { lastRunAt: now, nextRunAt: nextAfterRun, version: { increment: 1 } },
        })
      }
    } finally {
      inFlight = false
    }
  }

  // Run immediately on start, then every minute.
  tick().catch(() => {})
  const interval = setInterval(() => {
    tick().catch(() => {})
  }, 60_000)

  return {
    stop: () => {
      stopped = true
      clearInterval(interval)
    },
  }
}
