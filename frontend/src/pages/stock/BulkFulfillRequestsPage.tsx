import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
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

type MovementRequestItem = {
  id: string
  productId: string
  productSku: string | null
  productName: string | null
  genericName: string | null
  remainingQuantity: number
  presentationId?: string | null
  presentationName?: string | null
  presentationQuantity?: number | null
}

type MovementRequest = {
  id: string
  status: 'OPEN' | 'FULFILLED' | 'CANCELLED'
  requestedCity: string
  requestedByName: string | null
  createdAt: string
  items: MovementRequestItem[]
}

type BulkFulfillResponse = {
  referenceType: string
  referenceId: string
  destinationCity: string
  createdMovements: Array<{ createdMovement: any; fromBalance: any; toBalance: any }>
  fulfilledRequestIds: string[]
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

async function listMovementRequests(token: string, city?: string): Promise<{ items: MovementRequest[] }> {
  const params = new URLSearchParams({ take: '100', status: 'OPEN' })
  if (city && city.trim()) params.set('city', city.trim())
  const response = await apiFetch<{ items: any[] }>(`/api/v1/stock/movement-requests?${params.toString()}`, { token })
  return {
    items: response.items.map((req: any) => ({
      id: req.id,
      status: req.status,
      requestedCity: req.requestedCity,
      requestedByName: req.requestedByName ?? null,
      createdAt: req.createdAt,
      items: (req.items ?? []).map((it: any) => ({
        id: it.id,
        productId: it.productId,
        productSku: it.productSku ?? null,
        productName: it.productName ?? null,
        genericName: it.genericName ?? null,
        remainingQuantity: Number(it.remainingQuantity ?? 0),
        presentationId: it.presentationId ?? null,
        presentationName: it.presentationName ?? null,
        presentationQuantity: it.presentationQuantity ? Number(it.presentationQuantity) : null,
      })),
    })),
  }
}

export function BulkFulfillRequestsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()

  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [fromLocationId, setFromLocationId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [note, setNote] = useState('')

  const [selectedRequestIds, setSelectedRequestIds] = useState<Record<string, boolean>>({})
  const [selectedStockRowIds, setSelectedStockRowIds] = useState<Record<string, boolean>>({})
  const [qtyByStockRowId, setQtyByStockRowId] = useState<Record<string, string>>({})

  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState<null | { referenceId: string; fulfilledCount: number }>(null)

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'bulkFulfill'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const activeWarehouses = useMemo(
    () => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive),
    [warehousesQuery.data?.items],
  )

  const fromLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'bulkFulfill', 'from', fromWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, fromWarehouseId),
    enabled: !!auth.accessToken && !!fromWarehouseId,
  })

  const toLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'bulkFulfill', 'to', toWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, toWarehouseId),
    enabled: !!auth.accessToken && !!toWarehouseId,
  })

  const destCity = useMemo(() => {
    const w = (warehousesQuery.data?.items ?? []).find((x) => x.id === toWarehouseId)
    return (w?.city ?? '').trim() || ''
  }, [warehousesQuery.data?.items, toWarehouseId])

  const requestsQuery = useQuery({
    queryKey: ['movementRequests', 'bulkFulfill', destCity],
    queryFn: () => listMovementRequests(auth.accessToken!, destCity),
    enabled: !!auth.accessToken && !!destCity,
    refetchInterval: 10_000,
  })

  const stockQuery = useQuery({
    queryKey: ['warehouseStock', 'bulkFulfill', fromWarehouseId],
    queryFn: () => fetchWarehouseStock(auth.accessToken!, fromWarehouseId),
    enabled: !!auth.accessToken && !!fromWarehouseId,
  })

  const selectedRequests = useMemo(() => {
    return (requestsQuery.data?.items ?? []).filter((r) => selectedRequestIds[r.id])
  }, [requestsQuery.data?.items, selectedRequestIds])

  const neededByProduct = useMemo(() => {
    const map = new Map<string, { productId: string; sku: string | null; name: string | null; genericName: string | null; presentationId: string | null; presentationName: string | null; presentationQuantity: number | null; needed: number }>()
    for (const req of selectedRequests) {
      for (const it of req.items) {
        const key = `${it.productId}-${it.presentationId ?? 'null'}`
        const prev = map.get(key)
        const needed = (prev?.needed ?? 0) + Number(it.remainingQuantity ?? 0)
        map.set(key, {
          productId: it.productId,
          sku: it.productSku,
          name: it.productName,
          genericName: it.genericName,
          presentationId: it.presentationId ?? null,
          presentationName: it.presentationName ?? null,
          presentationQuantity: it.presentationQuantity ?? null,
          needed,
        })
      }
    }
    return [...map.values()].sort((a, b) => b.needed - a.needed)
  }, [selectedRequests])

  const filteredStock = useMemo(() => {
    const items = stockQuery.data?.items ?? []
    if (!fromLocationId) return []
    const productIds = new Set(neededByProduct.map((n) => n.productId))
    return items.filter((r) => r.locationId === fromLocationId && productIds.has(r.productId))
  }, [stockQuery.data?.items, fromLocationId, neededByProduct])

  const selectedStockRows = useMemo(() => {
    return filteredStock.filter((r) => selectedStockRowIds[r.id])
  }, [filteredStock, selectedStockRowIds])

  const bulkFulfillMutation = useMutation({
    mutationFn: async (): Promise<BulkFulfillResponse> => {
      if (!fromWarehouseId || !fromLocationId) throw new Error('Selecciona almacén y ubicación de origen')
      if (!toWarehouseId || !toLocationId) throw new Error('Selecciona almacén y ubicación destino (sucursal)')

      const requestIds = selectedRequests.map((r) => r.id)
      if (requestIds.length <= 0) throw new Error('Selecciona al menos una solicitud OPEN')

      const lines = selectedStockRows.map((r) => {
        const total = Number(r.quantity || '0')
        const reserved = Number(r.reservedQuantity ?? '0')
        const available = Math.max(0, total - reserved)

        // Get presentation units
        const pres = r.batch?.batchNumber ? parsePresentationFromBatchNumber(r.batch.batchNumber) : null
        const unitsPerPres = pres ? Number(pres.unitsPerPresentation) : 1
        if (!Number.isFinite(unitsPerPres) || unitsPerPres <= 0) throw new Error('Presentación inválida')

        const qtyRaw = (qtyByStockRowId[r.id] ?? '').trim()
        let qtyInPres = qtyRaw ? Number(qtyRaw) : (available / unitsPerPres)
        if (!Number.isFinite(qtyInPres) || qtyInPres <= 0) throw new Error('Cantidad inválida en una fila seleccionada')

        const qtyInUnits = qtyInPres * unitsPerPres
        if (qtyInUnits > available + 1e-9) throw new Error('Una fila supera la cantidad disponible')

        return {
          productId: r.productId,
          batchId: r.batchId,
          fromLocationId: r.locationId,
          quantity: qtyInUnits,
        }
      })

      if (lines.length <= 0) throw new Error('Selecciona al menos un lote/producto para enviar')

      return apiFetch('/api/v1/stock/movement-requests/bulk-fulfill', {
        token: auth.accessToken!,
        method: 'POST',
        body: JSON.stringify({
          requestIds,
          fromLocationId,
          toLocationId,
          note: note.trim() || undefined,
          lines,
        }),
      })
    },
    onMutate: () => {
      setSubmitError('')
      setSubmitSuccess(null)
    },
    onSuccess: (data) => {
      setSubmitSuccess({ referenceId: data.referenceId, fulfilledCount: data.fulfilledRequestIds.length })
      setSelectedRequestIds({})
      setSelectedStockRowIds({})
      setQtyByStockRowId({})
    },
    onError: (e: any) => {
      setSubmitError(e?.message || 'Error')
    },
  })

  const canSubmit = !!fromLocationId && !!toLocationId && selectedRequests.length > 0 && selectedStockRows.length > 0

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="✅ Atender múltiples solicitudes">
        <MovementQuickActions currentPath="/stock/fulfill-requests" />
        <div className="mb-4 text-sm text-slate-700 dark:text-slate-300">
          Selecciona solicitudes OPEN de una sucursal y envía stock desde un origen.
        </div>

        <div className="grid gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              label="Almacén origen"
              value={fromWarehouseId}
              onChange={(e) => {
                setFromWarehouseId(e.target.value)
                setFromLocationId('')
                setSelectedStockRowIds({})
                setQtyByStockRowId({})
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
                setSelectedStockRowIds({})
                setQtyByStockRowId({})
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
              label="Sucursal destino"
              value={toWarehouseId}
              onChange={(e) => {
                setToWarehouseId(e.target.value)
                setToLocationId('')
                setSelectedRequestIds({})
              }}
              options={[
                { value: '', label: 'Selecciona sucursal' },
                ...activeWarehouses
                  .filter((w) => w.id !== fromWarehouseId)
                  .map((w) => ({ value: w.id, label: `${w.code} - ${w.name}${w.city ? ` (${w.city})` : ''}` })),
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
            <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: Atención de pedidos SCZ" />
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={() => bulkFulfillMutation.mutate()} disabled={!canSubmit} loading={bulkFulfillMutation.isPending}>
              Enviar y aplicar a solicitudes
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedRequestIds({})
                setSelectedStockRowIds({})
                setQtyByStockRowId({})
                setSubmitError('')
                setSubmitSuccess(null)
              }}
              disabled={bulkFulfillMutation.isPending}
            >
              Limpiar
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

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 text-sm text-slate-700 dark:text-slate-300">Solicitudes OPEN {destCity ? `(${destCity})` : ''}</div>
            {!destCity ? (
              <EmptyState message="Selecciona sucursal destino para cargar solicitudes" />
            ) : requestsQuery.isLoading ? (
              <Loading />
            ) : requestsQuery.error ? (
              <ErrorState message="Error cargando solicitudes" retry={requestsQuery.refetch} />
            ) : (requestsQuery.data?.items ?? []).length === 0 ? (
              <EmptyState message="No hay solicitudes OPEN para esta sucursal" />
            ) : (
              <Table
                data={requestsQuery.data!.items}
                keyExtractor={(r) => r.id}
                columns={[
                  {
                    header: '✓',
                    className: 'w-12',
                    accessor: (r) => (
                      <input
                        type="checkbox"
                        checked={!!selectedRequestIds[r.id]}
                        onChange={(e) => setSelectedRequestIds((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                      />
                    ),
                  },
                  { header: 'Solicitante', accessor: (r) => r.requestedByName ?? '—' },
                  { header: 'Items', accessor: (r) => String(r.items.length) },
                  { header: 'Creada', accessor: (r) => new Date(r.createdAt).toLocaleString() },
                ]}
              />
            )}

            <div className="mt-4">
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">Necesidad (seleccionadas)</div>
              {selectedRequests.length === 0 ? (
                <div className="text-sm text-slate-600 dark:text-slate-400">Selecciona solicitudes para ver lo necesario.</div>
              ) : neededByProduct.length === 0 ? (
                <div className="text-sm text-slate-600 dark:text-slate-400">Sin items pendientes.</div>
              ) : (
                <Table
                  data={neededByProduct}
                  keyExtractor={(r) => `${r.productId}-${r.presentationId ?? 'null'}`}
                  columns={[
                    {
                      header: 'Producto',
                      accessor: (r) => (
                        <div>
                          <div>{r.name ?? '—'}</div>
                          <div className="text-xs text-slate-500">{r.sku ?? '—'}</div>
                        </div>
                      ),
                    },
                    {
                      header: 'Presentación',
                      accessor: (r) => r.presentationName ?? 'Unidad',
                    },
                    {
                      header: 'Solicitado',
                      accessor: (r) => String(r.needed),
                    },
                  ]}
                />
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 text-sm text-slate-700 dark:text-slate-300">Stock origen (selecciona filas y cantidades)</div>
            {!fromWarehouseId || !fromLocationId ? (
              <EmptyState message="Selecciona almacén y ubicación origen" />
            ) : stockQuery.isLoading ? (
              <Loading />
            ) : stockQuery.error ? (
              <ErrorState message="Error cargando stock" retry={stockQuery.refetch} />
            ) : filteredStock.length === 0 ? (
              <EmptyState message="Sin stock en esta ubicación" />
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
                        checked={!!selectedStockRowIds[r.id]}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setSelectedStockRowIds((prev) => ({ ...prev, [r.id]: checked }))
                          if (!checked) {
                            setQtyByStockRowId((prev) => {
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
                    accessor: (r) => {
                      const isSuggested = (() => {
                        if (!r.batch?.batchNumber) return false
                        const batchPres = parsePresentationFromBatchNumber(r.batch.batchNumber)
                        if (!batchPres) return false
                        return neededByProduct.some((n) => n.presentationName === batchPres.name && n.presentationQuantity === Number(batchPres.unitsPerPresentation))
                      })()
                      return (
                        <div className="flex items-center gap-2">
                          {isSuggested && <span className="text-yellow-500">⭐</span>}
                          <div>
                            <div>{r.product.name}</div>
                            <div className="text-xs text-slate-500">{r.product.sku}</div>
                          </div>
                        </div>
                      )
                    },
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
                    header: 'Cantidad',
                    accessor: (r) => {
                      const total = Number(r.quantity || '0')
                      const reserved = Number(r.reservedQuantity ?? '0')
                      const available = Math.max(0, total - reserved)
                      const disabled = !selectedStockRowIds[r.id]
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
                          value={qtyByStockRowId[r.id] ?? ''}
                          placeholder={placeholder}
                          onChange={(e) => setQtyByStockRowId((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        />
                      )
                    },
                  },
                ]}
              />
            )}
          </div>
        </div>
        </div>
      </PageContainer>
    </MainLayout>
  )
}
