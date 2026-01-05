import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Input, Select, Table, Loading, ErrorState } from '../../components'
import { useNavigation } from '../../hooks'

type ProductListItem = {
  id: string
  sku: string
  name: string
  isActive: boolean
}

type ListResponse = { items: ProductListItem[]; nextCursor: string | null }

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

type ProductBatchListItem = {
  id: string
  batchNumber: string
  expiresAt: string | null
  manufacturingDate: string | null
  status: string
  totalQuantity: string | null
  locations: {
    warehouseId: string
    warehouseCode: string
    warehouseName: string
    locationId: string
    locationCode: string
    quantity: string
  }[]
}

type ProductBatchesResponse = { items: ProductBatchListItem[]; hasStockRead: boolean }

async function fetchProducts(token: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: '50' })
  return apiFetch(`/api/v1/products?${params}`, { token })
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch(`/api/v1/warehouses?take=50`, { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  return apiFetch(`/api/v1/warehouses/${warehouseId}/locations?take=100`, { token })
}

async function listProductBatches(token: string, productId: string): Promise<ProductBatchesResponse> {
  return apiFetch(`/api/v1/products/${productId}/batches?take=100`, { token })
}

async function createMovement(
  token: string,
  data: {
    type: string
    productId: string
    batchId?: string
    fromLocationId?: string
    toLocationId?: string
    quantity: string
    referenceType?: string
    referenceId?: string
    note?: string
  },
): Promise<any> {
  return apiFetch(`/api/v1/stock/movements`, {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

export function MovementsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()

  const [type, setType] = useState('IN')
  const [productId, setProductId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')

  // UX helpers
  const [selectedStockKey, setSelectedStockKey] = useState('')

  const productsQuery = useQuery({
    queryKey: ['products', 'forMovements'],
    queryFn: () => fetchProducts(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const productBatchesQuery = useQuery({
    queryKey: ['productBatches', 'forMovements', productId],
    queryFn: () => listProductBatches(auth.accessToken!, productId),
    enabled: !!auth.accessToken && !!productId,
  })

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'forMovements'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken && (type === 'IN' || type === 'TRANSFER'),
  })

  const locationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'forMovements', toWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, toWarehouseId),
    enabled: !!auth.accessToken && !!toWarehouseId && (type === 'IN' || type === 'TRANSFER'),
  })

  const movementMutation = useMutation({
    mutationFn: (data: any) => createMovement(auth.accessToken!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      alert('Movimiento creado exitosamente')
      // Reset form
      setProductId('')
      setBatchId('')
      setToLocationId('')
      setToWarehouseId('')
      setQuantity('')
      setNote('')
      setSelectedStockKey('')
    },
  })

  const handleTypeChange = (nextType: string) => {
    setType(nextType)
    // Reset fields that depend on the movement type
    setBatchId('')
    setToLocationId('')
    setToWarehouseId('')
    setSelectedStockKey('')
  }

  const handleProductChange = (nextProductId: string) => {
    setProductId(nextProductId)
    setBatchId('')
    setToLocationId('')
    setToWarehouseId('')
    setSelectedStockKey('')
  }

  // If there is only one active product, auto-select it so stock loads.
  useEffect(() => {
    if (productId) return
    const activeProducts = (productsQuery.data?.items ?? []).filter((p) => p.isActive)
    if (activeProducts.length === 1) {
      handleProductChange(activeProducts[0]!.id)
    }
  }, [productsQuery.data, productId])

  // If there is only one active warehouse (for IN/TRANSFER), auto-select it.
  useEffect(() => {
    if (!(type === 'IN' || type === 'TRANSFER')) return
    if (toWarehouseId) return
    const activeWarehouses = (warehousesQuery.data?.items ?? []).filter((w) => w.isActive)
    if (activeWarehouses.length === 1) {
      setToWarehouseId(activeWarehouses[0]!.id)
    }
  }, [type, warehousesQuery.data, toWarehouseId])

  // If there is only one active destination location (for IN/TRANSFER), auto-select it.
  useEffect(() => {
    if (!(type === 'IN' || type === 'TRANSFER')) return
    if (toLocationId) return
    const activeLocations = (locationsQuery.data?.items ?? []).filter((l) => l.isActive)
    if (activeLocations.length === 1) {
      setToLocationId(activeLocations[0]!.id)
    }
  }, [type, locationsQuery.data, toLocationId])

  const stockOptions = (() => {
    const data = productBatchesQuery.data
    if (!data?.hasStockRead) return [] as { value: string; label: string }[]

    const opts: { value: string; label: string }[] = []
    for (const b of data.items) {
      for (const loc of b.locations ?? []) {
        const qty = Number(loc.quantity ?? '0')
        if (!Number.isFinite(qty) || qty <= 0) continue
        const exp = b.expiresAt ? new Date(b.expiresAt).toLocaleDateString() : '-'
        opts.push({
          value: `${b.id}::${loc.locationId}`,
          label: `${b.batchNumber} · Vence ${exp} · Qty ${loc.quantity} · ${loc.warehouseCode}/${loc.locationCode}`,
        })
      }
    }
    return opts
  })()

  const stockRows = (() => {
    const data = productBatchesQuery.data
    if (!data?.hasStockRead) return [] as Array<{
      id: string
      batchNumber: string
      expiresAt: string | null
      quantity: string
      warehouseName: string
      warehouseCode: string
      locationCode: string
    }>

    const rows: Array<{
      id: string
      batchNumber: string
      expiresAt: string | null
      quantity: string
      warehouseName: string
      warehouseCode: string
      locationCode: string
    }> = []

    for (const b of data.items) {
      for (const loc of b.locations ?? []) {
        rows.push({
          id: `${b.id}:${loc.locationId}`,
          batchNumber: b.batchNumber,
          expiresAt: b.expiresAt,
          quantity: loc.quantity,
          warehouseName: loc.warehouseName,
          warehouseCode: loc.warehouseCode,
          locationCode: loc.locationCode,
        })
      }
    }

    // Show positive stock first
    rows.sort((a, b) => Number(b.quantity) - Number(a.quantity))
    return rows
  })()

  const batchOptions = (() => {
    const data = productBatchesQuery.data
    if (!data) return [] as { value: string; label: string }[]
    return data.items.map((b) => {
      const exp = b.expiresAt ? new Date(b.expiresAt).toLocaleDateString() : '-'
      return { value: b.id, label: `${b.batchNumber} · Vence ${exp}` }
    })
  })()

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()

    const payload: any = {
      type,
      productId,
      quantity,
      note: note || undefined,
    }

    if (type === 'IN') {
      payload.batchId = batchId || undefined
      payload.toLocationId = toLocationId || undefined
    } else {
      if (!selectedStockKey) return
      const [bId, locId] = selectedStockKey.split('::')
      if (!bId || !locId) return
      payload.batchId = bId
      payload.fromLocationId = locId

      if (type === 'TRANSFER') {
        payload.toLocationId = toLocationId || undefined
      }
    }

    movementMutation.mutate(payload)
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Crear Movimiento de Stock">
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Select
              label="Tipo de Movimiento"
              value={type}
              onChange={(e) => handleTypeChange(e.target.value)}
              options={[
                { value: 'IN', label: 'Entrada (IN)' },
                { value: 'OUT', label: 'Salida (OUT)' },
                { value: 'TRANSFER', label: 'Transferencia (TRANSFER)' },
                { value: 'ADJUSTMENT', label: 'Ajuste (ADJUSTMENT)' },
              ]}
              disabled={movementMutation.isPending}
            />
            <Select
              label="Producto"
              value={productId}
              onChange={(e) => handleProductChange(e.target.value)}
              options={(productsQuery.data?.items ?? [])
                .filter((p) => p.isActive)
                .map((p) => ({ value: p.id, label: `${p.sku} - ${p.name}` }))}
              disabled={movementMutation.isPending || productsQuery.isLoading}
            />

            {!!productId && (
              <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">Existencias</div>

                {productBatchesQuery.isLoading && <Loading />}
                {productBatchesQuery.error && (
                  <ErrorState
                    message={productBatchesQuery.error instanceof Error ? productBatchesQuery.error.message : 'Error cargando existencias'}
                    retry={productBatchesQuery.refetch}
                  />
                )}

                {productBatchesQuery.data && !productBatchesQuery.data.hasStockRead && (
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    No tenés permiso `stock:read`, por eso no se pueden listar existencias por lote.
                  </div>
                )}

                {productBatchesQuery.data?.hasStockRead && stockRows.length === 0 && (
                  <div className="text-sm text-slate-600 dark:text-slate-400">No hay existencias para este producto.</div>
                )}

                {productBatchesQuery.data?.hasStockRead && stockRows.length > 0 && (
                  <Table
                    columns={[
                      { header: 'Lote', accessor: (r) => r.batchNumber },
                      { header: 'Vence', accessor: (r) => (r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : '-') },
                      { header: 'Cantidad', accessor: (r) => r.quantity },
                      { header: 'Sucursal', accessor: (r) => `${r.warehouseCode} - ${r.warehouseName}` },
                      { header: 'Ubicación', accessor: (r) => r.locationCode },
                    ]}
                    data={stockRows}
                    keyExtractor={(r) => r.id}
                  />
                )}
              </div>
            )}

            {type === 'IN' && (
              <Select
                label="Lote"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                options={batchOptions}
                disabled={movementMutation.isPending || productBatchesQuery.isLoading || !productId}
              />
            )}

            {(type === 'OUT' || type === 'TRANSFER' || type === 'ADJUSTMENT') && (
              <Select
                label="Existencias (lote / sucursal)"
                value={selectedStockKey}
                onChange={(e) => {
                  const key = e.target.value
                  setSelectedStockKey(key)
                  const bId = key.split('::')[0] ?? ''
                  setBatchId(bId)
                }}
                options={stockOptions}
                disabled={
                  movementMutation.isPending ||
                  productBatchesQuery.isLoading ||
                  !productId ||
                  !productBatchesQuery.data?.hasStockRead
                }
              />
            )}

            {(type === 'IN' || type === 'TRANSFER') && (
              <>
                <Select
                  label="Sucursal/Almacén destino"
                  value={toWarehouseId}
                  onChange={(e) => {
                    setToWarehouseId(e.target.value)
                    setToLocationId('')
                  }}
                  options={(warehousesQuery.data?.items ?? [])
                    .filter((w) => w.isActive)
                    .map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))}
                  disabled={movementMutation.isPending || warehousesQuery.isLoading}
                />
                <Select
                  label="Ubicación destino"
                  value={toLocationId}
                  onChange={(e) => setToLocationId(e.target.value)}
                  options={(locationsQuery.data?.items ?? [])
                    .filter((l) => l.isActive)
                    .map((l) => ({ value: l.id, label: l.code }))}
                  disabled={movementMutation.isPending || !toWarehouseId || locationsQuery.isLoading}
                />
              </>
            )}

            <Input
              label="Cantidad"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
              disabled={movementMutation.isPending}
              placeholder="0"
            />
            <Input
              label="Nota (opcional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={movementMutation.isPending}
              placeholder="Descripción del movimiento"
            />
            <div className="flex gap-2">
              <Button type="submit" loading={movementMutation.isPending}>
                Crear Movimiento
              </Button>
              {movementMutation.error && (
                <span className="text-sm text-red-600">
                  {movementMutation.error instanceof Error ? movementMutation.error.message : 'Error'}
                </span>
              )}
            </div>
          </form>
        </div>
      </PageContainer>
    </MainLayout>
  )
}
