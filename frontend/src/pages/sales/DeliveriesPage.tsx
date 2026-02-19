import { exportDeliveryNoteToPDF } from '../../lib/quotePdf'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  MainLayout,
  Modal,
  PageContainer,
  PaginationCursor,
  Select,
  Table,
} from '../../components'
import { useNavigation } from '../../hooks'
import { usePermissions } from '../../hooks/usePermissions'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { EyeIcon, CheckCircleIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

type DeliveryListItem = {
  id: string
  number: string
  status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'
  version: number
  updatedAt: string
  customerId: string
  customerName: string
  processedBy: string | null
  deliveryDate: string | null
  deliveryCity: string | null
  deliveryZone: string | null
  deliveryAddress: string | null
  deliveryMapsUrl: string | null
}

type ListResponse = { items: DeliveryListItem[]; nextCursor: string | null }

type WarehouseListItem = { id: string; code: string; name: string; isActive: boolean }
type LocationListItem = { id: string; warehouseId: string; code: string; isActive: boolean }

type DeliverStatusFilter = 'PENDING' | 'DELIVERED' | 'ALL'

type ReservationRow = {
  id: string
  inventoryBalanceId: string
  quantity: number
  createdAt: string
  productId: string | null
  productSku: string | null
  productName: string | null
  genericName: string | null
  batchId: string | null
  batchNumber: string | null
  expiresAt: string | null
  locationId: string | null
  locationCode: string | null
  warehouseId: string | null
  warehouseCode: string | null
  warehouseName: string | null
  presentationName: string | null
  unitsPerPresentation: number | null
}

type ReservationsResponse = { items: ReservationRow[] }

function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function relativeDeliveryLabel(deliveryDateIso: string | null): string {
  if (!deliveryDateIso) return 'Sin fecha'
  const delivery = startOfDayLocal(new Date(deliveryDateIso))
  const today = startOfDayLocal(new Date())
  const diffDays = Math.round((delivery.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'hoy'
  if (diffDays === -1) return 'ayer'
  if (diffDays > 0) return `en ${diffDays} días`
  return `hace ${Math.abs(diffDays)} días`
}

function formatDeliveryPlace(d: DeliveryListItem): string {
  const parts = [d.deliveryCity, d.deliveryZone, d.deliveryAddress].filter((p) => !!p && p.trim()) as string[]
  return parts.length ? parts.join(' · ') : '—'
}

async function fetchDeliveries(token: string, take: number, status: DeliverStatusFilter, cursor?: string, cities?: string[]): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take), status })
  if (cursor) params.append('cursor', cursor)
  if (cities && cities.length > 0) {
    params.append('cities', cities.join(','))
  }
  return apiFetch(`/api/v1/sales/deliveries?${params}`, { token })
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  return apiFetch(`/api/v1/warehouses?${params}`, { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  return apiFetch(`/api/v1/warehouses/${encodeURIComponent(warehouseId)}/locations?${params}`, { token })
}

async function deliverOrder(
  token: string,
  input: { orderId: string; version: number; fromLocationId?: string },
): Promise<{ order: { id: string } }> {
  return apiFetch(`/api/v1/sales/orders/${encodeURIComponent(input.orderId)}/deliver`, {
    method: 'POST',
    token,
    body: JSON.stringify({ version: input.version, ...(input.fromLocationId ? { fromLocationId: input.fromLocationId } : {}) }),
  })
}

async function fetchOrderReservations(token: string, orderId: string): Promise<ReservationsResponse> {
  return apiFetch(`/api/v1/sales/orders/${encodeURIComponent(orderId)}/reservations`, { token })
}

function isMissingReservationsError(message: string): boolean {
  const m = (message ?? '').toLowerCase()
  return m.includes('no reservations') || (m.includes('fromlocationid') && m.includes('no reservations'))
}

export function DeliveriesPage() {
  const auth = useAuth()
  const perms = usePermissions()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()
  const tenant = useTenant()

  const [status, setStatus] = useState<DeliverStatusFilter>('PENDING')
  const [cursor, setCursor] = useState<string | undefined>()
  const [selectedCities, setSelectedCities] = useState<string[]>([])
  const isBranchScoped = perms.hasPermission('scope:branch') && !perms.isTenantAdmin
  const branchCity = (perms.user?.warehouse?.city ?? '').trim().toUpperCase()

  const [deliverLocationModalOpen, setDeliverLocationModalOpen] = useState(false)
  const [deliverTarget, setDeliverTarget] = useState<{ orderId: string; version: number; number: string } | null>(null)
  const [deliverWarehouseId, setDeliverWarehouseId] = useState<string>('')
  const [deliverLocationId, setDeliverLocationId] = useState<string>('')

  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [locationModalItem, setLocationModalItem] = useState<DeliveryListItem | null>(null)

  const [exportingDeliveryNote, setExportingDeliveryNote] = useState(false)

  const deliveriesQuery = useQuery({
    queryKey: ['deliveries', status, cursor, selectedCities],
    queryFn: () => fetchDeliveries(auth.accessToken!, 50, status, cursor, selectedCities.length > 0 ? selectedCities : undefined),
    enabled: !!auth.accessToken,
  })

  useEffect(() => {
    if (!isBranchScoped || !branchCity) return
    if (selectedCities.length === 1 && selectedCities[0] === branchCity) return
    setSelectedCities([branchCity])
    setCursor(undefined)
  }, [isBranchScoped, branchCity, selectedCities])

  const availableCities = useMemo((): string[] => {
    if (!deliveriesQuery.data?.items) return []
    
    const cities = deliveriesQuery.data.items
      .map((d) => d.deliveryCity)
      .filter((city): city is string => city !== null && city.trim() !== '')
      .map((city: string) => city.toUpperCase())
      .filter((city: string, index: number, arr: string[]) => arr.indexOf(city) === index)
      .sort()
    
    return cities
  }, [deliveriesQuery.data?.items])

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'deliveries'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken && deliverLocationModalOpen,
  })

  const locationsQuery = useQuery({
    queryKey: ['warehouseLocations', deliverWarehouseId, 'deliveries'],
    queryFn: () => listWarehouseLocations(auth.accessToken!, deliverWarehouseId),
    enabled: !!auth.accessToken && deliverLocationModalOpen && !!deliverWarehouseId,
  })

  const deliverMutation = useMutation({
    mutationFn: (vars: { orderId: string; version: number; fromLocationId?: string }) => deliverOrder(auth.accessToken!, vars),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['deliveries'] })
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      setDeliverTarget(null)
      setDeliverLocationModalOpen(false)
      setDeliverWarehouseId('')
      setDeliverLocationId('')
    },
    onError: (err: any) => {
      const msg = (err?.message as string | undefined) ?? 'No se pudo marcar como entregado'
      if (deliverTarget && isMissingReservationsError(msg)) {
        setDeliverLocationModalOpen(true)
        return
      }
      window.alert(msg)
    },
  })

  const items = deliveriesQuery.data?.items ?? []

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Entregas">
        {/* Botones de filtro - segunda fila en móvil */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={status === 'PENDING' ? 'primary' : 'ghost'}
            onClick={() => {
              setStatus('PENDING')
              setCursor(undefined)
            }}
          >
            Pendientes
          </Button>
          <Button
            size="sm"
            variant={status === 'DELIVERED' ? 'primary' : 'ghost'}
            onClick={() => {
              setStatus('DELIVERED')
              setCursor(undefined)
            }}
          >
            Entregadas
          </Button>
          <div className="w-px self-stretch bg-slate-200 dark:bg-slate-700" />
          <Button
            size="sm"
            variant={status === 'ALL' ? 'primary' : 'ghost'}
            onClick={() => {
              setStatus('ALL')
              setCursor(undefined)
            }}
          >
            Ver todas
          </Button>
        </div>
        {/* Filtro de ciudades - Chips simples */}
        {isBranchScoped && branchCity ? (
          <div className="mb-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Ciudad:</span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {branchCity}
            </span>
          </div>
        ) : availableCities.length > 0 ? (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mr-2">Filtrar por ciudad:</span>
              <button
                onClick={() => setSelectedCities([])}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedCities.length === 0
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                Todas
              </button>
              {availableCities.map((city) => {
                const isSelected = selectedCities.includes(city)
                return (
                  <button
                    key={city}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedCities(prev => prev.filter(c => c !== city))
                      } else {
                        setSelectedCities(prev => [...prev, city])
                      }
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                    }`}
                  >
                    {city}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {deliveriesQuery.isLoading && <Loading />}
          {deliveriesQuery.error && <ErrorState message="Error al cargar entregas" retry={deliveriesQuery.refetch} />}
          {deliveriesQuery.data && items.length === 0 && <EmptyState message="No hay entregas" />}
          {deliveriesQuery.data && items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'OV', accessor: (o) => o.number.split('-').pop() ?? o.number },
                  { header: 'Cliente', accessor: (o) => o.customerName.length > 15 ? `${o.customerName.slice(0, 15)}...` : o.customerName },
                  {
                    header: 'Fecha entrega',
                    accessor: (o) => (
                      <div className="flex flex-col">
                        <span className="font-medium">{relativeDeliveryLabel(o.deliveryDate)}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString() : '—'}
                        </span>
                      </div>
                    ),
                  },
                  {
                    header: 'Lugar',
                    accessor: (o) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="border border-blue-600 rounded-xl bg-blue-600/20"
                        onClick={() => {
                          setLocationModalItem(o)
                          setLocationModalOpen(true)
                        }}
                      >
                        {o.deliveryCity || '—'}
                      </Button>
                    ),
                  },
                  {
                    header: 'Estado',
                    accessor: (o) => (
                      <Badge
                        variant={o.status === 'FULFILLED' ? 'success' : o.status === 'CONFIRMED' ? 'info' : 'default'}
                      >
                        {o.status === 'FULFILLED' ? 'ENTREGADO' : 'PENDIENTE'}
                      </Badge>
                    ),
                  },
                  {
                    header: 'Acciones',
                    className: 'text-center',
                    accessor: (o) => (
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" icon={<EyeIcon className="w-4 h-4" />} onClick={() => navigate(`/sales/orders/${o.id}`)}>
                          <span className="hidden md:inline">Ver</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<DocumentTextIcon className="w-4 h-4" />}
                          loading={exportingDeliveryNote}
                          onClick={async () => {
                            setExportingDeliveryNote(true)
                            try {
                              const res = await fetchOrderReservations(auth.accessToken!, o.id)
                              const reservations = res.items ?? []
                              const items = reservations.map((r: any) => ({
                                productName: r.productName ?? '—',
                                batchNumber: r.batchNumber ?? '—',
                                expiresAt: r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : '—',
                                quantity: r.presentationQuantity ?? r.quantity ?? 0,
                                presentationName: r.presentationName ?? undefined,
                                presentationQuantity: r.presentationQuantity ?? undefined,
                                unitsPerPresentation: r.unitsPerPresentation ?? undefined,
                              }))
                              await exportDeliveryNoteToPDF({
                                orderNumber: o.number,
                                customerName: o.customerName,
                                deliveryDate: o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString() : '—',
                                deliveryCity: o.deliveryCity ?? undefined,
                                deliveryZone: o.deliveryZone ?? undefined,
                                deliveryAddress: o.deliveryAddress ?? undefined,
                                items,
                                tenant,
                                logoUrl: tenant.branding?.logoUrl || undefined,
                              })
                            } catch (error) {
                              console.error('Error exporting delivery note:', error)
                              alert('Error al exportar nota de entrega')
                            } finally {
                              setExportingDeliveryNote(false)
                            }
                          }}
                        >
                          <span className="hidden md:inline">Nota</span>
                        </Button>
                        {o.status !== 'FULFILLED' && perms.hasPermission('sales:delivery:write') ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<CheckCircleIcon className="w-4 h-4" />}
                            disabled={deliverMutation.isPending}
                            onClick={async () => {
                              let confirmMsg = `¿Marcar la OV ${o.number} como entregada? Esto descontará stock.`
                              try {
                                const res = await fetchOrderReservations(auth.accessToken!, o.id)
                                const rows = res?.items ?? []
                                if (rows.length > 0) {
                                  const lotes = new Set(rows.map((r: any) => r.batchId ?? r.batchNumber ?? 'SIN_LOTE'))
                                  const ubic = new Set(rows.map((r: any) => r.locationId ?? r.locationCode ?? 'SIN_UBICACION'))
                                  confirmMsg += `\n\nSe descontará específicamente de las reservas (picking): ${rows.length} líneas, ${lotes.size} lotes, ${ubic.size} ubicaciones.`
                                }
                              } catch {
                                // ignore: keep default confirm text
                              }

                              const ok = window.confirm(confirmMsg)
                              if (!ok) return
                              setDeliverTarget({ orderId: o.id, version: o.version, number: o.number })
                              try {
                                await deliverMutation.mutateAsync({ orderId: o.id, version: o.version })
                              } catch (e: any) {
                                const msg = (e?.message as string | undefined) ?? ''
                                if (isMissingReservationsError(msg)) {
                                  setDeliverLocationModalOpen(true)
                                  return
                                }
                                throw e
                              }
                            }}
                          >
                            <span className="hidden md:inline">Marcar entregado</span>
                          </Button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
                data={items}
                keyExtractor={(o) => o.id}
              />
              <PaginationCursor
                hasMore={!!deliveriesQuery.data.nextCursor}
                onLoadMore={() => setCursor(deliveriesQuery.data!.nextCursor!)}
                loading={deliveriesQuery.isFetching}
              />
            </>
          )}
        </div>

        <Modal
          isOpen={deliverLocationModalOpen}
          onClose={() => {
            setDeliverLocationModalOpen(false)
            setDeliverWarehouseId('')
            setDeliverLocationId('')
          }}
          title={deliverTarget ? `Seleccionar ubicación para OV ${deliverTarget.number}` : 'Seleccionar ubicación'}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Esta orden no tiene reservas. Selecciona la sucursal y ubicación desde donde se descontará el stock.
            </p>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                label="Sucursal"
                value={deliverWarehouseId}
                onChange={(e) => {
                  setDeliverWarehouseId(e.target.value)
                  setDeliverLocationId('')
                }}
                disabled={warehousesQuery.isLoading || warehousesQuery.isError}
                options={[
                  { value: '', label: warehousesQuery.isLoading ? 'Cargando...' : 'Selecciona una sucursal' },
                  ...((warehousesQuery.data?.items ?? [])
                    .filter((w) => w.isActive)
                    .map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))),
                ]}
              />

              <Select
                label="Ubicación"
                value={deliverLocationId}
                onChange={(e) => setDeliverLocationId(e.target.value)}
                disabled={!deliverWarehouseId || locationsQuery.isLoading || locationsQuery.isError}
                options={[
                  {
                    value: '',
                    label: !deliverWarehouseId
                      ? 'Selecciona sucursal primero'
                      : locationsQuery.isLoading
                        ? 'Cargando...'
                        : 'Selecciona una ubicación',
                  },
                  ...((locationsQuery.data?.items ?? [])
                    .filter((l) => l.isActive)
                    .map((l) => ({ value: l.id, label: l.code }))),
                ]}
              />
            </div>

            {(warehousesQuery.isError || locationsQuery.isError) && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
                Error al cargar sucursales/ubicaciones.
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDeliverLocationModalOpen(false)
                  setDeliverWarehouseId('')
                  setDeliverLocationId('')
                }}
                disabled={deliverMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                onClick={async () => {
                  if (!deliverTarget) return
                  if (!deliverLocationId) {
                    window.alert('Selecciona una ubicación')
                    return
                  }
                  await deliverMutation.mutateAsync({
                    orderId: deliverTarget.orderId,
                    version: deliverTarget.version,
                    fromLocationId: deliverLocationId,
                  })
                  setDeliverLocationModalOpen(false)
                  setDeliverWarehouseId('')
                  setDeliverLocationId('')
                }}
                disabled={!deliverTarget || !deliverLocationId || deliverMutation.isPending}
              >
                {deliverMutation.isPending ? 'Marcando...' : 'Confirmar entrega'}
              </Button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={locationModalOpen}
          onClose={() => setLocationModalOpen(false)}
          title="Dirección de entrega"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {locationModalItem ? formatDeliveryPlace(locationModalItem) : ''}
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setLocationModalOpen(false)}
              >
                Cerrar
              </Button>
              <Button
                onClick={() => {
                  if (!locationModalItem) return
                  const address = formatDeliveryPlace(locationModalItem)
                  const url = locationModalItem.deliveryMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
                  window.open(url, '_blank')
                }}
              >
                Ver en Maps
              </Button>
            </div>
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
