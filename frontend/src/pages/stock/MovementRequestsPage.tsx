import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Button, Modal, Input, Select, Loading, ErrorState, EmptyState } from '../../components'
import { useNavigation } from '../../hooks'
import { getProductLabel } from '../../lib/productName'

type MovementRequestItem = {
  id: string
  productId: string
  productSku: string | null
  productName: string | null
  genericName: string | null
  requestedQuantity: number
  remainingQuantity: number
  presentationId: string | null
  presentationName: string | null
  presentationQuantity: number | null
  unitsPerPresentation: number | null
}

type MovementRequest = {
  id: string
  status: 'OPEN' | 'FULFILLED' | 'CANCELLED'
  confirmationStatus?: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  requestedCity: string
  requestedByName: string | null
  note?: string | null
  createdAt: string
  fulfilledAt: string | null
  confirmedAt?: string | null
  confirmationNote?: string | null
  items: MovementRequestItem[]
}

type WarehouseListItem = {
  id: string
  code: string
  name: string
  city?: string | null
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

async function listMovementRequests(token: string): Promise<{ items: MovementRequest[] }> {
  const response = await apiFetch<{ items: any[] }>('/api/v1/stock/movement-requests?take=50', { token })
  return {
    items: response.items.map((req: any) => ({
      ...req,
      items: (req.items ?? []).map((item: any) => ({
        ...item,
        presentationId: item.presentationId ?? item.presentation?.id ?? null,
        presentationName: item.presentationName ?? item.presentation?.name ?? null,
        unitsPerPresentation: item.unitsPerPresentation ?? item.presentation?.unitsPerPresentation ?? null,
      })),
    })),
  }
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch(`/api/v1/warehouses?take=100`, { token })
}

async function fetchProducts(token: string): Promise<{ items: ProductListItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  return apiFetch(`/api/v1/products?${params}`, { token })
}

async function fetchProductPresentations(token: string, productId: string): Promise<{ items: ProductPresentation[] }> {
  return apiFetch(`/api/v1/products/${productId}/presentations`, { token })
}

async function createMovementRequest(
  token: string,
  data: {
    warehouseId: string
    requestedByName: string
    productId: string
    items: { presentationId: string; quantity: number }[]
    note?: string
  },
): Promise<MovementRequest> {
  return apiFetch('/api/v1/stock/movement-requests', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

async function confirmMovementRequest(
  token: string,
  requestId: string,
  input: { action: 'ACCEPT' | 'REJECT'; note?: string },
): Promise<{ id: string; confirmationStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' }> {
  return apiFetch(`/api/v1/stock/movement-requests/${requestId}/confirm`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(input),
  })
}

export function MovementRequestsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()

  const movementRequestsQuery = useQuery({
    queryKey: ['movementRequests'],
    queryFn: () => listMovementRequests(auth.accessToken!),
    enabled: !!auth.accessToken,
    refetchInterval: 10_000,
  })

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'forMovementRequests'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const productsQuery = useQuery({
    queryKey: ['products', 'forMovementRequests'],
    queryFn: () => fetchProducts(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'ACCEPT' | 'REJECT'>('ACCEPT')
  const [confirmNote, setConfirmNote] = useState('')
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [requestWarehouseId, setRequestWarehouseId] = useState('')
  const [requestRequestedByName, setRequestRequestedByName] = useState('')
  const [requestProductId, setRequestProductId] = useState('')
  const [requestItems, setRequestItems] = useState<Array<{ presentationId: string; quantity: number }>>([])
  const [requestNote, setRequestNote] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const requestProductPresentationsQuery = useQuery({
    queryKey: ['productPresentations', 'forMovementRequest', requestProductId],
    queryFn: () => fetchProductPresentations(auth.accessToken!, requestProductId),
    enabled: !!auth.accessToken && !!requestProductId,
  })

  const activeWarehouses = useMemo(
    () => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive),
    [warehousesQuery.data],
  )

  const activeProducts = useMemo(
    () => (productsQuery.data?.items ?? []).filter((p) => p.isActive),
    [productsQuery.data],
  )

  const activePresentations = useMemo(
    () => (requestProductPresentationsQuery.data?.items ?? []).filter((p) => (p.isActive ?? true) === true),
    [requestProductPresentationsQuery.data],
  )

  const presentationLabelById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of activePresentations) {
      m.set(p.id, `${p.name} (${p.unitsPerPresentation}u)`) 
    }
    return m
  }, [activePresentations])

  const handleAddRequestItem = (presentationId: string, quantity: number) => {
    if (!presentationId) return
    if (!Number.isFinite(quantity) || quantity <= 0) return
    setRequestItems((prev) => {
      const existing = prev.find((x) => x.presentationId === presentationId)
      if (!existing) return [...prev, { presentationId, quantity }]
      return prev.map((x) => (x.presentationId === presentationId ? { ...x, quantity: x.quantity + quantity } : x))
    })
  }

  const handleRemoveRequestItem = (presentationId: string) => {
    setRequestItems((prev) => prev.filter((x) => x.presentationId !== presentationId))
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      setCreateError(null)
      if (!requestWarehouseId) throw new Error('Seleccioná la sucursal que solicita')
      if (!requestRequestedByName.trim()) throw new Error('Ingresá el nombre de quien solicita')
      if (!requestProductId) throw new Error('Seleccioná un producto')
      if (requestItems.length === 0) throw new Error('Agregá al menos una presentación solicitada')

      return createMovementRequest(auth.accessToken!, {
        warehouseId: requestWarehouseId,
        requestedByName: requestRequestedByName.trim(),
        productId: requestProductId,
        items: requestItems,
        note: requestNote.trim() || undefined,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movementRequests'] })
      setShowCreateModal(false)
      setRequestWarehouseId('')
      setRequestRequestedByName('')
      setRequestProductId('')
      setRequestItems([])
      setRequestNote('')
      setCreateError(null)
    },
    onError: (e: any) => {
      setCreateError(e?.message ?? 'Error al crear solicitud')
    },
  })

  const confirmMutation = useMutation({
    mutationFn: async () => {
      setConfirmError(null)
      if (!selectedRequestId) throw new Error('Seleccioná una solicitud')
      return confirmMovementRequest(auth.accessToken!, selectedRequestId, {
        action: confirmAction,
        note: confirmNote.trim() || undefined,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movementRequests'] })
      setConfirmNote('')
      setConfirmError(null)
      setShowDetailsModal(false)
    },
    onError: (e: any) => {
      setConfirmError(e?.message ?? 'Error al confirmar solicitud')
    },
  })

  type MovementRequestRow = {
    id: string
    status: MovementRequest['status']
    confirmationStatus: NonNullable<MovementRequest['confirmationStatus']>
    requestedCity: string
    requestedByName: string
    itemsCount: number
    createdAtLabel: string
  }

  const rows = useMemo<MovementRequestRow[]>(() => {
    const items = movementRequestsQuery.data?.items ?? []
    return items.map((r) => ({
      id: r.id,
      status: r.status,
      confirmationStatus: (r.confirmationStatus ?? 'PENDING') as any,
      requestedCity: r.requestedCity,
      requestedByName: r.requestedByName ?? '-',
      itemsCount: r.items?.length ?? 0,
      createdAtLabel: r.createdAt ? new Date(r.createdAt).toLocaleString() : '-',
    }))
  }, [movementRequestsQuery.data])

  const selectedRequest = useMemo(() => {
    if (!selectedRequestId) return null
    return (movementRequestsQuery.data?.items ?? []).find((r) => r.id === selectedRequestId) ?? null
  }, [movementRequestsQuery.data, selectedRequestId])

  const columns = useMemo(
    () => [
      { header: 'Estado', width: '130px', accessor: (r: MovementRequestRow) => r.status },
      {
        header: 'Confirmación',
        width: '140px',
        accessor: (r: MovementRequestRow) => {
          if (r.status !== 'FULFILLED') return '—'
          if (r.confirmationStatus === 'ACCEPTED') return 'ACEPTADA'
          if (r.confirmationStatus === 'REJECTED') return 'RECHAZADA'
          return 'PENDIENTE'
        },
      },
      { header: 'Ciudad', width: '130px', accessor: (r: MovementRequestRow) => (r.requestedCity ? r.requestedCity.toUpperCase() : '-') },
      { header: 'Solicitado por', width: '240px', accessor: (r: MovementRequestRow) => r.requestedByName },
      { header: 'Items', width: '90px', accessor: (r: MovementRequestRow) => String(r.itemsCount) },
      { header: 'Creado', width: '200px', accessor: (r: MovementRequestRow) => r.createdAtLabel },
    ],
    [],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">📨 Solicitudes de movimiento</h1>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setShowCreateModal(true)}>
              Crear solicitud
            </Button>
            <Button variant="secondary" onClick={() => movementRequestsQuery.refetch()} loading={movementRequestsQuery.isFetching}>
              Actualizar
            </Button>
          </div>
        </div>

        {movementRequestsQuery.isLoading && <Loading />}
        {movementRequestsQuery.error && <ErrorState message="Error al cargar solicitudes" retry={movementRequestsQuery.refetch} />}

        {!movementRequestsQuery.isLoading && !movementRequestsQuery.error && rows.length === 0 && (
          <EmptyState
            message="Todavía no se registraron solicitudes de movimiento."
            action={
              <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                Crear solicitud
              </Button>
            }
          />
        )}

        {rows.length > 0 && (
          <Table
            columns={columns}
            data={rows}
            keyExtractor={(r) => r.id}
            onRowClick={(r) => {
              setSelectedRequestId(r.id)
              setConfirmNote('')
              setConfirmError(null)
              setConfirmAction('ACCEPT')
              setShowDetailsModal(true)
            }}
          />
        )}
      </PageContainer>

      <Modal
        isOpen={showDetailsModal}
        onClose={() => {
          if (confirmMutation.isPending) return
          setShowDetailsModal(false)
          setConfirmError(null)
        }}
        title="Detalle de solicitud"
        maxWidth="lg"
      >
        {!selectedRequest && <div className="text-sm text-slate-600 dark:text-slate-300">Cargando...</div>}

        {selectedRequest && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500">Estado</div>
                <div className="font-medium text-slate-900 dark:text-slate-100">{selectedRequest.status}</div>
              </div>
              <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500">Ciudad</div>
                <div className="font-medium text-slate-900 dark:text-slate-100">{selectedRequest.requestedCity?.toUpperCase?.() ?? selectedRequest.requestedCity}</div>
              </div>
              <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500">Solicitado por</div>
                <div className="font-medium text-slate-900 dark:text-slate-100">{selectedRequest.requestedByName ?? '—'}</div>
              </div>
              <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500">Creado</div>
                <div className="font-medium text-slate-900 dark:text-slate-100">{selectedRequest.createdAt ? new Date(selectedRequest.createdAt).toLocaleString() : '—'}</div>
              </div>
            </div>

            {selectedRequest.note && (
              <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500">Nota</div>
                <div className="text-slate-900 dark:text-slate-100">{selectedRequest.note}</div>
              </div>
            )}

            <div>
              <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Ítems</div>
              <div className="space-y-2">
                {(selectedRequest.items ?? []).map((it) => (
                  <div key={it.id} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{getProductLabel({ sku: it.productSku ?? '', name: it.productName ?? '', genericName: it.genericName })}</div>
                    <div className="text-slate-600 dark:text-slate-300">
                      Solic.: {it.presentationName ?? '—'} × {it.presentationQuantity ?? '—'} · Pendiente(unid): {it.remainingQuantity}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedRequest.status === 'FULFILLED' && (selectedRequest.confirmationStatus ?? 'PENDING') === 'PENDING' && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="mb-3 text-sm font-medium text-slate-800 dark:text-slate-100">Confirmar recepción</div>

                <Select
                  label="Acción"
                  value={confirmAction}
                  onChange={(e) => setConfirmAction(e.target.value as any)}
                  options={[
                    { value: 'ACCEPT', label: '✅ Aceptar' },
                    { value: 'REJECT', label: '❌ Rechazar' },
                  ]}
                />

                <Input
                  label="Nota (opcional)"
                  value={confirmNote}
                  onChange={(e) => setConfirmNote(e.target.value)}
                  placeholder="Ej: recibido completo / faltó 1 unidad / etc."
                />

                {confirmError && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                    {confirmError}
                  </div>
                )}

                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setShowDetailsModal(false)} disabled={confirmMutation.isPending}>
                    Cerrar
                  </Button>
                  <Button type="button" variant="primary" loading={confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>
                    Confirmar
                  </Button>
                </div>
              </div>
            )}

            {(selectedRequest.confirmationStatus ?? 'PENDING') !== 'PENDING' && selectedRequest.status === 'FULFILLED' && (
              <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500">Confirmación</div>
                <div className="font-medium text-slate-900 dark:text-slate-100">{selectedRequest.confirmationStatus}</div>
                {selectedRequest.confirmedAt && <div className="text-slate-600 dark:text-slate-300">{new Date(selectedRequest.confirmedAt).toLocaleString()}</div>}
                {selectedRequest.confirmationNote && <div className="mt-1 text-slate-600 dark:text-slate-300">{selectedRequest.confirmationNote}</div>}
              </div>
            )}

            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={() => setShowDetailsModal(false)} disabled={confirmMutation.isPending}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          if (createMutation.isPending) return
          setShowCreateModal(false)
          setCreateError(null)
        }}
        title="Crear solicitud de movimiento"
        maxWidth="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createMutation.mutate()
          }}
          className="space-y-4"
        >
          <Select
            label="Sucursal que solicita"
            value={requestWarehouseId}
            onChange={(e) => setRequestWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'Selecciona una sucursal' },
              ...activeWarehouses.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}${w.city ? ` (${String(w.city).toUpperCase()})` : ''}` })),
            ]}
            disabled={warehousesQuery.isLoading}
            required
          />

          <Input
            label="Solicitado por"
            value={requestRequestedByName}
            onChange={(e) => setRequestRequestedByName(e.target.value)}
            placeholder="Nombre de la persona que solicita"
            required
          />

          <Select
            label="Producto"
            value={requestProductId}
            onChange={(e) => {
              setRequestProductId(e.target.value)
              setRequestItems([])
            }}
            options={[
              { value: '', label: 'Selecciona un producto' },
              ...activeProducts.map((p) => ({ value: p.id, label: getProductLabel(p) })),
            ]}
            disabled={productsQuery.isLoading}
            required
          />

          {requestProductId && (
            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Presentaciones solicitadas</div>

              <div className="flex gap-2">
                <Select
                  value=""
                  onChange={(e) => {
                    const presId = e.target.value
                    if (!presId) return
                    handleAddRequestItem(presId, 1)
                  }}
                  options={[
                    { value: '', label: 'Selecciona presentación' },
                    ...activePresentations.map((p) => ({ value: p.id, label: `${p.name} (${p.unitsPerPresentation}u)` })),
                  ]}
                  disabled={requestProductPresentationsQuery.isLoading}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const first = activePresentations[0]
                    if (first) handleAddRequestItem(first.id, 1)
                  }}
                  disabled={activePresentations.length === 0}
                >
                  + Agregar
                </Button>
              </div>

              {requestItems.length > 0 && (
                <div className="space-y-2">
                  {requestItems.map((it) => (
                    <div key={it.presentationId} className="flex items-center gap-2 rounded bg-slate-50 p-2 dark:bg-slate-800">
                      <div className="flex-1 text-sm text-slate-900 dark:text-slate-100">
                        {presentationLabelById.get(it.presentationId) ?? it.presentationId}
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={String(it.quantity)}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v) || v <= 0) {
                            handleRemoveRequestItem(it.presentationId)
                          } else {
                            setRequestItems((prev) => prev.map((x) => (x.presentationId === it.presentationId ? { ...x, quantity: v } : x)))
                          }
                        }}
                        className="w-24"
                      />
                      <Button type="button" variant="secondary" size="sm" onClick={() => handleRemoveRequestItem(it.presentationId)}>
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Nota (opcional)</label>
            <textarea
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              placeholder="Detalles adicionales de la solicitud"
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
            />
          </div>

          {createError && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {createError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowCreateModal(false)} disabled={createMutation.isPending}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={createMutation.isPending}>
              Crear
            </Button>
          </div>
        </form>
      </Modal>
    </MainLayout>
  )
}
