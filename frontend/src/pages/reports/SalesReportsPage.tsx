import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { MainLayout, PageContainer, Button, Input, Loading, ErrorState, EmptyState, Modal, Table } from '../../components'
import { useNavigation } from '../../hooks'
import { apiFetch } from '../../lib/api'
import { blobToBase64, exportElementToPdf, pdfBlobFromElement } from '../../lib/exportPdf'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'

type SalesStatus = 'ALL' | 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'

type SalesSummaryItem = {
  day: string
  ordersCount: number
  linesCount: number
  quantity: string
  amount: string
}

type SalesByCustomerItem = {
  customerId: string
  customerName: string
  city: string | null
  ordersCount: number
  quantity: string
  amount: string
}

type SalesByCityItem = {
  city: string
  ordersCount: number
  quantity: string
  amount: string
}

type SalesTopProductItem = {
  productId: string
  sku: string
  name: string
  quantity: string
  amount: string
}

type SalesFunnelItem = { key: string; label: string; value: number }

type FunnelResponse = { items: SalesFunnelItem[]; totals: { amountFulfilled: string; amountPaid: string } }

type ScheduleItem = {
  id: string
  reportKey: string
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  hour: number
  minute: number
  dayOfWeek: number | null
  dayOfMonth: number | null
  recipients: string[]
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
}

type ScheduleListResponse = { items: ScheduleItem[] }

type ReportTab = 'MONTH' | 'CUSTOMERS' | 'CITIES' | 'TOP_PRODUCTS' | 'FUNNEL'

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1)
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function statusLabel(s: SalesStatus): string {
  if (s === 'ALL') return 'TODOS'
  if (s === 'DRAFT') return 'BORRADOR'
  if (s === 'CONFIRMED') return 'CONFIRMADO'
  if (s === 'FULFILLED') return 'ENTREGADO'
  if (s === 'CANCELLED') return 'ANULADO'
  return s
}

const PIE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b']

async function fetchSalesSummary(token: string, q: { from?: string; to?: string; status?: SalesStatus }): Promise<{ items: SalesSummaryItem[] }> {
  const params = new URLSearchParams()
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.status && q.status !== 'ALL') params.set('status', q.status)
  return apiFetch(`/api/v1/reports/sales/summary?${params}`, { token })
}

async function fetchSalesByCustomer(
  token: string,
  q: { from?: string; to?: string; take: number; status?: SalesStatus },
): Promise<{ items: SalesByCustomerItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.status && q.status !== 'ALL') params.set('status', q.status)
  return apiFetch(`/api/v1/reports/sales/by-customer?${params}`, { token })
}

async function fetchSalesByCity(
  token: string,
  q: { from?: string; to?: string; take: number; status?: SalesStatus },
): Promise<{ items: SalesByCityItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.status && q.status !== 'ALL') params.set('status', q.status)
  return apiFetch(`/api/v1/reports/sales/by-city?${params}`, { token })
}

async function fetchTopProducts(
  token: string,
  q: { from?: string; to?: string; take: number; status?: SalesStatus },
): Promise<{ items: SalesTopProductItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.status && q.status !== 'ALL') params.set('status', q.status)
  return apiFetch(`/api/v1/reports/sales/top-products?${params}`, { token })
}

async function fetchFunnel(token: string, q: { from?: string; to?: string }): Promise<FunnelResponse> {
  const params = new URLSearchParams()
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  return apiFetch(`/api/v1/reports/sales/funnel?${params}`, { token })
}

async function sendSalesReportEmail(token: string, input: { to: string; subject: string; filename: string; pdfBase64: string; message?: string }) {
  await apiFetch(`/api/v1/reports/sales/email`, {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  })
}

async function listSalesSchedules(token: string): Promise<ScheduleListResponse> {
  return apiFetch(`/api/v1/reports/sales/schedules`, { token })
}

async function createSalesSchedule(
  token: string,
  input: {
    reportKey: string
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
    hour: number
    minute: number
    dayOfWeek?: number
    dayOfMonth?: number
    recipients: string[]
    status?: string
  },
): Promise<void> {
  await apiFetch(`/api/v1/reports/sales/schedules`, {
    token,
    method: 'POST',
    body: JSON.stringify({ ...input, enabled: true }),
  })
}

