import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, useEffect, type ReactElement, type ReactNode } from 'react'
import { apiFetch } from '../../lib/api'
import { formatDateOnlyUtc } from '../../lib/date'
import { exportToXlsx, type ExportSheet } from '../../lib/exportXlsx'
import { getProductLabel } from '../../lib/productName'
import { sortProductsByDisplayName } from '../../lib/productSorting'
import { useAuth } from '../../providers/AuthProvider'
import {
  MainLayout,
  PageContainer,
  Table,
  Loading,
  ErrorState,
  EmptyState,
  Button,
  Modal,
  Input,
  Select,
} from '../../components'
import { useNavigation, usePermissions } from '../../hooks'
import type { ExpiryStatus } from '../../components/common/ExpiryBadge'
import { ArchiveBoxIcon, ArrowPathIcon, BeakerIcon, DocumentArrowDownIcon, TableCellsIcon } from '@heroicons/react/24/outline'

type BalanceExpandedItem = {
  id: string
  quantity: string
  reservedQuantity?: string
  updatedAt: string
  productId: string
  batchId: string | null
  locationId: string
  product: {
    sku: string
    name: string
    genericName?: string | null
    presentationWrapper?: string | null
    presentationQuantity?: any
    presentationFormat?: string | null
    presentations: Array<{
      id: string
      name: string
      unitsPerPresentation: number
      isDefault: boolean
    }>
  }
  batch:
    | {
        id?: string
        batchNumber: string
        expiresAt: string | null
        status: string
        version: number
        presentationId?: string | null
        presentation?: { id: string; name: string; unitsPerPresentation: number } | null
      }
    | null
  location: {
    id: string
    code: string
    warehouse: { id: string; code: string; name: string }
  }
}

type PresentationLite = {
  id: string
  name: string
  unitsPerPresentation: number
  isDefault: boolean
}

type WarehouseListItem = {
  id: string
  code: string
  name: string
  isActive: boolean
}

type LocationListItem = {
  id: string
  warehouseId: string
  code: string
  isActive: boolean
}

type ReservationItem = {
  id: string
  seller: string
  client: string
  order: string
  quantity: number
  deliveryDays: number
  deliveryDate: string | null
  productName: string
}

type BatchMovementItem = {
  id: string
  number: string
  numberYear: number
  createdAt: string
  type: string
  quantity: string
  presentationId?: string | null
  presentationQuantity?: string | null
  presentation?: { id: string; name: string; unitsPerPresentation: string | number } | null
  referenceType: string | null
  referenceId: string | null
  note: string | null
  from: { id: string; code: string; warehouse: { id: string; code: string; name: string } } | null
  to: { id: string; code: string; warehouse: { id: string; code: string; name: string } } | null
}

type BatchMovementsResponse = { batch: { id: string; batchNumber: string }; items: BatchMovementItem[] }

type KardexItem = {
  date: string
  batchId: string | null
  batchNumber: string | null
  presentationId: string | ''
  presentationLabel: string
  presentationUnits: string
  fromCode: string | null
  fromWarehouseCode: string | null
  toCode: string | null
  toWarehouseCode: string | null
  warehouseCode: string | null
  warehouseName: string | null
  quantity: number
  entry: number
  exit: number
  balance: number
  affectsWarehouse: boolean
  movementId: string
  movementType: string
   movementNumber: string
   referenceType: string | null
   detail: string
  fromBalanceQty: number | null
  toBalanceQty: number | null
}

type KardexSummaryEntry = {
  batchId: string | null
  batchNumber: string
  presentationId: string | null
  presentationName: string
  unitsPerPresentation: number
  quantity: number
  presentationQuantity: number
  expiresAt: string | null
}

type KardexSummary = {
  totalMovements: number
  runningBalance: number
  currentStock: number
  totalBatches: number
  byBatch: KardexSummaryEntry[]
  byPresentation: Array<{
    label: string
    units: number
    total: number
    presentations: number
  }>
}

type KardexResponse = {
  product: { id: string; sku: string; name: string; baseUnitAbbreviation: string }
  hasStockRead: boolean
  currentStock: string
  kardex: KardexItem[]
  summary: KardexSummary
}

type ProductGroup = {
  productId: string
  sku: string
  name: string
  genericName?: string | null
  presentationWrapper?: string | null
  presentationQuantity?: any
  presentationFormat?: string | null
  presentations: PresentationLite[]
  totalQuantity: number
  totalReservedQuantity: number
  totalAvailableQuantity: number
  warehouses: Array<{
    warehouseId: string
    warehouseCode: string
    warehouseName: string
    quantity: number
    reservedQuantity: number
    availableQuantity: number
    batches: Array<{
      id: string
      productId: string
      productName: string
      batchId: string | null
      batchNumber: string
      expiresAt: string | null
      status: string
      version: number
      presentationName?: string | null
      unitsPerPresentation?: number | null
      quantity: number
      reservedQuantity: number
      availableQuantity: number
      locationId: string
      locationCode: string
      warehouseId: string
    }>
  }>
}

type WarehouseGroup = {
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  totalQuantity: number
  totalReservedQuantity: number
  totalAvailableQuantity: number
  products: Array<{
    productId: string
    sku: string
    name: string
    genericName?: string | null
    presentationWrapper?: string | null
    presentationQuantity?: any
    presentationFormat?: string | null
    presentations: PresentationLite[]
    quantity: number
    reservedQuantity: number
    availableQuantity: number
    batches: Array<{
      id: string
      productId: string
      productName: string
      batchId: string | null
      batchNumber: string
      expiresAt: string | null
      status: string
      version: number
      presentationName?: string | null
      unitsPerPresentation?: number | null
      quantity: number
      reservedQuantity: number
      availableQuantity: number
      locationId: string
      locationCode: string
      warehouseId: string
    }>
  }>
}

function formatQtyByBatchPresentation(qtyUnits: number, batch: { presentationName?: string | null; unitsPerPresentation?: number | null } | null | undefined): string {
  const qtyNum = Number(qtyUnits)
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) return '0'

  const unitsPer = Number(batch?.unitsPerPresentation ?? 0)
  const presName = (batch?.presentationName ?? '').trim()
  if (Number.isFinite(unitsPer) && unitsPer > 1 && presName) {
    const count = qtyNum / unitsPer
    const countStr = Number.isFinite(count) && Math.abs(count - Math.round(count)) < 1e-9 ? String(Math.round(count)) : count.toFixed(2)
    return `${countStr} ${presName} (${unitsPer.toFixed(0)}u)`
  }

  return `${qtyNum} unidades`
}

function formatTotalsFromBatches(
  batches: Array<{ quantity: number; reservedQuantity: number; availableQuantity: number; presentationName?: string | null; unitsPerPresentation?: number | null }>,
  field: 'quantity' | 'reservedQuantity' | 'availableQuantity',
): string {
  const acc = new Map<string, { name: string; unitsPer: number; count: number }>()
  let looseUnits = 0

  for (const b of batches) {
    const qtyUnits = Number(b[field])
    if (!Number.isFinite(qtyUnits) || qtyUnits <= 0) continue

    const unitsPer = Number(b.unitsPerPresentation ?? 0)
    const presName = (b.presentationName ?? '').trim()
    if (Number.isFinite(unitsPer) && unitsPer > 1 && presName) {
      const count = qtyUnits / unitsPer
      const key = `${presName}|${unitsPer}`
      const prev = acc.get(key)
      if (prev) prev.count += count
      else acc.set(key, { name: presName, unitsPer, count })
    } else {
      looseUnits += qtyUnits
    }
  }

  const parts = Array.from(acc.values())
    .sort((a, b) => b.unitsPer - a.unitsPer)
    .map((x) => {
      const rounded = Math.abs(x.count - Math.round(x.count)) < 1e-9 ? Math.round(x.count) : Number(x.count.toFixed(2))
      return `${rounded} ${x.name} (${x.unitsPer.toFixed(0)}u)`
    })

  if (looseUnits > 0) parts.push(`${looseUnits} unidades`)
  return parts.length ? parts.join(' + ') : '0'
}

