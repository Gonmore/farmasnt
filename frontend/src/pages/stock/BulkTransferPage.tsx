import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getProductLabel } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { usePermissions } from '../../hooks/usePermissions'
import { useNavigation } from '../../hooks'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, Button, Input, Select, Modal } from '../../components'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { exportPickingToPdf, exportLabelToPdf } from '../../lib/movementRequestDocsPdf'

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
  const tenant = useTenant()
  const permissions = usePermissions()
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
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [labelBultos, setLabelBultos] = useState('')
  const [labelResponsable, setLabelResponsable] = useState('')
  const [labelObservaciones, setLabelObservaciones] = useState('')

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

  const isBranchScoped = permissions.hasPermission('scope:branch')

  useEffect(() => {
    const wid = permissions.user?.warehouseId ?? ''
    if (!wid) return
    if (fromWarehouseId) return
    if (!activeWarehouses.some((w) => w.id === wid)) return
    setFromWarehouseId(wid)
    setFromLocationId('')
  }, [permissions.user?.warehouseId, activeWarehouses, fromWarehouseId])

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
      setIsConfirmModalOpen(false)

      // Generate picking PDF
      const fromWarehouse = activeWarehouses.find(w => w.id === fromWarehouseId)
      const toWarehouse = activeWarehouses.find(w => w.id === toWarehouseId)
      const fromLocation = fromLocationsQuery.data?.items.find(l => l.id === fromLocationId)
      const toLocation = toLocationsQuery.data?.items.find(l => l.id === toLocationId)

      exportPickingToPdf(
        {
          requestId: data.referenceId,
          generatedAtIso: new Date().toISOString(),
          fromWarehouseLabel: fromWarehouse ? `${fromWarehouse.code} - ${fromWarehouse.name}` : '—',
          fromLocationCode: fromLocation?.code ?? '—',
          toWarehouseLabel: toWarehouse ? `${toWarehouse.code} - ${toWarehouse.name}` : '—',
          toLocationCode: toLocation?.code ?? '—',
          requestedByName: permissions.user?.fullName ?? null,
        },
        [],
        data.items.map((item: any) => {
          const pres = parsePresentationFromBatchNumber(String(item.createdMovement.batch?.batchNumber ?? ''))
          const presentationLabel = pres ? `${pres.name} (${pres.unitsPerPresentation}u)` : '—'
          return {
            locationCode: fromLocation?.code ?? '—',
            productLabel: getProductLabel({
              sku: item.createdMovement.product?.sku ?? '—',
              name: item.createdMovement.product?.name ?? '—',
              genericName: null,
            }),
            batchNumber: item.createdMovement.batch?.batchNumber ?? null,
            expiresAt: item.createdMovement.batch?.expiresAt ?? null,
            quantityUnits: Number(item.createdMovement.quantity ?? 0),
            presentationLabel,
          }
        }),
      )

      // Generate label PDF
      const country = tenant.branding?.country ?? 'BOLIVIA'
      exportLabelToPdf({
        requestId: data.referenceId,
        generatedAtIso: new Date().toISOString(),
        fromWarehouseLabel: fromWarehouse?.city ? `${fromWarehouse.city}, ${country}` : country,
        fromLocationCode: fromLocation?.code ?? '—',
        toWarehouseLabel: toWarehouse?.city ? `${toWarehouse.city}, ${country}` : country,
        toLocationCode: toLocation?.code ?? '—',
        requestedByName: permissions.user?.fullName ?? null,
        bultos: labelBultos,
        responsable: labelResponsable,
        observaciones: labelObservaciones,
      })

      // Reset label fields
      setLabelBultos('')
      setLabelResponsable('')
      setLabelObservaciones('')

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
      // Don't close modal on error so user can see the error and retry
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
              disabled={warehousesQuery.isLoading || isBranchScoped}
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
            <Button onClick={() => setIsConfirmModalOpen(true)} disabled={!canSubmit}>
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

        <Modal isOpen={isConfirmModalOpen} onClose={() => setIsConfirmModalOpen(false)} title="Confirmar Transferencia" maxWidth="lg">
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 p-4 text-sm dark:border-slate-700">
              <div className="mb-2 text-slate-900 dark:text-slate-100">
                <span className="font-medium">Origen:</span>{' '}
                {activeWarehouses.find(w => w.id === fromWarehouseId)?.name ?? '—'} ·{' '}
                {fromLocationsQuery.data?.items.find(l => l.id === fromLocationId)?.code ?? '—'}
              </div>
              <div className="mb-2 text-slate-700 dark:text-slate-300">
                <span className="font-medium">Destino:</span>{' '}
                {activeWarehouses.find(w => w.id === toWarehouseId)?.name ?? '—'} ·{' '}
                {toLocationsQuery.data?.items.find(l => l.id === toLocationId)?.code ?? '—'}
              </div>
              <div className="text-slate-700 dark:text-slate-300">
                <span className="font-medium">Productos seleccionados:</span> {selectedCount}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Bultos" value={labelBultos} onChange={(e) => setLabelBultos(e.target.value)} placeholder="Ej: 3" />
              <Input
                label="Responsable"
                value={labelResponsable}
                onChange={(e) => setLabelResponsable(e.target.value)}
                placeholder="Ej: Juan Pérez"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Observaciones</label>
              <textarea
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                rows={3}
                value={labelObservaciones}
                onChange={(e) => setLabelObservaciones(e.target.value)}
                placeholder="Opcional"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => bulkTransferMutation.mutate()}
                loading={bulkTransferMutation.isPending}
                disabled={!labelResponsable.trim()}
              >
                Confirmar transferencia
              </Button>
              <Button variant="secondary" onClick={() => setIsConfirmModalOpen(false)} disabled={bulkTransferMutation.isPending}>
                Cancelar
              </Button>
            </div>

            {submitError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                {submitError}
              </div>
            )}
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