async function patchSalesSchedule(token: string, id: string, patch: { enabled?: boolean }): Promise<void> {
  await apiFetch(`/api/v1/reports/sales/schedules/${encodeURIComponent(id)}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

async function deleteSalesSchedule(token: string, id: string): Promise<void> {
  await apiFetch(`/api/v1/reports/sales/schedules/${encodeURIComponent(id)}`, {
    token,
    method: 'DELETE',
  })
}

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function SalesReportsPage() {
  const auth = useAuth()
  const tenant = useTenant()
  const currency = tenant.branding?.currency || 'BOB'

  const navGroups = useNavigation()
  const location = useLocation()

  const today = new Date()
  const [tab, setTab] = useState<ReportTab>('MONTH')
  const [from, setFrom] = useState<string>(toIsoDate(startOfMonth(today)))
  const [to, setTo] = useState<string>(toIsoDate(startOfNextMonth(today)))
  const [status, setStatus] = useState<SalesStatus>('FULFILLED')

  useEffect(() => {
    const sp = new URLSearchParams(location.search)
    const qsTab = sp.get('tab')
    const qsFrom = sp.get('from')
    const qsTo = sp.get('to')
    const qsStatus = sp.get('status')

    if (qsTab && ['MONTH', 'CUSTOMERS', 'CITIES', 'TOP_PRODUCTS', 'FUNNEL'].includes(qsTab)) {
      setTab(qsTab as ReportTab)
    }
    if (qsFrom && /^\d{4}-\d{2}-\d{2}$/.test(qsFrom)) setFrom(qsFrom)
    if (qsTo && /^\d{4}-\d{2}-\d{2}$/.test(qsTo)) setTo(qsTo)
    if (qsStatus && ['ALL', 'DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED'].includes(qsStatus)) {
      setStatus(qsStatus as SalesStatus)
    }
    // Only on navigation (e.g. opening scheduled link)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailMessage, setEmailMessage] = useState('Adjunto encontrarás el reporte solicitado.')

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [scheduleRecipientsRaw, setScheduleRecipientsRaw] = useState('')
  const [scheduleFrequency, setScheduleFrequency] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY')
  const [scheduleHour, setScheduleHour] = useState(8)
  const [scheduleMinute, setScheduleMinute] = useState(0)
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1)
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1)

  const reportRef = useRef<HTMLDivElement | null>(null)

  const title = useMemo(() => {
    const period = `${from} a ${to}`
    if (tab === 'MONTH') return `Ventas en el mes (${period})`
    if (tab === 'CUSTOMERS') return `Ventas por cliente (${period})`
    if (tab === 'CITIES') return `Ventas por ciudad (${period})`
    if (tab === 'TOP_PRODUCTS') return `Productos más vendidos (${period})`
    return `Embudo Ventas → Entregas → Cobros (${period})`
  }, [from, to, tab])

  const summaryQuery = useQuery({
    queryKey: ['reports', 'sales', 'summary', { from, to, status }],
    queryFn: () => fetchSalesSummary(auth.accessToken!, { from, to, status }),
    enabled: !!auth.accessToken && tab === 'MONTH',
  })

  const byCustomerQuery = useQuery({
    queryKey: ['reports', 'sales', 'byCustomer', { from, to, status }],
    queryFn: () => fetchSalesByCustomer(auth.accessToken!, { from, to, take: 25, status }),
    enabled: !!auth.accessToken && tab === 'CUSTOMERS',
  })

  const byCityQuery = useQuery({
    queryKey: ['reports', 'sales', 'byCity', { from, to, status }],
    queryFn: () => fetchSalesByCity(auth.accessToken!, { from, to, take: 20, status }),
    enabled: !!auth.accessToken && tab === 'CITIES',
  })

  const topProductsQuery = useQuery({
    queryKey: ['reports', 'sales', 'topProducts', { from, to, status }],
    queryFn: () => fetchTopProducts(auth.accessToken!, { from, to, take: 15, status }),
    enabled: !!auth.accessToken && tab === 'TOP_PRODUCTS',
  })

  const funnelQuery = useQuery({
    queryKey: ['reports', 'sales', 'funnel', { from, to }],
    queryFn: () => fetchFunnel(auth.accessToken!, { from, to }),
    enabled: !!auth.accessToken && tab === 'FUNNEL',
  })

  const exportFilename = useMemo(() => {
    const base = tab.toLowerCase()
    return `reporte-ventas-${base}-${from}-${to}.pdf`
  }, [from, to, tab])

  const emailMutation = useMutation({
    mutationFn: async () => {
      if (!reportRef.current) throw new Error('No se pudo generar el PDF')
      if (!emailTo.trim()) throw new Error('Ingresa un correo válido')
      const blob = await pdfBlobFromElement(reportRef.current, { title })
      const pdfBase64 = await blobToBase64(blob)
      await sendSalesReportEmail(auth.accessToken!, {
        to: emailTo.trim(),
        subject: title,
        filename: exportFilename,
        pdfBase64,
        message: emailMessage,
      })
    },
    onSuccess: () => {
      window.alert('Reporte enviado por correo')
      setEmailModalOpen(false)
    },
    onError: (err: any) => {
      window.alert(err?.message ?? 'No se pudo enviar el reporte')
    },
  })

  const schedulesQuery = useQuery({
    queryKey: ['reports', 'sales', 'schedules'],
    queryFn: () => listSalesSchedules(auth.accessToken!),
    enabled: !!auth.accessToken && scheduleModalOpen,
  })

  const createScheduleMutation = useMutation({
    mutationFn: async () => {
      const recipients = parseEmails(scheduleRecipientsRaw)
      if (recipients.length === 0) throw new Error('Ingresa al menos un correo en destinatarios')

      await createSalesSchedule(auth.accessToken!, {
        reportKey: tab,
        frequency: scheduleFrequency,
        hour: scheduleHour,
        minute: scheduleMinute,
        dayOfWeek: scheduleFrequency === 'WEEKLY' ? scheduleDayOfWeek : undefined,
        dayOfMonth: scheduleFrequency === 'MONTHLY' ? scheduleDayOfMonth : undefined,
        recipients,
        status: status !== 'ALL' ? status : undefined,
      })
    },
    onSuccess: async () => {
      window.alert('Envío programado creado')
      await schedulesQuery.refetch()
    },
    onError: (err: any) => window.alert(err?.message ?? 'No se pudo crear el envío programado'),
  })

  const toggleScheduleMutation = useMutation({
    mutationFn: async (vars: { id: string; enabled: boolean }) => {
      await patchSalesSchedule(auth.accessToken!, vars.id, { enabled: vars.enabled })
    },
    onSuccess: async () => {
      await schedulesQuery.refetch()
    },
  })

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteSalesSchedule(auth.accessToken!, id)
    },
    onSuccess: async () => {
      await schedulesQuery.refetch()
    },
  })

  const actions = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={tab === 'MONTH' ? 'primary' : 'ghost'} onClick={() => setTab('MONTH')}>
          📅 Mes
        </Button>
        <Button size="sm" variant={tab === 'CUSTOMERS' ? 'primary' : 'ghost'} onClick={() => setTab('CUSTOMERS')}>
          👥 Clientes
        </Button>
        <Button size="sm" variant={tab === 'CITIES' ? 'primary' : 'ghost'} onClick={() => setTab('CITIES')}>
          🏙️ Ciudades
        </Button>
        <Button
          size="sm"
          variant={tab === 'TOP_PRODUCTS' ? 'primary' : 'ghost'}
          onClick={() => setTab('TOP_PRODUCTS')}
        >
          🧪 Productos
        </Button>
        <Button size="sm" variant={tab === 'FUNNEL' ? 'primary' : 'ghost'} onClick={() => setTab('FUNNEL')}>
          🔻 Embudo
        </Button>

        <div className="w-px self-stretch bg-slate-200 dark:bg-slate-700" />

        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            if (!reportRef.current) return
            await exportElementToPdf(reportRef.current, { filename: exportFilename, title })
          }}
        >
          ⬇️ Exportar PDF
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setEmailModalOpen(true)}>
          ✉️ Enviar
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setScheduleModalOpen(true)}>
          ⏱ Programar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const url = window.location.href
            const text = encodeURIComponent(`Reporte: ${title}\n${url}`)
            window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer')
          }}
        >
          💬 WhatsApp
        </Button>
      </div>
    ),
    [exportFilename, tab, title],
  )

  const filters = useMemo(
    () => (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Input label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} />

        <div className="w-full">
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Estado</label>
          <select
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[var(--pf-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--pf-primary)] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={status}
            onChange={(e) => setStatus(e.target.value as SalesStatus)}
          >
            <option value="ALL">{statusLabel('ALL')}</option>
            <option value="DRAFT">{statusLabel('DRAFT')}</option>
            <option value="CONFIRMED">{statusLabel('CONFIRMED')}</option>
            <option value="FULFILLED">{statusLabel('FULFILLED')}</option>
            <option value="CANCELLED">{statusLabel('CANCELLED')}</option>
          </select>
        </div>

        <div className="flex items-end">
          <Button
            variant="ghost"
            onClick={() => {
              const now = new Date()
              setFrom(toIsoDate(startOfMonth(now)))
              setTo(toIsoDate(startOfNextMonth(now)))
            }}
          >
            Reset mes actual
          </Button>
        </div>
      </div>
    ),
    [from, status, to],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Reportes de Ventas" actions={actions}>
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          {filters}
        </div>

        <div ref={reportRef} className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">Moneda: {currency}</p>
              </div>
            </div>
          </div>

          {tab === 'MONTH' && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              {summaryQuery.isLoading && <Loading />}
              {summaryQuery.isError && <ErrorState message={(summaryQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!summaryQuery.isLoading && !summaryQuery.isError && (summaryQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ventas en el rango seleccionado." />
              )}
              {!summaryQuery.isLoading && !summaryQuery.isError && (summaryQuery.data?.items?.length ?? 0) > 0 && (
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={(summaryQuery.data?.items ?? []).map((i) => ({
                        day: i.day,
                        amount: toNumber(i.amount),
                        ordersCount: i.ordersCount,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip formatter={(v: any, name: any) => (name === 'amount' ? `${money(Number(v))} ${currency}` : v)} />
                      <Legend />
                      <Line type="monotone" dataKey="amount" stroke="#2563eb" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="ordersCount" stroke="#16a34a" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {tab === 'CUSTOMERS' && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              {byCustomerQuery.isLoading && <Loading />}
              {byCustomerQuery.isError && <ErrorState message={(byCustomerQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!byCustomerQuery.isLoading && !byCustomerQuery.isError && (byCustomerQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ventas en el rango seleccionado." />
              )}
              {!byCustomerQuery.isLoading && !byCustomerQuery.isError && (byCustomerQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={(byCustomerQuery.data?.items ?? []).map((i) => ({
                          name: i.customerName,
                          amount: toNumber(i.amount),
                          ordersCount: i.ordersCount,
                        }))}
                        margin={{ left: 10, right: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" hide />
                        <YAxis />
                        <Tooltip formatter={(v: any, name: any) => (name === 'amount' ? `${money(Number(v))} ${currency}` : v)} />
                        <Legend />
                        <Bar dataKey="amount" fill="#2563eb" />
                        <Bar dataKey="ordersCount" fill="#16a34a" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-4">
                    <Table
                      columns={[
                        { header: 'Cliente', accessor: (r) => r.customerName },
                        { header: 'Ciudad', accessor: (r) => r.city ?? '-' },
                        { header: 'Órdenes', accessor: (r) => String(r.ordersCount) },
                        { header: `Total (${currency})`, accessor: (r) => money(toNumber(r.amount)) },
                      ]}
                      data={byCustomerQuery.data?.items ?? []}
                      keyExtractor={(r) => r.customerId}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'CITIES' && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              {byCityQuery.isLoading && <Loading />}
              {byCityQuery.isError && <ErrorState message={(byCityQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!byCityQuery.isLoading && !byCityQuery.isError && (byCityQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ventas en el rango seleccionado." />
              )}
              {!byCityQuery.isLoading && !byCityQuery.isError && (byCityQuery.data?.items?.length ?? 0) > 0 && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={(byCityQuery.data?.items ?? []).map((i) => ({
                            name: i.city,
                            value: toNumber(i.amount),
                          }))}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={60}
                          outerRadius={120}
                          paddingAngle={2}
                        >
                          {(byCityQuery.data?.items ?? []).map((_, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: any) => `${money(Number(v))} ${currency}`} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <Table
                      columns={[
                        { header: 'Ciudad', accessor: (r) => r.city },
                        { header: 'Órdenes', accessor: (r) => String(r.ordersCount) },
                        { header: `Total (${currency})`, accessor: (r) => money(toNumber(r.amount)) },
                      ]}
                      data={byCityQuery.data?.items ?? []}
                      keyExtractor={(r) => r.city}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'TOP_PRODUCTS' && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              {topProductsQuery.isLoading && <Loading />}
              {topProductsQuery.isError && (
                <ErrorState message={(topProductsQuery.error as any)?.message ?? 'Error cargando reporte'} />
              )}
              {!topProductsQuery.isLoading && !topProductsQuery.isError && (topProductsQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ventas en el rango seleccionado." />
              )}
              {!topProductsQuery.isLoading && !topProductsQuery.isError && (topProductsQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={(topProductsQuery.data?.items ?? []).map((i) => ({
                          name: i.name,
                          amount: toNumber(i.amount),
                          quantity: toNumber(i.quantity),
                        }))}
                        margin={{ left: 10, right: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" hide />
                        <YAxis />
                        <Tooltip formatter={(v: any, name: any) => (name === 'amount' ? `${money(Number(v))} ${currency}` : v)} />
                        <Legend />
                        <Bar dataKey="amount" fill="#2563eb" />
                        <Bar dataKey="quantity" fill="#f59e0b" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-4">
                    <Table
                      columns={[
                        { header: 'SKU', accessor: (r) => r.sku },
                        { header: 'Producto', accessor: (r) => r.name },
                        { header: 'Cantidad', accessor: (r) => String(toNumber(r.quantity)) },
                        { header: `Total (${currency})`, accessor: (r) => money(toNumber(r.amount)) },
                      ]}
                      data={topProductsQuery.data?.items ?? []}
                      keyExtractor={(r) => r.productId}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'FUNNEL' && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              {funnelQuery.isLoading && <Loading />}
              {funnelQuery.isError && <ErrorState message={(funnelQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!funnelQuery.isLoading && !funnelQuery.isError && (funnelQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay datos en el rango seleccionado." />
              )}
              {!funnelQuery.isLoading && !funnelQuery.isError && (funnelQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                    {(funnelQuery.data?.items ?? []).map((i) => (
                      <div
                        key={i.key}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
                      >
                        <div className="text-xs text-slate-600 dark:text-slate-400">{i.label}</div>
                        <div className="text-2xl font-semibold text-slate-900 dark:text-white">{i.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={(funnelQuery.data?.items ?? []).map((i) => ({ label: i.label, value: i.value }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" hide />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill="#2563eb" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-700 dark:text-slate-300">
                    <div>
                      <span className="font-medium">Total entregado:</span> {money(toNumber(funnelQuery.data?.totals?.amountFulfilled))} {currency}
                    </div>
                    <div>
                      <span className="font-medium">Total cobrado:</span> {money(toNumber(funnelQuery.data?.totals?.amountPaid))} {currency}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <Modal isOpen={emailModalOpen} onClose={() => setEmailModalOpen(false)} title="Enviar reporte por correo" maxWidth="md">
          <div className="space-y-3">
            <Input label="Para (email)" placeholder="cliente@correo.com" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
            <Input
              label="Mensaje"
              value={emailMessage}
              onChange={(e) => setEmailMessage(e.target.value)}
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setEmailModalOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" loading={emailMutation.isPending} onClick={() => emailMutation.mutate()}>
                Enviar
              </Button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Requiere SMTP configurado en el backend (SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM).
            </p>
          </div>
        </Modal>

        <Modal isOpen={scheduleModalOpen} onClose={() => setScheduleModalOpen(false)} title="Programar envíos" maxWidth="xl">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              El backend enviará un correo con el enlace del reporte (con filtros y rango). Desde la vista puedes exportar a PDF.
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="w-full">
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Frecuencia</label>
                <select
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[var(--pf-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--pf-primary)] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  value={scheduleFrequency}
                  onChange={(e) => setScheduleFrequency(e.target.value as any)}
                >
                  <option value="DAILY">Diario (último día)</option>
                  <option value="WEEKLY">Semanal (últimos 7 días)</option>
                  <option value="MONTHLY">Mensual (mes anterior)</option>
                </select>
              </div>

              <Input label="Hora" type="number" min={0} max={23} value={String(scheduleHour)} onChange={(e) => setScheduleHour(Number(e.target.value))} />
              <Input label="Min" type="number" min={0} max={59} value={String(scheduleMinute)} onChange={(e) => setScheduleMinute(Number(e.target.value))} />

              {scheduleFrequency === 'WEEKLY' && (
                <Input
                  label="Día semana (0=Dom..6=Sáb)"
                  type="number"
                  min={0}
                  max={6}
                  value={String(scheduleDayOfWeek)}
                  onChange={(e) => setScheduleDayOfWeek(Number(e.target.value))}
                />
              )}

              {scheduleFrequency === 'MONTHLY' && (
                <Input
                  label="Día mes (1..31)"
                  type="number"
                  min={1}
                  max={31}
                  value={String(scheduleDayOfMonth)}
                  onChange={(e) => setScheduleDayOfMonth(Number(e.target.value))}
                />
              )}
            </div>

            <Input
              label="Destinatarios (emails separados por coma/espacio)"
              placeholder="admin@empresa.com, ventas@empresa.com"
              value={scheduleRecipientsRaw}
              onChange={(e) => setScheduleRecipientsRaw(e.target.value)}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" loading={createScheduleMutation.isPending} onClick={() => createScheduleMutation.mutate()}>
                Crear envío para pestaña actual ({tab})
              </Button>
              <Button variant="ghost" onClick={() => schedulesQuery.refetch()}>
                Refrescar
              </Button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Envíos programados</h3>

              {schedulesQuery.isLoading && <Loading />}
              {schedulesQuery.isError && (
                <ErrorState message={(schedulesQuery.error as any)?.message ?? 'No se pudo cargar los envíos programados'} />
              )}
              {!schedulesQuery.isLoading && !schedulesQuery.isError && (schedulesQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay envíos programados aún." />
              )}

              {!schedulesQuery.isLoading && !schedulesQuery.isError && (schedulesQuery.data?.items?.length ?? 0) > 0 && (
                <Table
                  columns={[
                    { header: 'Reporte', accessor: (r) => r.reportKey },
                    { header: 'Frecuencia', accessor: (r) => r.frequency },
                    { header: 'Hora', accessor: (r) => `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}` },
                    { header: 'Destinatarios', accessor: (r) => r.recipients.join(', ') },
                    { header: 'Próximo', accessor: (r) => (r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : '-') },
                    {
                      header: 'Acciones',
                      accessor: (r) => (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={r.enabled ? 'ghost' : 'primary'}
                            loading={toggleScheduleMutation.isPending}
                            onClick={() => toggleScheduleMutation.mutate({ id: r.id, enabled: !r.enabled })}
                          >
                            {r.enabled ? 'Desactivar' : 'Activar'}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={deleteScheduleMutation.isPending}
                            onClick={() => {
                              if (window.confirm('¿Eliminar este envío programado?')) deleteScheduleMutation.mutate(r.id)
                            }}
                          >
                            Eliminar
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                  data={schedulesQuery.data?.items ?? []}
                  keyExtractor={(r) => r.id}
                />
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nota: para que esto funcione debes aplicar la migración nueva y configurar SMTP en el backend.
            </p>
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
