import { formatInteger, formatMoney } from '../../lib/numberFormat'

export type SalesStatus = 'ALL' | 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'
export type ReportFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export type ScheduleItem = {
  id: string
  reportKey: string
  frequency: ReportFrequency
  hour: number
  minute: number
  dayOfWeek: number | null
  dayOfMonth: number | null
  recipients: string[]
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
}

export type ScheduleListResponse = { items: ScheduleItem[] }

export function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1)
}

export function money(n: number): string {
  return formatMoney(n)
}

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '-'
  if (minutes < 1) return `< 1 min`
  const h = Math.floor(minutes / 60)
  const m = Math.floor(minutes % 60)
  return `${h}h ${m}m`
}

export function formatPresentationLabel(p: { name: string | null; unitsPerPresentation: unknown } | null): string {
  if (!p) return 'Unidad'
  const name = p.name ?? 'Unidad'
  const units = p.unitsPerPresentation ? Number(p.unitsPerPresentation) : null
  return units ? `${name} (${units} u.)` : name
}

export function formatWarehouseLabel(wh: { code: string | null; name: string | null } | null | undefined): string {
  if (!wh) return '—'
  const code = wh.code ?? ''
  const name = wh.name ?? ''
  return code && name ? `${code} - ${name}` : code || name || '—'
}

export function formatLocationWithWarehouse(location: { code: string | null; warehouse: { code: string | null; name: string | null } | null } | null | undefined): string {
  if (!location) return '—'
  const locCode = location.code ?? ''
  const wh = formatWarehouseLabel(location.warehouse)
  return locCode ? `${wh}: ${locCode}` : wh
}

export function statusLabel(s: SalesStatus): string {
  if (s === 'ALL') return 'TODOS'
  if (s === 'DRAFT') return 'BORRADOR'
  if (s === 'CONFIRMED') return 'CONFIRMADO'
  if (s === 'FULFILLED') return 'ENTREGADO'
  if (s === 'CANCELLED') return 'ANULADO'
  return s
}

export function orderStatusLabel(status: string): string {
  if (status === 'DRAFT') return 'BORRADOR'
  if (status === 'CONFIRMED') return 'CONFIRMADO'
  if (status === 'FULFILLED') return 'ENTREGADO'
  if (status === 'CANCELLED') return 'ANULADO'
  return status
}

export function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

export type OrderDetailItem = {
  id: string
  number: string
  status: string
  customerId: string
  customerName: string
  total: number
  createdAt: string
  deliveredAt: string | null
  paidAt: string | null
}

export function buildTopCustomerMix(
  orders: OrderDetailItem[],
  getChartColor: (idx: number, scheme: string) => string,
): Array<{ label: string; total: number; ordersCount: number; color: string }> {
  const totalsByCustomer = new Map<string, { label: string; total: number; ordersCount: number }>()
  for (const order of orders) {
    const entry = totalsByCustomer.get(order.customerId) ?? {
      label: order.customerName || 'Cliente sin nombre',
      total: 0,
      ordersCount: 0,
    }
    entry.total += toNumber(order.total)
    entry.ordersCount += 1
    totalsByCustomer.set(order.customerId, entry)
  }

  const sorted = Array.from(totalsByCustomer.values()).sort((a, b) => b.total - a.total)
  const topThree = sorted.slice(0, 3)
  const others = sorted.slice(3)
  const result = topThree.map((item, idx) => ({
    label: item.label,
    total: item.total,
    ordersCount: item.ordersCount,
    color: getChartColor(idx, 'rainbow'),
  }))

  if (others.length > 0) {
    result.push({
      label: 'Otros',
      total: others.reduce((sum, item) => sum + item.total, 0),
      ordersCount: others.reduce((sum, item) => sum + item.ordersCount, 0),
      color: '#94a3b8',
    })
  }

  return result.filter((item) => item.total > 0)
}

export function buildStatusMix(
  orders: OrderDetailItem[],
  getChartColor: (idx: number, scheme: string) => string,
): Array<{ label: string; total: number; ordersCount: number; color: string }> {
  const palette: Record<string, string> = {
    DRAFT: '#94a3b8',
    CONFIRMED: '#2563eb',
    FULFILLED: '#10b981',
    CANCELLED: '#ef4444',
  }

  const totalsByStatus = new Map<string, { label: string; total: number; ordersCount: number; color: string }>()
  for (const order of orders) {
    const status = order.status || 'DRAFT'
    const entry = totalsByStatus.get(status) ?? {
      label: orderStatusLabel(status),
      total: 0,
      ordersCount: 0,
      color: palette[status] ?? '#64748b',
    }
    entry.total += toNumber(order.total)
    entry.ordersCount += 1
    totalsByStatus.set(status, entry)
  }

  return Array.from(totalsByStatus.values())
    .sort((a, b) => b.total - a.total)
    .map((item, idx) => ({
      ...item,
      color: palette[Object.keys(totalsByStatus)[idx]] ?? item.color,
    }))
}