async function fetchBalances(token: string): Promise<{ items: BalanceExpandedItem[] }> {
  const params = new URLSearchParams({ take: '200' })
  return apiFetch(`/api/v1/reports/stock/balances-expanded?${params}`, { token })
}

async function fetchBalancesForExport(token: string): Promise<{ items: BalanceExpandedItem[] }> {
  const params = new URLSearchParams({ take: '5000' })
  return apiFetch(`/api/v1/reports/stock/balances-expanded?${params}`, { token })
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  return apiFetch(`/api/v1/warehouses?${params}`, { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  return apiFetch(`/api/v1/warehouses/${warehouseId}/locations?${params}`, { token })
}

async function fetchReservations(token: string, balanceId: string): Promise<{ items: ReservationItem[] }> {
  return apiFetch(`/api/v1/stock/reservations?balanceId=${balanceId}`, { token })
}

async function listBatchMovements(token: string, productId: string, batchId: string): Promise<BatchMovementsResponse> {
  return apiFetch(`/api/v1/products/${productId}/batches/${batchId}/movements`, { token })
}

async function fetchProductKardex(token: string, productId: string, warehouseId?: string): Promise<KardexResponse> {
  const params = new URLSearchParams()
  if (warehouseId) params.set('warehouseId', warehouseId)
  const query = params.toString() ? `?${params.toString()}` : ''
  return apiFetch(`/api/v1/products/${productId}/kardex${query}`, { token })
}

async function updateBatchStatus(
  token: string,
  productId: string,
  batchId: string,
  status: string,
  version: number,
): Promise<any> {
  return apiFetch(`/api/v1/products/${productId}/batches/${batchId}/status`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ status, version }),
  })
}

async function createTransferMovement(
  token: string,
  data: {
    productId: string
    batchId: string | null
    fromLocationId: string
    toLocationId: string
    quantity: string
    note?: string
  },
): Promise<any> {
  return apiFetch(`/api/v1/stock/movements`, {
    token,
    method: 'POST',
    body: JSON.stringify({ type: 'TRANSFER', ...data }),
  })
}

function calculateExpiryStatus(expiresAt: string): ExpiryStatus {
  const expiryDate = new Date(expiresAt)
  const today = new Date()
  const daysToExpire = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (daysToExpire < 0) return 'EXPIRED'
  if (daysToExpire <= 30) return 'RED'
  if (daysToExpire <= 90) return 'YELLOW'
  return 'GREEN'
}

function getExpiryColors(status: ExpiryStatus): { bg: string; border: string; text: string } {
  switch (status) {
    case 'EXPIRED':
      return { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-300 dark:border-red-700', text: 'text-red-700 dark:text-red-300' }
    case 'RED':
      return { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-300 dark:border-red-700', text: 'text-red-700 dark:text-red-300' }
    case 'YELLOW':
      return { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-300 dark:border-yellow-700', text: 'text-yellow-700 dark:text-yellow-300' }
    case 'GREEN':
      return { bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-300 dark:border-green-700', text: 'text-green-700 dark:text-green-300' }
  }
}

function getBatchStatusDisplay(status: string): { text: string; color: string } {
  if (status === 'QUARANTINE') {
    return { text: 'En cuarentena', color: 'text-orange-600 dark:text-orange-400' }
  }
  return { text: 'Liberado', color: 'text-green-600 dark:text-green-400' }
}

function PillOutlineIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.5 4.5h5A5.5 5.5 0 0 1 20 10v4A5.5 5.5 0 0 1 14.5 19.5h-5A5.5 5.5 0 0 1 4 14v-4A5.5 5.5 0 0 1 9.5 4.5Z" />
      <path d="M8 8l8 8" />
    </svg>
  )
}

function getPresentationIcon(presentationName: string | null | undefined): ReactElement {
  const name = (presentationName ?? '').toLowerCase()
  const cls = 'h-4 w-4 text-slate-600 dark:text-slate-300'
  if (name.includes('caja')) return <ArchiveBoxIcon className={cls} />
  if (name.includes('frasco')) return <BeakerIcon className={cls} />
  if (name.includes('unidad') || name.includes('blister')) return <PillOutlineIcon className={cls} />
  return <ArchiveBoxIcon className={cls} />
}

function getPresentationEmoji(presentationName: string | null | undefined): string {
  const name = (presentationName ?? '').toLowerCase()
  if (name.includes('caja')) return '📦'
  if (name.includes('frasco')) return '🧪'
  if (name.includes('unidad') || name.includes('blister')) return '💊'
  return '📦'
}

function formatPresentationCountFromUnits(units: number, unitsPerPresentation: number): string {
  const u = Number(units)
  const upp = Number(unitsPerPresentation)
  if (!Number.isFinite(u) || u <= 0) return '0'
  if (!Number.isFinite(upp) || upp <= 1) return String(Math.round(u))
  const count = u / upp
  return Math.abs(count - Math.round(count)) < 1e-9 ? String(Math.round(count)) : count.toFixed(2)
}

function formatPresentation(p: {
  presentationWrapper?: string | null
  presentationQuantity?: any
  presentationFormat?: string | null
}): string | null {
  const wrapper = (p.presentationWrapper ?? '').trim()
  const format = (p.presentationFormat ?? '').trim()
  const qtyRaw = p.presentationQuantity
  const qtyStr = qtyRaw === null || qtyRaw === undefined ? '' : String(qtyRaw).trim()

  const parts = [wrapper, qtyStr, format].filter((x) => typeof x === 'string' && x.length > 0)
  return parts.length ? parts.join(' ') : null
}

function InlineLocationEditor({ batch, token, disabled }: { batch: any; token: string; disabled?: boolean }) {
  const [selectedLoc, setSelectedLoc] = useState(batch.locationId)
  const queryClient = useQueryClient()

  // Sincronizar el estado local si la data externa se actualiza
  useEffect(() => {
    setSelectedLoc(batch.locationId)
  }, [batch.locationId])

  // Obtener solo las ubicaciones de la misma sucursal
  const locQuery = useQuery({
    queryKey: ['warehouseLocations', 'inline', batch.warehouseId],
    queryFn: () => listWarehouseLocations(token, batch.warehouseId),
    enabled: !!token && !!batch.warehouseId,
    staleTime: 1000 * 60 * 5, // Cache por 5 minutos para no saturar la API
  })

  if (disabled) {
    return <span className="text-xs text-slate-500 dark:text-slate-400">{batch.locationCode ?? '—'}</span>
  }

  const moveMutation = useMutation({
    mutationFn: async () => {
      if (selectedLoc === batch.locationId) return
      return createTransferMovement(token, {
        productId: batch.productId,
        batchId: batch.batchId,
        fromLocationId: batch.locationId,
        toLocationId: selectedLoc,
        quantity: String(batch.availableQuantity), // Movemos solo lo disponible para no romper reservas
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['balances'] })
    },
    onError: (err: unknown) => {
      alert(err instanceof Error ? err.message : 'Error al cambiar la ubicación')
      setSelectedLoc(batch.locationId) // Revertimos al valor original si falla
    },
  })

  const isChanged = selectedLoc !== batch.locationId
  const hasNoAvailableStock = Number(batch.availableQuantity) <= 0

  return (
    <div className="flex items-center gap-1">
      <select
        value={selectedLoc}
        onChange={(e) => setSelectedLoc(e.target.value)}
        disabled={moveMutation.isPending || hasNoAvailableStock}
        title={hasNoAvailableStock ? "Sin stock disponible para mover" : "Cambiar ubicación"}
        className="block w-full min-w-[110px] rounded-md border border-slate-300 bg-white py-1 pl-2 pr-6 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:opacity-70 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:disabled:bg-slate-900"
      >
        <option value={batch.locationId}>{batch.locationCode}</option>
        {locQuery.data?.items
          .filter((l) => l.isActive && l.id !== batch.locationId)
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.code}
            </option>
          ))}
      </select>

      {isChanged && (
        <button
          onClick={() => moveMutation.mutate()}
          disabled={moveMutation.isPending}
          title="Grabar nueva ubicación"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-sm transition-colors hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
        >
          {moveMutation.isPending ? '⏳' : '💾'}
        </button>
      )}
    </div>
  )
}

