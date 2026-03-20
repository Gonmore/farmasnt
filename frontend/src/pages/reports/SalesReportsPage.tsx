import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ResponsiveContainer,
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
  Area,
  AreaChart,
} from 'recharts'
import { MainLayout, PageContainer, Button, IconButton, Input, Loading, ErrorState, EmptyState, Modal, Table } from '../../components'
import { KPICard, ReportSection, SalesByCityDocument, SalesByCustomerDocument, SalesComparisonDocument, SalesFunnelDocument, SalesMarginsDocument, SalesMonthDocument, SalesTopProductsDocument, reportColors, getChartColor, chartTooltipStyle, chartGridStyle, chartAxisStyle } from '../../components/reports'
import { useNavigation } from '../../hooks'
import { apiFetch } from '../../lib/api'
import { blobToBase64, exportElementToPdf, exportModalContentToPdf, exportReactNodeToPdf, pdfBlobFromElement, pdfBlobFromReactNode } from '../../lib/exportPdf'
import { exportToXlsx } from '../../lib/exportXlsx'
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

type SalesByMonthItem = {
  month: string
  orderCount: number
  linesCount: number
  quantity: string
  total: number
}

type ProductMarginsItem = {
  productId: string
  sku: string
  name: string
  qtySold: number
  revenue: number
  costPrice: number
  costTotal: number
  profit: number
  marginPct: number
}

type MarginsResponse = {
  items: ProductMarginsItem[]
  totals: { revenue: number; costTotal: number; profit: number; avgMargin: number }
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

type ReportTab = 'MONTH' | 'CUSTOMERS' | 'CITIES' | 'TOP_PRODUCTS' | 'FUNNEL' | 'COMPARISON' | 'MARGINS'

// Tipo para órdenes detalladas (drill-down)
type OrderDetailItem = {
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

function orderStatusLabel(status: string): string {
  if (status === 'DRAFT') return 'BORRADOR'
  if (status === 'CONFIRMED') return 'CONFIRMADO'
  if (status === 'FULFILLED') return 'ENTREGADO'
  if (status === 'CANCELLED') return 'ANULADO'
  return status
}

function buildTopCustomerMix(orders: OrderDetailItem[]): Array<{ label: string; total: number; ordersCount: number; color: string }> {
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

function buildStatusMix(orders: OrderDetailItem[]): Array<{ label: string; total: number; ordersCount: number; color: string }> {
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
    .filter((item) => item.total > 0 || item.ordersCount > 0)
}

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

// Función para obtener órdenes por ciudad (drill-down)
async function fetchOrdersByCity(
  token: string,
  q: { from?: string; to?: string; city: string; status?: SalesStatus },
): Promise<{ items: OrderDetailItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.city) params.set('deliveryCity', q.city)
  if (q.status && q.status !== 'ALL') params.set('status', q.status)
  return apiFetch(`/api/v1/sales/orders?${params}`, { token })
}

// Función para obtener órdenes por cliente (drill-down)
async function fetchOrdersByCustomer(
  token: string,
  q: { from?: string; to?: string; customerId: string; status?: SalesStatus },
): Promise<{ items: OrderDetailItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.customerId) params.set('customerId', q.customerId)
  if (q.status && q.status !== 'ALL') params.set('status', q.status)
  return apiFetch(`/api/v1/sales/orders?${params}`, { token })
}

// Función para obtener órdenes por producto (drill-down)
async function fetchOrdersByProduct(
  token: string,
  q: { from?: string; to?: string; productId: string; status?: SalesStatus },
): Promise<{ items: OrderDetailItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.productId) params.set('productId', q.productId)
  if (q.status && q.status !== 'ALL') params.set('status', q.status)
  return apiFetch(`/api/v1/sales/orders?${params}`, { token })
}

async function fetchFunnel(token: string, q: { from?: string; to?: string }): Promise<FunnelResponse> {
  const params = new URLSearchParams()
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  return apiFetch(`/api/v1/reports/sales/funnel?${params}`, { token })
}

async function fetchSalesByMonth(
  token: string,
  q: { from?: string; to?: string; status?: SalesStatus },
): Promise<{ items: SalesByMonthItem[] }> {
  const params = new URLSearchParams()
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.status && q.status !== 'ALL') params.set('status', q.status)
  return apiFetch(`/api/v1/reports/sales/by-month?${params}`, { token })
}

