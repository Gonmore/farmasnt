import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { MainLayout, PageContainer, Button, Input, Loading, ErrorState, EmptyState, Modal, Table } from '../../components'
import { useNavigation } from '../../hooks'
import { apiFetch } from '../../lib/api'
import { blobToBase64, exportElementToPdf, pdfBlobFromElement } from '../../lib/exportPdf'
import { useAuth } from '../../providers/AuthProvider'

type StockTab = 'INPUTS' | 'TRANSFERS'

type StockInputsItem = {
  productId: string
  sku: string
  name: string
  movementsCount: number
  quantity: string
}

type TransferItem = {
  fromWarehouse: { id: string; code: string | null; name: string | null } | null
  toWarehouse: { id: string; code: string | null; name: string | null } | null
  movementsCount: number
  quantity: string
}

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

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function fetchInputsByProduct(token: string, q: { from?: string; to?: string; take: number }): Promise<{ items: StockInputsItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  return apiFetch(`/api/v1/reports/stock/inputs-by-product?${params}`, { token })
}

async function fetchTransfers(token: string, q: { from?: string; to?: string; take: number }): Promise<{ items: TransferItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  return apiFetch(`/api/v1/reports/stock/transfers-between-warehouses?${params}`, { token })
}

async function sendStockReportEmail(token: string, input: { to: string; subject: string; filename: string; pdfBase64: string; message?: string }) {
  await apiFetch(`/api/v1/reports/stock/email`, {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  })
}

async function listStockSchedules(token: string): Promise<ScheduleListResponse> {
  return apiFetch(`/api/v1/reports/stock/schedules`, { token })
}

async function createStockSchedule(
  token: string,
  input: {
    reportKey: string
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
    hour: number
    minute: number
    dayOfWeek?: number
    dayOfMonth?: number
    recipients: string[]
  },
): Promise<void> {
  await apiFetch(`/api/v1/reports/stock/schedules`, {
    token,
    method: 'POST',
    body: JSON.stringify({ ...input, enabled: true }),
  })
}

