import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getProductLabel } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, PaginationCursor, Button, Modal, Input, Select, CitySelector } from '../../components'
import { useNavigation } from '../../hooks'
import { PencilIcon, ArrowPathIcon, MapPinIcon, PlusIcon } from '@heroicons/react/24/outline'

type WarehouseListItem = { id: string; code: string; name: string; city?: string | null; isActive: boolean; totalQuantity: string }
type ListResponse = { items: WarehouseListItem[]; nextCursor: string | null }

type WarehouseStockRow = {
  id: string
  quantity: string
  reservedQuantity?: string
  updatedAt: string
  productId: string
  batchId: string
  locationId: string
  product: { sku: string; name: string; genericName?: string | null }
  batch: { batchNumber: string; expiresAt: string | null; status: string }
  location: { id: string; code: string; warehouse: { id: string; code: string; name: string } }
}

type WarehouseStockResponse = { items: WarehouseStockRow[] }

type LocationListItem = { id: string; warehouseId: string; code: string; isActive: boolean }

async function fetchWarehouseStock(token: string, warehouseId: string): Promise<WarehouseStockResponse> {
  const params = new URLSearchParams({ warehouseId, take: '200' })
  return apiFetch(`/api/v1/reports/stock/balances-expanded?${params}`, { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  return apiFetch(`/api/v1/warehouses/${warehouseId}/locations?${params}`, { token })
}

async function createTransferMovement(
  token: string,
  data: {
    productId: string
    batchId: string
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

async function fetchWarehouses(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/warehouses?${params}`, { token })
}

export function WarehousesPage() {
  const auth = useAuth()
  const tenant = useTenant()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()
  const [cursor, setCursor] = useState<string | undefined>()
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseListItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editCity, setEditCity] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createCode, setCreateCode] = useState('')
  const [createName, setCreateName] = useState('')
  const [createCity, setCreateCity] = useState('')

  const tenantCountry = (tenant.branding?.country ?? '').trim() || 'BOLIVIA'

  const [stockWarehouse, setStockWarehouse] = useState<WarehouseListItem | null>(null)
  const [movingRow, setMovingRow] = useState<WarehouseStockRow | null>(null)
  const [moveQty, setMoveQty] = useState('')
  const [moveToWarehouseId, setMoveToWarehouseId] = useState('')
  const [moveToLocationId, setMoveToLocationId] = useState('')
  const [moveError, setMoveError] = useState('')
  const take = 50

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', take, cursor],
    queryFn: () => fetchWarehouses(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const warehouseStockQuery = useQuery({
    queryKey: ['warehouseStock', stockWarehouse?.id],
    queryFn: () => fetchWarehouseStock(auth.accessToken!, stockWarehouse!.id),
    enabled: !!auth.accessToken && !!stockWarehouse?.id,
  })

  const destinationLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'forWarehouseMove', moveToWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, moveToWarehouseId),
    enabled: !!auth.accessToken && !!moveToWarehouseId,
  })

  const activeWarehouses = useMemo(
    () => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive),
    [warehousesQuery.data],
  )

  const updateWarehouseMutation = useMutation({
    mutationFn: async ({ id, name, city }: { id: string; name: string; city: string }) => {
      return apiFetch(`/api/v1/warehouses/${id}`, {
        token: auth.accessToken!,
        method: 'PATCH',
        body: JSON.stringify({ name, city }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      setEditingWarehouse(null)
      setEditName('')
      setEditCity('')
    },
  })

  const createWarehouseMutation = useMutation({
    mutationFn: async ({ code, name, city }: { code: string; name: string; city: string }) => {
      return apiFetch(`/api/v1/warehouses`, {
        token: auth.accessToken!,
        method: 'POST',
        body: JSON.stringify({ code, name, city }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      setShowCreate(false)
      setCreateCode('')
      setCreateName('')
      setCreateCity('')
    },
  })

  const moveMutation = useMutation({
    mutationFn: async () => {
      if (!movingRow) throw new Error('Seleccioná una existencia para mover')

      const qtyNum = Number(moveQty)
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) throw new Error('Ingresá una cantidad válida (mayor a 0)')

      const total = Number(movingRow.quantity || '0')
      const reserved = Number(movingRow.reservedQuantity ?? '0')
      const available = Math.max(0, total - reserved)
      if (qtyNum > available) throw new Error(`No podés mover más de lo disponible (${available}).`)
      if (!moveToWarehouseId) throw new Error('Seleccioná el almacén destino')
      if (!moveToLocationId) throw new Error('Seleccioná la ubicación destino')

      return createTransferMovement(auth.accessToken!, {
        productId: movingRow.productId,
        batchId: movingRow.batchId,
        fromLocationId: movingRow.locationId,
        toLocationId: moveToLocationId,
        quantity: String(qtyNum),
      })
    },
    onSuccess: async () => {
      await warehouseStockQuery.refetch()
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      setMovingRow(null)
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

  const handleEdit = (warehouse: WarehouseListItem) => {
    setEditingWarehouse(warehouse)
    setEditName(warehouse.name)
    setEditCity((warehouse.city ?? '').toString())
  }

  const handleSaveEdit = () => {
    if (editingWarehouse && editName.trim() && editCity.trim()) {
      updateWarehouseMutation.mutate({ id: editingWarehouse.id, name: editName.trim(), city: editCity.trim() })
    }
  }

  const handleCancelEdit = () => {
    setEditingWarehouse(null)
    setEditName('')
    setEditCity('')
  }

  const handleLoadMore = () => {
    if (warehousesQuery.data?.nextCursor) {
      setCursor(warehousesQuery.data.nextCursor)
    }
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="🏬 Sucursales"
        actions={
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setShowCreate(true)}>
            Crear Sucursal
          </Button>
        }
      >
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {warehousesQuery.isLoading && <Loading />}
          {warehousesQuery.error && (
            <ErrorState
              message={warehousesQuery.error instanceof Error ? warehousesQuery.error.message : 'Error al cargar almacenes'}
              retry={warehousesQuery.refetch}
            />
          )}
          {warehousesQuery.data && warehousesQuery.data.items.length === 0 && (
            <EmptyState message="No hay almacenes" />
          )}
          {warehousesQuery.data && warehousesQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'Código', accessor: (w) => w.code },
                  { header: 'Nombre', accessor: (w) => w.name },
                  { header: 'Ciudad', accessor: (w) => w.city || '-' },
                  {
                    header: 'Estado',
                    accessor: (w) => (
                      <span className={w.isActive ? 'text-green-600' : 'text-slate-400'}>
                        {w.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    ),
                  },
                  {
                    header: 'Acciones',
                    className: 'text-center w-auto',
                    accessor: (w) => (
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setStockWarehouse(w)
                            setMovingRow(null)
                            setMoveQty('')
                            setMoveToWarehouseId('')
                            setMoveToLocationId('')
                            setMoveError('')
                          }}
                        >
                          Ver stock
                        </Button>
                        <Button variant="ghost" size="sm" icon={<PencilIcon className="w-4 h-4" />} onClick={() => handleEdit(w)}>
                          <span className="hidden sm:inline">Editar</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<MapPinIcon className="w-4 h-4" />}
                          onClick={() => navigate(`/warehouse/warehouses/${w.id}/locations`)}
                        >
                          <span className="hidden sm:inline">Ubicaciones</span>
                        </Button>
                      </div>
                    ),
                  },
                ]}
                data={warehousesQuery.data.items}
                keyExtractor={(w) => w.id}
              />
              <PaginationCursor
                hasMore={!!warehousesQuery.data.nextCursor}
                onLoadMore={handleLoadMore}
                loading={warehousesQuery.isFetching}
              />
            </>
          )}
        </div>
      </PageContainer>

      <Modal
        isOpen={showCreate}
        onClose={() => {
          setShowCreate(false)
          setCreateCode('')
          setCreateName('')
          setCreateCity('')
        }}
        title="➕ Crear Sucursal"
        maxWidth="md"
      >
        <div className="space-y-4">
          <Input label="Código" value={createCode} onChange={(e) => setCreateCode(e.target.value)} placeholder="BR-01" />
          <Input label="Nombre" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Sucursal" />
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Ciudad
            </label>
            <CitySelector
              country={tenantCountry}
              value={createCity}
              onChange={setCreateCity}
            />
          </div>

          {createWarehouseMutation.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              Error:{' '}
              {(createWarehouseMutation.error as any)?.response?.data?.message ||
                (createWarehouseMutation.error instanceof Error
                  ? createWarehouseMutation.error.message
                  : 'Error al crear sucursal')}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreate(false)
                setCreateCode('')
                setCreateName('')
                setCreateCity('')
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => createWarehouseMutation.mutate({ code: createCode.trim(), name: createName.trim(), city: createCity.trim() })}
              disabled={!createCode.trim() || !createName.trim() || !createCity.trim()}
              loading={createWarehouseMutation.isPending}
            >
              Crear
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!editingWarehouse}
        onClose={handleCancelEdit}
        title="Editar Sucursal"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Nombre de la Sucursal
            </label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Ej: Sucursal Central"
              disabled={updateWarehouseMutation.isPending}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Ciudad</label>
            <CitySelector
              country={tenantCountry}
              value={editCity}
              onChange={setEditCity}
              disabled={updateWarehouseMutation.isPending}
            />
          </div>

          {updateWarehouseMutation.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              Error: {(updateWarehouseMutation.error as any)?.response?.data?.message || 'Error al actualizar sucursal'}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleCancelEdit} disabled={updateWarehouseMutation.isPending}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSaveEdit} 
              disabled={updateWarehouseMutation.isPending || !editName.trim() || !editCity.trim()}
            >
              {updateWarehouseMutation.isPending ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!stockWarehouse}
        onClose={() => {
          setStockWarehouse(null)
          setMovingRow(null)
          setMoveQty('')
          setMoveToWarehouseId('')
          setMoveToLocationId('')
          setMoveError('')
        }}
        title={stockWarehouse ? `Stock: ${stockWarehouse.code} - ${stockWarehouse.name}` : 'Stock'}
        maxWidth="xl"
      >
        <div className="space-y-4">
          {warehouseStockQuery.isLoading && <Loading />}
          {warehouseStockQuery.error && (
            <ErrorState
              message={
                warehouseStockQuery.error instanceof Error
                  ? warehouseStockQuery.error.message
                  : 'Error al cargar stock'
              }
              retry={warehouseStockQuery.refetch}
            />
          )}

          {warehouseStockQuery.data && warehouseStockQuery.data.items.length === 0 && (
            <EmptyState message="No hay existencias en este almacén" />
          )}

          {warehouseStockQuery.data && warehouseStockQuery.data.items.length > 0 && (
            <Table
              columns={[
                { header: 'Producto', accessor: (r) => getProductLabel(r.product) },
                { header: 'Lote', accessor: (r) => r.batch.batchNumber },
                {
                  header: 'Vence',
                  accessor: (r) => (r.batch.expiresAt ? new Date(r.batch.expiresAt).toLocaleDateString() : '-'),
                },
                { header: 'Ubicación', accessor: (r) => r.location.code },
                { header: 'Total', accessor: (r) => r.quantity },
                { header: 'Reservado', accessor: (r) => r.reservedQuantity ?? '0' },
                {
                  header: 'Disponible',
                  accessor: (r) => {
                    const total = Number(r.quantity || '0')
                    const reserved = Number(r.reservedQuantity ?? '0')
                    return String(Math.max(0, total - reserved))
                  },
                },
                {
                  header: 'Acciones',
                  className: 'text-center',
                  accessor: (r) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ArrowPathIcon className="w-4 h-4" />}
                      onClick={() => {
                        setMovingRow(r)
                        setMoveQty('')
                        setMoveToWarehouseId('')
                        setMoveToLocationId('')
                        setMoveError('')
                      }}
                    >
                      Mover
                    </Button>
                  ),
                },
              ]}
              data={warehouseStockQuery.data.items}
              keyExtractor={(r) => r.id}
            />
          )}

          {movingRow && (
            <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
              <div className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Mover existencia</div>

              <div className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                {(() => {
                  const total = Number(movingRow.quantity || '0')
                  const reserved = Number(movingRow.reservedQuantity ?? '0')
                  const available = Math.max(0, total - reserved)
                  return (
                    <>
                      Origen: {movingRow.location.warehouse.code} / {movingRow.location.code} · {movingRow.product.sku} · Lote{' '}
                      {movingRow.batch.batchNumber} · Disponible {available} ({reserved} res. · {total} total)
                    </>
                  )
                })()}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  label="Cantidad"
                  type="number"
                  value={moveQty}
                  onChange={(e) => setMoveQty(e.target.value)}
                  min={0}
                  disabled={moveMutation.isPending}
                />
                <Select
                  label="Almacén destino"
                  value={moveToWarehouseId}
                  onChange={(e) => {
                    setMoveToWarehouseId(e.target.value)
                    setMoveToLocationId('')
                  }}
                  options={activeWarehouses.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))}
                  disabled={moveMutation.isPending || warehousesQuery.isLoading}
                />
                <Select
                  label="Ubicación destino"
                  value={moveToLocationId}
                  onChange={(e) => setMoveToLocationId(e.target.value)}
                  options={(destinationLocationsQuery.data?.items ?? [])
                    .filter((l) => l.isActive)
                    .map((l) => ({ value: l.id, label: l.code }))}
                  disabled={moveMutation.isPending || !moveToWarehouseId || destinationLocationsQuery.isLoading}
                />
              </div>

              {moveError && (
                <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {moveError}
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMovingRow(null)
                    setMoveQty('')
                    setMoveToWarehouseId('')
                    setMoveToLocationId('')
                    setMoveError('')
                  }}
                  disabled={moveMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button onClick={() => moveMutation.mutate()} disabled={moveMutation.isPending}>
                  {moveMutation.isPending ? 'Moviendo...' : 'Mover'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </MainLayout>
  )
}
