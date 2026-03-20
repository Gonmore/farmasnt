import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts'
import { MainLayout, PageContainer, Button, IconButton, Input, Loading, ErrorState, EmptyState, Modal, Table } from '../../components'
import { KPICard, ReportSection, StockExpiryDocument, StockInputsDocument, StockLowStockDocument, StockOpsDocument, StockRotationDocument, StockTransfersDocument, reportColors, getChartColor, chartTooltipStyle, chartGridStyle, chartAxisStyle } from '../../components/reports'
import { useNavigation } from '../../hooks'
import { apiFetch } from '../../lib/api'
import { formatDateOnlyUtc } from '../../lib/date'
import { blobToBase64, exportElementToPdf, exportModalContentToPdf, exportReactNodeToPdf, pdfBlobFromElement, pdfBlobFromReactNode } from '../../lib/exportPdf'
import { exportToXlsx } from '../../lib/exportXlsx'
import { getProductLabel } from '../../lib/productName'
import { exportPickingToPdf, exportLabelToPdf } from '../../lib/movementRequestDocsPdf'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'

type StockTab = 'INPUTS' | 'TRANSFERS' | 'ROTATION' | 'NOMOVEMENT' | 'LOWSTOCK' | 'EXPIRY' | 'OPS'

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

type RotationItem = {
  productId: string
  sku: string
  name: string
  movementsIn: number
  movementsOut: number
  totalMovements: number
  qtyIn: number
  qtyOut: number
  currentStock: number
}

type LowStockItem = {
  productId: string
  sku: string
  name: string
  currentStock: number
  minStock: number
  avgDailySales: number
  daysOfStock: number | null
}

type ExpiryAlertItem = {
  productId: string
  sku: string
  name: string
  warehouseId: string
  warehouseCode: string | null
  warehouseName: string | null
  locationId: string
  locationName: string | null
  lotNumber: string | null
  expiryDate: string | null
  quantity: number
  daysUntilExpiry: number | null
}

type BalanceExpandedItem = {
  id: string
  quantity: string
  reservedQuantity: string
  updatedAt: string
  productId: string
  batchId: string | null
  locationId: string
  product: { sku: string; name: string }
  batch: { batchNumber: string; expiresAt: string | null; status: string } | null
  location: {
    id: string
    code: string
    warehouse: { id: string; code: string; name: string }
  }
}

type MovementExpandedItem = {
  id: string
  createdAt: string
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT'
  productId: string
  batchId: string | null
  fromLocationId: string | null
  toLocationId: string | null
  quantity: string
  referenceType: string | null
  referenceId: string | null
  note: string | null
  product: { sku: string; name: string }
  batch: { batchNumber: string; expiresAt: string | null; status: string } | null
  fromLocation: { id: string; code: string; warehouse: { id: string; code: string; name: string } } | null
  toLocation: { id: string; code: string; warehouse: { id: string; code: string; name: string } } | null
}

type MovementRequestsSummary = {
  total: number
  open: number
  fulfilled: number
  cancelled: number
  pending: number
  accepted: number
  rejected: number
}

type MovementRequestsByCityItem = MovementRequestsSummary & {
  city: string | null
}

type MovementRequestsFlowItem = {
  fromWarehouse: { id: string | null; code: string | null; name: string | null } | null
  toWarehouse: { id: string | null; code: string | null; name: string | null } | null
  requestsCount: number
  avgMinutes: number | null
}

type FulfilledMovementRequestItem = {
  id: string
  requestedCity: string | null
  destinationWarehouse: { id: string; code: string | null; name: string | null } | null
  requestedByName: string | null
  createdAt: string
  fulfilledAt: string
  minutesToFulfill: number
  itemsCount: number
  requestedQuantity: string
  movementsCount: number
  sentQuantity: string
  fromWarehouseCodes: string | null
  fromLocationCodes: string | null
  toWarehouseCodes: string | null
  toLocationCodes: string | null
}

type MovementRequestTraceResponse = {
  request: {
    id: string
    status: string
    confirmationStatus: string
    requestedCity: string
    warehouseId: string | null
    warehouse: { id: string; code: string | null; name: string | null; city: string | null } | null
    note: string | null
    createdAt: string
    requestedBy: string
    requestedByName: string | null
    fulfilledAt: string | null
    fulfilledBy: string | null
    fulfilledByName: string | null
  }
  requestedItems: Array<{
    id: string
    productId: string
    productSku: string | null
    productName: string | null
    genericName: string | null
    requestedQuantity: number
    presentation: { id: string; name: string; unitsPerPresentation: unknown } | null
    unitsPerPresentation: unknown
  }>
  sentLines: Array<{
    id: string
    createdAt: string
    productId: string
    productSku: string | null
    productName: string | null
    genericName: string | null
    batchId: string | null
    batchNumber: string | null
    expiresAt: string | null
    quantity: number
    presentation: { id: string; name: string | null; unitsPerPresentation: number | null } | null
    presentationQuantity: number | null
    fromLocation: {
      id: string
      code: string | null
      warehouse: { id: string; code: string | null; name: string | null; city: string | null } | null
    } | null
    toLocation: {
      id: string
      code: string | null
      warehouse: { id: string; code: string | null; name: string | null; city: string | null } | null
    } | null
  }>
}

type ReturnsSummary = {
  returnsCount: number
  itemsCount: number
  quantity: string
}

type ReturnsByWarehouseItem = {
  warehouse: { id: string; code: string | null; name: string | null; city: string | null }
  returnsCount: number
  itemsCount: number
  quantity: string
}

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

function formatDate(date: Date): string {
  return date.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatMinutes(minutes: number | null | undefined): string {
  const m = Number(minutes ?? 0)
  if (!Number.isFinite(m) || m <= 0) return '—'
  const total = Math.round(m)
  const h = Math.floor(total / 60)
  const mm = total % 60
  if (h <= 0) return `${mm} min`
  return `${h}h ${String(mm).padStart(2, '0')}m`
}

function formatPresentationLabel(p: { name: string | null; unitsPerPresentation: unknown } | null): string {
  if (!p) return '—'
  const name = String(p.name ?? '').trim()
  const units = Number(p.unitsPerPresentation)
  if (!name) return '—'
  if (Number.isFinite(units) && units > 1) return `${name} (${units}u)`
  return name
}

function formatWarehouseLabel(wh: { code: string | null; name: string | null } | null | undefined): string {
  if (!wh) return '—'
  return `${wh.code ?? ''} ${wh.name ?? ''}`.trim() || '—'
}

function formatLocationWithWarehouse(location: { code: string | null; warehouse: { code: string | null; name: string | null } | null } | null | undefined): string {
  if (!location) return '—'
  const warehouse = formatWarehouseLabel(location.warehouse)
  return location.code ? `${warehouse} · ${location.code}` : warehouse
}

function buildTraceProductComparison(trace: MovementRequestTraceResponse): Array<{
  productId: string
  product: string
  presentation: string
  requestedQty: number
  sentQty: number
  differenceQty: number
}> {
  const map = new Map<string, { productId: string; product: string; presentation: string; requestedQty: number; sentQty: number }>()

  for (const item of trace.requestedItems ?? []) {
    map.set(item.productId, {
      productId: item.productId,
      product: getProductLabel({ sku: item.productSku ?? '—', name: item.productName ?? '—', genericName: item.genericName ?? null }),
      presentation: formatPresentationLabel(item.presentation),
      requestedQty: Number(item.requestedQuantity ?? 0),
      sentQty: 0,
    })
  }

  for (const line of trace.sentLines ?? []) {
    const existing = map.get(line.productId) ?? {
      productId: line.productId,
      product: getProductLabel({ sku: line.productSku ?? '—', name: line.productName ?? '—', genericName: line.genericName ?? null }),
      presentation: formatPresentationLabel(line.presentation),
      requestedQty: 0,
      sentQty: 0,
    }
    existing.sentQty += Number(line.quantity ?? 0)
    if (existing.presentation === '—') existing.presentation = formatPresentationLabel(line.presentation)
    map.set(line.productId, existing)
  }

  return Array.from(map.values())
    .map((item) => ({ ...item, differenceQty: item.sentQty - item.requestedQty }))
    .sort((a, b) => Math.max(b.requestedQty, b.sentQty) - Math.max(a.requestedQty, a.sentQty))
}

function buildTraceOriginMix(trace: MovementRequestTraceResponse): Array<{ label: string; quantity: number; linesCount: number; color: string }> {
  const map = new Map<string, { label: string; quantity: number; linesCount: number }>()
  for (const line of trace.sentLines ?? []) {
    const label = formatLocationWithWarehouse(line.fromLocation)
    const existing = map.get(label) ?? { label, quantity: 0, linesCount: 0 }
    existing.quantity += Number(line.quantity ?? 0)
    existing.linesCount += 1
    map.set(label, existing)
  }

  return Array.from(map.values())
    .sort((a, b) => b.quantity - a.quantity)
    .map((item, idx) => ({ ...item, color: getChartColor(idx, 'rainbow') }))
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

async function fetchBalancesExpanded(token: string, q: { take: number; productId?: string }): Promise<{ items: BalanceExpandedItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.productId) params.set('productId', q.productId)
  return apiFetch(`/api/v1/reports/stock/balances-expanded?${params}`, { token })
}

async function fetchMovementsExpanded(token: string, q: { from?: string; to?: string; take: number; productId?: string }): Promise<{ items: MovementExpandedItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.productId) params.set('productId', q.productId)
  return apiFetch(`/api/v1/reports/stock/movements-expanded?${params}`, { token })
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

async function fetchRotation(token: string, q: { from?: string; to?: string; take: number }): Promise<{ items: RotationItem[]; from: string; to: string }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  return apiFetch(`/api/v1/reports/stock/rotation?${params}`, { token })
}

async function fetchLowStock(token: string, take: number): Promise<{ items: LowStockItem[] }> {
  const params = new URLSearchParams({ take: String(take) })
  return apiFetch(`/api/v1/reports/stock/low-stock?${params}`, { token })
}

async function fetchExpiryAlerts(token: string, daysAhead: number, take: number): Promise<{ items: ExpiryAlertItem[] }> {
  const params = new URLSearchParams({ daysAhead: String(daysAhead), take: String(take) })
  return apiFetch(`/api/v1/reports/stock/expiry-alerts?${params}`, { token })
}

async function fetchMovementRequestsSummary(token: string, q: { from?: string; to?: string }): Promise<MovementRequestsSummary> {
  const params = new URLSearchParams()
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return apiFetch(`/api/v1/reports/stock/movement-requests/summary${suffix}`, { token })
}

async function fetchMovementRequestsByCity(
  token: string,
  q: { from?: string; to?: string; take: number },
): Promise<{ items: MovementRequestsByCityItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  return apiFetch(`/api/v1/reports/stock/movement-requests/by-city?${params}`, { token })
}

async function fetchMovementRequestFlows(
  token: string,
  q: { from?: string; to?: string; take: number },
): Promise<{ items: MovementRequestsFlowItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  return apiFetch(`/api/v1/reports/stock/movement-requests/flows?${params}`, { token })
}

async function fetchFulfilledMovementRequests(
  token: string,
  q: { from?: string; to?: string; take: number },
): Promise<{ items: FulfilledMovementRequestItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  return apiFetch(`/api/v1/reports/stock/movement-requests/fulfilled?${params}`, { token })
}

async function fetchMovementRequestTrace(token: string, id: string): Promise<MovementRequestTraceResponse> {
  return apiFetch(`/api/v1/reports/stock/movement-requests/${encodeURIComponent(id)}/trace`, { token })
}

async function fetchReturnsSummary(token: string, q: { from?: string; to?: string }): Promise<ReturnsSummary> {
  const params = new URLSearchParams()
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return apiFetch(`/api/v1/reports/stock/returns/summary${suffix}`, { token })
}