async function fetchProductMargins(
  token: string,
  q: { from?: string; to?: string; take: number; status?: SalesStatus },
): Promise<MarginsResponse> {
  const params = new URLSearchParams({ take: String(q.take) })
  if (q.from) params.set('from', q.from)
  if (q.to) params.set('to', q.to)
  if (q.status && q.status !== 'ALL') params.set('status', q.status)
  return apiFetch(`/api/v1/reports/sales/margins?${params}`, { token })
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

  // Estados para drill-down
  const [drillDownOpen, setDrillDownOpen] = useState(false)
  const [drillDownTitle, setDrillDownTitle] = useState('')
  const [drillDownType, setDrillDownType] = useState<'city' | 'customer' | 'product' | null>(null)
  const [drillDownParam, setDrillDownParam] = useState<string>('')

  useEffect(() => {
    const sp = new URLSearchParams(location.search)
    const qsTab = sp.get('tab')
    const qsFrom = sp.get('from')
    const qsTo = sp.get('to')
    const qsStatus = sp.get('status')

    if (qsTab && ['MONTH', 'CUSTOMERS', 'CITIES', 'TOP_PRODUCTS', 'FUNNEL', 'COMPARISON', 'MARGINS'].includes(qsTab)) {
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
  const drillDownRef = useRef<HTMLDivElement | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)

  const title = useMemo(() => {
    const period = `${from} a ${to}`
    if (tab === 'MONTH') return `Ventas en el mes (${period})`
    if (tab === 'CUSTOMERS') return `Ventas por cliente (${period})`
    if (tab === 'CITIES') return `Ventas por ciudad (${period})`
    if (tab === 'TOP_PRODUCTS') return `Productos más vendidos (${period})`
    if (tab === 'COMPARISON') return `Comparativa de períodos (${period})`
    if (tab === 'MARGINS') return `Márgenes y utilidades (${period})`
    return `Embudo Ventas → Entregas → Cobros (${period})`
  }, [from, to, tab])

  // Query para drill-down por ciudad
  const drillDownCityQuery = useQuery({
    queryKey: ['reports', 'sales', 'drilldown', 'city', drillDownParam, { from, to, status }],
    queryFn: () => fetchOrdersByCity(auth.accessToken!, { from, to, city: drillDownParam, status }),
    enabled: !!auth.accessToken && drillDownOpen && drillDownType === 'city' && !!drillDownParam,
  })

  // Query para drill-down por cliente
  const drillDownCustomerQuery = useQuery({
    queryKey: ['reports', 'sales', 'drilldown', 'customer', drillDownParam, { from, to, status }],
    queryFn: () => fetchOrdersByCustomer(auth.accessToken!, { from, to, customerId: drillDownParam, status }),
    enabled: !!auth.accessToken && drillDownOpen && drillDownType === 'customer' && !!drillDownParam,
  })

  // Query para drill-down por producto
  const drillDownProductQuery = useQuery({
    queryKey: ['reports', 'sales', 'drilldown', 'product', drillDownParam, { from, to, status }],
    queryFn: () => fetchOrdersByProduct(auth.accessToken!, { from, to, productId: drillDownParam, status }),
    enabled: !!auth.accessToken && drillDownOpen && drillDownType === 'product' && !!drillDownParam,
  })

  // Función helper para abrir drill-down
  const openDrillDown = (type: 'city' | 'customer' | 'product', param: string, title: string) => {
    setDrillDownType(type)
    setDrillDownParam(param)
    setDrillDownTitle(title)
    setDrillDownOpen(true)
  }

  const buildSalesByCityStructuredReport = async () => {
    if (!auth.accessToken) throw new Error('Sesión no disponible para exportar')

    const cityItems = (byCityQuery.data?.items ?? []).map((item) => ({
      city: item.city,
      ordersCount: item.ordersCount,
      quantity: toNumber(item.quantity),
      amount: toNumber(item.amount),
    }))

    const cityDetails = await Promise.all(
      cityItems.map(async (item) => {
        const response = await fetchOrdersByCity(auth.accessToken!, { from, to, city: item.city, status })
        return {
          city: item.city,
          orders: response.items.map((order) => ({
            id: order.id,
            number: order.number,
            status: order.status,
            customerName: order.customerName,
            total: order.total || 0,
            createdAt: order.createdAt,
            deliveredAt: order.deliveredAt,
            paidAt: order.paidAt,
          })),
        }
      }),
    )

    return { cityItems, cityDetails }
  }

  const buildSalesByCustomerStructuredReport = async () => {
    if (!auth.accessToken) throw new Error('Sesión no disponible para exportar')

    const customerItems = (byCustomerQuery.data?.items ?? []).map((item) => ({
      customerName: item.customerName,
      city: item.city,
      ordersCount: item.ordersCount,
      quantity: toNumber(item.quantity),
      amount: toNumber(item.amount),
    }))

    const customerDetails = await Promise.all(
      (byCustomerQuery.data?.items ?? []).map(async (item) => {
        const response = await fetchOrdersByCustomer(auth.accessToken!, { from, to, customerId: item.customerId, status })
        return {
          customerName: item.customerName,
          orders: response.items.map((order) => ({
            id: order.id,
            number: order.number,
            status: order.status,
            customerName: order.customerName,
            total: order.total || 0,
            createdAt: order.createdAt,
            deliveredAt: order.deliveredAt,
            paidAt: order.paidAt,
          })),
        }
      }),
    )

    return { customerItems, customerDetails }
  }

  const buildTopProductsStructuredReport = async () => {
    if (!auth.accessToken) throw new Error('Sesión no disponible para exportar')

    const productItems = (topProductsQuery.data?.items ?? []).map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: toNumber(item.quantity),
      amount: toNumber(item.amount),
    }))

    const productDetails = await Promise.all(
      (topProductsQuery.data?.items ?? []).map(async (item) => {
        const response = await fetchOrdersByProduct(auth.accessToken!, { from, to, productId: item.productId, status })
        return {
          productName: item.name,
          sku: item.sku,
          orders: response.items.map((order) => ({
            id: order.id,
            number: order.number,
            status: order.status,
            customerName: order.customerName,
            total: order.total || 0,
            createdAt: order.createdAt,
            deliveredAt: order.deliveredAt,
            paidAt: order.paidAt,
          })),
        }
      }),
    )

    return { productItems, productDetails }
  }

  const buildMarginsStructuredReport = async () => {
    if (!auth.accessToken) throw new Error('Sesión no disponible para exportar')

    const items = marginsQuery.data?.items ?? []
    const totals = marginsQuery.data?.totals ?? { revenue: 0, costTotal: 0, profit: 0, avgMargin: 0 }
    const hasCostData = items.some((item) => item.costPrice > 0)

    const marginItems = items.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      qtySold: item.qtySold,
      revenue: item.revenue,
      costTotal: item.costTotal,
      profit: item.profit,
      marginPct: item.marginPct,
    }))

    const marginDetails = await Promise.all(
      items.map(async (item) => {
        const response = await fetchOrdersByProduct(auth.accessToken!, { from, to, productId: item.productId, status })
        return {
          productName: item.name,
          sku: item.sku,
          qtySold: item.qtySold,
          revenue: item.revenue,
          costTotal: item.costTotal,
          profit: item.profit,
          marginPct: item.marginPct,
          orders: response.items.map((order) => ({
            id: order.id,
            number: order.number,
            status: order.status,
            customerName: order.customerName,
            total: order.total || 0,
            createdAt: order.createdAt,
            deliveredAt: order.deliveredAt,
            paidAt: order.paidAt,
          })),
        }
      }),
    )

    return { marginItems, marginDetails, totals, hasCostData }
  }

  const buildMonthStructuredReport = async () => {
    const monthItems = (summaryQuery.data?.items ?? []).map((item) => ({
      day: item.day,
      ordersCount: item.ordersCount,
      linesCount: item.linesCount,
      quantity: toNumber(item.quantity),
      amount: toNumber(item.amount),
    }))

    return { monthItems }
  }

  const buildFunnelStructuredReport = async () => {
    const funnelItems = (funnelQuery.data?.items ?? []).map((item) => ({
      key: item.key,
      label: item.label,
      value: item.value,
    }))

    const totals = {
      amountFulfilled: toNumber(funnelQuery.data?.totals?.amountFulfilled),
      amountPaid: toNumber(funnelQuery.data?.totals?.amountPaid),
    }

    return { funnelItems, totals }
  }

  const buildComparisonStructuredReport = async () => {
    const comparisonItems = (byMonthQuery.data?.items ?? []).map((item) => ({
      month: item.month,
      orderCount: item.orderCount,
      linesCount: item.linesCount,
      quantity: toNumber(item.quantity),
      total: item.total,
    }))

    return { comparisonItems }
  }

  const handleExportDrillDownExcel = async () => {
    const items = drillDownType === 'city'
      ? (drillDownCityQuery.data?.items ?? [])
      : drillDownType === 'customer'
        ? (drillDownCustomerQuery.data?.items ?? [])
        : drillDownType === 'product'
          ? (drillDownProductQuery.data?.items ?? [])
          : []

    if (items.length === 0) {
      window.alert('No hay detalle para exportar')
      return
    }

    const sheets: Array<{ name: string; rows: Record<string, unknown>[] }> = []

    if (drillDownType === 'city' || drillDownType === 'product') {
      const mix = buildTopCustomerMix(items)
      const total = mix.reduce((sum, item) => sum + item.total, 0)
      sheets.push({
        name: 'Participacion clientes',
        rows: mix.map((item) => ({
          Cliente: item.label,
          Ordenes: item.ordersCount,
          [`Facturacion (${currency})`]: item.total,
          'Participacion %': total > 0 ? (item.total / total) * 100 : 0,
        })),
      })
    } else if (drillDownType === 'customer') {
      const mix = buildStatusMix(items)
      const total = mix.reduce((sum, item) => sum + item.total, 0)
      sheets.push({
        name: 'Participacion estados',
        rows: mix.map((item) => ({
          Estado: item.label,
          Ordenes: item.ordersCount,
          [`Facturacion (${currency})`]: item.total,
          'Participacion %': total > 0 ? (item.total / total) * 100 : 0,
        })),
      })
    }

    sheets.push({
      name: 'Ordenes',
      rows: items.map((order) => ({
        Orden: order.number,
        Cliente: order.customerName,
        Estado: orderStatusLabel(order.status),
        [`Total (${currency})`]: order.total,
        Fecha: new Date(order.createdAt).toLocaleDateString(),
        Entregada: order.deliveredAt ? 'Si' : 'No',
        Pagada: order.paidAt ? 'Si' : 'No',
      })),
    })

    sheets.push({
      name: 'Meta',
      rows: [{
        Detalle: drillDownTitle,
        Tipo: drillDownType ?? 'reporte',
        Desde: from,
        Hasta: to,
        Moneda: currency,
        Generado: new Date().toLocaleString(),
      }],
    })

    exportToXlsx(`detalle-${(drillDownType ?? 'reporte').toLowerCase()}-${from}-${to}.xlsx`, sheets)
  }

  const exportLegacyPdf = async () => {
    if (!reportRef.current || !auth.accessToken) return

    let tempContainer: HTMLDivElement | null = null
    try {
      type DrillEntry = { label: string; orders: OrderDetailItem[] }
      const drillEntries: DrillEntry[] = []

      // Obtener datos de drill-down según la pestaña activa
      if (tab === 'CITIES') {
        const cities = byCityQuery.data?.items ?? []
        const results = await Promise.all(
          cities.slice(0, 15).map((c) =>
            fetchOrdersByCity(auth.accessToken!, { from, to, city: c.city, status }).then((r) => ({
              label: c.city,
              orders: r.items,
            })),
          ),
        )
        drillEntries.push(...results)
      } else if (tab === 'CUSTOMERS') {
        const customers = byCustomerQuery.data?.items ?? []
        const results = await Promise.all(
          customers.slice(0, 15).map((c) =>
            fetchOrdersByCustomer(auth.accessToken!, { from, to, customerId: c.customerId, status }).then((r) => ({
              label: c.customerName,
              orders: r.items,
            })),
          ),
        )
        drillEntries.push(...results)
      } else if (tab === 'TOP_PRODUCTS') {
        const products = topProductsQuery.data?.items ?? []
        const results = await Promise.all(
          products.slice(0, 15).map((p) =>
            fetchOrdersByProduct(auth.accessToken!, { from, to, productId: p.productId, status }).then((r) => ({
              label: p.name,
              orders: r.items,
            })),
          ),
        )
        drillEntries.push(...results)
      } else if (tab === 'MARGINS') {
        const products = marginsQuery.data?.items ?? []
        const results = await Promise.all(
          products.slice(0, 15).map((p) =>
            fetchOrdersByProduct(auth.accessToken!, { from, to, productId: p.productId, status }).then((r) => ({
              label: p.name,
              orders: r.items,
            })),
          ),
        )
        drillEntries.push(...results)
      }

      // Si hay drill-down data, crear secciones temporales
      if (drillEntries.length > 0) {
        tempContainer = document.createElement('div')
        tempContainer.style.cssText = 'margin-top: 24px; page-break-before: always;'

        const sectionTitle = document.createElement('h2')
        sectionTitle.textContent = 'Detalle por registro'
        sectionTitle.style.cssText = 'font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 16px; padding: 12px 16px; background: linear-gradient(135deg, #eff6ff, #f0fdf4); border-radius: 8px; border-left: 4px solid #3b82f6;'
        tempContainer.appendChild(sectionTitle)

        for (const entry of drillEntries) {
          if (entry.orders.length === 0) continue

          const section = document.createElement('div')
          section.style.cssText = 'margin-bottom: 20px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;'

          const header = document.createElement('div')
          header.style.cssText = 'padding: 10px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #334155; font-size: 14px;'
          header.textContent = `📋 ${entry.label} — ${entry.orders.length} órdenes · Total: ${money(entry.orders.reduce((s, o) => s + (o.total || 0), 0))} ${currency}`
          section.appendChild(header)

          const table = document.createElement('table')
          table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 12px;'
          const thead = document.createElement('thead')
          thead.innerHTML = `<tr style="background:#f1f5f9;"><th style="padding:6px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0;">Orden</th><th style="padding:6px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0;">Cliente</th><th style="padding:6px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0;">Estado</th><th style="padding:6px 10px;text-align:right;color:#475569;border-bottom:1px solid #e2e8f0;">Total (${currency})</th><th style="padding:6px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0;">Fecha</th><th style="padding:6px 10px;text-align:center;color:#475569;border-bottom:1px solid #e2e8f0;">Entrega</th><th style="padding:6px 10px;text-align:center;color:#475569;border-bottom:1px solid #e2e8f0;">Pago</th></tr>`
          table.appendChild(thead)

          const tbody = document.createElement('tbody')
          for (const o of entry.orders) {
            const tr = document.createElement('tr')
            tr.style.cssText = 'border-bottom: 1px solid #f1f5f9;'
            tr.innerHTML = `<td style="padding:5px 10px;font-family:monospace;font-size:11px;">${o.number}</td><td style="padding:5px 10px;">${o.customerName}</td><td style="padding:5px 10px;"><span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;background:${o.status === 'FULFILLED' ? '#dcfce7;color:#166534' : o.status === 'CANCELLED' ? '#fee2e2;color:#991b1b' : '#dbeafe;color:#1e40af'}">${statusLabel(o.status as SalesStatus)}</span></td><td style="padding:5px 10px;text-align:right;color:#16a34a;font-weight:600;">${money(o.total || 0)}</td><td style="padding:5px 10px;">${new Date(o.createdAt).toLocaleDateString()}</td><td style="padding:5px 10px;text-align:center;">${o.deliveredAt ? '✅' : '⏳'}</td><td style="padding:5px 10px;text-align:center;">${o.paidAt ? '✅' : '⏳'}</td>`
            tbody.appendChild(tr)
          }
          table.appendChild(tbody)
          section.appendChild(table)
          tempContainer.appendChild(section)
        }

        reportRef.current.appendChild(tempContainer)
        // Esperar reflow
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
      }

      await exportElementToPdf(reportRef.current, {
        filename: exportFilename,
        title,
        subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`,
        companyName: tenant.branding?.tenantName ?? 'Empresa',
        headerColor: '#10B981',
        logoUrl: tenant.branding?.logoUrl ?? undefined,
      })
    } catch (err) {
      console.error('Error exportando PDF:', err)
      window.alert('No se pudo generar el PDF')
    } finally {
      if (tempContainer && reportRef.current?.contains(tempContainer)) {
        reportRef.current.removeChild(tempContainer)
      }
    }
  }

  const handleExportPdf = async () => {
    setExportingPdf(true)
    try {
      if (tab === 'CITIES') {
        const { cityItems, cityDetails } = await buildSalesByCityStructuredReport()
        await exportReactNodeToPdf(
          <SalesByCityDocument
            title={title}
            from={from}
            to={to}
            currency={currency}
            statusLabel={statusLabel(status)}
            items={cityItems}
            details={cityDetails}
          />,
          {
            filename: exportFilename,
            title,
            subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`,
            companyName: tenant.branding?.tenantName ?? 'Empresa',
            headerColor: '#10B981',
            logoUrl: tenant.branding?.logoUrl ?? undefined,
            captureWidthPx: 1200,
          },
        )
        return
      }

      if (tab === 'CUSTOMERS') {
        const { customerItems, customerDetails } = await buildSalesByCustomerStructuredReport()
        await exportReactNodeToPdf(
          <SalesByCustomerDocument
            title={title}
            from={from}
            to={to}
            currency={currency}
            statusLabel={statusLabel(status)}
            items={customerItems}
            details={customerDetails}
          />,
          {
            filename: exportFilename,
            title,
            subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`,
            companyName: tenant.branding?.tenantName ?? 'Empresa',
            headerColor: '#10B981',
            logoUrl: tenant.branding?.logoUrl ?? undefined,
            captureWidthPx: 1200,
          },
        )
        return
      }

      if (tab === 'TOP_PRODUCTS') {
        const { productItems, productDetails } = await buildTopProductsStructuredReport()
        await exportReactNodeToPdf(
          <SalesTopProductsDocument
            title={title}
            from={from}
            to={to}
            currency={currency}
            statusLabel={statusLabel(status)}
            items={productItems}
            details={productDetails}
          />,
          {
            filename: exportFilename,
            title,
            subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`,
            companyName: tenant.branding?.tenantName ?? 'Empresa',
            headerColor: '#10B981',
            logoUrl: tenant.branding?.logoUrl ?? undefined,
            captureWidthPx: 1200,
          },
        )
        return
      }

      if (tab === 'MARGINS') {
        const { marginItems, marginDetails, totals, hasCostData } = await buildMarginsStructuredReport()
        await exportReactNodeToPdf(
          <SalesMarginsDocument
            title={title}
            from={from}
            to={to}
            currency={currency}
            statusLabel={statusLabel(status)}
            hasCostData={hasCostData}
            totals={totals}
            items={marginItems}
            details={marginDetails}
          />,
          {
            filename: exportFilename,
            title,
            subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`,
            companyName: tenant.branding?.tenantName ?? 'Empresa',
            headerColor: '#10B981',
            logoUrl: tenant.branding?.logoUrl ?? undefined,
            captureWidthPx: 1200,
          },
        )
        return
      }

      if (tab === 'MONTH') {
        const { monthItems } = await buildMonthStructuredReport()
        await exportReactNodeToPdf(
          <SalesMonthDocument
            title={title}
            from={from}
            to={to}
            currency={currency}
            statusLabel={statusLabel(status)}
            items={monthItems}
          />,
          {
            filename: exportFilename,
            title,
            subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`,
            companyName: tenant.branding?.tenantName ?? 'Empresa',
            headerColor: '#10B981',
            logoUrl: tenant.branding?.logoUrl ?? undefined,
            captureWidthPx: 1200,
          },
        )
        return
      }

      if (tab === 'FUNNEL') {
        const { funnelItems, totals } = await buildFunnelStructuredReport()
        await exportReactNodeToPdf(
          <SalesFunnelDocument
            title={title}
            from={from}
            to={to}
            currency={currency}
            items={funnelItems}
            totals={totals}
          />,
          {
            filename: exportFilename,
            title,
            subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`,
            companyName: tenant.branding?.tenantName ?? 'Empresa',
            headerColor: '#10B981',
            logoUrl: tenant.branding?.logoUrl ?? undefined,
            captureWidthPx: 1200,
          },
        )
        return
      }

      if (tab === 'COMPARISON') {
        const { comparisonItems } = await buildComparisonStructuredReport()
        await exportReactNodeToPdf(
          <SalesComparisonDocument
            title={title}
            from={from}
            to={to}
            currency={currency}
            statusLabel={statusLabel(status)}
            items={comparisonItems}
          />,
          {
            filename: exportFilename,
            title,
            subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`,
            companyName: tenant.branding?.tenantName ?? 'Empresa',
            headerColor: '#10B981',
            logoUrl: tenant.branding?.logoUrl ?? undefined,
            captureWidthPx: 1200,
          },
        )
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
      const metaSheet = {
        name: 'Meta',
        rows: [
          {
            Reporte: title,
            Desde: from,
            Hasta: to,
            Estado: statusLabel(status),
            Moneda: currency,
            Generado: new Date().toLocaleString(),
          },
        ],
      }

      if (tab === 'CITIES') {
        const { cityItems, cityDetails } = await buildSalesByCityStructuredReport()
        exportToXlsx(`reporte-ventas-ciudades-${from}-${to}.xlsx`, [
          {
            name: 'Resumen',
            rows: cityItems.map((item) => ({
              Ciudad: item.city,
              Ordenes: item.ordersCount,
              Cantidad: item.quantity,
              [`Total (${currency})`]: item.amount,
            })),
          },
          {
            name: 'Detalle ordenes',
            rows: cityDetails.flatMap((detail) =>
              detail.orders.map((order) => ({
                Ciudad: detail.city,
                Orden: order.number,
                Cliente: order.customerName,
                Estado: orderStatusLabel(order.status),
                [`Total (${currency})`]: order.total,
                Fecha: new Date(order.createdAt).toLocaleDateString(),
                Entregada: order.deliveredAt ? 'Si' : 'No',
                Pagada: order.paidAt ? 'Si' : 'No',
              })),
            ),
          },
          metaSheet,
        ])
      } else if (tab === 'CUSTOMERS') {
        const { customerItems, customerDetails } = await buildSalesByCustomerStructuredReport()
        exportToXlsx(`reporte-ventas-clientes-${from}-${to}.xlsx`, [
          {
            name: 'Resumen',
            rows: customerItems.map((item) => ({
              Cliente: item.customerName,
              Ciudad: item.city ?? '-',
              Ordenes: item.ordersCount,
              Cantidad: item.quantity,
              [`Total (${currency})`]: item.amount,
            })),
          },
          {
            name: 'Detalle ordenes',
            rows: customerDetails.flatMap((detail) =>
              detail.orders.map((order) => ({
                Cliente: detail.customerName,
                Orden: order.number,
                Estado: orderStatusLabel(order.status),
                [`Total (${currency})`]: order.total,
                Fecha: new Date(order.createdAt).toLocaleDateString(),
                Entregada: order.deliveredAt ? 'Si' : 'No',
                Pagada: order.paidAt ? 'Si' : 'No',
              })),
            ),
          },
          metaSheet,
        ])
      } else if (tab === 'TOP_PRODUCTS') {
        const { productItems, productDetails } = await buildTopProductsStructuredReport()
        exportToXlsx(`reporte-ventas-productos-${from}-${to}.xlsx`, [
          {
            name: 'Resumen',
            rows: productItems.map((item) => ({
              SKU: item.sku,
              Producto: item.name,
              Cantidad: item.quantity,
              [`Total (${currency})`]: item.amount,
            })),
          },
          {
            name: 'Detalle ordenes',
            rows: productDetails.flatMap((detail) =>
              detail.orders.map((order) => ({
                SKU: detail.sku,
                Producto: detail.productName,
                Orden: order.number,
                Cliente: order.customerName,
                Estado: orderStatusLabel(order.status),
                [`Total (${currency})`]: order.total,
                Fecha: new Date(order.createdAt).toLocaleDateString(),
                Entregada: order.deliveredAt ? 'Si' : 'No',
                Pagada: order.paidAt ? 'Si' : 'No',
              })),
            ),
          },
          metaSheet,
        ])
      } else if (tab === 'MARGINS') {
        const { marginItems, marginDetails, totals, hasCostData } = await buildMarginsStructuredReport()
        exportToXlsx(`reporte-ventas-margenes-${from}-${to}.xlsx`, [
          {
            name: 'Resumen',
            rows: marginItems.map((item) => ({
              SKU: item.sku,
              Producto: item.name,
              Unidades: item.qtySold,
              [`Ingreso (${currency})`]: item.revenue,
              [`Costo (${currency})`]: item.costTotal,
              [`Utilidad (${currency})`]: item.profit,
              'Margen %': item.marginPct,
            })),
          },
          {
            name: 'Detalle ordenes',
            rows: marginDetails.flatMap((detail) =>
              detail.orders.map((order) => ({
                SKU: detail.sku,
                Producto: detail.productName,
                'Margen %': detail.marginPct,
                Orden: order.number,
                Cliente: order.customerName,
                Estado: orderStatusLabel(order.status),
                [`Total (${currency})`]: order.total,
                Fecha: new Date(order.createdAt).toLocaleDateString(),
                Entregada: order.deliveredAt ? 'Si' : 'No',
                Pagada: order.paidAt ? 'Si' : 'No',
              })),
            ),
          },
          {
            name: 'Totales',
            rows: [
              {
                [`Ingreso (${currency})`]: totals.revenue,
                [`Costo (${currency})`]: totals.costTotal,
                [`Utilidad (${currency})`]: totals.profit,
                'Margen promedio %': totals.avgMargin,
                'Costo configurado': hasCostData ? 'Si' : 'No',
              },
            ],
          },
          metaSheet,
        ])
      } else if (tab === 'MONTH') {
        const { monthItems } = await buildMonthStructuredReport()
        exportToXlsx(`reporte-ventas-mes-${from}-${to}.xlsx`, [
          {
            name: 'Resumen diario',
            rows: monthItems.map((item) => ({
              Dia: new Date(item.day).toLocaleDateString(),
              Ordenes: item.ordersCount,
              Lineas: item.linesCount,
              Unidades: item.quantity,
              [`Total (${currency})`]: item.amount,
            })),
          },
          metaSheet,
        ])
      } else if (tab === 'FUNNEL') {
        const { funnelItems, totals } = await buildFunnelStructuredReport()
        exportToXlsx(`reporte-ventas-embudo-${from}-${to}.xlsx`, [
          {
            name: 'Embudo',
            rows: funnelItems.map((item, idx) => ({
              Orden: idx + 1,
              Etapa: item.label,
              Cantidad: item.value,
            })),
          },
          {
            name: 'Totales',
            rows: [
              {
                [`Entregado (${currency})`]: totals.amountFulfilled,
                [`Cobrado (${currency})`]: totals.amountPaid,
              },
            ],
          },
          metaSheet,
        ])
      } else if (tab === 'COMPARISON') {
        const { comparisonItems } = await buildComparisonStructuredReport()
        exportToXlsx(`reporte-ventas-comparacion-${from}-${to}.xlsx`, [
          {
            name: 'Comparacion mensual',
            rows: comparisonItems.map((item, idx) => {
              const prev = comparisonItems[idx - 1]
              const variation = prev && prev.total > 0 ? ((item.total - prev.total) / prev.total) * 100 : null
              return {
                Mes: item.month,
                Ordenes: item.orderCount,
                Lineas: item.linesCount,
                Unidades: item.quantity,
                [`Total (${currency})`]: item.total,
                'Variacion %': variation,
              }
            }),
          },
          metaSheet,
        ])
      } else {
        window.alert('La exportación estructurada a Excel ya está disponible para todas las pestañas de ventas.')
        return
      }
    } catch (err) {
      console.error('Error exportando Excel:', err)
      window.alert('No se pudo generar el Excel')
    } finally {
      setExportingExcel(false)
    }
  }

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

  // Query para comparativa mensual
  const byMonthQuery = useQuery({
    queryKey: ['reports', 'sales', 'byMonth', { from, to, status }],
    queryFn: () => fetchSalesByMonth(auth.accessToken!, { from, to, status }),
    enabled: !!auth.accessToken && tab === 'COMPARISON',
  })

  // Query para márgenes
  const marginsQuery = useQuery({
    queryKey: ['reports', 'sales', 'margins', { from, to, status }],
    queryFn: () => fetchProductMargins(auth.accessToken!, { from, to, take: 30, status }),
    enabled: !!auth.accessToken && tab === 'MARGINS',
  })



  const exportFilename = useMemo(() => {
    const base = tab.toLowerCase()
    return `reporte-ventas-${base}-${from}-${to}.pdf`
  }, [from, to, tab])

  const emailMutation = useMutation({
    mutationFn: async () => {
      if (!reportRef.current) throw new Error('No se pudo generar el PDF')
      if (!emailTo.trim()) throw new Error('Ingresa un correo válido')
      let blob: Blob

      if (tab === 'CITIES') {
        const { cityItems, cityDetails } = await buildSalesByCityStructuredReport()
        blob = await pdfBlobFromReactNode(
          <SalesByCityDocument title={title} from={from} to={to} currency={currency} statusLabel={statusLabel(status)} items={cityItems} details={cityDetails} />,
          { title, subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#10B981', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1200 },
        )
      } else if (tab === 'CUSTOMERS') {
        const { customerItems, customerDetails } = await buildSalesByCustomerStructuredReport()
        blob = await pdfBlobFromReactNode(
          <SalesByCustomerDocument title={title} from={from} to={to} currency={currency} statusLabel={statusLabel(status)} items={customerItems} details={customerDetails} />,
          { title, subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#10B981', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1200 },
        )
      } else if (tab === 'TOP_PRODUCTS') {
        const { productItems, productDetails } = await buildTopProductsStructuredReport()
        blob = await pdfBlobFromReactNode(
          <SalesTopProductsDocument title={title} from={from} to={to} currency={currency} statusLabel={statusLabel(status)} items={productItems} details={productDetails} />,
          { title, subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#10B981', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1200 },
        )
      } else if (tab === 'MARGINS') {
        const { marginItems, marginDetails, totals, hasCostData } = await buildMarginsStructuredReport()
        blob = await pdfBlobFromReactNode(
          <SalesMarginsDocument title={title} from={from} to={to} currency={currency} statusLabel={statusLabel(status)} hasCostData={hasCostData} totals={totals} items={marginItems} details={marginDetails} />,
          { title, subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#10B981', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1200 },
        )
      } else if (tab === 'MONTH') {
        const { monthItems } = await buildMonthStructuredReport()
        blob = await pdfBlobFromReactNode(
          <SalesMonthDocument title={title} from={from} to={to} currency={currency} statusLabel={statusLabel(status)} items={monthItems} />,
          { title, subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#10B981', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1200 },
        )
      } else if (tab === 'FUNNEL') {
        const { funnelItems, totals } = await buildFunnelStructuredReport()
        blob = await pdfBlobFromReactNode(
          <SalesFunnelDocument title={title} from={from} to={to} currency={currency} items={funnelItems} totals={totals} />,
          { title, subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#10B981', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1200 },
        )
      } else if (tab === 'COMPARISON') {
        const { comparisonItems } = await buildComparisonStructuredReport()
        blob = await pdfBlobFromReactNode(
          <SalesComparisonDocument title={title} from={from} to={to} currency={currency} statusLabel={statusLabel(status)} items={comparisonItems} />,
          { title, subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`, companyName: tenant.branding?.tenantName ?? 'Empresa', headerColor: '#10B981', logoUrl: tenant.branding?.logoUrl ?? undefined, captureWidthPx: 1200 },
        )
      } else {
        blob = await pdfBlobFromElement(reportRef.current, { title })
      }

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

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="📊 Reportes de Ventas">
        {/* LÍNEA 2: Tipo de Reporte | Acciones */}
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Tipos de reporte - botones outline */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-2 text-sm font-medium text-slate-600 dark:text-slate-400">Tipo de reporte:</span>
              <Button size="sm" variant={tab === 'MONTH' ? 'primary' : 'outline'} onClick={() => setTab('MONTH')}>
                📅 Mes
              </Button>
              <Button size="sm" variant={tab === 'CUSTOMERS' ? 'primary' : 'outline'} onClick={() => setTab('CUSTOMERS')}>
                👥 Clientes
              </Button>
              <Button size="sm" variant={tab === 'CITIES' ? 'primary' : 'outline'} onClick={() => setTab('CITIES')}>
                🏙️ Ciudades
              </Button>
              <Button size="sm" variant={tab === 'TOP_PRODUCTS' ? 'primary' : 'outline'} onClick={() => setTab('TOP_PRODUCTS')}>
                🧪 Productos
              </Button>
              <Button size="sm" variant={tab === 'FUNNEL' ? 'primary' : 'outline'} onClick={() => setTab('FUNNEL')}>
                🔻 Embudo
              </Button>
              <Button size="sm" variant={tab === 'COMPARISON' ? 'primary' : 'outline'} onClick={() => setTab('COMPARISON')}>
                📊 Comparativa
              </Button>
              <Button size="sm" variant={tab === 'MARGINS' ? 'primary' : 'outline'} onClick={() => setTab('MARGINS')}>
                💹 Márgenes
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

        <div ref={reportRef} className="space-y-6">
          {/* Header mejorado del reporte */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-green-50 via-white to-blue-50 shadow-md dark:border-slate-700 dark:from-green-900/20 dark:via-slate-900 dark:to-blue-900/20">
            <div className="border-b border-green-200 bg-gradient-to-r from-green-500 to-blue-500 px-6 py-3 dark:border-green-700">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-white/20 p-2 backdrop-blur">
                  <span className="text-3xl">📊</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">{title}</h2>
                  <p className="text-sm text-white/90">
                    {from} al {to} • {statusLabel(status)} • Moneda: {currency}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-wrap gap-3 text-sm">
                <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
                  <span className="text-base">🏢</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{tenant.branding?.tenantName ?? 'Empresa'}</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
                  <span className="text-base">📅</span>
                  <span className="text-slate-600 dark:text-slate-400">
                    Generado: {new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {tab === 'MONTH' && (
            <ReportSection
              title="📈 Evolución de Ventas"
              subtitle="Montos y cantidad de órdenes por día"
              icon="📊"
            >
              {summaryQuery.isLoading && <Loading />}
              {summaryQuery.isError && <ErrorState message={(summaryQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!summaryQuery.isLoading && !summaryQuery.isError && (summaryQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ventas en el rango seleccionado." />
              )}
              {!summaryQuery.isLoading && !summaryQuery.isError && (summaryQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  {/* KPIs resumidos */}
                  <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <KPICard
                      icon="💰"
                      label="Total Facturado"
                      value={`${money((summaryQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.amount), 0))} ${currency}`}
                      color="success"
                      subtitle="En el período"
                    />
                    <KPICard
                      icon="🧾"
                      label="Órdenes"
                      value={(summaryQuery.data?.items ?? []).reduce((sum, i) => sum + i.ordersCount, 0)}
                      color="primary"
                      subtitle="Total procesadas"
                    />
                    <KPICard
                      icon="📦"
                      label="Líneas de Venta"
                      value={(summaryQuery.data?.items ?? []).reduce((sum, i) => sum + i.linesCount, 0)}
                      color="info"
                      subtitle="Items vendidos"
                    />
                  </div>

                  {/* Gráfico mejorado con área y gradiente */}
                  <div className="mx-auto h-[400px] w-full min-w-0 max-w-5xl overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                      <AreaChart
                        data={(summaryQuery.data?.items ?? []).map((i) => ({
                          day: new Date(i.day).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }),
                          amount: toNumber(i.amount),
                          ordersCount: i.ordersCount,
                        }))}
                        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={reportColors.success[0]} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={reportColors.success[0]} stopOpacity={0.1} />
                          </linearGradient>
                          <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={reportColors.primary[0]} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={reportColors.primary[0]} stopOpacity={0.1} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid {...chartGridStyle} />
                        <XAxis dataKey="day" {...chartAxisStyle} angle={-45} textAnchor="end" height={80} />
                        <YAxis yAxisId="left" {...chartAxisStyle} />
                        <YAxis yAxisId="right" orientation="right" {...chartAxisStyle} />
                        <Tooltip {...chartTooltipStyle} formatter={(v: any, name: any) => [name === 'amount' ? `${money(Number(v))} ${currency}` : v, name === 'amount' ? 'Facturado' : 'Órdenes']} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey="amount"
                          stroke={reportColors.success[0]}
                          strokeWidth={3}
                          fillOpacity={1}
                          fill="url(#colorAmount)"
                          name="Monto Facturado"
                        />
                        <Area
                          yAxisId="right"
                          type="monotone"
                          dataKey="ordersCount"
                          stroke={reportColors.primary[0]}
                          strokeWidth={3}
                          fillOpacity={1}
                          fill="url(#colorOrders)"
                          name="Cantidad de Órdenes"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </ReportSection>
          )}

          {tab === 'CUSTOMERS' && (
            <ReportSection
              title="👥 Ventas por Cliente"
              subtitle="Top clientes por volumen de ventas"
              icon="🏆"
            >
              {byCustomerQuery.isLoading && <Loading />}
              {byCustomerQuery.isError && <ErrorState message={(byCustomerQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!byCustomerQuery.isLoading && !byCustomerQuery.isError && (byCustomerQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ventas en el rango seleccionado." />
              )}
              {!byCustomerQuery.isLoading && !byCustomerQuery.isError && (byCustomerQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  {/* KPIs de clientes */}
                  <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <KPICard
                      icon="👤"
                      label="Total Clientes"
                      value={(byCustomerQuery.data?.items ?? []).length}
                      color="primary"
                    />
                    <KPICard
                      icon="💵"
                      label="Facturación Total"
                      value={`${money((byCustomerQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.amount), 0))} ${currency}`}
                      color="success"
                    />
                    <KPICard
                      icon="📊"
                      label="Promedio por Cliente"
                      value={`${money((byCustomerQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.amount), 0) / Math.max(1, (byCustomerQuery.data?.items ?? []).length))} ${currency}`}
                      color="info"
                    />
                  </div>

                  {/* Gráfico de barras mejorado */}
                  <div className="mx-auto mb-6 h-[400px] w-full min-w-0 max-w-5xl overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                      <BarChart
                        data={(byCustomerQuery.data?.items ?? []).slice(0, 15).map((i) => ({
                          name: i.customerName.length > 20 ? i.customerName.slice(0, 17) + '...' : i.customerName,
                          amount: toNumber(i.amount),
                          ordersCount: i.ordersCount,
                        }))}
                        margin={{ left: 10, right: 10, bottom: 80 }}
                      >
                        <CartesianGrid {...chartGridStyle} />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} {...chartAxisStyle} />
                        <YAxis yAxisId="left" {...chartAxisStyle} label={{ value: `Monto (${currency})`, angle: -90, position: 'insideLeft' }} />
                        <YAxis yAxisId="right" orientation="right" {...chartAxisStyle} label={{ value: 'Órdenes', angle: 90, position: 'insideRight' }} />
                        <Tooltip {...chartTooltipStyle} formatter={(v: any, name: any) => [name === 'amount' ? `${money(Number(v))} ${currency}` : v, name === 'amount' ? 'Facturado' : 'Órdenes']} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="amount" fill={reportColors.success[0]} name="Monto Facturado" radius={[8, 8, 0, 0]} />
                        <Bar yAxisId="right" dataKey="ordersCount" fill={reportColors.primary[1]} name="Cantidad de Órdenes" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Tabla detallada - clickeable para drill-down */}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="bg-blue-50 dark:bg-blue-900/20 px-4 py-2 text-xs text-blue-700 dark:text-blue-300">
                      💡 Haz click en un cliente para ver sus órdenes detalladas
                    </div>
                    <Table
                      columns={[
                        { 
                          header: '🏅 Cliente', 
                          accessor: (r, idx) => (
                            <div className="flex items-center gap-2">
                              {idx < 3 && <span className="text-lg">{['🥇', '🥈', '🥉'][idx]}</span>}
                              <span className="font-medium">{r.customerName}</span>
                            </div>
                          )
                        },
                        { header: '🏙️ Ciudad', accessor: (r) => r.city ?? '-' },
                        { header: '📋 Órdenes', accessor: (r) => String(r.ordersCount) },
                        { header: '📦 Cantidad', accessor: (r) => toNumber(r.quantity).toFixed(0) },
                        { 
                          header: `💰 Total (${currency})`, 
                          accessor: (r) => (
                            <span className="font-semibold text-green-600 dark:text-green-400">
                              {money(toNumber(r.amount))}
                            </span>
                          )
                        },
                        {
                          header: '% del Total',
                          accessor: (r) => {
                            const total = (byCustomerQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.amount), 0)
                            const pct = total > 0 ? (toNumber(r.amount) / total) * 100 : 0
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
                      data={byCustomerQuery.data?.items ?? []}
                      keyExtractor={(r) => r.customerId}
                      onRowClick={(r) => openDrillDown('customer', r.customerId, `Órdenes de ${r.customerName}`)}
                    />
                  </div>
                </>
              )}
            </ReportSection>
          )}

          {tab === 'CITIES' && (
            <ReportSection
              title="🏙️ Ventas por Ciudad"
              subtitle="Distribución geográfica de ventas"
              icon="🗺️"
            >
              {byCityQuery.isLoading && <Loading />}
              {byCityQuery.isError && <ErrorState message={(byCityQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!byCityQuery.isLoading && !byCityQuery.isError && (byCityQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ventas en el rango seleccionado." />
              )}
              {!byCityQuery.isLoading && !byCityQuery.isError && (byCityQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  {/* KPIs */}
                  <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <KPICard
                      icon="📍"
                      label="Ciudades Activas"
                      value={(byCityQuery.data?.items ?? []).length}
                      color="info"
                    />
                    <KPICard
                      icon="🏆"
                      label="Ciudad Líder"
                      value={(byCityQuery.data?.items ?? [])[0]?.city ?? '-'}
                      subtitle={`${money(toNumber((byCityQuery.data?.items ?? [])[0]?.amount))} ${currency}`}
                      color="warning"
                    />
                    <KPICard
                      icon="💰"
                      label="Total Facturado"
                      value={`${money((byCityQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.amount), 0))} ${currency}`}
                      color="success"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* Gráfico de torta mejorado */}
                    <div className="h-[400px] w-full min-w-0 overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                        <PieChart>
                          <Pie
                            data={(byCityQuery.data?.items ?? []).map((i) => ({
                              name: i.city,
                              value: toNumber(i.amount),
                            }))}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={70}
                            outerRadius={130}
                            paddingAngle={4}
                            label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                          >
                            {(byCityQuery.data?.items ?? []).map((_, idx) => (
                              <Cell key={idx} fill={getChartColor(idx, 'rainbow')} />
                            ))}
                          </Pie>
                          <Tooltip
                            {...chartTooltipStyle}
                            formatter={(v: any) => [`${money(Number(v))} ${currency}`, 'Facturado']}
                          />
                          <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Tabla con ranking - clickeable para drill-down */}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="bg-blue-50 dark:bg-blue-900/20 px-4 py-2 text-xs text-blue-700 dark:text-blue-300">
                        💡 Haz click en una ciudad para ver las órdenes detalladas
                      </div>
                      <Table
                        columns={[
                          {
                            header: '🏅 Ciudad',
                            className: 'wrap',
                            width: '28%',
                            accessor: (r, idx) => (
                              <div className="flex items-center gap-2">
                                {idx < 3 && <span className="text-lg">{['🥇', '🥈', '🥉'][idx]}</span>}
                                <span className="font-medium">{r.city}</span>
                              </div>
                            ),
                          },
                          { header: '📋 Órdenes', width: '12%', accessor: (r) => String(r.ordersCount) },
                          { header: '📦 Cantidad', width: '14%', accessor: (r) => toNumber(r.quantity).toFixed(0) },
                          {
                            header: `💰 Total (${currency})`,
                            className: 'wrap',
                            width: '20%',
                            accessor: (r) => (
                              <span className="font-semibold text-green-600 dark:text-green-400">
                                {money(toNumber(r.amount))}
                              </span>
                            ),
                          },
                          {
                            header: '% del Total',
                            className: 'wrap',
                            width: '26%',
                            accessor: (r) => {
                              const total = (byCityQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.amount), 0)
                              const pct = total > 0 ? (toNumber(r.amount) / total) * 100 : 0
                              const pctSafe = Number.isFinite(pct) ? pct : 0
                              return (
                                <div className="flex items-center gap-2">
                                  <div className="h-2 w-full max-w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                    <div className="h-full bg-blue-500" style={{ width: `${pctSafe}%` }} />
                                  </div>
                                  <span className="text-sm">{pctSafe.toFixed(1)}%</span>
                                </div>
                              )
                            },
                          },
                        ]}
                        data={byCityQuery.data?.items ?? []}
                        keyExtractor={(r) => r.city}
                        onRowClick={(r) => openDrillDown('city', r.city, `Órdenes en ${r.city}`)}
                      />
                    </div>
                  </div>
                </>
              )}
            </ReportSection>
          )}

          {tab === 'TOP_PRODUCTS' && (
            <ReportSection
              title="🧪 Productos Más Vendidos"
              subtitle="Ranking de productos por facturación y volumen"
              icon="🏆"
            >
              {topProductsQuery.isLoading && <Loading />}
              {topProductsQuery.isError && (
                <ErrorState message={(topProductsQuery.error as any)?.message ?? 'Error cargando reporte'} />
              )}
              {!topProductsQuery.isLoading && !topProductsQuery.isError && (topProductsQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay ventas en el rango seleccionado." />
              )}
              {!topProductsQuery.isLoading && !topProductsQuery.isError && (topProductsQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  {/* KPIs de productos */}
                  <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
                    <KPICard
                      icon="📦"
                      label="Productos Vendidos"
                      value={(topProductsQuery.data?.items ?? []).length}
                      color="primary"
                    />
                    <KPICard
                      icon="⭐"
                      label="Producto Estrella"
                      value={(topProductsQuery.data?.items ?? [])[0]?.name?.slice(0, 15) ?? '-'}
                      subtitle={`${toNumber((topProductsQuery.data?.items ?? [])[0]?.quantity).toFixed(0)} unidades`}
                      color="warning"
                    />
                    <KPICard
                      icon="📊"
                      label="Unidades Totales"
                      value={(topProductsQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.quantity), 0).toFixed(0)}
                      color="info"
                    />
                    <KPICard
                      icon="💵"
                      label="Facturación Total"
                      value={`${money((topProductsQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.amount), 0))} ${currency}`}
                      color="success"
                    />
                  </div>

                  {/* Gráfico mejorado con barras horizontales y colores */}
                  <div className="mx-auto mb-6 h-[450px] w-full min-w-0 max-w-5xl overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={350}>
                      <BarChart
                        data={(topProductsQuery.data?.items ?? []).slice(0, 12).map((i) => ({
                          name: i.name.length > 25 ? i.name.slice(0, 22) + '...' : i.name,
                          amount: toNumber(i.amount),
                          quantity: toNumber(i.quantity),
                        }))}
                        margin={{ left: 10, right: 30, bottom: 80 }}
                      >
                        <CartesianGrid {...chartGridStyle} />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} {...chartAxisStyle} />
                        <YAxis yAxisId="left" {...chartAxisStyle} label={{ value: `Monto (${currency})`, angle: -90, position: 'insideLeft' }} />
                        <YAxis yAxisId="right" orientation="right" {...chartAxisStyle} label={{ value: 'Unidades', angle: 90, position: 'insideRight' }} />
                        <Tooltip
                          {...chartTooltipStyle}
                          formatter={(v: any, name: any) => [name === 'amount' ? `${money(Number(v))} ${currency}` : `${Number(v).toFixed(0)} unid.`, name === 'amount' ? 'Facturado' : 'Cantidad']}
                        />
                        <Legend />
                        <Bar yAxisId="left" dataKey="amount" fill={reportColors.success[0]} name="Monto Facturado" radius={[8, 8, 0, 0]} />
                        <Bar yAxisId="right" dataKey="quantity" fill={reportColors.warning[0]} name="Cantidad Vendida" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Tabla detallada - clickeable para drill-down */}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="bg-blue-50 dark:bg-blue-900/20 px-4 py-2 text-xs text-blue-700 dark:text-blue-300">
                      💡 Haz click en un producto para ver las órdenes donde se vendió
                    </div>
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
                        { header: '📊 Cantidad', accessor: (r) => <span className="tabular-nums">{toNumber(r.quantity).toFixed(0)}</span> },
                        {
                          header: `💰 Total (${currency})`,
                          accessor: (r) => (
                            <span className="font-semibold tabular-nums text-green-600 dark:text-green-400">
                              {money(toNumber(r.amount))}
                            </span>
                          ),
                        },
                        {
                          header: '% Ingresos',
                          accessor: (r) => {
                            const total = (topProductsQuery.data?.items ?? []).reduce((sum, i) => sum + toNumber(i.amount), 0)
                            const pct = total > 0 ? (toNumber(r.amount) / total) * 100 : 0
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
                      data={topProductsQuery.data?.items ?? []}
                      keyExtractor={(r) => r.productId}
                      onRowClick={(r) => openDrillDown('product', r.productId, `Órdenes con ${r.name}`)}
                    />
                  </div>
                </>
              )}
            </ReportSection>
          )}

          {tab === 'FUNNEL' && (
            <ReportSection
              title="🔻 Embudo de Ventas"
              subtitle="Proceso completo desde cotización hasta cobro"
              icon="📊"
            >
              {funnelQuery.isLoading && <Loading />}
              {funnelQuery.isError && <ErrorState message={(funnelQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!funnelQuery.isLoading && !funnelQuery.isError && (funnelQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay datos en el rango seleccionado." />
              )}
              {!funnelQuery.isLoading && !funnelQuery.isError && (funnelQuery.data?.items?.length ?? 0) > 0 && (
                <>
                  {/* KPIs del embudo con iconos */}
                  <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
                    {(funnelQuery.data?.items ?? []).map((i, idx) => {
                      const icons = ['📝', '⚙️', '📦', '✅', '💰']
                      const colors: Array<'primary' | 'info' | 'warning' | 'success'> = ['primary', 'info', 'warning', 'success', 'success']
                      return (
                        <KPICard
                          key={i.key}
                          icon={icons[idx] ?? '📊'}
                          label={i.label}
                          value={i.value}
                          color={colors[idx] ?? 'primary'}
                        />
                      )
                    })}
                  </div>

                  {/* Gráfico de embudo visual */}
                  <div className="mx-auto mb-6 h-[400px] w-full min-w-0 max-w-5xl overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                      <BarChart
                        data={(funnelQuery.data?.items ?? []).map((i, idx) => ({
                          label: i.label,
                          value: i.value,
                          fill: getChartColor(idx, 'rainbow'),
                        }))}
                        layout="horizontal"
                        margin={{ top: 20, right: 30, left: 20, bottom: 40 }}
                      >
                        <CartesianGrid {...chartGridStyle} />
                        <XAxis type="category" dataKey="label" angle={-15} textAnchor="end" height={60} {...chartAxisStyle} />
                        <YAxis type="number" {...chartAxisStyle} />
                        <Tooltip {...chartTooltipStyle} formatter={(v: any) => [v, 'Cantidad']} />
                        <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                          {(funnelQuery.data?.items ?? []).map((_, idx) => (
                            <Cell key={idx} fill={getChartColor(idx, 'rainbow')} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Totales monetarios con KPIs */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <KPICard
                      icon="✅"
                      label="Total Entregado"
                      value={`${money(toNumber(funnelQuery.data?.totals?.amountFulfilled))} ${currency}`}
                      color="success"
                      subtitle="Órdenes completadas"
                    />
                    <KPICard
                      icon="💵"
                      label="Total Cobrado"
                      value={`${money(toNumber(funnelQuery.data?.totals?.amountPaid))} ${currency}`}
                      color="primary"
                      subtitle="Pagos recibidos"
                    />
                  </div>
                </>
              )}
            </ReportSection>
          )}

          {/* Reporte Comparativo mes a mes */}
          {tab === 'COMPARISON' && (
            <ReportSection
              title="📊 Comparativa de Meses"
              subtitle="Evolución de ventas comparando períodos"
              icon="📈"
            >
              {byMonthQuery.isLoading && <Loading />}
              {byMonthQuery.isError && <ErrorState message={(byMonthQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!byMonthQuery.isLoading && !byMonthQuery.isError && (byMonthQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay datos para comparar en el rango seleccionado." />
              )}
              {!byMonthQuery.isLoading && !byMonthQuery.isError && (byMonthQuery.data?.items?.length ?? 0) > 0 && (() => {
                const items = byMonthQuery.data?.items ?? []
                const latest = items[items.length - 1]
                const previous = items[items.length - 2]
                const growthPct = previous && previous.total > 0 
                  ? ((latest.total - previous.total) / previous.total) * 100 
                  : 0
                const avgMonthly = items.reduce((s, i) => s + i.total, 0) / items.length

                return (
                  <>
                    {/* KPIs de comparación */}
                    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                      <KPICard
                        icon="📅"
                        label="Último Mes"
                        value={`${money(latest?.total ?? 0)} ${currency}`}
                        color="primary"
                        subtitle={latest?.month ?? '-'}
                      />
                      <KPICard
                        icon="📆"
                        label="Mes Anterior"
                        value={`${money(previous?.total ?? 0)} ${currency}`}
                        color="info"
                        subtitle={previous?.month ?? '-'}
                      />
                      <KPICard
                        icon={growthPct >= 0 ? '📈' : '📉'}
                        label="Crecimiento"
                        value={`${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}%`}
                        color={growthPct >= 0 ? 'success' : 'warning'}
                        subtitle="vs mes anterior"
                      />
                      <KPICard
                        icon="📊"
                        label="Promedio Mensual"
                        value={`${money(avgMonthly)} ${currency}`}
                        color="primary"
                        subtitle={`${items.length} meses`}
                      />
                    </div>

                    {/* Gráfico de líneas comparativo */}
                    <div className="mb-6 h-[350px] w-full min-w-0 overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={280}>
                        <AreaChart data={items} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid {...chartGridStyle} />
                          <XAxis dataKey="month" {...chartAxisStyle} />
                          <YAxis {...chartAxisStyle} tickFormatter={(v) => money(v)} />
                          <Tooltip {...chartTooltipStyle} formatter={(v: any) => [`${money(v)} ${currency}`, 'Ventas']} />
                          <defs>
                            <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10B981" stopOpacity={0.8}/>
                              <stop offset="95%" stopColor="#10B981" stopOpacity={0.1}/>
                            </linearGradient>
                          </defs>
                          <Area type="monotone" dataKey="total" stroke="#10B981" strokeWidth={3} fill="url(#colorTotal)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Tabla de meses - clickeable para drill-down */}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="bg-blue-50 dark:bg-blue-900/20 px-4 py-2 text-xs text-blue-700 dark:text-blue-300">
                        💡 Haz click en un mes para ver las órdenes de ese período
                      </div>
                      <Table
                        data={items.map((i, idx) => ({ ...i, idx: idx + 1 }))}
                        keyExtractor={(item) => item.idx.toString()}
                        columns={[
                          { header: 'Mes', accessor: (item) => item.month },
                          { header: 'Órdenes', accessor: (item) => item.orderCount, className: 'text-right' },
                          { header: `Total (${currency})`, accessor: (r) => money(r.total), className: 'text-right' },
                          { 
                            header: 'Variación', 
                            accessor: (r, idx) => {
                              const prev = items[idx - 1]
                              if (!prev) return '-'
                              const pct = prev.total > 0 ? ((r.total - prev.total) / prev.total) * 100 : 0
                              return (
                                <span className={pct >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {pct >= 0 ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
                                </span>
                              )
                            },
                            className: 'text-right'
                          },
                        ]}
                        onRowClick={(r) => {
                          const [y, m] = r.month.split('-').map(Number)
                          const monthFrom = `${y}-${String(m).padStart(2, '0')}-01`
                          const next = new Date(y, m, 1)
                          const monthTo = toIsoDate(next)
                          setFrom(monthFrom)
                          setTo(monthTo)
                          setTab('MONTH')
                        }}
                      />
                    </div>
                  </>
                )
              })()}
            </ReportSection>
          )}

          {/* Reporte de Márgenes / Utilidades */}
          {tab === 'MARGINS' && (
            <ReportSection
              title="💹 Márgenes y Utilidades"
              subtitle="Análisis de rentabilidad por producto"
              icon="💰"
            >
              {marginsQuery.isLoading && <Loading />}
              {marginsQuery.isError && <ErrorState message={(marginsQuery.error as any)?.message ?? 'Error cargando reporte'} />}
              {!marginsQuery.isLoading && !marginsQuery.isError && (marginsQuery.data?.items?.length ?? 0) === 0 && (
                <EmptyState message="No hay datos de productos para analizar márgenes." />
              )}
              {!marginsQuery.isLoading && !marginsQuery.isError && (marginsQuery.data?.items?.length ?? 0) > 0 && (() => {
                const items = marginsQuery.data?.items ?? []
                const totals = marginsQuery.data?.totals ?? { revenue: 0, costTotal: 0, profit: 0, avgMargin: 0 }
                const hasCostData = items.some(i => i.costPrice > 0)

                return (
                  <>
                    {!hasCostData && (
                      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                        <p className="text-sm text-amber-700 dark:text-amber-300">
                          ⚠️ <strong>Nota:</strong> Los productos no tienen precio de costo configurado.
                          Para obtener márgenes reales, configure el campo "Precio de Costo" en cada producto.
                        </p>
                      </div>
                    )}

                    {/* KPIs de rentabilidad */}
                    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                      <KPICard
                        icon="💵"
                        label="Ingresos Totales"
                        value={`${money(totals.revenue)} ${currency}`}
                        color="primary"
                        subtitle="Ventas brutas"
                      />
                      <KPICard
                        icon="📦"
                        label="Costo Total"
                        value={`${money(totals.costTotal)} ${currency}`}
                        color="warning"
                        subtitle="Costo de productos"
                      />
                      <KPICard
                        icon="💰"
                        label="Utilidad Bruta"
                        value={`${money(totals.profit)} ${currency}`}
                        color="success"
                        subtitle="Ingresos - Costos"
                      />
                      <KPICard
                        icon="📊"
                        label="Margen Promedio"
                        value={`${totals.avgMargin.toFixed(1)}%`}
                        color="info"
                        subtitle="Utilidad / Ingresos"
                      />
                    </div>

                    {/* Gráfico de márgenes por producto */}
                    <div className="mb-6 h-[400px] w-full min-w-0 overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                        <BarChart
                          data={items.slice(0, 10).map((i) => ({
                            name: i.name.length > 15 ? i.name.slice(0, 15) + '…' : i.name,
                            fullName: i.name,
                            revenue: i.revenue,
                            profit: i.profit,
                          }))}
                          layout="horizontal"
                          margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                        >
                          <CartesianGrid {...chartGridStyle} />
                          <XAxis dataKey="name" angle={-30} textAnchor="end" height={80} {...chartAxisStyle} />
                          <YAxis {...chartAxisStyle} tickFormatter={(v) => money(v)} />
                          <Tooltip 
                            {...chartTooltipStyle} 
                            formatter={(v: any, name?: string) => [
                              `${money(v)} ${currency}`, 
                              name === 'revenue' ? 'Ingreso' : name === 'profit' ? 'Utilidad' : name || 'Valor'
                            ]} 
                          />
                          <Legend />
                          <Bar dataKey="revenue" name="Ingreso" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="profit" name="Utilidad" fill="#10B981" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Tabla de productos con márgenes - clickeable para drill-down */}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="bg-blue-50 dark:bg-blue-900/20 px-4 py-2 text-xs text-blue-700 dark:text-blue-300">
                        💡 Haz click en un producto para ver sus órdenes detalladas
                      </div>
                      <Table
                        data={items}
                        keyExtractor={(item) => item.productId}
                        columns={[
                          { header: 'Producto', accessor: (item) => item.name },
                          { header: 'Unidades', accessor: (item) => item.qtySold, className: 'text-right' },
                          { header: `Ingreso (${currency})`, accessor: (r) => money(r.revenue), className: 'text-right' },
                          { header: `Costo`, accessor: (r) => money(r.costTotal), className: 'text-right text-slate-500' },
                          { header: `Utilidad`, accessor: (r) => <span className={r.profit >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{money(r.profit)}</span>, className: 'text-right' },
                          { header: 'Margen %', accessor: (r) => <span className={r.marginPct >= 0 ? 'text-green-600' : 'text-red-600'}>{r.marginPct.toFixed(1)}%</span>, className: 'text-right' },
                        ]}
                        onRowClick={(r) => openDrillDown('product', r.productId, `Órdenes de ${r.name}`)}
                      />
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
          <div className="flex flex-col max-h-[70vh]">
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

            <div className="flex-1 overflow-auto">
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
            </div>

            <div className="flex-shrink-0">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Nota: para que esto funcione debes aplicar la migración nueva y configurar SMTP en el backend.
              </p>
            </div>
          </div>
        </Modal>

        {/* Modal de Drill-Down - Detalle de órdenes */}
        <Modal 
          isOpen={drillDownOpen} 
          onClose={() => {
            setDrillDownOpen(false)
            setDrillDownType(null)
            setDrillDownParam('')
          }} 
          title={drillDownTitle} 
          maxWidth="6xl"
        >
          <div className="space-y-4">
            <div ref={drillDownRef} className="space-y-4">
            <div className="flex-shrink-0 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              📋 Detalle de órdenes para el período {from} - {to}
            </div>

            {/* Loading states */}
            {(drillDownType === 'city' && drillDownCityQuery.isLoading) ||
             (drillDownType === 'customer' && drillDownCustomerQuery.isLoading) ||
             (drillDownType === 'product' && drillDownProductQuery.isLoading) ? (
              <div className="flex-shrink-0"><Loading /></div>
            ) : null}

            {/* Error states */}
            {(drillDownType === 'city' && drillDownCityQuery.isError) ||
             (drillDownType === 'customer' && drillDownCustomerQuery.isError) ||
             (drillDownType === 'product' && drillDownProductQuery.isError) ? (
              <div className="flex-shrink-0"><ErrorState message="Error cargando órdenes" /></div>
            ) : null}

            {/* Data display */}
            {(() => {
              const items = drillDownType === 'city' 
                ? (drillDownCityQuery.data?.items ?? [])
                : drillDownType === 'customer'
                  ? (drillDownCustomerQuery.data?.items ?? [])
                  : drillDownType === 'product'
                    ? (drillDownProductQuery.data?.items ?? [])
                    : []

              const isLoading = drillDownType === 'city' 
                ? drillDownCityQuery.isLoading
                : drillDownType === 'customer'
                  ? drillDownCustomerQuery.isLoading
                  : drillDownProductQuery.isLoading

              if (isLoading) return null
              if (items.length === 0) return <div className="flex-shrink-0"><EmptyState message="No hay órdenes en este filtro" /></div>

              const topCustomerMix = drillDownType === 'city' || drillDownType === 'product' ? buildTopCustomerMix(items) : []
              const topCustomerTotal = topCustomerMix.reduce((sum, item) => sum + item.total, 0)
              const customerStatusMix = drillDownType === 'customer' ? buildStatusMix(items) : []
              const customerStatusTotal = customerStatusMix.reduce((sum, item) => sum + item.total, 0)

              return (
                <div className="space-y-4">
                  {/* Resumen */}
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div className="rounded-lg bg-slate-100 p-3 text-center dark:bg-slate-800">
                      <div className="text-2xl font-bold text-slate-900 dark:text-white">{items.length}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">Órdenes</div>
                    </div>
                    <div className="rounded-lg bg-green-100 p-3 text-center dark:bg-green-900/20">
                      <div className="text-2xl font-bold text-green-700 dark:text-green-400">
                        {money(items.reduce((sum, o) => sum + (o.total || 0), 0))} {currency}
                      </div>
                      <div className="text-xs text-green-600 dark:text-green-400">Total</div>
                    </div>
                    <div className="rounded-lg bg-blue-100 p-3 text-center dark:bg-blue-900/20">
                      <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                        {items.filter(o => o.deliveredAt).length}
                      </div>
                      <div className="text-xs text-blue-600 dark:text-blue-400">Entregadas</div>
                    </div>
                    <div className="rounded-lg bg-purple-100 p-3 text-center dark:bg-purple-900/20">
                      <div className="text-2xl font-bold text-purple-700 dark:text-purple-400">
                        {items.filter(o => o.paidAt).length}
                      </div>
                      <div className="text-xs text-purple-600 dark:text-purple-400">Cobradas</div>
                    </div>
                  </div>

                  {(drillDownType === 'city' || drillDownType === 'product') && topCustomerMix.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                          Participación por cliente
                        </div>
                        <div className="flex justify-center">
                          <PieChart width={340} height={260}>
                            <Pie
                              data={topCustomerMix.map((item) => ({ name: item.label, value: item.total }))}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={55}
                              outerRadius={95}
                              paddingAngle={4}
                              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                              isAnimationActive={false}
                            >
                              {topCustomerMix.map((item) => (
                                <Cell key={item.label} fill={item.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              {...chartTooltipStyle}
                              formatter={(value: number | string | undefined) => [`${money(Number(value ?? 0))} ${currency}`, 'Facturación']}
                            />
                          </PieChart>
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                          {drillDownType === 'city' ? 'Top clientes de la ciudad' : 'Top clientes del producto'}
                        </div>
                        <div className="space-y-3">
                          {topCustomerMix.map((item) => {
                            const pct = topCustomerTotal > 0 ? (item.total / topCustomerTotal) * 100 : 0
                            const pctSafe = Number.isFinite(pct) ? pct : 0
                            return (
                              <div key={item.label} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                                <div className="mb-2 flex items-start justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                                      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
                                      <span>{item.label}</span>
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                      {item.ordersCount} órdenes
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-sm font-semibold text-green-600 dark:text-green-400">
                                      {money(item.total)} {currency}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                      {pctSafe.toFixed(1)}%
                                    </div>
                                  </div>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                  <div className="h-full rounded-full" style={{ width: `${pctSafe}%`, backgroundColor: item.color }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {drillDownType === 'customer' && customerStatusMix.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                          Participación por estado
                        </div>
                        <div className="flex justify-center">
                          <PieChart width={340} height={260}>
                            <Pie
                              data={customerStatusMix.map((item) => ({ name: item.label, value: item.total }))}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={55}
                              outerRadius={95}
                              paddingAngle={4}
                              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                              isAnimationActive={false}
                            >
                              {customerStatusMix.map((item) => (
                                <Cell key={item.label} fill={item.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              {...chartTooltipStyle}
                              formatter={(value: number | string | undefined) => [`${money(Number(value ?? 0))} ${currency}`, 'Facturación']}
                            />
                          </PieChart>
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                          Resumen por estado
                        </div>
                        <div className="space-y-3">
                          {customerStatusMix.map((item) => {
                            const pct = customerStatusTotal > 0 ? (item.total / customerStatusTotal) * 100 : 0
                            const pctSafe = Number.isFinite(pct) ? pct : 0
                            return (
                              <div key={item.label} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                                <div className="mb-2 flex items-start justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                                      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
                                      <span>{item.label}</span>
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                      {item.ordersCount} órdenes
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-sm font-semibold text-green-600 dark:text-green-400">
                                      {money(item.total)} {currency}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                      {pctSafe.toFixed(1)}%
                                    </div>
                                  </div>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                  <div className="h-full rounded-full" style={{ width: `${pctSafe}%`, backgroundColor: item.color }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Tabla de órdenes */}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                    <Table
                      columns={[
                        { header: '# Orden', accessor: (o) => <span className="font-mono text-xs">{o.number}</span>, width: '12%' },
                        { header: 'Cliente', accessor: (o) => o.customerName, width: '30%', className: 'wrap' },
                        { 
                          header: 'Estado', 
                          accessor: (o) => {
                            const statusColors: Record<string, string> = {
                              'DRAFT': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
                              'CONFIRMED': 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
                              'FULFILLED': 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300',
                              'CANCELLED': 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300',
                            }
                            return (
                              <span className={`rounded px-2 py-1 text-xs font-medium ${statusColors[o.status] || ''}`}>
                                {statusLabel(o.status as SalesStatus)}
                              </span>
                            )
                          },
                          width: '16%'
                        },
                        { 
                          header: `Total (${currency})`, 
                          accessor: (o) => (
                            <span className="font-semibold text-green-600 dark:text-green-400">
                              {money(o.total || 0)}
                            </span>
                          ),
                          width: '16%'
                        },
                        { header: 'Fecha', accessor: (o) => new Date(o.createdAt).toLocaleDateString(), width: '12%' },
                        { 
                          header: '✓ Entrega', 
                          accessor: (o) => o.deliveredAt ? '✅' : '⏳',
                          width: '7%'
                        },
                        { 
                          header: '💰 Pago', 
                          accessor: (o) => o.paidAt ? '✅' : '⏳',
                          width: '7%'
                        },
                      ]}
                      data={items}
                      keyExtractor={(o) => o.id}
                    />
                  </div>
                </div>
              )
            })()}

            <div className="flex justify-end flex-shrink-0 border-t border-slate-200 pt-3 dark:border-slate-700 gap-2 pdf-hide">
              <Button variant="outline" size="sm" onClick={handleExportDrillDownExcel}>
                ⬇️ Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!drillDownRef.current) return
                  await exportModalContentToPdf(drillDownRef.current, {
                    filename: `detalle-${(drillDownType ?? 'reporte').toLowerCase()}-${from}-${to}.pdf`,
                    title: drillDownTitle,
                    subtitle: `Período: ${from} a ${to} | Moneda: ${currency}`,
                    companyName: tenant.branding?.tenantName ?? 'Empresa',
                    headerColor: '#10B981',
                    logoUrl: tenant.branding?.logoUrl ?? undefined,
                  })
                }}
              >
                ⬇️ Exportar PDF
              </Button>
              <Button variant="ghost" onClick={() => setDrillDownOpen(false)}>
                Cerrar
              </Button>
            </div>
            </div>{/* close drillDownRef */}
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
