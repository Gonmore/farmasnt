import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Button, Modal, Input, Select, Loading, ErrorState, EmptyState } from '../../components'
import { useNavigation } from '../../hooks'
import { getProductLabel } from '../../lib/productName'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { EyeIcon } from '@heroicons/react/24/outline'

type WarehouseListItem = {
  id: string
  code: string
  name: string
  city?: string | null
  isActive: boolean
}

type LocationListItem = {
  id: string
  warehouseId: string
  code: string
  isActive: boolean
}

type ProductListItem = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  isActive: boolean
}

type ProductPresentation = {
  id: string
  name: string
  unitsPerPresentation: string
  isDefault?: boolean
  isActive?: boolean
}

type ProductBatch = {
  id: string
  batchNumber: string
  expiresAt: string | null
  status: string
}

type StockReturnItem = {
  id: string
  productId: string
  sku: string | null
  name: string | null
  genericName: string | null
  batchId: string | null
  batchNumber: string | null
  expiresAt: string | null
  quantity: string
  presentationId: string | null
  presentationName: string | null
  unitsPerPresentation: string | null
  presentationQuantity: string | null
}

type StockReturn = {
  id: string
  reason: string
  note: string | null
  photoUrl: string | null
  createdAt: string
  toLocation: {
    id: string
    code: string
    warehouse: { id: string; code: string | null; name: string | null; city: string | null }
  }
  items: StockReturnItem[]
}

async function listSentMovementRequests(token: string): Promise<{ items: any[] }> {
  const params = new URLSearchParams({ take: '50', status: 'SENT' })
  return apiFetch(`/api/v1/stock/movement-requests?${params.toString()}`, { token })
}

async function listReturns(token: string): Promise<{ items: StockReturn[] }> {
  return apiFetch('/api/v1/stock/returns?take=50', { token })
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch('/api/v1/warehouses?take=100', { token })
}

async function listLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  return apiFetch(`/api/v1/warehouses/${encodeURIComponent(warehouseId)}/locations?take=100`, { token })
}

async function fetchProducts(token: string): Promise<{ items: ProductListItem[] }> {
  return apiFetch('/api/v1/products?take=200', { token })
}

async function fetchProductPresentations(token: string, productId: string): Promise<{ items: ProductPresentation[] }> {
  return apiFetch(`/api/v1/products/${encodeURIComponent(productId)}/presentations`, { token })
}

async function fetchProductBatches(token: string, productId: string): Promise<{ items: ProductBatch[] }> {
  return apiFetch(`/api/v1/products/${encodeURIComponent(productId)}/batches?take=50`, { token })
}

async function presignReturnPhoto(token: string, fileName: string, contentType: string): Promise<{ uploadUrl: string; publicUrl: string; key: string; method: string }> {
  return apiFetch('/api/v1/stock/returns/photo-upload', {
    token,
    method: 'POST',
    body: JSON.stringify({ fileName, contentType }),
  })
}

async function uploadToPresignedUrl(uploadUrl: string, file: File, contentType: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  })
  if (!res.ok) throw new Error('No se pudo subir la foto')
}

async function confirmReception(token: string, requestId: string): Promise<{ message: string }> {
  return apiFetch(`/api/v1/stock/movement-requests/${encodeURIComponent(requestId)}/receive`, {
    token,
    method: 'POST',
  })
}

