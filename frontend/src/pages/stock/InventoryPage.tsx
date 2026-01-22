import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { exportToXlsx } from '../../lib/exportXlsx'
import { getProductLabel } from '../../lib/productName'
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
import { useNavigation } from '../../hooks'
import type { ExpiryStatus } from '../../components/common/ExpiryBadge'
import { ArrowPathIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline'

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
  }
  batch: { batchNumber: string; expiresAt: string | null; status: string; version: number } | null
  location: {
    id: string
    code: string
    warehouse: { id: string; code: string; name: string }
  }
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

type ProductGroup = {
  productId: string
  sku: string
  name: string
  genericName?: string | null
  presentationWrapper?: string | null
  presentationQuantity?: any
  presentationFormat?: string | null
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
      batchId: string | null
      batchNumber: string
      expiresAt: string | null
      status: string
      version: number
      quantity: number
      reservedQuantity: number
      availableQuantity: number
      locationId: string
      locationCode: string
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
    quantity: number
    reservedQuantity: number
    availableQuantity: number
    batches: Array<{
      id: string
      batchId: string | null
      batchNumber: string
      expiresAt: string | null
      status: string
      version: number
      quantity: number
      reservedQuantity: number
      availableQuantity: number
      locationId: string
      locationCode: string
    }>
  }>
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

function formatProductTitle(p: {
  name: string
  sku: string
  presentationWrapper?: string | null
  presentationQuantity?: any
  presentationFormat?: string | null
}): string {
  const pres = formatPresentation(p)
  return `${p.name}${pres ? ` - ${pres}` : ''} | ${p.sku}`
}

function getCoveragePill(withStockCount: number, totalActive: number): { className: string; title: string; label: string } {
  if (!Number.isFinite(totalActive) || totalActive <= 0) {
    return {
      className: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
      title: 'Sin sucursales activas',
      label: '0 sucursales',
    }
  }

  const clampedWith = Math.max(0, Math.min(totalActive, withStockCount))
  const missing = totalActive - clampedWith
  const ratio = clampedWith / totalActive

  if (missing === 0) {
    return {
      className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800',
      title: 'Existencias en todas las sucursales',
      label: `${totalActive} sucursal${totalActive !== 1 ? 'es' : ''}`,
    }
  }

  if (ratio >= 0.5) {
    return {
      className: 'bg-yellow-100 text-yellow-900 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-200 dark:border-yellow-800',
      title: `Faltan existencias en ${missing} sucursal${missing !== 1 ? 'es' : ''}`,
      label: `${clampedWith}/${totalActive} sucursales`,
    }
  }

  return {
    className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800',
    title: `Existencias solo en ${clampedWith} sucursal${clampedWith !== 1 ? 'es' : ''}`,
    label: `${clampedWith}/${totalActive} sucursales`,
  }
}