async function fetchReturnsByWarehouse(
  token: string,
  q: { from?: string; to?: string; take: number },
): Promise<{ items: ReturnsByWarehouseItem[] }> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  return apiFetch(`/api/v1/reports/stock/returns/by-warehouse?${params}`, { token })
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
  const tenant = useTenant()
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

    if (qsTab && ['INPUTS', 'TRANSFERS', 'ROTATION', 'NOMOVEMENT', 'LOWSTOCK', 'EXPIRY', 'OPS'].includes(qsTab)) {
      setTab(qsTab as StockTab)
    }
    if (qsFrom && /^\d{4}-\d{2}-\d{2}$/.test(qsFrom)) setFrom(qsFrom)
    if (qsTo && /^\d{4}-\d{2}-\d{2}$/.test(qsTo)) setTo(qsTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  const reportRef = useRef<HTMLDivElement | null>(null)
  const traceRef = useRef<HTMLDivElement | null>(null)

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

  const [traceRequestId, setTraceRequestId] = useState<string | null>(null)
  const [fulfilledFilter, setFulfilledFilter] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)

  const title = useMemo(() => {
    const period = `${from} a ${to}`
    switch (tab) {
      case 'INPUTS': return `Existencias ingresadas por producto (${period})`
      case 'TRANSFERS': return `Traspasos entre sucursales (${period})`
      case 'ROTATION': return `Rotación de inventario (${period})`
      case 'NOMOVEMENT': return `Productos sin movimiento (${period})`
      case 'LOWSTOCK': return `Stock bajo / Por agotar`
      case 'EXPIRY': return `Productos próximos a vencer`
      case 'OPS': return `Solicitudes y devoluciones (${period})`
      default: return `Reporte de Stock (${period})`
    }
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

  const rotationQuery = useQuery({
    queryKey: ['reports', 'stock', 'rotation', { from, to }],
    queryFn: () => fetchRotation(auth.accessToken!, { from, to, take: 50 }),
    enabled: !!auth.accessToken && (tab === 'ROTATION' || tab === 'NOMOVEMENT'),
  })

  const lowStockQuery = useQuery({
    queryKey: ['reports', 'stock', 'lowStock'],
    queryFn: () => fetchLowStock(auth.accessToken!, 50),
    enabled: !!auth.accessToken && tab === 'LOWSTOCK',
  })

  const expiryQuery = useQuery({
    queryKey: ['reports', 'stock', 'expiry'],
    queryFn: () => fetchExpiryAlerts(auth.accessToken!, 60, 50),
    enabled: !!auth.accessToken && tab === 'EXPIRY',
  })

  const stockBalancesExpandedQuery = useQuery({
    queryKey: ['reports', 'stock', 'balancesExpanded', { tab }],
    queryFn: () => fetchBalancesExpanded(auth.accessToken!, { take: 5000 }),
    enabled: !!auth.accessToken && ['INPUTS', 'ROTATION', 'NOMOVEMENT', 'LOWSTOCK'].includes(tab),
  })

  const stockMovementsExpandedQuery = useQuery({
    queryKey: ['reports', 'stock', 'movementsExpanded', { from, to, tab }],
    queryFn: () => fetchMovementsExpanded(auth.accessToken!, { from, to, take: 5000 }),
    enabled: !!auth.accessToken && ['INPUTS', 'ROTATION', 'NOMOVEMENT'].includes(tab),
  })

  const movementRequestsSummaryQuery = useQuery({
    queryKey: ['reports', 'stock', 'movementRequestsSummary', { from, to }],
    queryFn: () => fetchMovementRequestsSummary(auth.accessToken!, { from, to }),
    enabled: !!auth.accessToken && tab === 'OPS',
  })

  const movementRequestsByCityQuery = useQuery({
    queryKey: ['reports', 'stock', 'movementRequestsByCity', { from, to }],
    queryFn: () => fetchMovementRequestsByCity(auth.accessToken!, { from, to, take: 100 }),
    enabled: !!auth.accessToken && tab === 'OPS',
  })

  const movementRequestFlowsQuery = useQuery({
    queryKey: ['reports', 'stock', 'movementRequestFlows', { from, to }],
    queryFn: () => fetchMovementRequestFlows(auth.accessToken!, { from, to, take: 100 }),
    enabled: !!auth.accessToken && tab === 'OPS',
  })

  const fulfilledMovementRequestsQuery = useQuery({
    queryKey: ['reports', 'stock', 'movementRequestsFulfilled', { from, to }],
    queryFn: () => fetchFulfilledMovementRequests(auth.accessToken!, { from, to, take: 100 }),
    enabled: !!auth.accessToken && tab === 'OPS',
  })

  const movementRequestTraceQuery = useQuery({
    queryKey: ['reports', 'stock', 'movementRequestTrace', traceRequestId],
    queryFn: () => fetchMovementRequestTrace(auth.accessToken!, traceRequestId!),
    enabled: !!auth.accessToken && tab === 'OPS' && !!traceRequestId,
  })

  const returnsSummaryQuery = useQuery({
    queryKey: ['reports', 'stock', 'returnsSummary', { from, to }],
    queryFn: () => fetchReturnsSummary(auth.accessToken!, { from, to }),
    enabled: !!auth.accessToken && tab === 'OPS',
  })

  const returnsByWarehouseQuery = useQuery({
    queryKey: ['reports', 'stock', 'returnsByWarehouse', { from, to }],
    queryFn: () => fetchReturnsByWarehouse(auth.accessToken!, { from, to, take: 200 }),
    enabled: !!auth.accessToken && tab === 'OPS',
  })

  const buildOpsStructuredReport = async () => {
    if (!auth.accessToken) throw new Error('Sesión no disponible para exportar')

    const summary = movementRequestsSummaryQuery.data ?? {
      total: 0,
      open: 0,
      fulfilled: 0,
      cancelled: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
    }

    const byCity = (movementRequestsByCityQuery.data?.items ?? []).map((item) => ({
      city: item.city ?? '(sin ciudad)',
      total: item.total,
      open: item.open,
      fulfilled: item.fulfilled,
      cancelled: item.cancelled,
      pending: item.pending,
      accepted: item.accepted,
      rejected: item.rejected,
    }))

    const flows = (movementRequestFlowsQuery.data?.items ?? []).map((item) => ({
      origin: item.fromWarehouse ? `${item.fromWarehouse.code ?? ''} ${item.fromWarehouse.name ?? ''}`.trim() || item.fromWarehouse.id || '—' : '—',
      destination: item.toWarehouse ? `${item.toWarehouse.code ?? ''} ${item.toWarehouse.name ?? ''}`.trim() || item.toWarehouse.id || '—' : '—',
      requestsCount: item.requestsCount,
      avgMinutes: item.avgMinutes,
    }))

    const fulfilled = (fulfilledMovementRequestsQuery.data?.items ?? []).map((item) => ({
      id: item.id,
      destination: item.destinationWarehouse ? `${item.destinationWarehouse.code ?? ''} ${item.destinationWarehouse.name ?? ''}`.trim() || item.destinationWarehouse.id : item.requestedCity ?? '—',
      origin: item.fromWarehouseCodes ? (item.fromLocationCodes ? `${item.fromWarehouseCodes} · ${item.fromLocationCodes}` : item.fromWarehouseCodes) : '—',
      requestedByName: item.requestedByName ?? '—',
      createdAt: item.createdAt,
      fulfilledAt: item.fulfilledAt,
      minutesToFulfill: item.minutesToFulfill,
      itemsCount: item.itemsCount,
      movementsCount: item.movementsCount,
    }))

    const traces = await Promise.all(
      (fulfilledMovementRequestsQuery.data?.items ?? []).map(async (item) => {
        const response = await fetchMovementRequestTrace(auth.accessToken!, item.id)
        return {
          requestId: response.request.id,
          destination: response.request.warehouse ? `${response.request.warehouse.code ?? ''} ${response.request.warehouse.name ?? ''}`.trim() || response.request.requestedCity : response.request.requestedCity,
          requestedAt: response.request.createdAt,
          fulfilledAt: response.request.fulfilledAt,
          minutesToFulfill: response.request.fulfilledAt ? (new Date(response.request.fulfilledAt).getTime() - new Date(response.request.createdAt).getTime()) / 60000 : null,
          requestedByName: response.request.requestedByName ?? '—',
          fulfilledByName: response.request.fulfilledByName ?? '—',
          requestedItems: (response.requestedItems ?? []).map((requestedItem) => ({
            id: requestedItem.id,
            product: getProductLabel({ sku: requestedItem.productSku ?? '—', name: requestedItem.productName ?? '—', genericName: requestedItem.genericName ?? null }),
            presentation: formatPresentationLabel(requestedItem.presentation ? { name: requestedItem.presentation.name, unitsPerPresentation: requestedItem.presentation.unitsPerPresentation } : null),
            requestedQuantity: requestedItem.requestedQuantity ?? 0,
          })),
          sentLines: (response.sentLines ?? []).map((sentLine) => ({
            id: sentLine.id,
            createdAt: sentLine.createdAt,
            origin: (() => {
              const warehouse = sentLine.fromLocation?.warehouse
              const warehouseLabel = warehouse ? `${warehouse.code ?? ''} ${warehouse.name ?? ''}`.trim() : '—'
              return sentLine.fromLocation?.code ? `${warehouseLabel} · ${sentLine.fromLocation.code}` : warehouseLabel
            })(),
            destination: (() => {
              const warehouse = sentLine.toLocation?.warehouse
              const warehouseLabel = warehouse ? `${warehouse.code ?? ''} ${warehouse.name ?? ''}`.trim() : '—'
              return sentLine.toLocation?.code ? `${warehouseLabel} · ${sentLine.toLocation.code}` : warehouseLabel
            })(),
            product: getProductLabel({ sku: sentLine.productSku ?? '—', name: sentLine.productName ?? '—', genericName: sentLine.genericName ?? null }),
            batchNumber: sentLine.batchNumber ?? null,
            expiresAt: sentLine.expiresAt ?? null,
            quantity: sentLine.quantity ?? 0,
          })),
        }
      }),
    )

    const returnsSummary = {
      returnsCount: returnsSummaryQuery.data?.returnsCount ?? 0,
      itemsCount: returnsSummaryQuery.data?.itemsCount ?? 0,
      quantity: toNumber(returnsSummaryQuery.data?.quantity),
    }

    const returnsByWarehouse = (returnsByWarehouseQuery.data?.items ?? []).map((item) => ({
      warehouse: `${item.warehouse.code ?? ''} ${item.warehouse.name ?? ''}`.trim() || item.warehouse.id,
      city: item.warehouse.city ?? '-',
      returnsCount: item.returnsCount,
      itemsCount: item.itemsCount,
      quantity: toNumber(item.quantity),
    }))

    return { summary, byCity, flows, fulfilled, traces, returnsSummary, returnsByWarehouse }
  }

  const buildInputsStructuredReport = async () => {
    const items = (inputsQuery.data?.items ?? []).map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: toNumber(item.quantity),
      movementsCount: item.movementsCount,
    }))

    const byWarehouse = new Map<string, { warehouse: string; totalQuantity: number; items: Map<string, { sku: string; name: string; quantity: number; movementsCount: number }> }>()
    for (const movement of stockMovementsExpandedQuery.data?.items ?? []) {
      if (movement.type !== 'IN') continue
      const warehouse = movement.toLocation?.warehouse
      if (!warehouse) continue
      const warehouseLabel = `${warehouse.code ?? ''} ${warehouse.name ?? ''}`.trim()
      const warehouseEntry = byWarehouse.get(warehouseLabel) ?? { warehouse: warehouseLabel, totalQuantity: 0, items: new Map() }
      const productEntry = warehouseEntry.items.get(movement.productId) ?? { sku: movement.product.sku, name: movement.product.name, quantity: 0, movementsCount: 0 }
      productEntry.quantity += toNumber(movement.quantity)
      productEntry.movementsCount += 1
      warehouseEntry.totalQuantity += toNumber(movement.quantity)
      warehouseEntry.items.set(movement.productId, productEntry)
      byWarehouse.set(warehouseLabel, warehouseEntry)
    }

    const warehouses = Array.from(byWarehouse.values())
      .map((entry) => ({
        warehouse: entry.warehouse,
        totalQuantity: entry.totalQuantity,
        items: Array.from(entry.items.values()).sort((a, b) => b.quantity - a.quantity),
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)

    return { items, warehouses }
  }

  const buildTransfersStructuredReport = async () => {
    const routes = (transfersQuery.data?.items ?? []).map((item) => ({
      origin: item.fromWarehouse ? `${item.fromWarehouse.code ?? ''} ${item.fromWarehouse.name ?? ''}`.trim() || item.fromWarehouse.id : '—',
      destination: item.toWarehouse ? `${item.toWarehouse.code ?? ''} ${item.toWarehouse.name ?? ''}`.trim() || item.toWarehouse.id : '—',
      quantity: toNumber(item.quantity),
      movementsCount: item.movementsCount,
    }))
    return { routes }
  }

  const buildRotationStructuredReport = async () => {
    const items = (rotationQuery.data?.items ?? []).map((item) => ({
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      movementsIn: item.movementsIn,
      movementsOut: item.movementsOut,
      totalMovements: item.totalMovements,
      currentStock: item.currentStock,
    }))

    const stockByWarehouseProduct = new Map<string, number>()
    for (const balance of stockBalancesExpandedQuery.data?.items ?? []) {
      const warehouse = balance.location?.warehouse
      if (!warehouse) continue
      const key = `${warehouse.id}:${balance.productId}`
      stockByWarehouseProduct.set(key, (stockByWarehouseProduct.get(key) ?? 0) + Math.max(0, toNumber(balance.quantity) - toNumber(balance.reservedQuantity)))
    }

    const byWarehouse = new Map<string, { warehouse: string; items: Map<string, { productId: string; sku: string; name: string; movementsIn: number; movementsOut: number; totalMovements: number; currentStock: number }> }>()
    for (const movement of stockMovementsExpandedQuery.data?.items ?? []) {
      const productKeySeed = { productId: movement.productId, sku: movement.product.sku, name: movement.product.name }

      if (movement.type === 'IN' || (movement.type === 'ADJUSTMENT' && movement.toLocation)) {
        const warehouse = movement.toLocation?.warehouse
        if (warehouse) {
          const label = `${warehouse.code ?? ''} ${warehouse.name ?? ''}`.trim()
          const group = byWarehouse.get(label) ?? { warehouse: label, items: new Map() }
          const existing = group.items.get(movement.productId) ?? { ...productKeySeed, movementsIn: 0, movementsOut: 0, totalMovements: 0, currentStock: stockByWarehouseProduct.get(`${warehouse.id}:${movement.productId}`) ?? 0 }
          existing.movementsIn += 1
          existing.totalMovements += 1
          group.items.set(movement.productId, existing)
          byWarehouse.set(label, group)
        }
      }

      if (movement.type === 'OUT' || (movement.type === 'ADJUSTMENT' && !movement.toLocation)) {
        const warehouse = movement.fromLocation?.warehouse
        if (warehouse) {
          const label = `${warehouse.code ?? ''} ${warehouse.name ?? ''}`.trim()
          const group = byWarehouse.get(label) ?? { warehouse: label, items: new Map() }
          const existing = group.items.get(movement.productId) ?? { ...productKeySeed, movementsIn: 0, movementsOut: 0, totalMovements: 0, currentStock: stockByWarehouseProduct.get(`${warehouse.id}:${movement.productId}`) ?? 0 }
          existing.movementsOut += 1
          existing.totalMovements += 1
          group.items.set(movement.productId, existing)
          byWarehouse.set(label, group)
        }
      }
    }

    for (const balance of stockBalancesExpandedQuery.data?.items ?? []) {
      const warehouse = balance.location?.warehouse
      if (!warehouse) continue
      const label = `${warehouse.code ?? ''} ${warehouse.name ?? ''}`.trim()
      const group = byWarehouse.get(label) ?? { warehouse: label, items: new Map() }
      const existing = group.items.get(balance.productId) ?? { productId: balance.productId, sku: balance.product.sku, name: balance.product.name, movementsIn: 0, movementsOut: 0, totalMovements: 0, currentStock: 0 }
      existing.currentStock = stockByWarehouseProduct.get(`${warehouse.id}:${balance.productId}`) ?? existing.currentStock
      group.items.set(balance.productId, existing)
      byWarehouse.set(label, group)
    }

    const warehouses = Array.from(byWarehouse.values())
      .map((entry) => ({
        warehouse: entry.warehouse,
        items: Array.from(entry.items.values()).sort((a, b) => b.totalMovements - a.totalMovements),
      }))
      .sort((a, b) => a.warehouse.localeCompare(b.warehouse))

    return { items, warehouses }
  }

  const buildLowStockStructuredReport = async () => {
    const items = lowStockQuery.data?.items ?? []
    const itemIds = new Set(items.map((item) => item.productId))
    const byWarehouse = new Map<string, Array<{ productId: string; sku: string; name: string; currentStock: number }>>()

    for (const balance of stockBalancesExpandedQuery.data?.items ?? []) {
      if (!itemIds.has(balance.productId)) continue
      const warehouse = balance.location?.warehouse
      if (!warehouse) continue
      const label = `${warehouse.code ?? ''} ${warehouse.name ?? ''}`.trim()
      const entry = byWarehouse.get(label) ?? []
      const existing = entry.find((item) => item.productId === balance.productId)
      const available = Math.max(0, toNumber(balance.quantity) - toNumber(balance.reservedQuantity))
      if (existing) {
        existing.currentStock += available
      } else {
        entry.push({ productId: balance.productId, sku: balance.product.sku, name: balance.product.name, currentStock: available })
      }
      byWarehouse.set(label, entry)
    }

    const warehouses = Array.from(byWarehouse.entries())
      .map(([warehouse, warehouseItems]) => ({
        warehouse,
        items: warehouseItems.sort((a, b) => a.currentStock - b.currentStock),
      }))
      .filter((section) => section.items.length > 0)

    return { items, warehouses }
  }

  const buildExpiryStructuredReport = async () => {
    const items = (expiryQuery.data?.items ?? []).map((item) => ({
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      warehouse: `${item.warehouseCode ?? ''} ${item.warehouseName ?? ''}`.trim() || item.warehouseId,
      locationName: item.locationName ?? '—',
      lotNumber: item.lotNumber,
      expiryDate: item.expiryDate,
      quantity: item.quantity,
      daysUntilExpiry: item.daysUntilExpiry,
    }))

    const byWarehouse = new Map<string, typeof items>()
    for (const item of items) {
      const group = byWarehouse.get(item.warehouse) ?? []
      group.push(item)
      byWarehouse.set(item.warehouse, group)
    }

    const warehouses = Array.from(byWarehouse.entries()).map(([warehouse, warehouseItems]) => ({
      warehouse,
      items: warehouseItems.sort((a, b) => (a.daysUntilExpiry ?? 9999) - (b.daysUntilExpiry ?? 9999)),
    }))

    return { items, warehouses }
  }

  const emailMutation = useMutation({
    mutationFn: async () => {
      if (!reportRef.current) throw new Error('No se pudo generar el PDF')
      if (!emailTo.trim()) throw new Error('Ingresa un correo válido')
      let blob: Blob

      if (tab === 'OPS') {
        const report = await buildOpsStructuredReport()
        blob = await pdfBlobFromReactNode(<StockOpsDocument title={title} from={from} to={to} summary={report.summary} byCity={report.byCity} flows={report.flows} fulfilled={report.fulfilled} traces={report.traces} returnsSummary={report.returnsSummary} returnsByWarehouse={report.returnsByWarehouse} />, { title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
      } else if (tab === 'INPUTS') {
        const report = await buildInputsStructuredReport()
        blob = await pdfBlobFromReactNode(<StockInputsDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} />, { title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
      } else if (tab === 'TRANSFERS') {
        const report = await buildTransfersStructuredReport()
        blob = await pdfBlobFromReactNode(<StockTransfersDocument title={title} from={from} to={to} routes={report.routes} />, { title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
      } else if (tab === 'ROTATION') {
        const report = await buildRotationStructuredReport()
        blob = await pdfBlobFromReactNode(<StockRotationDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} mode="ROTATION" />, { title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
      } else if (tab === 'NOMOVEMENT') {
        const report = await buildRotationStructuredReport()
        blob = await pdfBlobFromReactNode(<StockRotationDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} mode="NOMOVEMENT" />, { title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
      } else if (tab === 'LOWSTOCK') {
        const report = await buildLowStockStructuredReport()
        blob = await pdfBlobFromReactNode(<StockLowStockDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} />, { title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
      } else if (tab === 'EXPIRY') {
        const report = await buildExpiryStructuredReport()
        blob = await pdfBlobFromReactNode(<StockExpiryDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} />, { title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
      } else {
        blob = await pdfBlobFromElement(reportRef.current, { title })
      }

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

  const exportLegacyPdf = async () => {
    if (!reportRef.current) return

    await exportElementToPdf(reportRef.current, {
      filename: exportFilename,
      title,
      subtitle: `Período: ${formatDate(new Date(from))} - ${formatDate(new Date(to))}`,
      companyName: tenant.branding?.tenantName ?? 'Empresa',
      headerColor: '#3B82F6',
      logoUrl: tenant.branding?.logoUrl ?? undefined,
    })
  }

  const handleExportPdf = async () => {
    setExportingPdf(true)
    try {
      if (tab === 'OPS') {
        const report = await buildOpsStructuredReport()
        await exportReactNodeToPdf(
          <StockOpsDocument
            title={title}
            from={from}
            to={to}
            summary={report.summary}
            byCity={report.byCity}
            flows={report.flows}
            fulfilled={report.fulfilled}
            traces={report.traces}
            returnsSummary={report.returnsSummary}
            returnsByWarehouse={report.returnsByWarehouse}
          />,
          {
            filename: exportFilename,
            title,
            subtitle: `Período: ${from} a ${to}`,
            companyName: tenant.branding?.tenantName ?? 'Empresa',
            headerColor: '#3B82F6',
            logoUrl: tenant.branding?.logoUrl ?? undefined,
            captureWidthPx: 1240,
          },
        )
        return
      }

      if (tab === 'INPUTS') {
        const report = await buildInputsStructuredReport()
        await exportReactNodeToPdf(<StockInputsDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} />, { filename: exportFilename, title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
        return
      }

      if (tab === 'TRANSFERS') {
        const report = await buildTransfersStructuredReport()
        await exportReactNodeToPdf(<StockTransfersDocument title={title} from={from} to={to} routes={report.routes} />, { filename: exportFilename, title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
        return
      }

      if (tab === 'ROTATION') {
        const report = await buildRotationStructuredReport()
        await exportReactNodeToPdf(<StockRotationDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} mode="ROTATION" />, { filename: exportFilename, title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
        return
      }

      if (tab === 'NOMOVEMENT') {
        const report = await buildRotationStructuredReport()
        await exportReactNodeToPdf(<StockRotationDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} mode="NOMOVEMENT" />, { filename: exportFilename, title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
        return
      }

      if (tab === 'LOWSTOCK') {
        const report = await buildLowStockStructuredReport()
        await exportReactNodeToPdf(<StockLowStockDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} />, { filename: exportFilename, title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
        return
      }

      if (tab === 'EXPIRY') {
        const report = await buildExpiryStructuredReport()
        await exportReactNodeToPdf(<StockExpiryDocument title={title} from={from} to={to} items={report.items} warehouses={report.warehouses} />, { filename: exportFilename, title, subtitle: `Período: ${from} a ${to}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#3B82F6', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1240 })
        return
      }

      await exportLegacyPdf()
    } finally {
      setExportingPdf(false)
    }
  }

  const handleExportExcel = async () => {
    setExportingExcel(true)
    try {
      if (tab !== 'OPS') {
        if (tab === 'INPUTS') {
          const report = await buildInputsStructuredReport()
          exportToXlsx(`reporte-stock-ingresos-${from}-${to}.xlsx`, [
            { name: 'Resumen', rows: report.items.map((item) => ({ SKU: item.sku, Producto: item.name, Movimientos: item.movementsCount, Unidades: item.quantity })) },
            { name: 'Por sucursal', rows: report.warehouses.flatMap((section) => section.items.map((item) => ({ Sucursal: section.warehouse, SKU: item.sku, Producto: item.name, Movimientos: item.movementsCount, Unidades: item.quantity }))) },
            { name: 'Meta', rows: [{ Reporte: title, Desde: from, Hasta: to, Generado: new Date().toLocaleString() }] },
          ])
          return
        }

        if (tab === 'TRANSFERS') {
          const report = await buildTransfersStructuredReport()
          exportToXlsx(`reporte-stock-traspasos-${from}-${to}.xlsx`, [
            { name: 'Rutas', rows: report.routes.map((item) => ({ Origen: item.origin, Destino: item.destination, Movimientos: item.movementsCount, Unidades: item.quantity })) },
            { name: 'Meta', rows: [{ Reporte: title, Desde: from, Hasta: to, Generado: new Date().toLocaleString() }] },
          ])
          return
        }

        if (tab === 'ROTATION' || tab === 'NOMOVEMENT') {
          const report = await buildRotationStructuredReport()
          const filtered = tab === 'NOMOVEMENT' ? report.items.filter((item) => item.totalMovements <= 1) : report.items
          exportToXlsx(`reporte-stock-${tab === 'ROTATION' ? 'rotacion' : 'sin-movimiento'}-${from}-${to}.xlsx`, [
            { name: 'Resumen', rows: filtered.map((item) => ({ SKU: item.sku, Producto: item.name, Entradas: item.movementsIn, Salidas: item.movementsOut, Movimientos: item.totalMovements, StockActual: item.currentStock })) },
            { name: 'Por sucursal', rows: report.warehouses.flatMap((section) => section.items.filter((item) => tab === 'ROTATION' || item.totalMovements <= 1).map((item) => ({ Sucursal: section.warehouse, SKU: item.sku, Producto: item.name, Entradas: item.movementsIn, Salidas: item.movementsOut, Movimientos: item.totalMovements, StockActual: item.currentStock }))) },
            { name: 'Meta', rows: [{ Reporte: title, Desde: from, Hasta: to, Generado: new Date().toLocaleString() }] },
          ])
          return
        }

        if (tab === 'LOWSTOCK') {
          const report = await buildLowStockStructuredReport()
          exportToXlsx(`reporte-stock-bajo-${from}-${to}.xlsx`, [
            { name: 'Resumen', rows: report.items.map((item) => ({ SKU: item.sku, Producto: item.name, StockActual: item.currentStock, Minimo: item.minStock, VentaDiaria: item.avgDailySales, DiasStock: item.daysOfStock })) },
            { name: 'Por sucursal', rows: report.warehouses.flatMap((section) => section.items.map((item) => ({ Sucursal: section.warehouse, SKU: item.sku, Producto: item.name, StockLocal: item.currentStock }))) },
            { name: 'Meta', rows: [{ Reporte: title, Desde: from, Hasta: to, Generado: new Date().toLocaleString() }] },
          ])
          return
        }

        if (tab === 'EXPIRY') {
          const report = await buildExpiryStructuredReport()
          exportToXlsx(`reporte-stock-vencimiento-${from}-${to}.xlsx`, [
            { name: 'Resumen', rows: report.items.map((item) => ({ Sucursal: item.warehouse, SKU: item.sku, Producto: item.name, Ubicacion: item.locationName, Lote: item.lotNumber ?? '—', Vence: item.expiryDate ?? '—', Unidades: item.quantity, Dias: item.daysUntilExpiry })) },
            { name: 'Meta', rows: [{ Reporte: title, Desde: from, Hasta: to, Generado: new Date().toLocaleString() }] },
          ])
          return
        }
      }

      const report = await buildOpsStructuredReport()
      exportToXlsx(`reporte-stock-ops-${from}-${to}.xlsx`, [
        {
          name: 'Resumen',
          rows: [
            {
              TotalSolicitudes: report.summary.total,
              Abiertas: report.summary.open,
              Atendidas: report.summary.fulfilled,
              Canceladas: report.summary.cancelled,
              Pendientes: report.summary.pending,
              Aceptadas: report.summary.accepted,
              Rechazadas: report.summary.rejected,
              Devoluciones: report.returnsSummary.returnsCount,
              ItemsDevolucion: report.returnsSummary.itemsCount,
              UnidadesDevueltas: report.returnsSummary.quantity,
            },
          ],
        },
        {
          name: 'Solicitudes ciudad',
          rows: report.byCity.map((item) => ({ Ciudad: item.city, Total: item.total, Abiertas: item.open, Atendidas: item.fulfilled, Canceladas: item.cancelled, Pendientes: item.pending, Aceptadas: item.accepted, Rechazadas: item.rejected })),
        },
        { name: 'Flujos', rows: report.flows.map((item) => ({ Origen: item.origin, Destino: item.destination, Completadas: item.requestsCount, TiempoPromedioMin: item.avgMinutes ?? 0 })) },
        { name: 'Atendidas', rows: report.fulfilled.map((item) => ({ Solicitud: item.id, Destino: item.destination, Origen: item.origin, Solicitante: item.requestedByName, Solicitada: new Date(item.createdAt).toLocaleString(), Atendida: new Date(item.fulfilledAt).toLocaleString(), TiempoMin: item.minutesToFulfill, Items: item.itemsCount, Envios: item.movementsCount })) },
        { name: 'Trace solicitado', rows: report.traces.flatMap((trace) => trace.requestedItems.map((item) => ({ Solicitud: trace.requestId, Destino: trace.destination, Solicitada: new Date(trace.requestedAt).toLocaleString(), Producto: item.product, Presentacion: item.presentation, CantidadSolicitada: item.requestedQuantity }))) },
        { name: 'Trace enviado', rows: report.traces.flatMap((trace) => trace.sentLines.map((item) => ({ Solicitud: trace.requestId, DestinoSolicitud: trace.destination, Fecha: new Date(item.createdAt).toLocaleString(), Origen: item.origin, Destino: item.destination, Producto: item.product, Lote: item.batchNumber ?? '—', Vence: item.expiresAt ? formatDateOnlyUtc(item.expiresAt) : '—', CantidadEnviada: item.quantity }))) },
        { name: 'Devoluciones', rows: report.returnsByWarehouse.map((item) => ({ Sucursal: item.warehouse, Ciudad: item.city, Devoluciones: item.returnsCount, Items: item.itemsCount, Unidades: item.quantity })) },
        { name: 'Meta', rows: [{ Reporte: title, Desde: from, Hasta: to, Generado: new Date().toLocaleString() }] },
      ])
    } catch (err) {
      console.error('Error exportando Excel:', err)
      window.alert('No se pudo generar el Excel')
    } finally {
      setExportingExcel(false)
    }
  }

  const handleExportTraceExcel = () => {
    const trace = movementRequestTraceQuery.data
    if (!trace || !traceRequestId) {
      window.alert('No hay trazabilidad para exportar')
      return
    }

    const comparison = buildTraceProductComparison(trace)
    const origins = buildTraceOriginMix(trace)
    const requestedUnits = comparison.reduce((sum, item) => sum + item.requestedQty, 0)
    const sentUnits = comparison.reduce((sum, item) => sum + item.sentQty, 0)

    exportToXlsx(`trazabilidad-${trace.request.id}.xlsx`, [
      {
        name: 'Resumen',
        rows: [{
          Solicitud: trace.request.id,
          Destino: trace.request.warehouse ? `${trace.request.warehouse.code ?? ''} ${trace.request.warehouse.name ?? ''}`.trim() || trace.request.requestedCity : trace.request.requestedCity,
          Solicitante: trace.request.requestedByName ?? '—',
          Atendio: trace.request.fulfilledByName ?? '—',
          Solicitado: new Date(trace.request.createdAt).toLocaleString(),
          Atendido: trace.request.fulfilledAt ? new Date(trace.request.fulfilledAt).toLocaleString() : '—',
          Tiempo: trace.request.fulfilledAt ? formatMinutes((new Date(trace.request.fulfilledAt).getTime() - new Date(trace.request.createdAt).getTime()) / 60000) : '—',
          Productos: comparison.length,
          UnidadesSolicitadas: requestedUnits,
          UnidadesEnviadas: sentUnits,
        }],
      },
      {
        name: 'Comparativo producto',
        rows: comparison.map((item) => ({
          Producto: item.product,
          Presentacion: item.presentation,
          Solicitado: item.requestedQty,
          Enviado: item.sentQty,
          Diferencia: item.differenceQty,
        })),
      },
      {
        name: 'Origenes',
        rows: origins.map((item) => ({
          Origen: item.label,
          Lineas: item.linesCount,
          Unidades: item.quantity,
        })),
      },
      {
        name: 'Solicitado',
        rows: (trace.requestedItems ?? []).map((item) => ({
          Producto: getProductLabel({ sku: item.productSku ?? '—', name: item.productName ?? '—', genericName: item.genericName ?? null }),
          Presentacion: formatPresentationLabel(item.presentation),
          CantidadSolicitada: Number(item.requestedQuantity ?? 0),
        })),
      },
      {
        name: 'Enviado',
        rows: (trace.sentLines ?? []).map((line) => ({
          Fecha: new Date(line.createdAt).toLocaleString(),
          Origen: formatLocationWithWarehouse(line.fromLocation),
          Destino: formatLocationWithWarehouse(line.toLocation),
          Producto: getProductLabel({ sku: line.productSku ?? '—', name: line.productName ?? '—', genericName: line.genericName ?? null }),
          Presentacion: formatPresentationLabel(line.presentation),
          Lote: line.batchNumber ?? '—',
          Vence: line.expiresAt ? formatDateOnlyUtc(line.expiresAt) : '—',
          CantidadEnviada: Number(line.quantity ?? 0),
        })),
      },
    ])
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="📦 Reportes de Stock">
        {/* LÍNEA 2: Tipo de Reporte | Acciones */}
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Tipos de reporte - botones outline */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-2 text-sm font-medium text-slate-600 dark:text-slate-400">Tipo de reporte:</span>
              <Button size="sm" variant={tab === 'INPUTS' ? 'primary' : 'outline'} onClick={() => setTab('INPUTS')}>
                📥 Ingresos
              </Button>
              <Button size="sm" variant={tab === 'TRANSFERS' ? 'primary' : 'outline'} onClick={() => setTab('TRANSFERS')}>
                🔁 Traspasos
              </Button>
              <Button size="sm" variant={tab === 'ROTATION' ? 'primary' : 'outline'} onClick={() => setTab('ROTATION')}>
                🔄 Rotación
              </Button>
              <Button size="sm" variant={tab === 'NOMOVEMENT' ? 'primary' : 'outline'} onClick={() => setTab('NOMOVEMENT')}>
                💤 Sin Movimiento
              </Button>
              <Button size="sm" variant={tab === 'LOWSTOCK' ? 'primary' : 'outline'} onClick={() => setTab('LOWSTOCK')}>
                ⚠️ Stock Bajo
              </Button>
              <Button size="sm" variant={tab === 'EXPIRY' ? 'primary' : 'outline'} onClick={() => setTab('EXPIRY')}>
                📅 Por Vencer
              </Button>
              <Button size="sm" variant={tab === 'OPS' ? 'primary' : 'outline'} onClick={() => setTab('OPS')}>
                📨 Ops
              </Button>
            </div>
            
            {/* Acciones - botones ghost */}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700 lg:border-t-0 lg:border-l lg:pl-4 lg:pt-0">
              <span className="mr-2 hidden text-sm font-medium text-slate-600 dark:text-slate-400 lg:inline">Acciones:</span>
              <Button
                size="sm"
                variant="ghost"
                loading={exportingPdf}
                onClick={handleExportPdf}
              >
                ⬇️ PDF
              </Button>
              <Button size="sm" variant="ghost" loading={exportingExcel} onClick={handleExportExcel}>
                ⬇️ Excel
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEmailModalOpen(true)}>
                ✉️ Enviar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setScheduleModalOpen(true)}>
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
          </div>
        </div>

        {/* LÍNEA 3: Filtros de período */}
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Input label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <div className="col-span-2 flex items-end md:col-span-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const now = new Date()
                  setFrom(toIsoDate(startOfMonth(now)))
                  setTo(toIsoDate(startOfNextMonth(now)))
                }}
              >
                Reset mes
              </Button>
            </div>
          </div>
        </div>

        <div ref={reportRef} className="space-y-4">
          {/* Header del reporte mejorado */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:border-slate-700 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
            {/* Banner superior */}
            <div className="h-2 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

            <div className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-3xl shadow-lg backdrop-blur-sm">
                    📦
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      Análisis detallado de inventario y movimientos
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    🏢 {tenant.branding?.tenantName ?? 'Empresa'}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    📅 {formatDate(new Date())}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {tab === 'INPUTS' && (
            <ReportSection
              title="📦 Existencias Ingresadas"
              subtitle="Productos con mayor ingreso de inventario"
              icon="📊"
            >
              {inputsQuery.isLoading && <Loading />}
              {inputsQuery.isError && <ErrorState message={(inputsQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!inputsQuery.isLoading && !inputsQuery.isError && (inputsQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ingresos de stock en el rango seleccionado." />
              )}
              {!inputsQuery.isLoading && !inputsQuery.isError && (inputsQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  {/* KPIs de ingresos */}
                  <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
                    <KPICard
                      icon="📦"
                      label="Productos Ingresados"
                      value={(inputsQuery.data?.items ?? []).length}
                      color="primary"
                    />
                    <KPICard
                      icon="📊"
                      label="Total Movimientos"
                      value={(inputsQuery.data?.items ?? []).reduce((sum, i) => sum + i.movementsCount, 0)}
                      color="info"
                    />
                    <KPICard
                      icon="📥"
                      label="Unidades Totales"
                      value={(inputsQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.quantity), 0).toFixed(0)}
                      color="success"
                    />
                    <KPICard
                      icon="⭐"
                      label="Producto Top"
                      value={(inputsQuery.data?.items ?? [])[0]?.name?.slice(0, 15) ?? '-'}
                      subtitle={`${toNumber((inputsQuery.data?.items ?? [])[0]?.quantity).toFixed(0)} unidades`}
                      color="warning"
                    />
                  </div>

                  {/* Gráfico mejorado */}
                  <div className="mx-auto mb-6 h-[450px] w-full min-w-0 max-w-5xl overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={350}>
                      <BarChart
                        data={(inputsQuery.data?.items ?? []).slice(0, 15).map((i) => ({
                          name: `${i.sku}`,
                          fullName: i.name,
                          quantity: toNumber(i.quantity),
                          movementsCount: i.movementsCount,
                        }))}
                        margin={{ left: 10, right: 30, bottom: 80 }}
                      >
                        <CartesianGrid {...chartGridStyle} />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} {...chartAxisStyle} />
                        <YAxis yAxisId="left" {...chartAxisStyle} label={{ value: 'Cantidad', angle: -90, position: 'insideLeft' }} />
                        <YAxis yAxisId="right" orientation="right" {...chartAxisStyle} label={{ value: 'Movimientos', angle: 90, position: 'insideRight' }} />
                        <Tooltip
                          {...chartTooltipStyle}
                          formatter={(v: any, name: any) => {
                            const label = name === 'quantity' ? 'Cantidad Ingresada' : 'Nº Movimientos'
                            return [v, label]
                          }}
                          labelFormatter={(label, payload) => {
                            if (payload && payload[0] && payload[0].payload) {
                              return payload[0].payload.fullName
                            }
                            return label
                          }}
                        />
                        <Legend />
                        <Bar yAxisId="left" dataKey="quantity" fill={reportColors.success[0]} name="Cantidad Ingresada" radius={[8, 8, 0, 0]} />
                        <Bar yAxisId="right" dataKey="movementsCount" fill={reportColors.primary[0]} name="Movimientos" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Tabla detallada */}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                    <Table
                      columns={[
                        {
                          header: '🏅 Ranking',
                          accessor: (_, idx) => (
                            <div className="flex items-center justify-center">
                              {idx < 3 ? (
                                <span className="text-2xl">{['🥇', '🥈', '🥉'][idx]}</span>
                              ) : (
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-bold dark:bg-slate-700">
                                  {idx + 1}
                                </span>
                              )}
                            </div>
                          ),
                        },
                        { header: '🔖 SKU', accessor: (r) => <span className="font-mono text-xs">{r.sku}</span> },
                        { header: '📦 Producto', accessor: (r) => <span className="font-medium">{r.name}</span> },
                        {
                          header: '📊 Movimientos',
                          accessor: (r) => (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                              {r.movementsCount}
                            </span>
                          ),
                        },
                        {
                          header: '📥 Cantidad Ingresada',
                          accessor: (r) => (
                            <span className="font-semibold tabular-nums text-green-600 dark:text-green-400">
                              {toNumber(r.quantity).toFixed(0)}
                            </span>
                          ),
                        },
                        {
                          header: '% del Total',
                          accessor: (r) => {
                            const total = (inputsQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.quantity), 0)
                            const pct = total > 0 ? (toNumber(r.quantity) / total) * 100 : 0
                            const pctSafe = Number.isFinite(pct) ? pct : 0
                            return (
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                  <div className="h-full bg-green-500" style={{ width: `${pctSafe}%` }} />
                                </div>
                                <span className="text-sm tabular-nums">{pctSafe.toFixed(1)}%</span>
                              </div>
                            )
                          },
                        },
                      ]}
                      data={inputsQuery.data?.items ?? []}
                      keyExtractor={(r) => r.productId}
                    />
                  </div>
                </>
              )}
            </ReportSection>
          )}

          {tab === 'TRANSFERS' && (
            <ReportSection
              title="🚚 Traspasos entre Sucursales"
              subtitle="Movimientos de inventario entre almacenes"
              icon="🔄"
            >
              {transfersQuery.isLoading && <Loading />}
              {transfersQuery.isError && (
                <ErrorState message={(transfersQuery.error as any)?.message ?? 'Error cargando reporte'} />
              )}
              {!transfersQuery.isLoading && !transfersQuery.isError && (transfersQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay traspasos en el rango seleccionado." />
              )}
              {!transfersQuery.isLoading && !transfersQuery.isError && (transfersQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  {/* KPIs de traspasos */}
                  <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <KPICard
                      icon="🔄"
                      label="Rutas de Traspaso"
                      value={(transfersQuery.data?.items ?? []).length}
                      color="info"
                    />
                    <KPICard
                      icon="📊"
                      label="Total Movimientos"
                      value={(transfersQuery.data?.items ?? []).reduce((sum, i) => sum + i.movementsCount, 0)}
                      color="primary"
                    />
                    <KPICard
                      icon="📦"
                      label="Unidades Transferidas"
                      value={(transfersQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.quantity), 0).toFixed(0)}
                      color="warning"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* Gráfico de torta para rutas más activas */}
                    <div className="h-[400px] w-full min-w-0 overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                      <h4 className="mb-4 text-center text-sm font-semibold text-slate-700 dark:text-slate-300">
                        Distribución por Ruta
                      </h4>
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                        <PieChart>
                          <Pie
                            data={(transfersQuery.data?.items ?? []).slice(0, 8).map((i) => ({
                              name: `${i.fromWarehouse?.code ?? 'N/A'} → ${i.toWarehouse?.code ?? 'N/A'}`,
                              value: toNumber(i.quantity),
                            }))}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={3}
                            label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                          >
                            {(transfersQuery.data?.items ?? []).slice(0, 8).map((_, idx) => (
                              <Cell key={idx} fill={getChartColor(idx, 'rainbow')} />
                            ))}
                          </Pie>
                          <Tooltip {...chartTooltipStyle} formatter={(v: any) => [`${Number(v).toFixed(0)} unid.`, 'Transferido']} />
                          <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Gráfico de barras */}
                    <div className="h-[400px] w-full min-w-0 overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                      <h4 className="mb-4 text-center text-sm font-semibold text-slate-700 dark:text-slate-300">
                        Top Rutas por Volumen
                      </h4>
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                        <BarChart
                          data={(transfersQuery.data?.items ?? []).slice(0, 10).map((i) => ({
                            name: `${i.fromWarehouse?.code ?? 'N/A'} → ${i.toWarehouse?.code ?? 'N/A'}`,
                            quantity: toNumber(i.quantity),
                            movementsCount: i.movementsCount,
                          }))}
                          margin={{ left: 10, right: 10, bottom: 80 }}
                        >
                          <CartesianGrid {...chartGridStyle} />
                          <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} {...chartAxisStyle} />
                          <YAxis {...chartAxisStyle} />
                          <Tooltip {...chartTooltipStyle} />
                          <Legend />
                          <Bar dataKey="quantity" fill={reportColors.warning[0]} name="Cantidad" radius={[8, 8, 0, 0]} />
                          <Bar dataKey="movementsCount" fill={reportColors.primary[1]} name="Movimientos" radius={[8, 8, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Tabla detallada */}
                  <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700">
                    <Table
                      columns={[
                        {
                          header: '🏅 Ranking',
                          accessor: (_, idx) => (
                            <div className="flex items-center justify-center">
                              {idx < 3 ? (
                                <span className="text-2xl">{['🥇', '🥈', '🥉'][idx]}</span>
                              ) : (
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-bold dark:bg-slate-700">
                                  {idx + 1}
                                </span>
                              )}
                            </div>
                          ),
                        },
                        {
                          header: '📤 Desde',
                          accessor: (r) => (
                            <span className="font-medium">
                              {r.fromWarehouse ? `${r.fromWarehouse.code ?? ''} ${r.fromWarehouse.name ?? ''}`.trim() : 'N/A'}
                            </span>
                          ),
                        },
                        {
                          header: '📥 Hacia',
                          accessor: (r) => (
                            <span className="font-medium">
                              {r.toWarehouse ? `${r.toWarehouse.code ?? ''} ${r.toWarehouse.name ?? ''}`.trim() : 'N/A'}
                            </span>
                          ),
                        },
                        {
                          header: '📊 Movimientos',
                          accessor: (r) => (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                              {r.movementsCount}
                            </span>
                          ),
                        },
                        {
                          header: '📦 Cantidad Transferida',
                          accessor: (r) => (
                            <span className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                              {toNumber(r.quantity).toFixed(0)}
                            </span>
                          ),
                        },
                      ]}
                      data={transfersQuery.data?.items ?? []}
                      keyExtractor={(r) => `${r.fromWarehouse?.id ?? 'x'}-${r.toWarehouse?.id ?? 'y'}`}
                    />
                  </div>
                </>
              )}
            </ReportSection>
          )}

          {/* Reporte de Rotación de Inventario */}
          {tab === 'ROTATION' && (
            <ReportSection
              title="🔄 Rotación de Inventario"
              subtitle="Velocidad de movimiento de productos"
              icon="📈"
            >
              {rotationQuery.isLoading && <Loading />}
              {rotationQuery.isError && <ErrorState message={(rotationQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!rotationQuery.isLoading && !rotationQuery.isError && (rotationQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay datos de rotación disponibles." />
              )}
              {!rotationQuery.isLoading && !rotationQuery.isError && (rotationQuery.data?.items?.length ?? 0) > 0 && (() => {
                const items = rotationQuery.data?.items ?? []
                const totalMovements = items.reduce((s, i) => s + i.totalMovements, 0)
                const avgRotation = items.length > 0 ? totalMovements / items.length : 0
                const highRotation = items.filter(i => i.totalMovements > avgRotation).length
                const lowRotation = items.filter(i => i.totalMovements <= avgRotation / 2).length

                return (
                  <>
                    {/* KPIs de rotación */}
                    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                      <KPICard
                        icon="🔄"
                        label="Total Movimientos"
                        value={totalMovements.toString()}
                        color="primary"
                        subtitle="En el período"
                      />
                      <KPICard
                        icon="📊"
                        label="Rotación Promedio"
                        value={avgRotation.toFixed(1)}
                        color="info"
                        subtitle="Movimientos por producto"
                      />
                      <KPICard
                        icon="🚀"
                        label="Alta Rotación"
                        value={highRotation.toString()}
                        color="success"
                        subtitle="Productos de rápido movimiento"
                      />
                      <KPICard
                        icon="🐢"
                        label="Baja Rotación"
                        value={lowRotation.toString()}
                        color="warning"
                        subtitle="Productos de lento movimiento"
                      />
                    </div>

                    {/* Clasificación por velocidad */}
                    <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                        <h4 className="mb-2 flex items-center gap-2 font-semibold text-green-800 dark:text-green-200">
                          <span className="text-xl">🚀</span> Alta Rotación
                        </h4>
                        <p className="text-sm text-green-700 dark:text-green-300">
                          {highRotation} productos con más de {avgRotation.toFixed(0)} movimientos
                        </p>
                        <ul className="mt-2 space-y-1 text-sm text-green-600 dark:text-green-400">
                          {items.filter(i => i.totalMovements > avgRotation).slice(0, 3).map((item, idx) => (
                            <li key={idx}>• {item.name.slice(0, 25)}... ({item.totalMovements} mov.)</li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                        <h4 className="mb-2 flex items-center gap-2 font-semibold text-blue-800 dark:text-blue-200">
                          <span className="text-xl">📊</span> Rotación Media
                        </h4>
                        <p className="text-sm text-blue-700 dark:text-blue-300">
                          {items.filter(i => i.totalMovements <= avgRotation && i.totalMovements > avgRotation / 2).length} productos
                        </p>
                      </div>

                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                        <h4 className="mb-2 flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200">
                          <span className="text-xl">🐢</span> Baja Rotación
                        </h4>
                        <p className="text-sm text-amber-700 dark:text-amber-300">
                          {lowRotation} productos requieren atención
                        </p>
                        <ul className="mt-2 space-y-1 text-sm text-amber-600 dark:text-amber-400">
                          {items.filter(i => i.totalMovements <= avgRotation / 2).slice(0, 3).map((item, idx) => (
                            <li key={idx}>• {item.name.slice(0, 25)}... ({item.totalMovements} mov.)</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Tabla de rotación */}
                    <Table
                      columns={[
                        { header: 'SKU', accessor: (r) => <span className="font-mono text-xs">{r.sku}</span> },
                        { header: 'Producto', accessor: (r) => r.name },
                        { header: 'Entradas', accessor: (r) => r.movementsIn, className: 'text-center' },
                        { header: 'Salidas', accessor: (r) => r.movementsOut, className: 'text-center' },
                        { header: 'Total Mov.', accessor: (r) => r.totalMovements, className: 'text-center' },
                        { header: 'Stock Actual', accessor: (r) => r.currentStock, className: 'text-right' },
                        { 
                          header: 'Clasificación', 
                          accessor: (r) => {
                            if (r.totalMovements > avgRotation) return <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">Alta</span>
                            if (r.totalMovements > avgRotation / 2) return <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">Media</span>
                            return <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">Baja</span>
                          }
                        },
                      ]}
                      data={items}
                      keyExtractor={(r) => r.productId}
                    />
                  </>
                )
              })()}
            </ReportSection>
          )}

          {/* Reporte de Productos Sin Movimiento */}
          {tab === 'NOMOVEMENT' && (
            <ReportSection
              title="💤 Productos Sin Movimiento"
              subtitle="Inventario estancado que requiere atención"
              icon="⚠️"
            >
              {rotationQuery.isLoading && <Loading />}
              {rotationQuery.isError && <ErrorState message={(rotationQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!rotationQuery.isLoading && !rotationQuery.isError && (() => {
                const items = rotationQuery.data?.items ?? []
                const avgMovement = items.reduce((s, i) => s + i.totalMovements, 0) / (items.length || 1)
                const noMovementItems = items.filter(i => i.totalMovements <= 1).slice(0, 15)

                return (
                  <>
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        ⚠️ <strong>Nota:</strong> Este reporte muestra productos con muy bajo movimiento en el período seleccionado.
                        Considere promociones o ajustes de inventario.
                      </p>
                    </div>

                    {/* KPIs */}
                    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
                      <KPICard
                        icon="💤"
                        label="Productos Estancados"
                        value={noMovementItems.length.toString()}
                        color="warning"
                        subtitle="Con ≤1 movimiento"
                      />
                      <KPICard
                        icon="📊"
                        label="Movimiento Promedio"
                        value={avgMovement.toFixed(1)}
                        color="info"
                        subtitle="Por producto"
                      />
                      <KPICard
                        icon="💡"
                        label="Recomendación"
                        value="Revisar"
                        color="primary"
                        subtitle="Estrategia de ventas"
                      />
                    </div>

                    {noMovementItems.length > 0 ? (
                      <>
                        {/* Lista de productos sin movimiento */}
                        <div className="mb-6 space-y-2">
                          <h4 className="font-semibold text-slate-700 dark:text-slate-300">📦 Productos sin movimiento o con movimiento mínimo</h4>
                          {noMovementItems.map((item, idx) => (
                            <div 
                              key={idx}
                              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-2xl">📦</span>
                                <div>
                                  <p className="font-medium text-slate-800 dark:text-slate-200">{item.name}</p>
                                  <p className="text-sm text-slate-500 dark:text-slate-400">SKU: {item.sku}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-amber-600 dark:text-amber-400">{item.totalMovements} mov.</p>
                                <p className="text-xs text-slate-500">{toNumber(item.currentStock).toFixed(0)} unid.</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Recomendaciones */}
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                          <h4 className="mb-2 font-semibold text-blue-800 dark:text-blue-200">💡 Acciones Recomendadas</h4>
                          <ul className="list-inside list-disc space-y-1 text-sm text-blue-700 dark:text-blue-300">
                            <li>Crear promociones o descuentos para mover inventario estancado</li>
                            <li>Revisar si los productos están correctamente exhibidos</li>
                            <li>Considerar devolución al proveedor si es posible</li>
                            <li>Evaluar si continuar comprando estos productos</li>
                          </ul>
                        </div>
                      </>
                    ) : (
                      <EmptyState message="¡Excelente! No hay productos sin movimiento en este período." />
                    )}
                  </>
                )
              })()}
            </ReportSection>
          )}

          {/* Reporte de Stock Bajo */}
          {tab === 'LOWSTOCK' && (
            <ReportSection
              title="⚠️ Stock Bajo / Por Agotar"
              subtitle="Productos que necesitan reposición urgente"
              icon="📉"
            >
              {lowStockQuery.isLoading && <Loading />}
              {lowStockQuery.isError && <ErrorState message={(lowStockQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!lowStockQuery.isLoading && !lowStockQuery.isError && (lowStockQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay productos con stock bajo." />
              )}
              {!lowStockQuery.isLoading && !lowStockQuery.isError && (lowStockQuery.data?.items?.length ?? 0) > 0 && (() => {
                const items = lowStockQuery.data?.items ?? []
                const critical = items.filter(i => i.currentStock <= 5)
                const low = items.filter(i => i.currentStock > 5 && i.currentStock <= 10)

                return (
                  <>
                    {/* KPIs */}
                    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                      <KPICard
                        icon="🔴"
                        label="Crítico"
                        value={critical.length.toString()}
                        color="warning"
                        subtitle="Stock ≤ 5 unidades"
                      />
                      <KPICard
                        icon="🟡"
                        label="Bajo"
                        value={low.length.toString()}
                        color="info"
                        subtitle="Stock ≤ 10 unidades"
                      />
                      <KPICard
                        icon="📦"
                        label="Total Alertas"
                        value={items.length.toString()}
                        color="primary"
                        subtitle="Productos monitoreados"
                      />
                      <KPICard
                        icon="📊"
                        label="Días Promedio"
                        value={items.length > 0 
                          ? (items.reduce((s, i) => s + (i.daysOfStock ?? 0), 0) / items.length).toFixed(0)
                          : '0'
                        }
                        color="info"
                        subtitle="Cobertura de stock"
                      />
                    </div>

                    {/* Lista de alertas críticas */}
                    {critical.length > 0 && (
                      <div className="mb-6 space-y-3">
                        <h4 className="font-semibold text-slate-700 dark:text-slate-300">🔴 Productos con Stock Crítico</h4>
                        {critical.slice(0, 10).map((item, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">🔴</span>
                              <div>
                                <p className="font-medium text-red-800 dark:text-red-200">{item.name}</p>
                                <p className="text-sm text-red-600 dark:text-red-400">
                                  SKU: {item.sku} • Mínimo: {item.minStock} unid.
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-red-700 dark:text-red-300">{item.currentStock}</p>
                              <p className="text-xs text-red-500">
                                {item.daysOfStock !== null ? `${item.daysOfStock} días` : 'Sin ventas'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Lista de alertas bajas */}
                    {low.length > 0 && (
                      <div className="mb-6 space-y-3">
                        <h4 className="font-semibold text-slate-700 dark:text-slate-300">🟡 Productos con Stock Bajo</h4>
                        {low.slice(0, 10).map((item, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">🟡</span>
                              <div>
                                <p className="font-medium text-amber-800 dark:text-amber-200">{item.name}</p>
                                <p className="text-sm text-amber-600 dark:text-amber-400">
                                  SKU: {item.sku} • Mínimo: {item.minStock} unid.
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{item.currentStock}</p>
                              <p className="text-xs text-amber-500">
                                {item.daysOfStock !== null ? `${item.daysOfStock} días` : 'Sin ventas'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Recomendaciones */}
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                      <h4 className="mb-2 font-semibold text-blue-800 dark:text-blue-200">💡 Acciones Urgentes</h4>
                      <ul className="list-inside list-disc space-y-1 text-sm text-blue-700 dark:text-blue-300">
                        <li>Generar órdenes de compra para productos críticos</li>
                        <li>Contactar proveedores para entrega urgente</li>
                        <li>Revisar si hay existencias en otras sucursales para traspaso</li>
                        <li>Configurar alertas automáticas de reposición</li>
                      </ul>
                    </div>
                  </>
                )
              })()}
            </ReportSection>
          )}

          {/* Reporte Ops: Solicitudes + Devoluciones */}
          {tab === 'OPS' && (
            <>
              <ReportSection title="📨 Solicitudes de Movimiento" subtitle="Totales y estado de confirmación" icon="📨">
                {movementRequestsSummaryQuery.isLoading && <Loading />}
                {movementRequestsSummaryQuery.isError && (
                  <ErrorState
                    message={(movementRequestsSummaryQuery.error as any)?.message ?? 'Error cargando resumen de solicitudes'}
                  />
                )}

                {!movementRequestsSummaryQuery.isLoading && !movementRequestsSummaryQuery.isError && (() => {
                  const s = movementRequestsSummaryQuery.data ?? {
                    total: 0,
                    open: 0,
                    fulfilled: 0,
                    cancelled: 0,
                    pending: 0,
                    accepted: 0,
                    rejected: 0,
                  }

                  const statusPieData = [
                    { name: 'Abiertas', value: s.open, color: '#3B82F6' },
                    { name: 'Atendidas', value: s.fulfilled, color: '#10B981' },
                    { name: 'Canceladas', value: s.cancelled, color: '#F59E0B' },
                  ].filter((d) => d.value > 0)

                  const confirmPieData = [
                    { name: 'Pendientes', value: s.pending, color: '#6366F1' },
                    { name: 'Aceptadas', value: s.accepted, color: '#10B981' },
                    { name: 'Rechazadas', value: s.rejected, color: '#EF4444' },
                  ].filter((d) => d.value > 0)

                  const cityItems = movementRequestsByCityQuery.data?.items ?? []
                  const cityBarData = cityItems.map((c) => ({
                    city: c.city ?? '(sin ciudad)',
                    total: c.total,
                    fulfilled: c.fulfilled,
                    open: c.open,
                    cancelled: c.cancelled,
                  }))

                  const flowItems = movementRequestFlowsQuery.data?.items ?? []
                  const flowBarData = flowItems.map((f) => ({
                    route: `${f.fromWarehouse?.code ?? '?'} → ${f.toWarehouse?.code ?? '?'}`,
                    completadas: f.requestsCount,
                    tiempoProm: Math.round(f.avgMinutes ?? 0),
                  }))

                  return (
                    <>
                      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                        <KPICard icon="📦" label="Total" value={String(s.total)} color="primary" subtitle="Solicitudes" />
                        <KPICard icon="🟡" label="Abiertas" value={String(s.open)} color="info" subtitle="OPEN" />
                        <KPICard icon="✅" label="Atendidas" value={String(s.fulfilled)} color="primary" subtitle="FULFILLED" />
                        <KPICard icon="❌" label="Canceladas" value={String(s.cancelled)} color="warning" subtitle="CANCELLED" />
                      </div>

                      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
                        <KPICard icon="⏳" label="Pendientes" value={String(s.pending)} color="info" subtitle="PENDING" />
                        <KPICard icon="👍" label="Aceptadas" value={String(s.accepted)} color="primary" subtitle="ACCEPTED" />
                        <KPICard icon="👎" label="Rechazadas" value={String(s.rejected)} color="warning" subtitle="REJECTED" />
                      </div>

                      {/* Gráficas de estado */}
                      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                        {/* Pie: estado de solicitudes */}
                        {statusPieData.length > 0 && (
                          <div className="w-full min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Distribución por estado</h3>
                            <ResponsiveContainer width="100%" height={260}>
                              <PieChart>
                                <Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                                  {statusPieData.map((entry, i) => (
                                    <Cell key={i} fill={entry.color} />
                                  ))}
                                </Pie>
                                <Tooltip {...chartTooltipStyle} />
                                <Legend />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        {/* Pie: confirmación */}
                        {confirmPieData.length > 0 && (
                          <div className="w-full min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Estado de confirmación</h3>
                            <ResponsiveContainer width="100%" height={260}>
                              <PieChart>
                                <Pie data={confirmPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                                  {confirmPieData.map((entry, i) => (
                                    <Cell key={i} fill={entry.color} />
                                  ))}
                                </Pie>
                                <Tooltip {...chartTooltipStyle} />
                                <Legend />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>

                      {/* Gráfica: solicitudes por ciudad */}
                      {cityBarData.length > 0 && (
                        <div className="mb-6 w-full min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Solicitudes por ciudad</h3>
                          <ResponsiveContainer width="100%" height={Math.max(260, cityBarData.length * 40)}>
                            <BarChart data={cityBarData} layout="vertical" margin={{ left: 80 }}>
                              <CartesianGrid {...chartGridStyle} />
                              <XAxis type="number" {...chartAxisStyle} />
                              <YAxis type="category" dataKey="city" width={75} {...chartAxisStyle} />
                              <Tooltip {...chartTooltipStyle} />
                              <Legend />
                              <Bar dataKey="fulfilled" name="Atendidas" fill="#10B981" stackId="a" />
                              <Bar dataKey="open" name="Abiertas" fill="#3B82F6" stackId="a" />
                              <Bar dataKey="cancelled" name="Cancel." fill="#F59E0B" stackId="a" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Gráfica: flujos completados */}
                      {flowBarData.length > 0 && (
                        <div className="mb-6 w-full min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Flujos completados y tiempo promedio</h3>
                          <ResponsiveContainer width="100%" height={Math.max(260, flowBarData.length * 45)}>
                            <BarChart data={flowBarData} layout="vertical" margin={{ left: 100 }}>
                              <CartesianGrid {...chartGridStyle} />
                              <XAxis type="number" {...chartAxisStyle} />
                              <YAxis type="category" dataKey="route" width={95} {...chartAxisStyle} tick={{ fontSize: 11 }} />
                              <Tooltip {...chartTooltipStyle} formatter={(value: number | string | undefined, name: string | number | undefined) => name === 'Tiempo prom. (min)' ? `${Number(value ?? 0)} min` : Number(value ?? 0)} />
                              <Legend />
                              <Bar dataKey="completadas" name="Completadas" fill={getChartColor(0)} />
                              <Bar dataKey="tiempoProm" name="Tiempo prom. (min)" fill={getChartColor(3)} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Tabla: por ciudad */}
                      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Detalle por ciudad</h3>

                        {movementRequestsByCityQuery.isLoading && <Loading />}
                        {movementRequestsByCityQuery.isError && (
                          <ErrorState
                            message={(movementRequestsByCityQuery.error as any)?.message ?? 'Error cargando solicitudes por ciudad'}
                          />
                        )}
                        {!movementRequestsByCityQuery.isLoading && !movementRequestsByCityQuery.isError && (movementRequestsByCityQuery.data?.items?.length ?? 0) === 0 && (
                          <EmptyState message="No hay solicitudes en el período." />
                        )}
                        {!movementRequestsByCityQuery.isLoading && !movementRequestsByCityQuery.isError && (movementRequestsByCityQuery.data?.items?.length ?? 0) > 0 && (
                          <Table
                            columns={[
                              { header: 'Ciudad', accessor: (r: MovementRequestsByCityItem) => r.city ?? '(sin ciudad)' },
                              { header: 'Total', accessor: (r: MovementRequestsByCityItem) => r.total },
                              { header: 'Abiertas', accessor: (r: MovementRequestsByCityItem) => r.open },
                              { header: 'Atendidas', accessor: (r: MovementRequestsByCityItem) => r.fulfilled },
                              { header: 'Canceladas', accessor: (r: MovementRequestsByCityItem) => r.cancelled },
                              { header: 'Pend.', accessor: (r: MovementRequestsByCityItem) => r.pending },
                              { header: 'Acept.', accessor: (r: MovementRequestsByCityItem) => r.accepted },
                              { header: 'Rech.', accessor: (r: MovementRequestsByCityItem) => r.rejected },
                            ]}
                            data={movementRequestsByCityQuery.data?.items ?? []}
                            keyExtractor={(r: MovementRequestsByCityItem) => String(r.city ?? 'null')}
                          />
                        )}
                      </div>

                      {/* Tabla: flujos completados */}
                      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Flujos completados (de dónde → a dónde)</h3>

                        {movementRequestFlowsQuery.isLoading && <Loading />}
                        {movementRequestFlowsQuery.isError && (
                          <ErrorState message={(movementRequestFlowsQuery.error as any)?.message ?? 'Error cargando flujos'} />
                        )}
                        {!movementRequestFlowsQuery.isLoading && !movementRequestFlowsQuery.isError && (movementRequestFlowsQuery.data?.items?.length ?? 0) === 0 && (
                          <EmptyState message="No hay solicitudes atendidas en el período." />
                        )}
                        {!movementRequestFlowsQuery.isLoading && !movementRequestFlowsQuery.isError && (movementRequestFlowsQuery.data?.items?.length ?? 0) > 0 && (
                          <Table
                            columns={[
                              {
                                header: 'Origen',
                                accessor: (r: MovementRequestsFlowItem) =>
                                  r.fromWarehouse
                                    ? `${r.fromWarehouse.code ?? ''} ${r.fromWarehouse.name ?? ''}`.trim() || r.fromWarehouse.id || '—'
                                    : '—',
                              },
                              {
                                header: 'Destino',
                                accessor: (r: MovementRequestsFlowItem) =>
                                  r.toWarehouse
                                    ? `${r.toWarehouse.code ?? ''} ${r.toWarehouse.name ?? ''}`.trim() || r.toWarehouse.id || '—'
                                    : '—',
                              },
                              { header: 'Completadas', accessor: (r: MovementRequestsFlowItem) => r.requestsCount },
                              { header: 'T. prom.', accessor: (r: MovementRequestsFlowItem) => formatMinutes(r.avgMinutes) },
                            ]}
                            data={movementRequestFlowsQuery.data?.items ?? []}
                            keyExtractor={(r: MovementRequestsFlowItem) => `${r.fromWarehouse?.id ?? 'null'}-${r.toWarehouse?.id ?? 'null'}`}
                          />
                        )}
                      </div>

                      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Trazabilidad (solicitudes atendidas)</h3>
                        <div className="mb-2 text-xs text-slate-600 dark:text-slate-400">
                          Ver lo solicitado vs. lo enviado (picking) por solicitud.
                        </div>

                        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-end">
                          <Input
                            label="Filtrar"
                            placeholder="ID, solicitante, origen/destino (códigos)…"
                            value={fulfilledFilter}
                            onChange={(e) => setFulfilledFilter(e.target.value)}
                          />
                          {!fulfilledMovementRequestsQuery.isLoading && !fulfilledMovementRequestsQuery.isError && (
                            <div className="text-xs text-slate-600 dark:text-slate-400">
                              {(() => {
                                const all = fulfilledMovementRequestsQuery.data?.items ?? []
                                const q = fulfilledFilter.trim().toLowerCase()
                                if (!q) return `Mostrando ${all.length}`
                                const filtered = all.filter((r) => {
                                  const dest = r.destinationWarehouse ? `${r.destinationWarehouse.code ?? ''} ${r.destinationWarehouse.name ?? ''}` : ''
                                  const haystack = [
                                    r.id,
                                    r.requestedCity ?? '',
                                    dest,
                                    r.requestedByName ?? '',
                                    r.fromWarehouseCodes ?? '',
                                    r.fromLocationCodes ?? '',
                                    r.toWarehouseCodes ?? '',
                                    r.toLocationCodes ?? '',
                                  ]
                                    .join(' ')
                                    .toLowerCase()
                                  return haystack.includes(q)
                                })
                                return `Mostrando ${filtered.length} de ${all.length}`
                              })()}
                            </div>
                          )}
                        </div>

                        {fulfilledMovementRequestsQuery.isLoading && <Loading />}
                        {fulfilledMovementRequestsQuery.isError && (
                          <ErrorState message={(fulfilledMovementRequestsQuery.error as any)?.message ?? 'Error cargando solicitudes atendidas'} />
                        )}
                        {!fulfilledMovementRequestsQuery.isLoading && !fulfilledMovementRequestsQuery.isError && (fulfilledMovementRequestsQuery.data?.items?.length ?? 0) === 0 && (
                          <EmptyState message="No hay solicitudes atendidas en el período." />
                        )}
                        {!fulfilledMovementRequestsQuery.isLoading && !fulfilledMovementRequestsQuery.isError && (fulfilledMovementRequestsQuery.data?.items?.length ?? 0) > 0 && (
                          <Table
                            columns={[
                              { header: 'ID', accessor: (r: FulfilledMovementRequestItem) => r.id },
                              {
                                header: 'Destino',
                                accessor: (r: FulfilledMovementRequestItem) =>
                                  r.destinationWarehouse
                                    ? `${r.destinationWarehouse.code ?? ''} ${r.destinationWarehouse.name ?? ''}`.trim() || r.destinationWarehouse.id
                                    : r.requestedCity ?? '—',
                              },
                              {
                                header: 'Origen',
                                accessor: (r: FulfilledMovementRequestItem) => {
                                  const wh = r.fromWarehouseCodes ?? '—'
                                  const loc = r.fromLocationCodes ?? null
                                  return loc ? `${wh} · ${loc}` : wh
                                },
                              },
                              { header: 'T. atención', accessor: (r: FulfilledMovementRequestItem) => formatMinutes(r.minutesToFulfill) },
                              { header: 'Ítems', accessor: (r: FulfilledMovementRequestItem) => r.itemsCount },
                              { header: 'Envíos', accessor: (r: FulfilledMovementRequestItem) => r.movementsCount },
                              {
                                header: 'Acción',
                                accessor: (r: FulfilledMovementRequestItem) => (
                                  <Button size="sm" variant="outline" onClick={() => setTraceRequestId(r.id)}>
                                    Ver
                                  </Button>
                                ),
                              },
                            ]}
                            data={(() => {
                              const all = fulfilledMovementRequestsQuery.data?.items ?? []
                              const q = fulfilledFilter.trim().toLowerCase()
                              if (!q) return all
                              return all.filter((r) => {
                                const dest = r.destinationWarehouse ? `${r.destinationWarehouse.code ?? ''} ${r.destinationWarehouse.name ?? ''}` : ''
                                const haystack = [
                                  r.id,
                                  r.requestedCity ?? '',
                                  dest,
                                  r.requestedByName ?? '',
                                  r.fromWarehouseCodes ?? '',
                                  r.fromLocationCodes ?? '',
                                  r.toWarehouseCodes ?? '',
                                  r.toLocationCodes ?? '',
                                ]
                                  .join(' ')
                                  .toLowerCase()
                                return haystack.includes(q)
                              })
                            })()}
                            keyExtractor={(r: FulfilledMovementRequestItem) => r.id}
                          />
                        )}
                      </div>
                    </>
                  )
                })()}
              </ReportSection>

              <ReportSection title="↩️ Devoluciones" subtitle="Conteo y volumen devuelto" icon="↩️">
                {returnsSummaryQuery.isLoading && <Loading />}
                {returnsSummaryQuery.isError && <ErrorState message={(returnsSummaryQuery.error as any)?.message ?? 'Error cargando resumen de devoluciones'} />}

                {!returnsSummaryQuery.isLoading && !returnsSummaryQuery.isError && (() => {
                  const s = returnsSummaryQuery.data ?? { returnsCount: 0, itemsCount: 0, quantity: '0' }
                  const avgItems = s.returnsCount > 0 ? (s.itemsCount / s.returnsCount).toFixed(1) : '0.0'
                  const qty = toNumber(s.quantity).toFixed(0)

                  const returnsByWhItems = returnsByWarehouseQuery.data?.items ?? []
                  const returnsBarData = returnsByWhItems.map((r) => ({
                    sucursal: `${r.warehouse.code ?? ''} ${r.warehouse.name ?? ''}`.trim() || r.warehouse.id,
                    devoluciones: r.returnsCount,
                    unidades: toNumber(r.quantity),
                  }))

                  return (
                    <>
                      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                        <KPICard icon="↩️" label="Devoluciones" value={String(s.returnsCount)} color="primary" subtitle="Cabeceras" />
                        <KPICard icon="🧾" label="Ítems" value={String(s.itemsCount)} color="info" subtitle="Líneas" />
                        <KPICard icon="📦" label="Unidades" value={qty} color="primary" subtitle="Sum qty" />
                        <KPICard icon="📊" label="Promedio" value={avgItems} color="info" subtitle="ítems/devolución" />
                      </div>

                      {/* Gráfica de devoluciones por sucursal */}
                      {returnsBarData.length > 0 && (
                        <div className="mb-6 w-full min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Devoluciones por sucursal</h3>
                          <ResponsiveContainer width="100%" height={Math.max(240, returnsBarData.length * 40)}>
                            <BarChart data={returnsBarData} layout="vertical" margin={{ left: 80 }}>
                              <CartesianGrid {...chartGridStyle} />
                              <XAxis type="number" {...chartAxisStyle} />
                              <YAxis type="category" dataKey="sucursal" width={75} {...chartAxisStyle} />
                              <Tooltip {...chartTooltipStyle} />
                              <Legend />
                              <Bar dataKey="devoluciones" name="Devoluciones" fill="#EF4444" />
                              <Bar dataKey="unidades" name="Unidades" fill="#F59E0B" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Detalle por sucursal</h3>

                        {returnsByWarehouseQuery.isLoading && <Loading />}
                        {returnsByWarehouseQuery.isError && (
                          <ErrorState
                            message={(returnsByWarehouseQuery.error as any)?.message ?? 'Error cargando devoluciones por sucursal'}
                          />
                        )}
                        {!returnsByWarehouseQuery.isLoading && !returnsByWarehouseQuery.isError && (returnsByWarehouseQuery.data?.items?.length ?? 0) === 0 && (
                          <EmptyState message="No hay devoluciones en el período." />
                        )}
                        {!returnsByWarehouseQuery.isLoading && !returnsByWarehouseQuery.isError && (returnsByWarehouseQuery.data?.items?.length ?? 0) > 0 && (
                          <Table
                            columns={[
                              {
                                header: 'Sucursal',
                                accessor: (r: ReturnsByWarehouseItem) =>
                                  `${r.warehouse.code ?? ''} ${r.warehouse.name ?? ''}`.trim() || r.warehouse.id,
                              },
                              { header: 'Ciudad', accessor: (r: ReturnsByWarehouseItem) => r.warehouse.city ?? '-' },
                              { header: 'Devol.', accessor: (r: ReturnsByWarehouseItem) => r.returnsCount },
                              { header: 'Ítems', accessor: (r: ReturnsByWarehouseItem) => r.itemsCount },
                              {
                                header: 'Unidades',
                                accessor: (r: ReturnsByWarehouseItem) => toNumber(r.quantity).toFixed(0),
                              },
                            ]}
                            data={returnsByWarehouseQuery.data?.items ?? []}
                            keyExtractor={(r: ReturnsByWarehouseItem) => r.warehouse.id}
                          />
                        )}
                      </div>
                    </>
                  )
                })()}
              </ReportSection>
            </>
          )}

          <Modal
            isOpen={!!traceRequestId}
            onClose={() => setTraceRequestId(null)}
            title={traceRequestId ? `Trazabilidad · ${traceRequestId}` : 'Trazabilidad'}
            maxWidth="6xl"
          >
            {movementRequestTraceQuery.isLoading && <Loading />}
            {movementRequestTraceQuery.isError && (
              <ErrorState message={(movementRequestTraceQuery.error as any)?.message ?? 'Error cargando trazabilidad'} />
            )}
            {!movementRequestTraceQuery.isLoading && !movementRequestTraceQuery.isError && movementRequestTraceQuery.data && (() => {
              const d = movementRequestTraceQuery.data
              const createdAt = new Date(d.request.createdAt)
              const fulfilledAt = d.request.fulfilledAt ? new Date(d.request.fulfilledAt) : null
              const minutes = fulfilledAt ? (fulfilledAt.getTime() - createdAt.getTime()) / 60000 : null

              const canExportPicking = (d.sentLines ?? []).length > 0
              const onExportPicking = () => {
                const sent = d.sentLines ?? []
                if (sent.length === 0) return

                const uniqFromWh = Array.from(new Set(sent.map((l) => formatWarehouseLabel(l.fromLocation?.warehouse ?? null))))
                const uniqToWh = Array.from(new Set(sent.map((l) => formatWarehouseLabel(l.toLocation?.warehouse ?? null))))
                const uniqFromLoc = Array.from(new Set(sent.map((l) => String(l.fromLocation?.code ?? '—'))))
                const uniqToLoc = Array.from(new Set(sent.map((l) => String(l.toLocation?.code ?? '—'))))

                const fromWarehouseLabel = uniqFromWh.length === 1 ? uniqFromWh[0] : 'MIXED'
                const toWarehouseLabel = uniqToWh.length === 1 ? uniqToWh[0] : 'MIXED'
                const fromLocationCode = uniqFromLoc.length === 1 ? uniqFromLoc[0] : 'MIXED'
                const toLocationCode = uniqToLoc.length === 1 ? uniqToLoc[0] : 'MIXED'

                const requestedItems = (d.requestedItems ?? []).map((it) => ({
                  productLabel: getProductLabel({ sku: it.productSku ?? '—', name: it.productName ?? '—', genericName: it.genericName ?? null }),
                  quantityUnits: Number(it.requestedQuantity ?? 0),
                  presentationLabel: formatPresentationLabel(it.presentation),
                }))

                const sentLines = sent.map((l) => ({
                  locationCode: String(l.fromLocation?.code ?? '—'),
                  productLabel: getProductLabel({ sku: l.productSku ?? '—', name: l.productName ?? '—', genericName: l.genericName ?? null }),
                  batchNumber: l.batchNumber ?? null,
                  expiresAt: l.expiresAt ?? null,
                  quantityUnits: Number(l.quantity ?? 0),
                  presentationLabel: formatPresentationLabel(l.presentation),
                }))

                exportPickingToPdf(
                  {
                    requestId: d.request.id,
                    generatedAtIso: new Date().toISOString(),
                    fromWarehouseLabel,
                    fromLocationCode,
                    toWarehouseLabel,
                    toLocationCode,
                    requestedByName: d.request.requestedByName ?? null,
                  },
                  requestedItems,
                  sentLines,
                )
              }

              return (
                <div ref={traceRef} className="space-y-4">
                  <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-end pdf-hide">
                      <Button size="sm" variant="outline" onClick={handleExportTraceExcel}>
                        ⬇️ Excel
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!traceRef.current) return
                          exportModalContentToPdf(traceRef.current, {
                            title: `Trazabilidad · ${d.request.id}`,
                            subtitle: `Período: ${formatDate(new Date(from))} - ${formatDate(new Date(to))}`,
                            companyName: tenant.branding?.tenantName ?? 'Empresa',
                            headerColor: '#3B82F6',
                            logoUrl: tenant.branding?.logoUrl ?? undefined,
                            filename: `trazabilidad-${d.request.id}.pdf`,
                          })
                        }}
                      >
                        ⬇️ Exportar PDF
                      </Button>
                      <Button size="sm" variant="outline" disabled={!canExportPicking} onClick={onExportPicking}>
                        Exportar picking (PDF)
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        const country = tenant.branding?.country ?? 'BOLIVIA'
                        const destinationCity = (d.request.warehouse?.city ?? d.request.requestedCity ?? '').trim()
                        const destination = destinationCity ? `${destinationCity}, ${country}` : country

                        const sentLines = d.sentLines ?? []
                        const fromCity = (sentLines.find((l) => (l.fromLocation?.warehouse?.city ?? '').trim())?.fromLocation?.warehouse?.city ?? '').trim()
                        const origin = fromCity ? `${fromCity}, ${country}` : country
                        
                        exportLabelToPdf({
                          requestId: d.request.id,
                          generatedAtIso: new Date().toISOString(),
                          fromWarehouseLabel: origin,
                          fromLocationCode: '—',
                          toWarehouseLabel: destination,
                          toLocationCode: '—',
                          requestedByName: d.request.requestedByName ?? null,
                          bultos: '—',
                          responsable: d.request.fulfilledByName ?? '—',
                          observaciones: '—',
                        })
                      }}>
                        Exportar rótulo (PDF)
                      </Button>
                    </div>
                    <div className="text-slate-900 dark:text-slate-100">
                      <span className="font-medium">Destino:</span>{' '}
                      {d.request.warehouse ? `${d.request.warehouse.code ?? ''} ${d.request.warehouse.name ?? ''}`.trim() : d.request.requestedCity}
                    </div>
                    <div className="text-slate-700 dark:text-slate-300">
                      <span className="font-medium">Solicitado:</span> {createdAt.toLocaleString()} · <span className="font-medium">Atendido:</span>{' '}
                      {fulfilledAt ? fulfilledAt.toLocaleString() : '—'} · <span className="font-medium">Tiempo:</span> {formatMinutes(minutes)}
                    </div>
                    <div className="text-slate-700 dark:text-slate-300">
                      <span className="font-medium">Solicitante:</span> {d.request.requestedByName ?? '—'} · <span className="font-medium">Atendió:</span>{' '}
                      {d.request.fulfilledByName ?? '—'}
                    </div>
                  </div>

                  {(() => {
                    const comparison = buildTraceProductComparison(d)
                    const origins = buildTraceOriginMix(d)
                    const requestedUnits = comparison.reduce((sum, item) => sum + item.requestedQty, 0)
                    const sentUnits = comparison.reduce((sum, item) => sum + item.sentQty, 0)
                    const fillRate = requestedUnits > 0 ? (sentUnits / requestedUnits) * 100 : 0

                    return (
                      <>
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                          <div className="rounded-lg bg-slate-100 p-3 text-center dark:bg-slate-800">
                            <div className="text-2xl font-bold text-slate-900 dark:text-white">{comparison.length}</div>
                            <div className="text-xs text-slate-600 dark:text-slate-400">Productos</div>
                          </div>
                          <div className="rounded-lg bg-blue-100 p-3 text-center dark:bg-blue-900/20">
                            <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{requestedUnits}</div>
                            <div className="text-xs text-blue-600 dark:text-blue-400">Unid. solicitadas</div>
                          </div>
                          <div className="rounded-lg bg-green-100 p-3 text-center dark:bg-green-900/20">
                            <div className="text-2xl font-bold text-green-700 dark:text-green-400">{sentUnits}</div>
                            <div className="text-xs text-green-600 dark:text-green-400">Unid. enviadas</div>
                          </div>
                          <div className="rounded-lg bg-amber-100 p-3 text-center dark:bg-amber-900/20">
                            <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{fillRate.toFixed(0)}%</div>
                            <div className="text-xs text-amber-600 dark:text-amber-400">Cumplimiento</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
                          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                            <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Solicitado vs enviado por producto</h4>
                            <ResponsiveContainer width="100%" height={Math.max(260, Math.min(420, comparison.slice(0, 8).length * 52))}>
                              <BarChart
                                data={comparison.slice(0, 8).map((item) => ({
                                  product: item.product.length > 26 ? `${item.product.slice(0, 26)}...` : item.product,
                                  requestedQty: item.requestedQty,
                                  sentQty: item.sentQty,
                                }))}
                                layout="vertical"
                                margin={{ left: 110, right: 20 }}
                              >
                                <CartesianGrid {...chartGridStyle} />
                                <XAxis type="number" {...chartAxisStyle} />
                                <YAxis type="category" dataKey="product" width={100} {...chartAxisStyle} tick={{ fontSize: 11 }} />
                                <Tooltip {...chartTooltipStyle} />
                                <Bar dataKey="requestedQty" name="Solicitado" fill="#3B82F6" radius={[0, 6, 6, 0]} />
                                <Bar dataKey="sentQty" name="Enviado" fill="#10B981" radius={[0, 6, 6, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700 dark:text-slate-300">
                              <div className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-blue-500" />Solicitado</div>
                              <div className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-emerald-500" />Enviado</div>
                            </div>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                            <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Distribución por origen</h4>
                            {origins.length === 0 ? (
                              <EmptyState message="Sin movimientos asociados" />
                            ) : (
                              <>
                                <div className="flex justify-center">
                                  <PieChart width={340} height={260}>
                                    <Pie
                                      data={origins.map((item) => ({ name: item.label, value: item.quantity }))}
                                      dataKey="value"
                                      nameKey="name"
                                      cx="50%"
                                      cy="50%"
                                      innerRadius={55}
                                      outerRadius={95}
                                      paddingAngle={4}
                                      label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                                      isAnimationActive={false}
                                    >
                                      {origins.map((item) => (
                                        <Cell key={item.label} fill={item.color} />
                                      ))}
                                    </Pie>
                                    <Tooltip {...chartTooltipStyle} formatter={(value: number | string | undefined) => [Number(value ?? 0), 'Unidades']} />
                                  </PieChart>
                                </div>
                                <div className="space-y-2">
                                  {origins.map((item) => {
                                    const pct = sentUnits > 0 ? (item.quantity / sentUnits) * 100 : 0
                                    return (
                                      <div key={item.label} className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                                              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
                                              <span className="truncate">{item.label}</span>
                                            </div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">{item.linesCount} líneas</div>
                                          </div>
                                          <div className="text-right">
                                            <div className="text-sm font-semibold text-green-600 dark:text-green-400">{item.quantity} u</div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">{pct.toFixed(1)}%</div>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    )
                  })()}

                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Lo solicitado</h4>
                    {(d.requestedItems ?? []).length === 0 ? (
                      <EmptyState message="Sin ítems" />
                    ) : (
                      <Table
                        data={d.requestedItems}
                        keyExtractor={(r) => r.id}
                        columns={[
                          {
                            header: 'Producto',
                            accessor: (r) => getProductLabel({ sku: r.productSku ?? '—', name: r.productName ?? '—', genericName: r.genericName ?? null }),
                          },
                          {
                            header: 'Presentación',
                            accessor: (r) => formatPresentationLabel(r.presentation ? { name: r.presentation.name, unitsPerPresentation: r.presentation.unitsPerPresentation } : null),
                          },
                          { header: 'Cantidad (u)', className: 'w-32', accessor: (r) => String(r.requestedQuantity ?? 0) },
                        ]}
                      />
                    )}
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Lo enviado (picking)</h4>
                    {(d.sentLines ?? []).length === 0 ? (
                      <EmptyState message="Sin movimientos asociados" />
                    ) : (
                      <Table
                        data={d.sentLines}
                        keyExtractor={(r) => r.id}
                        columns={[
                          { header: 'Fecha', className: 'w-40', accessor: (r) => new Date(r.createdAt).toLocaleString() },
                          {
                            header: 'Origen',
                            accessor: (r) => {
                              const wh = r.fromLocation?.warehouse
                              const loc = r.fromLocation?.code
                              const whLabel = wh ? `${wh.code ?? ''} ${wh.name ?? ''}`.trim() : '—'
                              return loc ? `${whLabel} · ${loc}` : whLabel
                            },
                          },
                          {
                            header: 'Destino',
                            accessor: (r) => {
                              const wh = r.toLocation?.warehouse
                              const loc = r.toLocation?.code
                              const whLabel = wh ? `${wh.code ?? ''} ${wh.name ?? ''}`.trim() : '—'
                              return loc ? `${whLabel} · ${loc}` : whLabel
                            },
                          },
                          {
                            header: 'Producto',
                            accessor: (r) => getProductLabel({ sku: r.productSku ?? '—', name: r.productName ?? '—', genericName: r.genericName ?? null }),
                          },
                          { header: 'Lote', className: 'w-28', accessor: (r) => r.batchNumber ?? '—' },
                          { header: 'Vence', className: 'w-28', accessor: (r) => (r.expiresAt ? formatDateOnlyUtc(r.expiresAt) : '—') },
                          { header: 'Cantidad (u)', className: 'w-24', accessor: (r) => String(r.quantity ?? 0) },
                        ]}
                      />
                    )}
                  </div>
                </div>
              )
            })()}
          </Modal>

          {/* Reporte de Productos Por Vencer */}
          {tab === 'EXPIRY' && (
            <ReportSection
              title="📅 Productos Próximos a Vencer"
              subtitle="Control de caducidades para evitar pérdidas"
              icon="⏰"
            >
              {expiryQuery.isLoading && <Loading />}
              {expiryQuery.isError && <ErrorState message={(expiryQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!expiryQuery.isLoading && !expiryQuery.isError && (expiryQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay productos próximos a vencer en los próximos 60 días." />
              )}
              {!expiryQuery.isLoading && !expiryQuery.isError && (expiryQuery.data?.items?.length ?? 0) > 0 && (() => {
                const items = expiryQuery.data?.items ?? []
                const expired = items.filter(i => (i.daysUntilExpiry ?? 999) < 0)
                const thisWeek = items.filter(i => (i.daysUntilExpiry ?? 999) >= 0 && (i.daysUntilExpiry ?? 999) <= 7)
                const thisMonth = items.filter(i => (i.daysUntilExpiry ?? 999) > 7 && (i.daysUntilExpiry ?? 999) <= 30)

                return (
                  <>
                    {/* KPIs */}
                    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                      <KPICard
                        icon="🔴"
                        label="Vencidos"
                        value={expired.length.toString()}
                        color="warning"
                        subtitle="Ya caducados"
                      />
                      <KPICard
                        icon="🟠"
                        label="Esta Semana"
                        value={thisWeek.length.toString()}
                        color="warning"
                        subtitle="Vencen en 7 días"
                      />
                      <KPICard
                        icon="🟡"
                        label="Este Mes"
                        value={thisMonth.length.toString()}
                        color="info"
                        subtitle="Vencen en 30 días"
                      />
                      <KPICard
                        icon="📦"
                        label="Total Items"
                        value={items.length.toString()}
                        color="primary"
                        subtitle="Próximos 60 días"
                      />
                    </div>

                    {/* Productos ya vencidos */}
                    {expired.length > 0 && (
                      <div className="mb-6 space-y-3">
                        <h4 className="font-semibold text-slate-700 dark:text-slate-300">🔴 Productos Vencidos</h4>
                        {expired.slice(0, 5).map((item, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">❌</span>
                              <div>
                                <p className="font-medium text-red-800 dark:text-red-200">{item.name}</p>
                                <p className="text-sm text-red-600 dark:text-red-400">
                                  Lote: {item.lotNumber ?? 'N/A'} • Venció: {item.expiryDate ?? 'N/A'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-red-700 dark:text-red-300">{item.quantity} unid.</p>
                              <p className="text-xs text-red-500">{item.locationName ?? 'Sin ubicación'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Esta semana */}
                    {thisWeek.length > 0 && (
                      <div className="mb-6 space-y-3">
                        <h4 className="font-semibold text-slate-700 dark:text-slate-300">🟠 Vencen esta Semana</h4>
                        {thisWeek.slice(0, 5).map((item, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-900/20"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">⏰</span>
                              <div>
                                <p className="font-medium text-orange-800 dark:text-orange-200">{item.name}</p>
                                <p className="text-sm text-orange-600 dark:text-orange-400">
                                  Lote: {item.lotNumber ?? 'N/A'} • Vence: {item.expiryDate ?? 'N/A'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-orange-700 dark:text-orange-300">{item.quantity} unid.</p>
                              <p className="text-xs text-orange-500">{item.daysUntilExpiry} días</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Este mes */}
                    {thisMonth.length > 0 && (
                      <div className="mb-6 space-y-3">
                        <h4 className="font-semibold text-slate-700 dark:text-slate-300">🟡 Vencen este Mes</h4>
                        {thisMonth.slice(0, 5).map((item, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">📅</span>
                              <div>
                                <p className="font-medium text-amber-800 dark:text-amber-200">{item.name}</p>
                                <p className="text-sm text-amber-600 dark:text-amber-400">
                                  Lote: {item.lotNumber ?? 'N/A'} • Vence: {item.expiryDate ?? 'N/A'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-amber-700 dark:text-amber-300">{item.quantity} unid.</p>
                              <p className="text-xs text-amber-500">{item.daysUntilExpiry} días</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Recomendaciones */}
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                      <h4 className="mb-2 font-semibold text-blue-800 dark:text-blue-200">💡 Estrategias para Productos por Vencer</h4>
                      <ul className="list-inside list-disc space-y-1 text-sm text-blue-700 dark:text-blue-300">
                        <li>Crear promociones especiales (2x1, descuentos)</li>
                        <li>Priorizar en sistema FEFO (First Expire, First Out)</li>
                        <li>Considerar donaciones a organizaciones benéficas</li>
                        <li>Contactar al proveedor para posibles devoluciones</li>
                        <li>Registrar merma si el producto está vencido</li>
                      </ul>
                    </div>
                  </>
                )
              })()}
            </ReportSection>
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
                      className: 'text-center w-auto',
                      accessor: (r) => (
                        <div className="flex items-center justify-center gap-1">
                          <IconButton
                            label={r.enabled ? 'Desactivar' : 'Activar'}
                            icon={'⏻'}
                            variant={r.enabled ? 'ghost' : 'primary'}
                            loading={toggleScheduleMutation.isPending}
                            onClick={() => toggleScheduleMutation.mutate({ id: r.id, enabled: !r.enabled })}
                            className={r.enabled ? 'text-red-600 dark:text-red-300' : ''}
                          />
                          <IconButton
                            label="Eliminar"
                            icon={'🗑️'}
                            variant="danger"
                            loading={deleteScheduleMutation.isPending}
                            onClick={() => {
                              if (window.confirm('¿Eliminar este envío programado?')) deleteScheduleMutation.mutate(r.id)
                            }}
                          />
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