async function createReturn(
  token: string,
  input: {
    toLocationId: string
    reason: string
    photoKey: string
    photoUrl: string
    note?: string
    items: Array<{ productId: string; batchId?: string | null; presentationId?: string; presentationQuantity?: number; quantity?: number; note?: string }>
  },
): Promise<{ id: string; createdAt: string }> {
  return apiFetch('/api/v1/stock/returns', {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function ReturnsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()

  const returnsQuery = useQuery({
    queryKey: ['stockReturns'],
    queryFn: () => listReturns(auth.accessToken!),
    enabled: !!auth.accessToken,
    refetchInterval: 15_000,
  })

  const sentRequestsQuery = useQuery({
    queryKey: ['sentMovementRequests'],
    queryFn: () => listSentMovementRequests(auth.accessToken!),
    enabled: !!auth.accessToken,
    refetchInterval: 15_000,
  })

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'forReturns'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const productsQuery = useQuery({
    queryKey: ['products', 'forReturns'],
    queryFn: () => fetchProducts(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const activeWarehouses = useMemo(() => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive), [warehousesQuery.data])
  const activeProducts = useMemo(() => (productsQuery.data?.items ?? []).filter((p) => p.isActive), [productsQuery.data])

  const [activeTab, setActiveTab] = useState<'returns' | 'receptions'>('receptions')

  const [selectedRequest, setSelectedRequest] = useState<any>(null)

  const sortedReturns = useMemo(() => {
    const items = returnsQuery.data?.items ?? []
    return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [returnsQuery.data?.items])

  const sortedSentRequests = useMemo(() => {
    const items = sentRequestsQuery.data?.items ?? []
    return [...items].sort(
      (a, b) =>
        new Date(b.fulfilledAt || b.createdAt).getTime() - new Date(a.fulfilledAt || a.createdAt).getTime(),
    )
  }, [sentRequestsQuery.data?.items])

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [warehouseId, setWarehouseId] = useState('')
  const locationsQuery = useQuery({
    queryKey: ['locations', 'forReturns', warehouseId],
    queryFn: () => listLocations(auth.accessToken!, warehouseId),
    enabled: !!auth.accessToken && !!warehouseId,
  })
  const activeLocations = useMemo(() => (locationsQuery.data?.items ?? []).filter((l) => l.isActive), [locationsQuery.data])

  const [toLocationId, setToLocationId] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  const [photoFile, setPhotoFile] = useState<File | null>(null)

  // Add-item form
  const [itemProductId, setItemProductId] = useState('')
  const [itemBatchId, setItemBatchId] = useState<string>('')
  const [itemPresentationId, setItemPresentationId] = useState('')
  const [itemPresentationQty, setItemPresentationQty] = useState<number>(1)
  const [itemNote, setItemNote] = useState('')

  const itemPresentationsQuery = useQuery({
    queryKey: ['productPresentations', 'forReturnItem', itemProductId],
    queryFn: () => fetchProductPresentations(auth.accessToken!, itemProductId),
    enabled: !!auth.accessToken && !!itemProductId,
  })

  const itemBatchesQuery = useQuery({
    queryKey: ['productBatches', 'forReturnItem', itemProductId],
    queryFn: () => fetchProductBatches(auth.accessToken!, itemProductId),
    enabled: !!auth.accessToken && !!itemProductId,
  })

  const abbreviateCity = (city: string) => {
    if (!city) return '—'
    const upper = city.toUpperCase()
    if (upper.includes('COCHABAMBA')) return 'CBBA'
    if (upper.includes('LA PAZ')) return 'LPZ'
    if (upper.includes('SANTA CRUZ')) return 'SCZ'
    if (upper.includes('ORURO')) return 'ORU'
    if (upper.includes('POTOSI')) return 'PTS'
    if (upper.includes('SUCRE')) return 'SCR'
    if (upper.includes('TARIJA')) return 'TJA'
    if (upper.includes('PANDO')) return 'PND'
    if (upper.includes('BENI')) return 'BNI'
    return upper.slice(0, 3)
  }

  const activeItemPresentations = useMemo(
    () => (itemPresentationsQuery.data?.items ?? []).filter((p) => (p.isActive ?? true) === true),
    [itemPresentationsQuery.data],
  )

  const defaultPresentationId = useMemo(() => {
    const defaults = activeItemPresentations.filter((p) => p.isDefault)
    return (defaults[0]?.id ?? activeItemPresentations[0]?.id ?? '')
  }, [activeItemPresentations])

  const [items, setItems] = useState<Array<{ productId: string; batchId: string | null; presentationId: string | null; presentationQuantity: number | null; note?: string }>>([])

  const productById = useMemo(() => {
    const m = new Map<string, ProductListItem>()
    for (const p of activeProducts) m.set(p.id, p)
    return m
  }, [activeProducts])

  const addItem = () => {
    setCreateError(null)
    if (!itemProductId) {
      setCreateError('Seleccioná un producto')
      return
    }

    const p = productById.get(itemProductId)
    if (!p) {
      setCreateError('Producto inválido')
      return
    }

    const hasPresentations = activeItemPresentations.length > 0
    const presId = (itemPresentationId || defaultPresentationId || '').trim()

    if (hasPresentations && !presId) {
      setCreateError('Seleccioná una presentación')
      return
    }

    if (!Number.isFinite(itemPresentationQty) || itemPresentationQty <= 0) {
      setCreateError('Ingresá una cantidad válida')
      return
    }

    setItems((prev) => [
      ...prev,
      {
        productId: itemProductId,
        batchId: itemBatchId ? itemBatchId : null,
        presentationId: hasPresentations ? presId : null,
        presentationQuantity: hasPresentations ? itemPresentationQty : null,
        note: itemNote.trim() || undefined,
      },
    ])

    setItemBatchId('')
    setItemNote('')
    setItemPresentationQty(1)
  }

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      setCreateError(null)
      if (!toLocationId) throw new Error('Seleccioná la ubicación destino')
      if (!reason.trim()) throw new Error('Ingresá un motivo')
      if (!photoFile) throw new Error('Adjuntá una foto como evidencia')
      if (items.length === 0) throw new Error('Agregá al menos un ítem')

      const presign = await presignReturnPhoto(auth.accessToken!, photoFile.name, photoFile.type || 'image/jpeg')
      await uploadToPresignedUrl(presign.uploadUrl, photoFile, photoFile.type || 'image/jpeg')

      return createReturn(auth.accessToken!, {
        toLocationId,
        reason: reason.trim(),
        note: note.trim() || undefined,
        photoKey: presign.key,
        photoUrl: presign.publicUrl,
        items: items.map((it) => ({
          productId: it.productId,
          batchId: it.batchId ?? undefined,
          ...(it.presentationId && it.presentationQuantity
            ? { presentationId: it.presentationId, presentationQuantity: it.presentationQuantity }
            : { quantity: 1 }),
          note: it.note,
        })),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['stockReturns'] })
      setShowCreateModal(false)
      setCreateError(null)
      setWarehouseId('')
      setToLocationId('')
      setReason('')
      setNote('')
      setPhotoFile(null)
      setItemProductId('')
      setItemBatchId('')
      setItemPresentationId('')
      setItemPresentationQty(1)
      setItemNote('')
      setItems([])
    },
    onError: (e: any) => {
      setCreateError(e?.message ?? 'Error al crear devolución')
    },
  })

  const confirmReceptionMutation = useMutation({
    mutationFn: (requestId: string) => confirmReception(auth.accessToken!, requestId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sentMovementRequests'] })
      await queryClient.invalidateQueries({ queryKey: ['movement-requests'] })
    },
  })

  const columns = useMemo(
    () => [
      { header: 'Fecha', width: '170px', accessor: (r: any) => new Date(r.createdAt).toLocaleString() },
      { header: 'Sucursal', accessor: (r: any) => r.toLocation?.warehouse?.name ?? r.toLocation?.warehouse?.code ?? '-' },
      { header: 'Ubicación', width: '120px', accessor: (r: any) => r.toLocation?.code ?? '-' },
      { header: 'Ítems', width: '80px', accessor: (r: any) => (r.items?.length ?? 0) },
      { header: 'Motivo', accessor: (r: any) => r.reason },
      {
        header: 'Evidencia',
        width: '110px',
        accessor: (r: any) =>
          r.photoUrl ? (
            <a className="text-blue-600 underline" href={r.photoUrl} target="_blank" rel="noreferrer">
              Ver foto
            </a>
          ) : (
            '-'
          ),
      },
    ],
    [],
  )

  const receptionModal = selectedRequest ? (
    <Modal
      isOpen={!!selectedRequest}
      onClose={() => setSelectedRequest(null)}
      title="📦 Detalle del envío"
      maxWidth="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100">Origen</div>
            <div className="text-slate-600 dark:text-slate-400">
              {selectedRequest.originWarehouse?.city
                ? abbreviateCity(selectedRequest.originWarehouse.city)
                : selectedRequest.originWarehouse?.code?.replace(/^SUC-/, '') ?? '-'}
            </div>
          </div>
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100">Destino</div>
            <div className="text-slate-600 dark:text-slate-400">
              {selectedRequest.warehouse?.city
                ? abbreviateCity(selectedRequest.warehouse.city)
                : selectedRequest.requestedCity
                  ? abbreviateCity(selectedRequest.requestedCity)
                  : selectedRequest.warehouse?.code?.replace(/^SUC-/, '') ?? '-'}
            </div>
          </div>
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100">Solicitante</div>
            <div className="text-slate-600 dark:text-slate-400">{selectedRequest.requestedByName ?? '-'}</div>
          </div>
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100">Enviado por</div>
            <div className="text-slate-600 dark:text-slate-400">{selectedRequest.fulfilledByName ?? '-'}</div>
          </div>
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100">Fecha envío</div>
            <div className="text-slate-600 dark:text-slate-400">{new Date(selectedRequest.fulfilledAt || selectedRequest.createdAt).toLocaleString()}</div>
          </div>
        </div>

        <div>
          <div className="font-medium text-slate-900 dark:text-slate-100 mb-2">Productos enviados</div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {selectedRequest.movements?.map((movement: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded">
                <div className="flex-1">
                  <div className="font-medium">{getProductLabel(movement)}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400 grid grid-cols-2 gap-2 mt-1">
                    <div><strong>Presentación:</strong> {movement.presentation?.name ?? '-'}</div>
                    <div><strong>Cantidad:</strong> {movement.quantity}</div>
                    <div><strong>Lote:</strong> {movement.batch?.batchNumber ?? '-'}</div>
                    <div><strong>Vencimiento:</strong> {movement.batch?.expiresAt ? new Date(movement.batch.expiresAt).toLocaleDateString() : '-'}</div>
                  </div>
                </div>
              </div>
            )) || (
              <div className="text-sm text-slate-500">No hay información detallada de envío disponible</div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => setSelectedRequest(null)}>
            Cerrar
          </Button>
          <Button 
            onClick={() => {
              confirmReceptionMutation.mutate(selectedRequest.id)
              setSelectedRequest(null)
            }} 
            disabled={confirmReceptionMutation.isPending}
          >
            {confirmReceptionMutation.isPending ? 'Confirmando…' : '✅ Confirmar recepción'}
          </Button>
        </div>
      </div>
    </Modal>
  ) : null

  const createModal = (
    <Modal
      isOpen={showCreateModal}
      onClose={() => {
        if (createMutation.isPending) return
        setShowCreateModal(false)
      }}
      title="➕ Registrar devolución"
      maxWidth="lg"
    >
      <div className="space-y-3">
        {createError && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{createError}</div>}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            label="Sucursal"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value)
              setToLocationId('')
            }}
            options={[
              { value: '', label: 'Seleccionar...' },
              ...activeWarehouses.map((w) => ({ value: w.id, label: `${w.name}${w.city ? ` (${w.city})` : ''}` })),
            ]}
          />

          <Select
            label="Ubicación destino"
            value={toLocationId}
            onChange={(e) => setToLocationId(e.target.value)}
            options={[
              { value: '', label: 'Seleccionar...' },
              ...activeLocations.map((l) => ({ value: l.id, label: l.code })),
            ]}
          />
        </div>

        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Evidencia (foto)</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              setPhotoFile(f)
            }}
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-4 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          {photoFile && <div className="mt-1 text-xs text-slate-500">{photoFile.name}</div>}
        </div>

        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-2 text-sm font-semibold">Ítems</div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select
              label="Producto"
              value={itemProductId}
              onChange={(e) => {
                const next = e.target.value
                setItemProductId(next)
                setItemBatchId('')
                setItemPresentationId('')
              }}
              options={[
                { value: '', label: 'Seleccionar...' },
                ...activeProducts.map((p) => ({ value: p.id, label: getProductLabel(p as any) })),
              ]}
            />

            <Select
              label="Lote (opcional)"
              value={itemBatchId}
              onChange={(e) => setItemBatchId(e.target.value)}
              options={[
                { value: '', label: 'Sin lote' },
                ...(itemBatchesQuery.data?.items ?? []).map((b) => ({
                  value: b.id,
                  label: `${b.batchNumber}${b.expiresAt ? ` (vence ${new Date(b.expiresAt).toLocaleDateString()})` : ''}`,
                })),
              ]}
            />

            <Select
              label="Presentación"
              value={itemPresentationId || defaultPresentationId}
              onChange={(e) => setItemPresentationId(e.target.value)}
              disabled={activeItemPresentations.length === 0}
              options={
                activeItemPresentations.length === 0
                  ? [{ value: '', label: '(Sin presentaciones)' }]
                  : activeItemPresentations.map((p) => ({ value: p.id, label: `${p.name} (${p.unitsPerPresentation}u)` }))
              }
            />

            <Input
              label="Cantidad (en presentación)"
              type="number"
              value={String(itemPresentationQty)}
              onChange={(e) => setItemPresentationQty(Number(e.target.value))}
            />
          </div>

          <Input label="Nota del ítem (opcional)" value={itemNote} onChange={(e) => setItemNote(e.target.value)} />

          <div className="mt-2 flex justify-end">
            <Button variant="outline" onClick={addItem}>
              + Agregar
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            {items.length === 0 && <div className="text-sm text-slate-500">Sin ítems agregados.</div>}
            {items.map((it, idx) => {
              const p = productById.get(it.productId)
              const label = p ? getProductLabel(p as any) : it.productId
              return (
                <div key={`${it.productId}-${idx}`} className="flex items-center justify-between rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-800">
                  <div>
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      {it.presentationQuantity ?? '-'} {it.presentationId ? 'presentación(es)' : 'unidad(es)'}
                      {it.batchId ? ' · con lote' : ''}
                      {it.note ? ` · ${it.note}` : ''}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeItem(idx)}>
                    Quitar
                  </Button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setShowCreateModal(false)}>
            Cancelar
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creando…' : 'Crear devolución'}
          </Button>
        </div>
      </div>
    </Modal>
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="↩️ Recepción/Devolución">
        <MovementQuickActions currentPath="/stock/returns" />
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm text-slate-600 dark:text-slate-400">Recepción de envíos y devoluciones con evidencia.</div>
          <Button onClick={() => setShowCreateModal(true)}>➕ Nueva devolución</Button>
        </div>

        <div className="mb-4 border-b border-slate-200 dark:border-slate-700">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('returns')}
              className={`border-b-2 py-2 px-1 text-sm font-medium ${
                activeTab === 'returns'
                  ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300'
              }`}
            >
              Devoluciones
            </button>
            <button
              onClick={() => setActiveTab('receptions')}
              className={`border-b-2 py-2 px-1 text-sm font-medium ${
                activeTab === 'receptions'
                  ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300'
              }`}
            >
              Recepciones
            </button>
          </nav>
        </div>

        {activeTab === 'returns' && (
          <>
            {returnsQuery.isLoading && <Loading />}
            {returnsQuery.isError && <ErrorState message={(returnsQuery.error as any)?.message ?? 'Error cargando devoluciones'} />}
            {!returnsQuery.isLoading && !returnsQuery.isError && (returnsQuery.data?.items?.length ?? 0) === 0 && (
              <EmptyState message="No hay devoluciones registradas." />
            )}
            {!returnsQuery.isLoading && !returnsQuery.isError && (returnsQuery.data?.items?.length ?? 0) > 0 && (
              <Table columns={columns as any} data={sortedReturns} keyExtractor={(r: StockReturn) => r.id} />
            )}
          </>
        )}

        {activeTab === 'receptions' && (
          <>
            {sentRequestsQuery.isLoading && <Loading />}
            {sentRequestsQuery.isError && <ErrorState message={(sentRequestsQuery.error as any)?.message ?? 'Error cargando recepciones'} />}
            {!sentRequestsQuery.isLoading && !sentRequestsQuery.isError && (sentRequestsQuery.data?.items?.length ?? 0) === 0 && (
              <EmptyState message="No hay envíos pendientes de recepción." />
            )}
            {!sentRequestsQuery.isLoading && !sentRequestsQuery.isError && (sentRequestsQuery.data?.items?.length ?? 0) > 0 && (
              <Table
                columns={[
                  { header: 'Fecha envío', width: '170px', accessor: (r: any) => new Date(r.fulfilledAt || r.createdAt).toLocaleString() },
                  { 
                    header: 'Origen → Destino', 
                    accessor: (r: any) => {
                      const fromCode = r.originWarehouse?.city
                        ? abbreviateCity(r.originWarehouse.city)
                        : r.originWarehouse?.code?.replace(/^SUC-/, '') ?? '—'

                      const toCode = r.warehouse?.city
                        ? abbreviateCity(r.warehouse.city)
                        : r.requestedCity
                          ? abbreviateCity(r.requestedCity)
                          : r.warehouse?.code?.replace(/^SUC-/, '') ?? '—'

                      return `${fromCode} → ${toCode}`
                    }
                  },
                  { header: 'Solicitante', accessor: (r: any) => r.requestedByName },
                  { header: 'Enviado por', accessor: (r: any) => r.fulfilledByName ?? '-' },
                  { header: 'Ítems', width: '80px', accessor: (r: any) => (r.movements?.length ?? r.items?.length ?? 0) },
                  {
                    header: 'Acciones',
                    width: '120px',
                    accessor: (r: any) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<EyeIcon className="w-4 h-4" />}
                        onClick={() => setSelectedRequest(r)}
                      >
                        Ver
                      </Button>
                    ),
                  },
                ]}
                data={sortedSentRequests}
                keyExtractor={(r) => r.id}
              />
            )}
          </>
        )}

        {receptionModal}
        {createModal}
      </PageContainer>
    </MainLayout>
  )
}