const KardexModalContent = ({ productId, warehouseId, onClose }: { productId: string; warehouseId?: string; onClose: () => void }) => {
  const auth = useAuth()

  const { data: kardexData, isLoading, error, refetch } = useQuery({
    queryKey: ['productKardex', productId, warehouseId ?? null],
    queryFn: () => fetchProductKardex(auth.accessToken!, productId, warehouseId),
    enabled: !!auth.accessToken && !!productId,
  })

  const kardexItems = kardexData?.kardex ?? []
  const summary = kardexData?.summary

   const movementTypeLabel = (type: string, refType?: string | null): string => {
     if (type === 'IN' && refType === 'BATCH') return 'Creación Lote'
     if (type === 'IN' && refType === 'MOVEMENT_REQUEST_RECEIPT') return 'Recepción'
     if (type === 'IN' && refType === 'MOVEMENT_REQUEST') return 'Recepción'
     if (type === 'IN' && refType === 'RETURN') return 'Devolución'
     if (type === 'IN') return 'Entrada'
     if (type === 'OUT' && refType === 'SALES_ORDER') return 'Venta'
     if (type === 'OUT' && refType === 'MOVEMENT_REQUEST') return 'Transferencia'
     if (type === 'OUT' && refType === 'PRODUCT_SAMPLE') return 'Muestra'
     if (type === 'OUT' && refType === 'MANUAL_DISCARD') return 'Descarte'
     if (type === 'OUT') return 'Salida'
     if (type === 'ADJUSTMENT') return 'Ajuste'
     if (type === 'TRANSFER') return 'Transferencia'
       return type
    }

    const cleanWarehouseCode = (code: string | null | undefined) => (code ? code.replace(/^SUC-/, '') : '')
    const locLabel = (m: KardexItem, side: 'from' | 'to') => {
      const wh = side === 'from' ? m.fromWarehouseCode : m.toWarehouseCode
      const loc = side === 'from' ? m.fromCode : m.toCode
      if (!wh && !loc) return '—'
      // For sales orders, wh holds the customer name and loc holds the order number → show as "ORDER#: Customer"
      if (side === 'to' && m.referenceType === 'SALES_ORDER' && m.movementType === 'OUT') {
        return `${loc ?? '—'}: ${wh ?? '—'}`
      }
      return `${cleanWarehouseCode(wh)}:${loc ?? '—'}`
    }

    const { saldoTotal, saldoLote } = useMemo(() => {
        const visibleItems = kardexItems.filter((m) => m.affectsWarehouse)
        let running = 0
        const byLote = new Map<string, number>()
        const total: number[] = []
        const lote: (number | '—')[] = []
        visibleItems.forEach((m) => {
          const delta = (m.entry ?? 0) - (m.exit ?? 0)
          running += delta
          const batchKey = m.batchNumber ?? '__SIN_LOTE__'
          const prevLote = byLote.get(batchKey) ?? 0
          const newLote = prevLote + delta
          byLote.set(batchKey, newLote)
          total.push(running)
          lote.push(newLote)
        })
        return { saldoTotal: total, saldoLote: lote }
      }, [kardexItems])

  function formatQty(v: number): string {
  if (Number.isInteger(v)) return v.toString();
  const s = v.toFixed(2);
  const dot = s.indexOf('.');
  if (dot === -1) return s;
  let end = s.length;
  while (end > dot + 1 && s[end - 1] === '0') end--;
  if (s[end - 1] === '.') end--;
  return s.slice(0, end);
}

   const batchColors = new Map<string, string>()
   const batchColorPalette = [
     'bg-red-100 dark:bg-red-900/20',
     'bg-blue-100 dark:bg-blue-900/20',
     'bg-green-100 dark:bg-green-900/20',
     'bg-yellow-100 dark:bg-yellow-900/20',
     'bg-purple-100 dark:bg-purple-900/20',
     'bg-pink-100 dark:bg-pink-900/20',
     'bg-indigo-100 dark:bg-indigo-900/20',
     'bg-teal-100 dark:bg-teal-900/20',
     'bg-orange-100 dark:bg-orange-900/20',
     'bg-cyan-100 dark:bg-cyan-900/20',
   ]
   let paletteIndex = 0
   const getBatchColor = (batchNumber: string | null): string => {
     if (!batchNumber) return ''
     if (batchColors.has(batchNumber)) return batchColors.get(batchNumber)!
     const color = batchColorPalette[paletteIndex % batchColorPalette.length]
     paletteIndex++
     batchColors.set(batchNumber, color)
     return color
   }

   const exportKardexToExcel = () => {
    if (!kardexData) return
    const sheets: ExportSheet[] = [
      {
        name: 'Kardex',
        rows: kardexItems.filter((m) => m.affectsWarehouse).map((m, idx) => ({
          Fecha: m.date,
          Origen: locLabel(m, 'from'),
          Destino: locLabel(m, 'to'),
          Almacén: cleanWarehouseCode(m.warehouseCode) ?? '',
          LOTE: m.batchNumber ?? '',
          Presentación: m.presentationLabel,
          'Tipo Movimiento': movementTypeLabel(m.movementType, m.referenceType),
          Detalle: m.detail,
          'Cantidad (u)': m.quantity,
          'Saldo Lote (u)': typeof saldoLote[idx] === 'number' ? saldoLote[idx] as number : '',
          'Saldo Total (u)': saldoTotal[idx],
        })),
      },
      ...(summary?.byBatch
        ? [
            {
              name: 'Resumen por Lote',
              rows: summary.byBatch.map((b) => ({
                Lote: b.batchNumber,
                Presentación: b.presentationName || 'Sin presentación',
                'Unidades por presentación': b.unitsPerPresentation,
                'Cantidad (u)': b.quantity,
                'Cantidad (presentaciones)': b.presentationQuantity,
                Vencimiento: b.expiresAt ?? '',
              })),
            },
          ]
        : []),
    ]
    const date = new Date().toISOString().split('T')[0]
    const filename = `kardex_${kardexData.product.sku}_${date}.xlsx`
    exportToXlsx(filename, sheets)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {kardexData?.product?.name ?? 'Producto'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">SKU: {kardexData?.product?.sku ?? '—'}</p>
        </div>
        {warehouseId && (
          <div className="text-right">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Sucursal: </span>
            <span className="text-sm text-slate-600 dark:text-slate-400">{cleanWarehouseCode(kardexItems.find((m) => m.affectsWarehouse)?.warehouseCode ?? kardexItems[0]?.warehouseCode ?? null)}</span>
          </div>
        )}
      </div>

      {isLoading && <Loading />}

      {error && <ErrorState message="Error al cargar el kardex" retry={() => refetch()} />}

        {!isLoading && !error && kardexData && kardexItems.filter((m) => m.affectsWarehouse).length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <th className="border px-2 py-1.5 text-left font-medium text-slate-800 dark:text-slate-200">Fecha</th>
                  <th className="border px-2 py-1.5 text-left font-medium text-slate-800 dark:text-slate-200">Lote</th>
                  <th className="border px-2 py-1.5 text-left font-medium text-slate-800 dark:text-slate-200">Presentación</th>
                  <th className="border px-2 py-1.5 text-center font-medium text-slate-800 dark:text-slate-200">Tipo</th>
                  <th className="border px-2 py-1.5 text-left font-medium text-slate-800 dark:text-slate-200">Origen</th>
                  <th className="border px-2 py-1.5 text-left font-medium text-slate-800 dark:text-slate-200">Destino</th>
                   <th className="border px-2 py-1.5 text-right font-medium text-slate-800 dark:text-slate-200">Cantidad</th>
                   <th className="border px-2 py-1.5 text-right font-medium text-slate-800 dark:text-slate-200">Saldo Lote</th>
                   <th className="border px-2 py-1.5 text-right font-medium text-slate-800 dark:text-slate-200">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {kardexItems.filter((m) => m.affectsWarehouse).map((m, idx) => (
                  <tr
                    key={m.movementId}
                    className={`${getBatchColor(m.batchNumber)} ${!m.affectsWarehouse ? 'opacity-60' : ''}`}
                  >
                    <td className="border px-2 py-1">{new Date(m.date).toLocaleString()}</td>
                    <td className="border px-2 py-1 bg-white/80 dark:bg-slate-900/80">{m.batchNumber ?? '—'}</td>
                    <td className="border px-2 py-1 bg-white/80 dark:bg-slate-900/80">{m.presentationLabel}</td>
                    <td className="border px-2 py-1 bg-white/80 dark:bg-slate-900/80 font-medium">{movementTypeLabel(m.movementType, m.referenceType)}</td>
                    <td className="border px-2 py-1 bg-white/80 dark:bg-slate-900/80">{locLabel(m, 'from')}</td>
                    <td className="border px-2 py-1 bg-white/80 dark:bg-slate-900/80">{locLabel(m, 'to')}</td>
                    <td className="border px-2 py-1 text-right bg-white/80 dark:bg-slate-900/80">{formatQty(m.quantity)}</td>
                    <td className="border px-2 py-1 text-right bg-white/80 dark:bg-slate-900/80">{typeof saldoLote[idx] === 'number' ? formatQty(saldoLote[idx] as number) : '—'}</td>
                    <td className="border px-2 py-1 text-right font-medium bg-white/80 dark:bg-slate-900/80">{formatQty(saldoTotal[idx])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {summary && summary.byBatch.length > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-4">
              <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Resumen consolidado por lote y presentación</h4>
              <div className="mb-2 text-sm text-slate-600 dark:text-slate-400">
                <span className="font-medium">Total:</span> {formatQty(summary.currentStock)} {kardexData.product.baseUnitAbbreviation} distribuidos en {summary.totalBatches} lotes:
              </div>
              <div className="grid grid-cols-1 gap-1 text-sm text-slate-700 dark:text-slate-300 sm:grid-cols-2">
                {summary.byBatch.map((b) => (
                  <div key={b.batchId ?? b.batchNumber} className="flex justify-between">
                    <span>
                      {b.batchNumber}
                      {b.unitsPerPresentation > 1 ? ` (${b.unitsPerPresentation}${kardexData.product.baseUnitAbbreviation})` : ''}
                    </span>
                    <span className="font-medium">
                      {formatQty(b.quantity)} {kardexData.product.baseUnitAbbreviation}
                      {b.unitsPerPresentation > 1
                        ? ` (${formatQty(b.presentationQuantity)} ${b.unitsPerPresentation === 1 ? 'unidad' : 'presentaciones'} de ${b.unitsPerPresentation}${kardexData.product.baseUnitAbbreviation})`
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
              {summary.byPresentation.length > 0 && (
                <div className="mt-3 border-t border-slate-200 dark:border-slate-700 pt-2">
                  <h5 className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Desglose por presentación</h5>
                  <div className="grid grid-cols-1 gap-1 text-sm text-slate-700 dark:text-slate-300 sm:grid-cols-2">
                    {summary.byPresentation.map((p, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{p.label}</span>
                        <span className="font-medium">
                          {formatQty(p.total)} {kardexData.product.baseUnitAbbreviation} ({p.presentations} {p.units > 1 ? 'presentaciones' : 'unidades'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-700 pt-3">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Total movimientos: {summary?.totalMovements ?? kardexItems.length} | Saldo acumulado: {summary ? formatQty(summary.runningBalance) : '—'} | Stock actual (sucursal): {kardexData.currentStock ?? '—'}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cerrar
              </Button>
              <Button icon={<DocumentArrowDownIcon />} onClick={exportKardexToExcel}>
                Exportar a Excel
              </Button>
            </div>
          </div>
        </>
      )}

      {!isLoading && !error && kardexItems.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400">Este producto no tiene movimientos registrados.</p>
      )}
    </div>
  )
}

export function InventoryPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const queryClient = useQueryClient()

  const canSeeBatchFlow = perms.hasPermission('stock:read') && perms.hasPermission('catalog:read')
  const canChangeBatchStatus = perms.hasPermission('stock:manage')

  // Usuarios de sucursal (scope:branch) solo pueden editar su propio almacén;
  // el resto es solo lectura. El backend refuerza esto, pero lo indicamos en la UI.
  const isBranchScoped = perms.hasPermission('scope:branch') && !perms.isTenantAdmin
  const userWarehouseId = perms.warehouseId ?? null
  const canEditWarehouse = (warehouseId: string | undefined): boolean =>
    !isBranchScoped || !userWarehouseId || warehouseId === userWarehouseId

  const [groupBy, setGroupBy] = useState<'product' | 'warehouse'>('product')
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)
  const [expandedWarehouse, setExpandedWarehouse] = useState<string | null>(null)
  const [movingItem, setMovingItem] = useState<{
    productId: string
    productName: string
    batchId: string | null
    batchNumber: string
    fromLocationId: string
    fromWarehouseCode: string
    fromLocationCode: string
    availableQty: string
  } | null>(null)

  const [moveQty, setMoveQty] = useState('')
  const [moveToWarehouseId, setMoveToWarehouseId] = useState('')
  const [moveToLocationId, setMoveToLocationId] = useState('')
  const [moveError, setMoveError] = useState('')

  const [statusChangeItem, setStatusChangeItem] = useState<{
    productId: string
    productName: string
    batchId: string
    batchNumber: string
    currentStatus: string
    version: number
  } | null>(null)
  const [newStatus, setNewStatus] = useState('RELEASED')

  const [reservationsModalOpen, setReservationsModalOpen] = useState(false)
  const [selectedReservations, setSelectedReservations] = useState<ReservationItem[]>([])
  const [loadingReservations, setLoadingReservations] = useState(false)

  const [kardexModalOpen, setKardexModalOpen] = useState(false)
  const [kardexProductId, setKardexProductId] = useState<string | null>(null)
  const [kardexWarehouseId, setKardexWarehouseId] = useState<string | null>(null)

  const [flowItem, setFlowItem] = useState<{
    productId: string
    productName: string
    batchId: string
    batchNumber: string
  } | null>(null)

  const openReservationsModal = async (balanceId: string) => {
    setLoadingReservations(true)
    try {
      const data = await fetchReservations(auth.accessToken!, balanceId)
      setSelectedReservations(data.items)
      setReservationsModalOpen(true)
    } catch (error) {
      console.error('Error fetching reservations:', error)
    } finally {
      setLoadingReservations(false)
    }
  }

  const balancesQuery = useQuery({
    queryKey: ['balances', 'inventory'],
    queryFn: () => fetchBalances(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const batchFlowQuery = useQuery({
    queryKey: ['batchFlow', flowItem?.productId, flowItem?.batchId],
    queryFn: () => listBatchMovements(auth.accessToken!, flowItem!.productId, flowItem!.batchId),
    enabled: !!auth.accessToken && !!flowItem && canSeeBatchFlow,
  })

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'forInventory'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const destinationLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'forInventoryMove', moveToWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, moveToWarehouseId),
    enabled: !!auth.accessToken && !!moveToWarehouseId,
  })

  const moveMutation = useMutation({
    mutationFn: async () => {
      if (!movingItem) throw new Error('Seleccioná una existencia para mover')

      const qtyNum = Number(moveQty)
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) throw new Error('Ingresá una cantidad válida (mayor a 0)')
      if (!moveToWarehouseId) throw new Error('Seleccioná el almacén destino')
      if (!moveToLocationId) throw new Error('Seleccioná la ubicación destino')
      if (moveToLocationId === movingItem.fromLocationId) throw new Error('Seleccioná una ubicación destino diferente')

      return createTransferMovement(auth.accessToken!, {
        productId: movingItem.productId,
        batchId: movingItem.batchId,
        fromLocationId: movingItem.fromLocationId,
        toLocationId: moveToLocationId,
        quantity: String(qtyNum),
      })
    },
    onSuccess: async () => {
      await balancesQuery.refetch()
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      setMovingItem(null)
      setMoveQty('')
      setMoveToWarehouseId('')
      setMoveToLocationId('')
      setMoveError('')
      alert('Movimiento realizado')
    },
    onError: (err: any) => {
      setMoveError(err instanceof Error ? err.message : 'Error al mover')
    },
  })

  const statusChangeMutation = useMutation({
    mutationFn: async () => {
      if (!statusChangeItem) throw new Error('Seleccioná un lote para cambiar estado')

      return updateBatchStatus(
        auth.accessToken!,
        statusChangeItem.productId,
        statusChangeItem.batchId,
        newStatus,
        statusChangeItem.version,
      )
    },
    onSuccess: async () => {
      await balancesQuery.refetch()
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      setStatusChangeItem(null)
      setNewStatus('RELEASED')
      alert('Estado del lote actualizado')
    },
    onError: (err: any) => {
      alert(err instanceof Error ? err.message : 'Error al cambiar estado')
    },
  })

  // Column definitions for tables
  const productExpandedColumns = useMemo(() => {
    const baseColumns: Array<{
      header: string | ReactElement
      accessor: (b: any, _index: number) => ReactNode
      width?: string
    }> = [
      {
        header: 'Sucursal',
        accessor: (b, _index) => (
          <div>
            <div className="font-mono text-sm text-slate-800 dark:text-slate-200">{b.warehouseCode}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{b.warehouseName}</div>
          </div>
        ),
        width: '160px',
      },
      { header: 'Lote', accessor: (b, _index) => b.batchNumber, width: '140px' },
      {
        header: 'Presentación',
        accessor: (b, _index) => {
          const name = (b.presentationName ?? 'Unidad').trim() || 'Unidad'
          const unitsPer = Number(b.unitsPerPresentation ?? 1)
          const label = Number.isFinite(unitsPer) && unitsPer > 1 ? `${name} (${unitsPer.toFixed(0)}u)` : name
          return (
            <span className="text-sm text-slate-800 dark:text-slate-200">
              {getPresentationEmoji(name)} {label}
            </span>
          )
        },
        width: '160px',
      },
      {
        header: 'Total (Disp/Res)',
        accessor: (b, _index) => {
          const total = Number(b.quantity ?? 0)
          const disp = Number(b.availableQuantity ?? 0)
          const res = Number(b.reservedQuantity ?? 0)
          return (
            <div className="text-sm">
              <div className="font-medium text-slate-800 dark:text-slate-200">
                {formatQtyByBatchPresentation(total, b)}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {formatQtyByBatchPresentation(disp, b)} disp · {formatQtyByBatchPresentation(res, b)} res
              </div>
            </div>
          )
        },
        width: '190px',
      },
      {
        header: 'Vence',
        accessor: (b, _index) => {
          if (!b.expiresAt) return '-'
          const expiryStatus = calculateExpiryStatus(b.expiresAt)
          const colors = getExpiryColors(expiryStatus)
          return (
            <span className={`inline-block rounded-md border px-2 py-1 text-xs font-medium ${colors.bg} ${colors.border} ${colors.text}`}>
              {formatDateOnlyUtc(b.expiresAt)}
            </span>
          )
        },
        width: '120px',
      },
      {
        header: 'Estado',
        accessor: (b, _index) => {
          const statusDisplay = getBatchStatusDisplay(b.status)
          return <span className={`text-sm font-medium ${statusDisplay.color}`}>{statusDisplay.text}</span>
        },
        width: '120px',
      },
      {
        header: 'Ubicación',
        accessor: (b, _index) => <InlineLocationEditor batch={b} token={auth.accessToken!} disabled={!canEditWarehouse(b.warehouseId)} />,
        width: '180px',
      },
    ]

    // Action column: flow + optional status change
    if (canSeeBatchFlow || canChangeBatchStatus) {
      baseColumns.push({
        header: 'Acción',
        accessor: (b, _index) => (
          <div className="flex gap-2">
            {canSeeBatchFlow ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!b.batchId) return
                  setFlowItem({
                    productId: b.productId,
                    productName: b.productName,
                    batchId: b.batchId,
                    batchNumber: b.batchNumber,
                  })
                }}
                disabled={!b.batchId}
              >
                Ver flujo
              </Button>
            ) : null}

            {canChangeBatchStatus && b.batchId ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canEditWarehouse(b.warehouseId)}
                title={canEditWarehouse(b.warehouseId) ? undefined : 'Solo lectura: no es tu almacén'}
                onClick={() =>
                  setStatusChangeItem({
                    productId: b.productId,
                    productName: b.productName,
                    batchId: b.batchId,
                    batchNumber: b.batchNumber,
                    currentStatus: b.status,
                    version: b.version,
                  })
                }
              >
                Estado
              </Button>
            ) : null}
          </div>
        ),
        width: '200px',
      })
    }

    return baseColumns
  }, [canSeeBatchFlow, canChangeBatchStatus, auth.accessToken])

  const warehouseColumns = useMemo(() => {
    const baseColumns: Array<{
      header: string | ReactElement
      accessor: (b: any, _index: number) => ReactNode
      width?: string
    }> = [
      { header: '🏷️ Lote', accessor: (b, _index) => b.batchNumber },
      {
        header: '📅 Vence',
        accessor: (b, _index) => {
          if (!b.expiresAt) return '-'
          const expiryStatus = calculateExpiryStatus(b.expiresAt)
          const colors = getExpiryColors(expiryStatus)
          return (
            <span className={`inline-block px-2 py-1 rounded-md border text-xs font-medium ${colors.bg} ${colors.border} ${colors.text}`}>
              {formatDateOnlyUtc(b.expiresAt)}
            </span>
          )
        },
      },
      {
        header: '🔒 Estado',
        accessor: (b, _index) => {
          const statusDisplay = getBatchStatusDisplay(b.status)
          return (
            <span className={`text-sm font-medium ${statusDisplay.color}`}>
              {statusDisplay.text}
            </span>
          )
        },
      },
      { 
        header: '📍 Ubicación', 
        accessor: (b, _index) => <InlineLocationEditor batch={b} token={auth.accessToken!} disabled={!canEditWarehouse(b.warehouseId)} /> 
      },
      { header: '📊 Total', accessor: (b, _index) => formatQtyByBatchPresentation(Number(b.quantity), b) },
      {
        header: '🧷 Reservado',
        accessor: (b, _index) => {
          const reserved = Number(b.reservedQuantity ?? '0')
          if (reserved > 0) {
            return (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openReservationsModal(b.id)}
                loading={loadingReservations}
              >
                {formatQtyByBatchPresentation(reserved, b)}
              </Button>
            )
          }
          return formatQtyByBatchPresentation(reserved, b)
        },
      },
      { header: '✅ Disponible', accessor: (b, _index) => formatQtyByBatchPresentation(Number(b.availableQuantity), b) },
    ]

    // Action column: flow + optional status change
    if (canSeeBatchFlow || canChangeBatchStatus) {
      baseColumns.push({
        header: '🚀 Acción',
        accessor: (b, _index) => (
          <div className="flex gap-2">
            {canSeeBatchFlow ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!b.batchId) return
                  setFlowItem({
                    productId: b.productId,
                    productName: b.productName,
                    batchId: b.batchId,
                    batchNumber: b.batchNumber,
                  })
                }}
                disabled={!b.batchId}
              >
                Ver flujo
              </Button>
            ) : null}

            {canChangeBatchStatus && b.batchId ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canEditWarehouse(b.warehouseId)}
                title={canEditWarehouse(b.warehouseId) ? undefined : 'Solo lectura: no es tu almacén'}
                onClick={() =>
                  setStatusChangeItem({
                    productId: b.productId,
                    productName: b.productName,
                    batchId: b.batchId,
                    batchNumber: b.batchNumber,
                    currentStatus: b.status,
                    version: b.version,
                  })
                }
              >
                Estado
              </Button>
            ) : null}
          </div>
        ),
        width: '200px',
      })
    }

    return baseColumns
  }, [canSeeBatchFlow, canChangeBatchStatus, loadingReservations, auth.accessToken])

  const productGroups = useMemo<ProductGroup[]>(() => {
    if (!balancesQuery.data?.items) return []

    const map = new Map<string, ProductGroup>()

    for (const item of balancesQuery.data.items) {
      const qty = Number(item.quantity)
      if (!Number.isFinite(qty) || qty <= 0) continue

      const reserved = Math.max(0, Number(item.reservedQuantity ?? '0'))
      const available = Math.max(0, qty - reserved)

      let productGroup = map.get(item.productId)
      if (!productGroup) {
        productGroup = {
          productId: item.productId,
          sku: item.product.sku,
          name: item.product.name,
          genericName: item.product.genericName ?? null,
          presentationWrapper: item.product.presentationWrapper ?? null,
          presentationQuantity: item.product.presentationQuantity ?? null,
          presentationFormat: item.product.presentationFormat ?? null,
          presentations: item.product.presentations ?? [],
          totalQuantity: 0,
          totalReservedQuantity: 0,
          totalAvailableQuantity: 0,
          warehouses: [],
        }
        map.set(item.productId, productGroup)
      }

      productGroup.totalQuantity += qty
      productGroup.totalReservedQuantity += reserved
      productGroup.totalAvailableQuantity += available

      let whGroup = productGroup.warehouses.find((w) => w.warehouseId === item.location.warehouse.id)
      if (!whGroup) {
        whGroup = {
          warehouseId: item.location.warehouse.id,
          warehouseCode: item.location.warehouse.code,
          warehouseName: item.location.warehouse.name,
          quantity: 0,
          reservedQuantity: 0,
          availableQuantity: 0,
          batches: [],
        }
        productGroup.warehouses.push(whGroup)
      }

      whGroup.quantity += qty
      whGroup.reservedQuantity += reserved
      whGroup.availableQuantity += available
      whGroup.batches.push({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        batchId: item.batchId,
        batchNumber: item.batch?.batchNumber ?? '-',
        expiresAt: item.batch?.expiresAt ?? null,
        status: item.batch?.status ?? 'RELEASED',
        version: item.batch?.version ?? 1,
        presentationName: item.batch?.presentation?.name ?? null,
        unitsPerPresentation: item.batch?.presentation?.unitsPerPresentation ?? null,
        quantity: qty,
        reservedQuantity: reserved,
        availableQuantity: available,
        locationId: item.locationId,
        locationCode: item.location.code,
        warehouseId: item.location.warehouse.id,
      })
    }

    return sortProductsByDisplayName(Array.from(map.values()))
  }, [balancesQuery.data])

  const warehouseGroups = useMemo<WarehouseGroup[]>(() => {
    if (!balancesQuery.data?.items) return []

    const map = new Map<string, WarehouseGroup>()

    for (const item of balancesQuery.data.items) {
      const qty = Number(item.quantity)
      if (!Number.isFinite(qty) || qty <= 0) continue

      const reserved = Math.max(0, Number(item.reservedQuantity ?? '0'))
      const available = Math.max(0, qty - reserved)

      let whGroup = map.get(item.location.warehouse.id)
      if (!whGroup) {
        whGroup = {
          warehouseId: item.location.warehouse.id,
          warehouseCode: item.location.warehouse.code,
          warehouseName: item.location.warehouse.name,
          totalQuantity: 0,
          totalReservedQuantity: 0,
          totalAvailableQuantity: 0,
          products: [],
        }
        map.set(item.location.warehouse.id, whGroup)
      }

      whGroup.totalQuantity += qty
      whGroup.totalReservedQuantity += reserved
      whGroup.totalAvailableQuantity += available

      let prodGroup = whGroup.products.find((p) => p.productId === item.productId)
      if (!prodGroup) {
        prodGroup = {
          productId: item.productId,
          sku: item.product.sku,
          name: item.product.name,
          genericName: item.product.genericName ?? null,
          presentationWrapper: item.product.presentationWrapper ?? null,
          presentationQuantity: item.product.presentationQuantity ?? null,
          presentationFormat: item.product.presentationFormat ?? null,
          presentations: item.product.presentations ?? [],
          quantity: 0,
          reservedQuantity: 0,
          availableQuantity: 0,
          batches: [],
        }
        whGroup.products.push(prodGroup)
      }

      prodGroup.quantity += qty
      prodGroup.reservedQuantity += reserved
      prodGroup.availableQuantity += available
      prodGroup.batches.push({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        batchId: item.batchId,
        batchNumber: item.batch?.batchNumber ?? '-',
        expiresAt: item.batch?.expiresAt ?? null,
        status: item.batch?.status ?? 'RELEASED',
        version: item.batch?.version ?? 1,
        presentationName: item.batch?.presentation?.name ?? null,
        unitsPerPresentation: item.batch?.presentation?.unitsPerPresentation ?? null,
        quantity: qty,
        reservedQuantity: reserved,
        availableQuantity: available,
        locationId: item.locationId,
        locationCode: item.location.code,
        warehouseId: item.location.warehouse.id,
      })
    }

    for (const warehouse of map.values()) {
      warehouse.products = sortProductsByDisplayName(warehouse.products)
    }

    return Array.from(map.values()).sort((a, b) =>
      a.warehouseName.localeCompare(b.warehouseName, 'es', {
        sensitivity: 'base',
        numeric: true,
      }),
    )
  }, [balancesQuery.data])

  const activeWarehouses = useMemo(
    () => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive),
    [warehousesQuery.data],
  )

  const exportMutation = useMutation({
    mutationFn: async () => fetchBalancesForExport(auth.accessToken!),
    onSuccess: (data) => {
      const rows = (data.items ?? []).map((item) => {
        const total = Number(item.quantity || '0')
        const reserved = Number(item.reservedQuantity ?? '0')
        const available = Math.max(0, total - reserved)

        const batchPresentationName = item.batch?.presentation?.name ?? null
        const batchUnitsPerPresentation =
          item.batch?.presentation?.unitsPerPresentation != null ? Number(item.batch.presentation.unitsPerPresentation) : null
        const batchPres = { presentationName: batchPresentationName, unitsPerPresentation: batchUnitsPerPresentation }

        return {
          SKU: item.product.sku,
          Producto: getProductLabel(item.product),
          Lote: item.batch?.batchNumber ?? '-',
          Vence: item.batch?.expiresAt ? formatDateOnlyUtc(item.batch.expiresAt) : '',
          'Estado lote': item.batch?.status ?? '',
          'Sucursal (código)': item.location.warehouse.code,
          'Sucursal (nombre)': item.location.warehouse.name,
          Ubicación: item.location.code,
          Total: formatQtyByBatchPresentation(total, batchPres),
          Reservado: formatQtyByBatchPresentation(reserved, batchPres),
          Disponible: formatQtyByBatchPresentation(available, batchPres),
          'Total (u)': total,
          'Reservado (u)': reserved,
          'Disponible (u)': available,
          'Actualizado': new Date(item.updatedAt).toLocaleString(),
        }
      })

      const date = new Date().toISOString().slice(0, 10)
      exportToXlsx(`inventario_${date}.xlsx`, [
        {
          name: 'Inventario',
          rows,
        },
        {
          name: 'Meta',
          rows: [{ Generado: new Date().toLocaleString(), Filas: rows.length }],
        },
      ])
    },
    onError: (e) => {
      window.alert(e instanceof Error ? e.message : 'Error al exportar a Excel')
    },
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="📦 Inventario Completo">
        {perms.isBranchProvider && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Modo sucursal: puedes <strong>editar únicamente tu almacén</strong> ({perms.warehouse?.code ?? '—'}). El resto de almacenes se muestra en <strong>solo lectura</strong>.
          </div>
        )}
        {/* Botones de filtro - segunda fila en móvil */}
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={groupBy === 'product' ? 'primary' : 'outline'}
            onClick={() => setGroupBy('product')}
            className="text-xs sm:text-sm"
          >
            Por Producto
          </Button>
          <Button
            size="sm"
            variant={groupBy === 'warehouse' ? 'primary' : 'outline'}
            onClick={() => setGroupBy('warehouse')}
            className="text-xs sm:text-sm"
          >
            Por Sucursal
          </Button>
          <Button 
            size="sm"
            variant="outline" 
            icon={<ArrowPathIcon />} 
            onClick={() => balancesQuery.refetch()}
            className="text-xs sm:text-sm"
          >
            Actualizar
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={<DocumentArrowDownIcon />}
            onClick={() => exportMutation.mutate()}
            loading={exportMutation.isPending}
            disabled={!auth.accessToken}
            className="text-xs sm:text-sm"
          >
            Exportar Excel
          </Button>
        </div>
        <div className="space-y-4">
          {balancesQuery.isLoading && <Loading />}
          {balancesQuery.error && (
            <ErrorState
              message={
                balancesQuery.error instanceof Error ? balancesQuery.error.message : 'Error al cargar inventario'
              }
              retry={balancesQuery.refetch}
            />
          )}

          {balancesQuery.data && balancesQuery.data.items.length === 0 && (
            <EmptyState message="No hay existencias en el inventario" />
          )}

          {/* Vista por Producto */}
          {groupBy === 'product' && productGroups.length > 0 && (
            <div className="space-y-3">
              {productGroups.map((pg) => (
                <div
                  key={pg.productId}
                  className={`rounded-lg border-2 ${
                    expandedProduct === pg.productId
                      ? 'border-blue-500 bg-blue-100/70 dark:border-blue-400 dark:bg-blue-800/40'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedProduct(expandedProduct === pg.productId ? null : pg.productId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setExpandedProduct(expandedProduct === pg.productId ? null : pg.productId)
                      }
                    }}
                    className="flex w-full items-start justify-between gap-4 p-4 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400/40 dark:hover:bg-slate-800"
                  >
                     <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900 dark:text-slate-100">{pg.name}</div>
                      <div className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400">{pg.sku}</div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      {(() => {
                        const batches = pg.warehouses.flatMap((w) =>
                          w.batches.map((b) => ({
                            ...b,
                            warehouseCode: w.warehouseCode,
                          })),
                        )

                        const byPresentation = new Map<
                          string,
                          {
                            name: string
                            unitsPer: number
                            byWarehouse: Map<string, number>
                            totalUnits: number
                          }
                        >()

                        for (const b of batches) {
                          const name = (b.presentationName ?? 'Unidad').trim() || 'Unidad'
                          const unitsPer = Number(b.unitsPerPresentation ?? 1)
                          const availableUnits = Number(b.availableQuantity ?? 0)
                          if (!Number.isFinite(availableUnits) || availableUnits <= 0) continue

                          const key = `${name}|${Number.isFinite(unitsPer) && unitsPer > 0 ? unitsPer : 1}`
                          const entry = byPresentation.get(key) ?? {
                            name,
                            unitsPer: Number.isFinite(unitsPer) && unitsPer > 0 ? unitsPer : 1,
                            byWarehouse: new Map<string, number>(),
                            totalUnits: 0,
                          }
                          entry.totalUnits += availableUnits
                          entry.byWarehouse.set(b.warehouseCode, (entry.byWarehouse.get(b.warehouseCode) ?? 0) + availableUnits)
                          byPresentation.set(key, entry)
                        }

                        const cards = Array.from(byPresentation.values())
                          .filter((x) => x.totalUnits > 0)
                          .sort((a, b) => b.unitsPer - a.unitsPer)

                        if (cards.length === 0) {
                          return (
                            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              Sin existencias
                            </div>
                          )
                        }

                        return cards.map((c) => (
                          <div
                            key={`${c.name}|${c.unitsPer}`}
                            className="min-w-[200px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
                          >
                            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                              <div className="flex items-center gap-2">
                                {getPresentationIcon(c.name)}
                                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">{c.name}</div>
                              </div>
                              {c.unitsPer > 1 ? (
                                <div className="rounded-full bg-white px-2 py-0.5 text-[10px] font-mono text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                                  {c.unitsPer}u
                                </div>
                              ) : null}
                            </div>
                            <div className="space-y-1 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
                              {Array.from(c.byWarehouse.entries())
                                .filter(([, units]) => units > 0)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([warehouseCode, units]) => (
                                  <div key={warehouseCode} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
                                    <span className="font-mono text-slate-500 dark:text-slate-400">{warehouseCode}:</span>
                                    <span className="font-bold text-slate-800 dark:text-slate-100">
                                      {formatPresentationCountFromUnits(units, c.unitsPer)}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  </div>

                  {expandedProduct === pg.productId && (
                    <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                      {(() => {
                        const rows = pg.warehouses
                          .flatMap((wh) =>
                            wh.batches.map((b) => ({
                              ...b,
                              warehouseCode: wh.warehouseCode,
                              warehouseName: wh.warehouseName,
                            })),
                          )
                          .sort((a, b) => {
                            const w = a.warehouseCode.localeCompare(b.warehouseCode)
                            if (w !== 0) return w
                            return (a.batchNumber ?? '').localeCompare(b.batchNumber ?? '')
                          })

                        return (
                          <Table
                            columns={productExpandedColumns}
                            data={rows}
                            keyExtractor={(b: any) => `${b.batchId ?? 'null'}-${b.locationId}`}
                          />
                        )
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Vista por Sucursal */}
          {groupBy === 'warehouse' && warehouseGroups.length > 0 && (
            <div className="space-y-3">
              {warehouseGroups.map((wg) => (
                <div
                  key={wg.warehouseId}
                  className={`rounded-lg border-2 ${
                    expandedWarehouse === wg.warehouseId
                      ? 'border-blue-500 bg-blue-100/70 dark:border-blue-400 dark:bg-blue-800/40'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                  }`}
                >
                  <button
                    onClick={() =>
                      setExpandedWarehouse(expandedWarehouse === wg.warehouseId ? null : wg.warehouseId)
                    }
                    className="flex w-full items-center justify-between p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{expandedWarehouse === wg.warehouseId ? '🏢' : '🏬'}</span>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {wg.warehouseCode} - {wg.warehouseName}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          {wg.products.length} producto{wg.products.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-[var(--pf-primary)]">
                        <span className="text-xl">
                          {(() => {
                            const totalProducts = wg.products.length
                            const productsWithStock = wg.products.filter(p => p.availableQuantity > 0).length
                            return `${productsWithStock}/${totalProducts}`
                          })()}
                        </span>
                        <span className="text-sm"> productos con stock</span>
                      </div>
                    </div>
                  </button>

                  {expandedWarehouse === wg.warehouseId && (
                    <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                      {wg.products.map((prod) => (
                        <div
                          key={prod.productId}
                          className="mb-4 last:mb-0 rounded border border-slate-100 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                                <span>
                                  📦 {prod.name}
                                  {(() => {
                                    const pres = formatPresentation(prod)
                                    return pres ? ` - ${pres}` : ''
                                  })()}
                                </span>
                                <span className="ml-2 text-xs font-mono text-slate-500 dark:text-slate-400">| {prod.sku}</span>
                            </div>
                            {prod.genericName ? (
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Genérico: {prod.genericName}</div>
                            ) : null}
                            <div className="flex items-center gap-3">
                              <Button
                                size="sm"
                                variant="outline"
                                icon={<TableCellsIcon />}
                                onClick={() => {
                                  setKardexProductId(prod.productId)
                                  setKardexWarehouseId(wg.warehouseId)
                                  setKardexModalOpen(true)
                                }}
                                className="h-7 text-xs"
                                title="Ver kardex de este producto en esta sucursal"
                              >
                                Kardex
                              </Button>
                              <div className="text-right">
                                <div className="text-lg font-semibold text-slate-700 dark:text-slate-300">
                                  {formatTotalsFromBatches(prod.batches, 'availableQuantity')}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {formatTotalsFromBatches(prod.batches, 'reservedQuantity')} res. · {formatTotalsFromBatches(prod.batches, 'quantity')} total
                                </div>
                              </div>
                            </div>
                          </div>

                          <Table
                            columns={warehouseColumns}
                            data={prod.batches}
                            keyExtractor={(b) => `${b.batchId ?? 'null'}-${b.locationId}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PageContainer>

      {/* Modal Mover */}
      <Modal
        isOpen={!!movingItem}
        onClose={() => {
          setMovingItem(null)
          setMoveQty('')
          setMoveToWarehouseId('')
          setMoveToLocationId('')
          setMoveError('')
        }}
        title="Mover Existencias"
        maxWidth="lg"
      >
        {movingItem && (
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">📦 Origen</div>
              <div className="text-sm text-slate-700 dark:text-slate-300">
                <div>
                  <strong>Producto:</strong> {movingItem.productName}
                </div>
                <div>
                  <strong>Lote:</strong> {movingItem.batchNumber}
                </div>
                <div>
                  <strong>Ubicación:</strong> {movingItem.fromWarehouseCode} / {movingItem.fromLocationCode}
                </div>
                <div>
                  <strong>Disponible:</strong> {movingItem.availableQty}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="📊 Cantidad a mover"
                type="number"
                value={moveQty}
                onChange={(e) => setMoveQty(e.target.value)}
                min={0}
                max={Number(movingItem.availableQty)}
                disabled={moveMutation.isPending}
              />
              <Select
                label="🏢 Almacén destino"
                value={moveToWarehouseId}
                onChange={(e) => {
                  setMoveToWarehouseId(e.target.value)
                  setMoveToLocationId('')
                }}
                options={[
                  { value: '', label: 'Seleccioná...' },
                  ...activeWarehouses.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
                ]}
                disabled={moveMutation.isPending || warehousesQuery.isLoading}
              />
              <Select
                label="📍 Ubicación destino"
                value={moveToLocationId}
                onChange={(e) => setMoveToLocationId(e.target.value)}
                options={[
                  { value: '', label: 'Seleccioná...' },
                  ...(destinationLocationsQuery.data?.items ?? [])
                    .filter((l) => l.isActive)
                    .map((l) => ({ value: l.id, label: l.code })),
                ]}
                disabled={moveMutation.isPending || !moveToWarehouseId || destinationLocationsQuery.isLoading}
              />
            </div>

            {moveError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                ❌ {moveError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setMovingItem(null)
                  setMoveQty('')
                  setMoveToWarehouseId('')
                  setMoveToLocationId('')
                  setMoveError('')
                }}
                disabled={moveMutation.isPending}
              >
                ❌ Cancelar
              </Button>
              <Button onClick={() => moveMutation.mutate()} disabled={moveMutation.isPending}>
                {moveMutation.isPending ? '⏳ Moviendo...' : '✅ Confirmar Movimiento'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Ver flujo */}
      <Modal
        isOpen={!!flowItem}
        onClose={() => setFlowItem(null)}
        title={flowItem ? `Ver flujo — Lote ${flowItem.batchNumber}` : 'Ver flujo'}
        maxWidth="lg"
      >
        {!canSeeBatchFlow ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No tenés permisos para ver el flujo del lote.</p>
        ) : (
          <div className="space-y-3">
            {flowItem ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
                <div>
                  <span className="font-medium">Producto:</span> {flowItem.productName}
                </div>
                <div>
                  <span className="font-medium">Lote:</span> {flowItem.batchNumber}
                </div>
              </div>
            ) : null}

            {batchFlowQuery.isLoading && <p className="text-sm text-slate-600 dark:text-slate-400">Cargando flujo…</p>}
            {batchFlowQuery.error && (
              <p className="text-sm text-red-600">
                {batchFlowQuery.error instanceof Error ? batchFlowQuery.error.message : 'Error cargando flujo'}
              </p>
            )}

            {batchFlowQuery.data && batchFlowQuery.data.items.length === 0 && (
              <p className="text-sm text-slate-600 dark:text-slate-400">Sin movimientos registrados para este lote.</p>
            )}

            {batchFlowQuery.data && batchFlowQuery.data.items.length > 0 && (
              <div className="max-h-[60vh] space-y-2 overflow-auto rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                {batchFlowQuery.data.items.map((m) => (
                  <div key={m.id} className="text-xs text-slate-700 dark:text-slate-300">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{m.number}</span>
                      <span className="shrink-0">{new Date(m.createdAt).toLocaleString()}</span>
                    </div>
                    <div>
                      {m.type} · Qty {m.quantity}
                      {m.presentation && m.presentationQuantity ? ` · ${m.presentationQuantity} ${m.presentation.name}` : ''}
                      {m.from ? ` · Desde ${m.from.warehouse.code}/${m.from.code}` : ''}
                      {m.to ? ` · Hacia ${m.to.warehouse.code}/${m.to.code}` : ''}
                    </div>
                    {m.note ? <div className="text-slate-500 dark:text-slate-400">Nota: {m.note}</div> : null}
                    {(m.referenceType || m.referenceId) ? (
                      <div className="text-slate-500 dark:text-slate-400">
                        Ref: {m.referenceType ?? '-'} · {m.referenceId ?? '-'}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setFlowItem(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Cambiar Estado */}
      <Modal
        isOpen={!!statusChangeItem}
        onClose={() => {
          setStatusChangeItem(null)
          setNewStatus('RELEASED')
        }}
        title="Cambiar Estado del Lote"
      >
        {statusChangeItem && (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                🔄 Cambiar Estado del Lote
              </h3>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                <div>
                  <strong>Producto:</strong> {statusChangeItem.productName}
                </div>
                <div>
                  <strong>Lote:</strong> {statusChangeItem.batchNumber}
                </div>
                <div>
                  <strong>Estado actual:</strong>{' '}
                  <span className={getBatchStatusDisplay(statusChangeItem.currentStatus).color}>
                    {getBatchStatusDisplay(statusChangeItem.currentStatus).text}
                  </span>
                </div>
              </div>
            </div>

            <Select
              label="🔒 Nuevo estado"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              options={[
                { value: 'RELEASED', label: '✅ Liberado' },
                { value: 'QUARANTINE', label: '🚫 En cuarentena' },
              ]}
              disabled={statusChangeMutation.isPending}
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setStatusChangeItem(null)
                  setNewStatus('RELEASED')
                }}
                disabled={statusChangeMutation.isPending}
              >
                ❌ Cancelar
              </Button>
              <Button
                onClick={() => statusChangeMutation.mutate()}
                disabled={statusChangeMutation.isPending || newStatus === statusChangeItem.currentStatus}
              >
                {statusChangeMutation.isPending ? '⏳ Cambiando...' : '✅ Cambiar Estado'}
              </Button>
            </div>
          </div>
        )}

        </Modal>

        <Modal
          isOpen={reservationsModalOpen}
          onClose={() => setReservationsModalOpen(false)}
          title="Reservas de Stock"
        >
          <div className="space-y-4">
            {selectedReservations.length === 0 ? (
              <p className="text-slate-900 dark:text-slate-100">No hay reservas para este balance.</p>
            ) : (
              selectedReservations.map((res) => {
                const deliveryDate = res.deliveryDate ? new Date(res.deliveryDate) : null
                const isPast = res.deliveryDays < 0
                const daysText = isPast
                  ? `Hace ${Math.abs(res.deliveryDays)} días`
                  : `En ${res.deliveryDays} días`

                // Use the same blue background for all reservations with solid blue border
                const colorClass = 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400'

                return (
                  <div key={res.id} className={`rounded-lg p-4 border-2 ${colorClass}`}>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><strong>Vendedor:</strong> {res.seller}</div>
                      <div><strong>Cliente:</strong> {res.client}</div>
                      <div><strong>Orden:</strong> {res.order}</div>
                      <div><strong>Cantidad:</strong> {res.quantity}</div>
                      <div className="col-span-2">
                        <strong>Entrega:</strong> {deliveryDate ? deliveryDate.toLocaleDateString() : 'No especificada'} ({daysText})
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
         </Modal>

         <Modal
          isOpen={kardexModalOpen}
          onClose={() => { setKardexModalOpen(false); setKardexProductId(null); setKardexWarehouseId(null) }}
          title="Kardex de Inventario"
          maxWidth="5xl"
        >
          {kardexProductId ? <KardexModalContent productId={kardexProductId} warehouseId={kardexWarehouseId ?? undefined} onClose={() => { setKardexModalOpen(false); setKardexProductId(null); setKardexWarehouseId(null) }} /> : null}
        </Modal>

     </MainLayout>
  )
}
