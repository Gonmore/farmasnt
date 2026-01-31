import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getProductLabel } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation } from '../../hooks'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, Button, Input, Select } from '../../components'
import { MovementQuickActions } from '../../components/MovementQuickActions'

type WarehouseListItem = { id: string; code: string; name: string; city?: string | null; isActive: boolean }

type LocationListItem = { id: string; warehouseId: string; code: string; isActive: boolean }

type WarehouseStockRow = {
  id: string
  quantity: string
  reservedQuantity?: string
  updatedAt: string
  productId: string
  batchId: string | null
  locationId: string
  product: { sku: string; name: string; genericName?: string | null }
  batch: { batchNumber: string; expiresAt: string | null; status: string } | null
  location: { id: string; code: string; warehouse: { id: string; code: string; name: string } }
}

type WarehouseStockResponse = { items: WarehouseStockRow[] }

type BulkTransferResponse = {
  referenceType: string
  referenceId: string
  items: Array<{ createdMovement: any; fromBalance: any; toBalance: any }>
}

const parsePresentationFromBatchNumber = (batchNumber: string): { name: string; unitsPerPresentation: string } | null => {
  const match = batchNumber.match(/C(\d+)/i)
  if (match) {
    const units = parseInt(match[1], 10)
    if (Number.isFinite(units) && units > 0) return { name: 'Caja', unitsPerPresentation: String(units) }
  }
  return null
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch('/api/v1/warehouses?take=100', { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  return apiFetch(`/api/v1/warehouses/${encodeURIComponent(warehouseId)}/locations?take=100`, { token })
}

async function fetchWarehouseStock(token: string, warehouseId: string): Promise<WarehouseStockResponse> {
  const params = new URLSearchParams({ warehouseId, take: '200' })
  return apiFetch(`/api/v1/reports/stock/balances-expanded?${params}`, { token })
}

export function BulkTransferPage() {
  const auth = useAuth()
  const navGroups = useNavigation()

  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [fromLocationId, setFromLocationId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [note, setNote] = useState('')
  const [qtyByRowId, setQtyByRowId] = useState<Record<string, string>>({})
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({})
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState<null | { referenceId: string }>(null)
  const [productFilter, setProductFilter] = useState('')

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'bulkTransfer'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const fromLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'bulkTransfer', 'from', fromWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, fromWarehouseId),
    enabled: !!auth.accessToken && !!fromWarehouseId,
  })

  const toLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'bulkTransfer', 'to', toWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, toWarehouseId),
    enabled: !!auth.accessToken && !!toWarehouseId,
  })

  const stockQuery = useQuery({
    queryKey: ['warehouseStock', 'bulkTransfer', fromWarehouseId],
    queryFn: () => fetchWarehouseStock(auth.accessToken!, fromWarehouseId),
    enabled: !!auth.accessToken && !!fromWarehouseId,
  })

  const activeWarehouses = useMemo(
    () => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive),
    [warehousesQuery.data?.items],
  )

  const filteredStock = useMemo(() => {
    const items = stockQuery.data?.items ?? []
    if (!fromLocationId) return []
    let filtered = items.filter((r) => r.locationId === fromLocationId)
    if (productFilter.trim()) {
      const filter = productFilter.toLowerCase()
      filtered = filtered.filter((r) =>
        getProductLabel({ id: r.productId, sku: r.product.sku, name: r.product.name, genericName: r.product.genericName ?? null } as any).toLowerCase().includes(filter)
      )
    }
    return filtered
  }, [stockQuery.data?.items, fromLocationId, productFilter])

  const selectedRows = useMemo(() => {
    return filteredStock.filter((r) => selectedRowIds[r.id])
  }, [filteredStock, selectedRowIds])

  const selectedCount = selectedRows.length

  const bulkTransferMutation = useMutation({
    mutationFn: async (): Promise<BulkTransferResponse> => {
      if (!fromWarehouseId || !fromLocationId) throw new Error('Selecciona almacén y ubicación de origen')
      if (!toWarehouseId || !toLocationId) throw new Error('Selecciona almacén y ubicación de destino')
      if (selectedCount <= 0) throw new Error('Selecciona al menos un lote/producto para transferir')

      const items = selectedRows.map((r) => {
        const total = Number(r.quantity || '0')
        const reserved = Number(r.reservedQuantity ?? '0')
        const available = Math.max(0, total - reserved)

        // Get presentation units
        const pres = r.batch?.batchNumber ? parsePresentationFromBatchNumber(r.batch.batchNumber) : null
        const unitsPerPres = pres ? Number(pres.unitsPerPresentation) : 1
        if (!Number.isFinite(unitsPerPres) || unitsPerPres <= 0) throw new Error('Presentación inválida')

        const qtyRaw = (qtyByRowId[r.id] ?? '').trim()
        let qtyInPres = qtyRaw ? Number(qtyRaw) : (available / unitsPerPres)
        if (!Number.isFinite(qtyInPres) || qtyInPres <= 0) throw new Error('Cantidad inválida en una fila seleccionada')

        const qtyInUnits = qtyInPres * unitsPerPres
        if (qtyInUnits > available + 1e-9) throw new Error('Una fila supera la cantidad disponible')

        return {
          productId: r.productId,
          batchId: r.batchId,
          fromLocationId: r.locationId,
          toLocationId,
          quantity: qtyInUnits,
        }
      })

      return apiFetch('/api/v1/stock/bulk-transfers', {
        token: auth.accessToken!,
        method: 'POST',
        body: JSON.stringify({
          fromWarehouseId,
          fromLocationId,
          toWarehouseId,
          toLocationId,
          note: note.trim() || undefined,
          items,
        }),
      })
    },
    onMutate: () => {
      setSubmitError('')
      setSubmitSuccess(null)
    },
    onSuccess: async (data) => {
      setSubmitSuccess({ referenceId: data.referenceId })
      setSelectedRowIds({})
      setQtyByRowId({})

      // Enviar notificaciones
      try {
        await apiFetch('/api/v1/notifications/send-bulk-transfer', {
          token: auth.accessToken!,
          method: 'POST',
          body: JSON.stringify({
            referenceId: data.referenceId,
            fromWarehouseId,
            toWarehouseId,
            items: data.items.map((item: any) => ({
              productId: item.createdMovement.productId,
              quantity: item.createdMovement.quantity,
            })),
          }),
        })
      } catch (error) {
        console.warn('Error enviando notificaciones:', error)
        // No fallar la operación por error en notificaciones
      }
    },
    onError: (e: any) => {
      setSubmitError(e?.message || 'Error')
    },
  })

  const canSubmit = !!fromWarehouseId && !!fromLocationId && !!toWarehouseId && !!toLocationId && selectedCount > 0

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="📦 Transferencia masiva">
        <MovementQuickActions currentPath="/stock/bulk-transfer" />
        <div className="mb-4 text-sm text-slate-700 dark:text-slate-300">Mueve varios productos/lotes en una sola operación.</div>

        <div className="grid gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              label="Almacén origen"
              value={fromWarehouseId}
              onChange={(e) => {
                setFromWarehouseId(e.target.value)
                setFromLocationId('')
                setSelectedRowIds({})
                setQtyByRowId({})
              }}
              options={[
                { value: '', label: 'Selecciona almacén' },
                ...activeWarehouses.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
              ]}
              disabled={warehousesQuery.isLoading}
            />

            <Select
              label="Ubicación origen"
              value={fromLocationId}
              onChange={(e) => {
                setFromLocationId(e.target.value)
                setSelectedRowIds({})
                setQtyByRowId({})
              }}
              options={[
                { value: '', label: 'Selecciona ubicación' },
                ...(fromLocationsQuery.data?.items ?? [])
                  .filter((l) => l.isActive)
                  .map((l) => ({ value: l.id, label: l.code })),
              ]}
              disabled={!fromWarehouseId || fromLocationsQuery.isLoading}
            />

            <Select
              label="Almacén destino"
              value={toWarehouseId}
              onChange={(e) => {
                setToWarehouseId(e.target.value)
                setToLocationId('')
              }}
              options={[
                { value: '', label: 'Selecciona almacén' },
                ...activeWarehouses
                  .filter((w) => w.id !== fromWarehouseId)
                  .map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
              ]}
              disabled={warehousesQuery.isLoading}
            />

            <Select
              label="Ubicación destino"
              value={toLocationId}
              onChange={(e) => setToLocationId(e.target.value)}
              options={[
                { value: '', label: 'Selecciona ubicación' },
                ...(toLocationsQuery.data?.items ?? [])
                  .filter((l) => l.isActive)
                  .map((l) => ({ value: l.id, label: l.code })),
              ]}
              disabled={!toWarehouseId || toLocationsQuery.isLoading}
            />
          </div>

          <div className="mt-3">
            <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: Envío semanal" />
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={() => bulkTransferMutation.mutate()} disabled={!canSubmit} loading={bulkTransferMutation.isPending}>
              Crear transferencia masiva
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedRowIds({})
                setQtyByRowId({})
                setSubmitError('')
                setSubmitSuccess(null)
              }}
              disabled={bulkTransferMutation.isPending}
            >
              Limpiar selección
            </Button>
          </div>

          {submitError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {submitError}
            </div>
          )}
          {submitSuccess && (
            <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
              Listo. Referencia: <span className="font-mono">{submitSuccess.referenceId}</span>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-sm text-slate-700 dark:text-slate-300">
            Selecciona filas (lote/ubicación) y define cantidad a mover.
          </div>

          <div className="mb-4">
            <Input
              label="Buscar por producto"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              placeholder="Nombre del producto"
            />
          </div>

          {!fromWarehouseId || !fromLocationId ? (
            <EmptyState message="Selecciona almacén y ubicación de origen" />
          ) : stockQuery.isLoading ? (
            <Loading />
          ) : stockQuery.error ? (
            <ErrorState message="Error cargando existencias" retry={stockQuery.refetch} />
          ) : filteredStock.length === 0 ? (
            <EmptyState message="Sin existencias en esta ubicación" />
          ) : (
            <Table
              data={filteredStock}
              keyExtractor={(r) => r.id}
              columns={[
                {
                  header: '✓',
                  className: 'w-12',
                  accessor: (r) => (
                    <input
                      type="checkbox"
                      checked={!!selectedRowIds[r.id]}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setSelectedRowIds((prev) => ({ ...prev, [r.id]: checked }))
                        if (!checked) {
                          setQtyByRowId((prev) => {
                            const next = { ...prev }
                            delete next[r.id]
                            return next
                          })
                        }
                      }}
                    />
                  ),
                },
                {
                  header: 'Producto',
                  accessor: (r) => getProductLabel({ id: r.productId, sku: r.product.sku, name: r.product.name, genericName: r.product.genericName ?? null } as any),
                },
                { header: 'Lote', accessor: (r) => r.batch?.batchNumber ?? '—' },
                {
                  header: 'Presentación',
                  accessor: (r) => {
                    if (!r.batch?.batchNumber) return 'Unidad'
                    const pres = parsePresentationFromBatchNumber(r.batch.batchNumber)
                    return pres ? `${pres.name} (${pres.unitsPerPresentation}u)` : 'Unidad'
                  }
                },
                {
                  header: 'Disponible',
                  accessor: (r) => {
                    const total = Number(r.quantity || '0')
                    const reserved = Number(r.reservedQuantity ?? '0')
                    const available = Math.max(0, total - reserved)
                    if (!r.batch?.batchNumber) return String(available)
                    const pres = parsePresentationFromBatchNumber(r.batch.batchNumber)
                    if (!pres) return String(available)
                    const unitsPerPres = Number(pres.unitsPerPresentation)
                    if (!Number.isFinite(unitsPerPres) || unitsPerPres <= 0) return String(available)
                    const availPres = available / unitsPerPres
                    return Number.isInteger(availPres) ? String(availPres) : availPres.toFixed(2)
                  },
                },
                {
                  header: 'Cantidad a mover',
                  accessor: (r) => {
                    const total = Number(r.quantity || '0')
                    const reserved = Number(r.reservedQuantity ?? '0')
                    const available = Math.max(0, total - reserved)
                    const disabled = !selectedRowIds[r.id]
                    let placeholder = String(available)
                    let maxValue = available
                    if (r.batch?.batchNumber) {
                      const pres = parsePresentationFromBatchNumber(r.batch.batchNumber)
                      if (pres) {
                        const unitsPerPres = Number(pres.unitsPerPresentation)
                        if (Number.isFinite(unitsPerPres) && unitsPerPres > 0) {
                          const availPres = available / unitsPerPres
                          placeholder = Number.isInteger(availPres) ? String(availPres) : availPres.toFixed(2)
                          maxValue = availPres
                        }
                      }
                    }
                    return (
                      <input
                        className="w-28 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                        type="number"
                        min={0}
                        max={maxValue}
                        disabled={disabled}
                        value={qtyByRowId[r.id] ?? ''}
                        placeholder={placeholder}
                        onChange={(e) => setQtyByRowId((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                    )
                  },
                },
              ]}
            />
          )}
        </div>
        </div>
      </PageContainer>
    </MainLayout>
  )
}