async function patchStockSchedule(token: string, id: string, patch: { enabled?: boolean }): Promise<void> {
  await apiFetch(`/api/v1/reports/stock/schedules/${encodeURIComponent(id)}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

async function deleteStockSchedule(token: string, id: string): Promise<void> {
  await apiFetch(`/api/v1/reports/stock/schedules/${encodeURIComponent(id)}`, {
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

export function StockReportsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const location = useLocation()

  const today = new Date()
  const [tab, setTab] = useState<StockTab>('INPUTS')
  const [from, setFrom] = useState<string>(toIsoDate(startOfMonth(today)))
  const [to, setTo] = useState<string>(toIsoDate(startOfNextMonth(today)))

  useEffect(() => {
    const sp = new URLSearchParams(location.search)
    const qsTab = sp.get('tab')
    const qsFrom = sp.get('from')
    const qsTo = sp.get('to')

    if (qsTab && ['INPUTS', 'TRANSFERS'].includes(qsTab)) {
      setTab(qsTab as StockTab)
    }
    if (qsFrom && /^\d{4}-\d{2}-\d{2}$/.test(qsFrom)) setFrom(qsFrom)
    if (qsTo && /^\d{4}-\d{2}-\d{2}$/.test(qsTo)) setTo(qsTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  const reportRef = useRef<HTMLDivElement | null>(null)

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

  const title = useMemo(() => {
    const period = `${from} a ${to}`
    if (tab === 'INPUTS') return `Existencias ingresadas por producto (${period})`
    return `Traspasos entre sucursales (${period})`
  }, [from, to, tab])

  const exportFilename = useMemo(() => {
    const base = tab.toLowerCase()
    return `reporte-stock-${base}-${from}-${to}.pdf`
  }, [from, to, tab])

  const inputsQuery = useQuery({
    queryKey: ['reports', 'stock', 'inputsByProduct', { from, to }],
    queryFn: () => fetchInputsByProduct(auth.accessToken!, { from, to, take: 25 }),
    enabled: !!auth.accessToken && tab === 'INPUTS',
  })

  const transfersQuery = useQuery({
    queryKey: ['reports', 'stock', 'transfersBetweenWarehouses', { from, to }],
    queryFn: () => fetchTransfers(auth.accessToken!, { from, to, take: 50 }),
    enabled: !!auth.accessToken && tab === 'TRANSFERS',
  })

  const emailMutation = useMutation({
    mutationFn: async () => {
      if (!reportRef.current) throw new Error('No se pudo generar el PDF')
      if (!emailTo.trim()) throw new Error('Ingresa un correo válido')
      const blob = await pdfBlobFromElement(reportRef.current, { title })
      const pdfBase64 = await blobToBase64(blob)
      await sendStockReportEmail(auth.accessToken!, {
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
    queryKey: ['reports', 'stock', 'schedules'],
    queryFn: () => listStockSchedules(auth.accessToken!),
    enabled: !!auth.accessToken && scheduleModalOpen,
  })

  const createScheduleMutation = useMutation({
    mutationFn: async () => {
      const recipients = parseEmails(scheduleRecipientsRaw)
      if (recipients.length === 0) throw new Error('Ingresa al menos un correo en destinatarios')

      await createStockSchedule(auth.accessToken!, {
        reportKey: tab,
        frequency: scheduleFrequency,
        hour: scheduleHour,
        minute: scheduleMinute,
        dayOfWeek: scheduleFrequency === 'WEEKLY' ? scheduleDayOfWeek : undefined,
        dayOfMonth: scheduleFrequency === 'MONTHLY' ? scheduleDayOfMonth : undefined,
        recipients,
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
      await patchStockSchedule(auth.accessToken!, vars.id, { enabled: vars.enabled })
    },
    onSuccess: async () => {
      await schedulesQuery.refetch()
    },
  })

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteStockSchedule(auth.accessToken!, id)
    },
    onSuccess: async () => {
      await schedulesQuery.refetch()
    },
  })

  const actions = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={tab === 'INPUTS' ? 'primary' : 'ghost'} onClick={() => setTab('INPUTS')}>
          📥 Ingresos
        </Button>
        <Button size="sm" variant={tab === 'TRANSFERS' ? 'primary' : 'ghost'} onClick={() => setTab('TRANSFERS')}>
          🔁 Traspasos
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
    [from, to],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Reportes de Stock" actions={actions}>
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          {filters}
        </div>

        <div ref={reportRef} className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
          </div>

          {tab === 'INPUTS' && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              {inputsQuery.isLoading && <Loading />}
              {inputsQuery.isError && <ErrorState message={(inputsQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!inputsQuery.isLoading && !inputsQuery.isError && (inputsQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ingresos de stock en el rango seleccionado." />
              )}
              {!inputsQuery.isLoading && !inputsQuery.isError && (inputsQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={(inputsQuery.data?.items ?? []).map((i) => ({
                          name: `${i.sku} - ${i.name}`,
                          quantity: toNumber(i.quantity),
                          movementsCount: i.movementsCount,
                        }))}
                        margin={{ left: 10, right: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" hide />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="quantity" fill="#2563eb" />
                        <Bar dataKey="movementsCount" fill="#16a34a" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-4">
                    <Table
                      columns={[
                        { header: 'SKU', accessor: (r) => r.sku },
                        { header: 'Producto', accessor: (r) => r.name },
                        { header: 'Movimientos', accessor: (r) => String(r.movementsCount) },
                        { header: 'Cantidad ingresada', accessor: (r) => String(toNumber(r.quantity)) },
                      ]}
                      data={inputsQuery.data?.items ?? []}
                      keyExtractor={(r) => r.productId}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'TRANSFERS' && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              {transfersQuery.isLoading && <Loading />}
              {transfersQuery.isError && (
                <ErrorState message={(transfersQuery.error as any)?.message ?? 'Error cargando reporte'} />
              )}
              {!transfersQuery.isLoading && !transfersQuery.isError && (transfersQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay traspasos en el rango seleccionado." />
              )}
              {!transfersQuery.isLoading && !transfersQuery.isError && (transfersQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={(transfersQuery.data?.items ?? []).map((i) => ({
                          name: `${i.fromWarehouse?.code ?? 'N/A'} → ${i.toWarehouse?.code ?? 'N/A'}`,
                          quantity: toNumber(i.quantity),
                          movementsCount: i.movementsCount,
                        }))}
                        margin={{ left: 10, right: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" hide />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="quantity" fill="#f59e0b" />
                        <Bar dataKey="movementsCount" fill="#2563eb" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-4">
                    <Table
                      columns={[
                        {
                          header: 'Desde',
                          accessor: (r) => (r.fromWarehouse ? `${r.fromWarehouse.code ?? ''} ${r.fromWarehouse.name ?? ''}`.trim() : 'N/A'),
                        },
                        {
                          header: 'Hacia',
                          accessor: (r) => (r.toWarehouse ? `${r.toWarehouse.code ?? ''} ${r.toWarehouse.name ?? ''}`.trim() : 'N/A'),
                        },
                        { header: 'Movimientos', accessor: (r) => String(r.movementsCount) },
                        { header: 'Cantidad transferida', accessor: (r) => String(toNumber(r.quantity)) },
                      ]}
                      data={transfersQuery.data?.items ?? []}
                      keyExtractor={(r) => `${r.fromWarehouse?.id ?? 'x'}-${r.toWarehouse?.id ?? 'y'}`}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <Modal isOpen={emailModalOpen} onClose={() => setEmailModalOpen(false)} title="Enviar reporte por correo" maxWidth="md">
          <div className="space-y-3">
            <Input label="Para (email)" placeholder="cliente@correo.com" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
            <Input label="Mensaje" value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} />
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
              placeholder="admin@empresa.com, almacen@empresa.com"
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
