import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MainLayout, PageContainer, Select, Input, Button } from '../../components'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { useNavigation } from '../../hooks'
import { useAuth } from '../../providers/AuthProvider'
import { apiFetch } from '../../lib/api'

type WarehouseListItem = { id: string; code: string; name: string; city?: string | null; isActive: boolean }

type LocationListItem = { id: string; warehouseId: string; code: string; isActive: boolean }

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

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch('/api/v1/warehouses?take=100', { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  return apiFetch(`/api/v1/warehouses/${encodeURIComponent(warehouseId)}/locations?take=100`, { token })
}

async function listMovementRequests(token: string): Promise<{ items: MovementRequest[] }> {
  const response = await apiFetch<{ items: any[] }>('/api/v1/stock/movement-requests?take=50', { token })
  return {
    items: response.items.map((req: any) => ({
      ...req,
      items: (req.items ?? []).map((item: any) => ({
        ...item,
        requestedQuantity: Number(item.requestedQuantity ?? 0),
        remainingQuantity: Number(item.remainingQuantity ?? 0),
        presentationId: item.presentationId ?? item.presentation?.id ?? null,
        presentationName: item.presentationName ?? item.presentation?.name ?? null,
        presentationQuantity:
          item.presentationQuantity === null || item.presentationQuantity === undefined ? null : Number(item.presentationQuantity),
        unitsPerPresentation:
          item.unitsPerPresentation === null || item.unitsPerPresentation === undefined
            ? item.presentation?.unitsPerPresentation === null || item.presentation?.unitsPerPresentation === undefined
              ? null
              : Number(item.presentation.unitsPerPresentation)
            : Number(item.unitsPerPresentation),
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
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([])

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'fulfillRequests'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const fromLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'fulfillRequests', 'from', fromWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, fromWarehouseId),
    enabled: !!auth.accessToken && !!fromWarehouseId,
  })

  const toLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'fulfillRequests', 'to', toWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, toWarehouseId),
    enabled: !!auth.accessToken && !!toWarehouseId,
  })

  const movementRequestsQuery = useQuery({
    queryKey: ['movement-requests'],
    queryFn: () => listMovementRequests(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const activeWarehouses = useMemo(
    () => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive),
    [warehousesQuery.data?.items],
  )

  const availableFromWarehouses = activeWarehouses
  const availableToWarehouses = activeWarehouses.filter((w) => w.id !== fromWarehouseId)

  const canSubmit = !!fromWarehouseId && !!fromLocationId && !!toWarehouseId && !!toLocationId

  const filteredRequests = useMemo(() => {
    if (!movementRequestsQuery.data?.items || !toWarehouseId) return []

    return movementRequestsQuery.data.items.filter(
      (request) =>
        request.status === 'OPEN' &&
        request.requestedCity === activeWarehouses.find((w) => w.id === toWarehouseId)?.city
    )
  }, [movementRequestsQuery.data, toWarehouseId, activeWarehouses])

  const queryClient = useQueryClient()

  const bulkFulfillMutation = useMutation({
    mutationFn: async (data: { requestIds: string[]; fromLocationId: string; toLocationId: string; note?: string }) => {
      return apiFetch('/api/v1/stock/movement-requests/bulk-fulfill', {
        method: 'POST',
        token: auth.accessToken!,
        body: JSON.stringify(data),
      })
    },
    onSuccess: () => {
      // Refrescar las queries para mostrar los cambios
      queryClient.invalidateQueries({ queryKey: ['movement-requests'] })
      // Limpiar la selección después del éxito
      setSelectedRequestIds([])
      setNote('')
    },
  })

  console.log('BulkFulfillRequestsPage loaded')
  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="✅ Atender solicitudes">
        <MovementQuickActions currentPath="/stock/fulfill-requests" />
        <div className="mb-4 text-sm text-slate-700 dark:text-slate-300">Envía stock a solicitudes OPEN desde un almacén origen a un almacén destino.</div>

        <div className="grid gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="Almacén origen"
                value={fromWarehouseId}
                onChange={(e) => {
                  setFromWarehouseId(e.target.value)
                  setFromLocationId('')
                  // Si el destino era el mismo que el origen, lo limpiamos
                  if (toWarehouseId === e.target.value) {
                    setToWarehouseId('')
                    setToLocationId('')
                  }
                }}
                options={[
                  { value: '', label: 'Selecciona almacén' },
                  ...availableFromWarehouses.map((w) => ({
                    value: w.id,
                    label: `${w.code} - ${w.name}${w.city ? ` (${w.city})` : ''}`,
                  })),
                ]}
                disabled={warehousesQuery.isLoading}
              />

              <Select
                label="Ubicación origen"
                value={fromLocationId}
                onChange={(e) => setFromLocationId(e.target.value)}
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
                  ...availableToWarehouses.map((w) => ({
                    value: w.id,
                    label: `${w.code} - ${w.name}${w.city ? ` (${w.city})` : ''}`,
                  })),
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
              <Input
                label="Nota (opcional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej: Atención de pedidos SCZ"
              />
            </div>

            {/* Multiselect de solicitudes abiertas */}
            {filteredRequests.length > 0 && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Solicitudes a atender
                </label>
                <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-md dark:border-slate-700">
                  {filteredRequests.map((request) => (
                    <div key={request.id} className="flex items-center p-3 border-b border-slate-100 last:border-b-0 dark:border-slate-700">
                      <input
                        type="checkbox"
                        id={`request-${request.id}`}
                        checked={selectedRequestIds.includes(request.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedRequestIds(prev => [...prev, request.id])
                          } else {
                            setSelectedRequestIds(prev => prev.filter(id => id !== request.id))
                          }
                        }}
                        className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded"
                      />
                      <label htmlFor={`request-${request.id}`} className="flex-1 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1">
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                {request.requestedByName || 'Usuario desconocido'}
                              </span>
                              {request.note && (
                                <span
                                  className="text-xs cursor-help"
                                  title={request.note}
                                >
                                  📝
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {new Date(request.createdAt).toLocaleString('es-ES')}
                            </span>
                          </div>
                          <div className="flex-1 text-xs text-slate-600 dark:text-slate-400 ml-4">
                            {request.items.map((item, index) => {
                              const presentationQuantity = item.unitsPerPresentation && item.unitsPerPresentation > 0 
                                ? Math.ceil(item.requestedQuantity / item.unitsPerPresentation)
                                : item.presentationQuantity || item.requestedQuantity;
                              return (
                                <div key={index} className="text-xs">
                                  (<strong>{presentationQuantity}</strong>, {item.presentationName || 'Sin presentación'}{item.unitsPerPresentation ? ` (${item.unitsPerPresentation}u)` : ''} - {item.productName || 'Producto desconocido'})
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
                {selectedRequestIds.length > 0 && (
                  <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                    {selectedRequestIds.length} solicitud{selectedRequestIds.length !== 1 ? 'es' : ''} seleccionada{selectedRequestIds.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Button 
                onClick={() => {
                  bulkFulfillMutation.mutate({
                    requestIds: selectedRequestIds,
                    fromLocationId,
                    toLocationId,
                    note: note.trim() || undefined,
                  })
                }} 
                disabled={!canSubmit || selectedRequestIds.length === 0 || bulkFulfillMutation.isPending}
              >
                Atender {selectedRequestIds.length > 0 ? `${selectedRequestIds.length} solicitud${selectedRequestIds.length !== 1 ? 'es' : ''}` : 'solicitudes'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setFromWarehouseId('')
                  setFromLocationId('')
                  setToWarehouseId('')
                  setToLocationId('')
                  setNote('')
                  setSelectedRequestIds([])
                }}
              >
                Limpiar selección
              </Button>
            </div>

            {bulkFulfillMutation.isError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md dark:bg-red-900/20 dark:border-red-800">
                <div className="text-sm text-red-800 dark:text-red-200">
                  Error al atender solicitudes: {(bulkFulfillMutation.error as any)?.response?.data?.message || 
                    (bulkFulfillMutation.error instanceof Error ? bulkFulfillMutation.error.message : 'Error desconocido')}
                </div>
              </div>
            )}

            {bulkFulfillMutation.isSuccess && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md dark:bg-green-900/20 dark:border-green-800">
                <div className="text-sm text-green-800 dark:text-green-200">
                  ✅ Solicitudes atendidas exitosamente
                </div>
              </div>
            )}
          </div>
        </div>
      </PageContainer>
    </MainLayout>
  )
}