export function InventoryPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()

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
        batchId: item.batchId,
        batchNumber: item.batch?.batchNumber ?? '-',
        expiresAt: item.batch?.expiresAt ?? null,
        status: item.batch?.status ?? 'RELEASED',
        version: item.batch?.version ?? 1,
        quantity: qty,
        reservedQuantity: reserved,
        availableQuantity: available,
        locationId: item.locationId,
        locationCode: item.location.code,
      })
    }

    return Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku))
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
        batchId: item.batchId,
        batchNumber: item.batch?.batchNumber ?? '-',
        expiresAt: item.batch?.expiresAt ?? null,
        status: item.batch?.status ?? 'RELEASED',
        version: item.batch?.version ?? 1,
        quantity: qty,
        reservedQuantity: reserved,
        availableQuantity: available,
        locationId: item.locationId,
        locationCode: item.location.code,
      })
    }

    return Array.from(map.values()).sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode))
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

        return {
          SKU: item.product.sku,
          Producto: getProductLabel(item.product),
          Lote: item.batch?.batchNumber ?? '-',
          Vence: item.batch?.expiresAt ? new Date(item.batch.expiresAt).toLocaleDateString() : '',
          'Estado lote': item.batch?.status ?? '',
          'Sucursal (código)': item.location.warehouse.code,
          'Sucursal (nombre)': item.location.warehouse.name,
          Ubicación: item.location.code,
          Total: total,
          Reservado: reserved,
          Disponible: available,
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
                  <button
                    onClick={() => setExpandedProduct(expandedProduct === pg.productId ? null : pg.productId)}
                    className="flex w-full items-center justify-between p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{expandedProduct === pg.productId ? '📂' : '📁'}</span>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          <span>
                            {pg.name}
                            {(() => {
                              const pres = formatPresentation(pg)
                              return pres ? ` - ${pres}` : ''
                            })()}
                          </span>
                          <span className="ml-2 text-xs font-mono text-slate-500 dark:text-slate-400">| {pg.sku}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          {(() => {
                            const activeCount = activeWarehouses.length
                            const withStock = activeWarehouses.filter((w) =>
                              pg.warehouses.some((x) => x.warehouseId === w.id && x.availableQuantity > 0),
                            ).length
                            const pill = getCoveragePill(withStock, activeCount)
                            return (
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${pill.className}`}
                                title={pill.title}
                              >
                                {pill.label}
                              </span>
                            )
                          })()}
                          {pg.genericName ? (
                            <span className="text-xs text-slate-500 dark:text-slate-400">Genérico: {pg.genericName}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-[var(--pf-primary)]">{pg.totalAvailableQuantity}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        disp. · {pg.totalReservedQuantity} res. · {pg.totalQuantity} total
                      </div>
                    </div>
                  </button>

                  {expandedProduct === pg.productId && (
                    <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                      {pg.warehouses.map((wh) => (
                        <div
                          key={wh.warehouseId}
                          className="mb-4 last:mb-0 rounded border border-slate-100 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                                🏢 {wh.warehouseName}
                            </div>
                            <div className="text-right">
                              <div className="text-lg font-semibold text-slate-700 dark:text-slate-300">{wh.availableQuantity}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {wh.reservedQuantity} res. · {wh.quantity} total
                              </div>
                            </div>
                          </div>

                          <Table
                            columns={[
                              { header: '🏷️ Lote', accessor: (b) => b.batchNumber },
                              {
                                header: '📅 Vence',
                                accessor: (b) => {
                                  if (!b.expiresAt) return '-'
                                  const expiryStatus = calculateExpiryStatus(b.expiresAt)
                                  const colors = getExpiryColors(expiryStatus)
                                  return (
                                    <span className={`inline-block px-2 py-1 rounded-md border text-xs font-medium ${colors.bg} ${colors.border} ${colors.text}`}>
                                      {new Date(b.expiresAt).toLocaleDateString()}
                                    </span>
                                  )
                                },
                              },
                              {
                                header: '🔒 Estado',
                                accessor: (b) => {
                                  const statusDisplay = getBatchStatusDisplay(b.status)
                                  return (
                                    <span className={`text-sm font-medium ${statusDisplay.color}`}>
                                      {statusDisplay.text}
                                    </span>
                                  )
                                },
                              },
                              { header: '📍 Ubicación', accessor: (b) => b.locationCode },
                              { header: '📊 Total', accessor: (b) => b.quantity },
                              {
                                header: '🧷 Reservado',
                                accessor: (b) => {
                                  const reserved = Number(b.reservedQuantity ?? '0')
                                  if (reserved > 0) {
                                    return (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => openReservationsModal(b.id)}
                                        loading={loadingReservations}
                                      >
                                        {b.reservedQuantity}
                                      </Button>
                                    )
                                  }
                                  return b.reservedQuantity ?? '0'
                                },
                              },
                              { header: '✅ Disponible', accessor: (b) => b.availableQuantity },
                              {
                                header: 'Acción',
                                className: 'text-center',
                                accessor: (b) => (
                                  <div className="flex gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      icon={<ArrowPathIcon className="w-4 h-4" />}
                                      onClick={() =>
                                        setMovingItem({
                                          productId: pg.productId,
                                          productName: formatProductTitle(pg),
                                          batchId: b.batchId,
                                          batchNumber: b.batchNumber,
                                          fromLocationId: b.locationId,
                                          fromWarehouseCode: wh.warehouseCode,
                                          fromLocationCode: b.locationCode,
                                          availableQty: String(b.availableQuantity),
                                        })
                                      }
                                    >
                                      Mover
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      icon={<ArrowPathIcon className="w-4 h-4" />}
                                      onClick={() => {
                                        setStatusChangeItem({
                                          productId: pg.productId,
                                          productName: formatProductTitle(pg),
                                          batchId: b.batchId!,
                                          batchNumber: b.batchNumber,
                                          currentStatus: b.status,
                                          version: b.version,
                                        })
                                        setNewStatus(b.status === 'QUARANTINE' ? 'RELEASED' : 'QUARANTINE')
                                      }}
                                    >
                                      Estado
                                    </Button>
                                  </div>
                                ),
                              },
                            ]}
                            data={wh.batches}
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
                      <div className="text-2xl font-bold text-[var(--pf-primary)]">{wg.totalAvailableQuantity}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        disp. · {wg.totalReservedQuantity} res. · {wg.totalQuantity} total
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
                            <div className="text-right">
                              <div className="text-lg font-semibold text-slate-700 dark:text-slate-300">{prod.availableQuantity}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {prod.reservedQuantity} res. · {prod.quantity} total
                              </div>
                            </div>
                          </div>

                          <Table
                            columns={[
                              { header: '🏷️ Lote', accessor: (b) => b.batchNumber },
                              {
                                header: '📅 Vence',
                                accessor: (b) => {
                                  if (!b.expiresAt) return '-'
                                  const expiryStatus = calculateExpiryStatus(b.expiresAt)
                                  const colors = getExpiryColors(expiryStatus)
                                  return (
                                    <span className={`inline-block px-2 py-1 rounded-md border text-xs font-medium ${colors.bg} ${colors.border} ${colors.text}`}>
                                      {new Date(b.expiresAt).toLocaleDateString()}
                                    </span>
                                  )
                                },
                              },
                              {
                                header: '🔒 Estado',
                                accessor: (b) => {
                                  const statusDisplay = getBatchStatusDisplay(b.status)
                                  return (
                                    <span className={`text-sm font-medium ${statusDisplay.color}`}>
                                      {statusDisplay.text}
                                    </span>
                                  )
                                },
                              },
                              { header: '📍 Ubicación', accessor: (b) => b.locationCode },
                              { header: '📊 Total', accessor: (b) => b.quantity },
                              {
                                header: '🧷 Reservado',
                                accessor: (b) => {
                                  const reserved = Number(b.reservedQuantity ?? '0')
                                  if (reserved > 0) {
                                    return (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => openReservationsModal(b.id)}
                                        loading={loadingReservations}
                                      >
                                        {b.reservedQuantity}
                                      </Button>
                                    )
                                  }
                                  return b.reservedQuantity ?? '0'
                                },
                              },
                              { header: '✅ Disponible', accessor: (b) => b.availableQuantity },
                              {
                                header: 'Acción',
                                className: 'text-center',
                                accessor: (b) => (
                                  <div className="flex gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      icon={<ArrowPathIcon className="w-4 h-4" />}
                                      onClick={() =>
                                        setMovingItem({
                                          productId: prod.productId,
                                          productName: formatProductTitle(prod),
                                          batchId: b.batchId,
                                          batchNumber: b.batchNumber,
                                          fromLocationId: b.locationId,
                                          fromWarehouseCode: wg.warehouseCode,
                                          fromLocationCode: b.locationCode,
                                          availableQty: String(b.availableQuantity),
                                        })
                                      }
                                    >
                                      Mover
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      icon={<ArrowPathIcon className="w-4 h-4" />}
                                      onClick={() => {
                                        setStatusChangeItem({
                                          productId: prod.productId,
                                          productName: formatProductTitle(prod),
                                          batchId: b.batchId!,
                                          batchNumber: b.batchNumber,
                                          currentStatus: b.status,
                                          version: b.version,
                                        })
                                        setNewStatus(b.status === 'QUARANTINE' ? 'RELEASED' : 'QUARANTINE')
                                      }}
                                    >
                                      Estado
                                    </Button>
                                  </div>
                                ),
                              },
                            ]}
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
                  <strong>Disponible:</strong> {movingItem.availableQty} unidades
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
    </MainLayout>
  )
}
