import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, PaginationCursor, Modal, Input, Select } from '../../components'
import { useNavigation } from '../../hooks'

type LocationListItem = {
  id: string
  warehouseId: string
  code: string
  type: string
  isActive: boolean
  version: number
  updatedAt: string
}

type ListResponse = { items: LocationListItem[]; nextCursor: string | null }

const LOCATION_TYPE_OPTIONS = [
  { value: 'BIN', label: 'BIN (Contenedor)' },
  { value: 'SHELF', label: 'SHELF (Estante)' },
  { value: 'FLOOR', label: 'FLOOR (Piso)' },
  { value: 'SUB_ALMACEN', label: 'Sub Almacén' },
]

async function fetchLocations(token: string, warehouseId: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/warehouses/${warehouseId}/locations?${params}`, { token })
}

export function LocationsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const { warehouseId } = useParams<{ warehouseId: string }>()
  const [cursor, setCursor] = useState<string | undefined>()
  const take = 50
  const [showCreate, setShowCreate] = useState(false)
  const [createCode, setCreateCode] = useState('')
  const [createType, setCreateType] = useState<'BIN' | 'SHELF' | 'FLOOR' | 'SUB_ALMACEN'>('BIN')
  const [editingLocation, setEditingLocation] = useState<LocationListItem | null>(null)
  const [editCode, setEditCode] = useState('')
  const [editType, setEditType] = useState<'BIN' | 'SHELF' | 'FLOOR' | 'SUB_ALMACEN'>('BIN')
  const [editIsActive, setEditIsActive] = useState(true)
  const [deleteError, setDeleteError] = useState<string>('')
  const queryClient = useQueryClient()

  const locationsQuery = useQuery({
    queryKey: ['locations', warehouseId, take, cursor],
    queryFn: () => fetchLocations(auth.accessToken!, warehouseId!, take, cursor),
    enabled: !!auth.accessToken && !!warehouseId,
  })

  const createLocationMutation = useMutation({
    mutationFn: async (data: { code: string; type: 'BIN' | 'SHELF' | 'FLOOR' | 'SUB_ALMACEN' }) => {
      return apiFetch(`/api/v1/warehouses/${warehouseId}/locations`, {
        method: 'POST',
        token: auth.accessToken!,
        body: JSON.stringify(data),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId] })
      setShowCreate(false)
      setCreateCode('')
      setCreateType('BIN')
    },
  })

  const updateLocationMutation = useMutation({
    mutationFn: async (data: { code: string; type: 'BIN' | 'SHELF' | 'FLOOR' | 'SUB_ALMACEN'; isActive: boolean }) => {
      return apiFetch(`/api/v1/warehouses/${warehouseId}/locations/${editingLocation!.id}`, {
        method: 'PATCH',
        token: auth.accessToken!,
        body: JSON.stringify(data),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId] })
      setEditingLocation(null)
    },
  })

  const deleteLocationMutation = useMutation({
    mutationFn: async (locationId: string) => {
      return apiFetch(`/api/v1/warehouses/${warehouseId}/locations/${locationId}`, {
        method: 'DELETE',
        token: auth.accessToken!,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId] })
      setDeleteError('')
    },
    onError: (error: unknown) => {
      setDeleteError(error instanceof Error ? error.message : 'No se pudo eliminar la ubicación')
    },
  })

  const handleCreateLocation = () => {
    if (!createCode.trim()) return
    createLocationMutation.mutate({ code: createCode.trim(), type: createType })
  }

  const openEditModal = (location: LocationListItem) => {
    setEditingLocation(location)
    setEditCode(location.code)
    setEditType(location.type as 'BIN' | 'SHELF' | 'FLOOR' | 'SUB_ALMACEN')
    setEditIsActive(location.isActive)
  }

  const handleUpdateLocation = () => {
    if (!editingLocation || !editCode.trim()) return
    updateLocationMutation.mutate({ code: editCode.trim(), type: editType, isActive: editIsActive })
  }

  const handleDeleteLocation = (location: LocationListItem) => {
    setDeleteError('')
    if (!window.confirm(`¿Eliminar la ubicación ${location.code}?`)) return
    deleteLocationMutation.mutate(location.id)
  }

  const handleLoadMore = () => {
    if (locationsQuery.data?.nextCursor) {
      setCursor(locationsQuery.data.nextCursor)
    }
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="Ubicaciones"
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/warehouse/warehouses')}>
              Volver a Almacenes
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              ➕ Crear Ubicación
            </Button>
          </>
        }
      >
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {locationsQuery.isLoading && <Loading />}
          {locationsQuery.error && (
            <ErrorState
              message={locationsQuery.error instanceof Error ? locationsQuery.error.message : 'Error al cargar ubicaciones'}
              retry={locationsQuery.refetch}
            />
          )}
          {deleteError && (
            <div className="px-4 pt-4 text-sm text-red-600 dark:text-red-400">{deleteError}</div>
          )}
          {locationsQuery.data && locationsQuery.data.items.length === 0 && (
            <EmptyState message="No hay ubicaciones" />
          )}
          {locationsQuery.data && locationsQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'Código', accessor: (l) => l.code },
                  {
                    header: 'Tipo',
                    accessor: (l) => LOCATION_TYPE_OPTIONS.find((o) => o.value === l.type)?.label ?? l.type,
                  },
                  {
                    header: 'Estado',
                    accessor: (l) => (
                      <span className={l.isActive ? 'text-green-600' : 'text-slate-400'}>
                        {l.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    ),
                  },
                  {
                    header: 'Acciones',
                    accessor: (l) => (
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openEditModal(l)}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteLocation(l)}
                          disabled={!l.isActive || deleteLocationMutation.isPending}
                        >
                          Eliminar
                        </Button>
                      </div>
                    ),
                  },
                ]}
                data={locationsQuery.data.items}
                keyExtractor={(l) => l.id}
              />
              <PaginationCursor
                hasMore={!!locationsQuery.data.nextCursor}
                onLoadMore={handleLoadMore}
                loading={locationsQuery.isFetching}
              />
            </>
          )}
        </div>

        {/* Modal Crear Ubicación */}
        <Modal
          isOpen={showCreate}
          onClose={() => setShowCreate(false)}
          title="Crear Ubicación"
          maxWidth="sm"
        >
          <div className="space-y-4">
            <Input
              label="Código"
              value={createCode}
              onChange={(e) => setCreateCode(e.target.value)}
              placeholder="Ej: BIN-02"
              required
            />
            <Select
              label="Tipo"
              value={createType}
              onChange={(e) => setCreateType(e.target.value as 'BIN' | 'SHELF' | 'FLOOR' | 'SUB_ALMACEN')}
              options={LOCATION_TYPE_OPTIONS}
            />
            {createLocationMutation.error && (
              <div className="text-sm text-red-600 dark:text-red-400">
                Error: {createLocationMutation.error instanceof Error ? createLocationMutation.error.message : 'Error desconocido'}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleCreateLocation}
                disabled={createLocationMutation.isPending || !createCode.trim()}
              >
                {createLocationMutation.isPending ? 'Creando...' : 'Crear'}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Modal Editar Ubicación */}
        <Modal
          isOpen={!!editingLocation}
          onClose={() => setEditingLocation(null)}
          title="Editar Ubicación"
          maxWidth="sm"
        >
          <div className="space-y-4">
            <Input
              label="Código"
              value={editCode}
              onChange={(e) => setEditCode(e.target.value)}
              placeholder="Ej: BIN-02"
              required
            />
            <Select
              label="Tipo"
              value={editType}
              onChange={(e) => setEditType(e.target.value as 'BIN' | 'SHELF' | 'FLOOR' | 'SUB_ALMACEN')}
              options={LOCATION_TYPE_OPTIONS}
            />
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={editIsActive}
                onChange={(e) => setEditIsActive(e.target.checked)}
                disabled={updateLocationMutation.isPending}
              />
              Activo
            </label>
            {updateLocationMutation.error && (
              <div className="text-sm text-red-600 dark:text-red-400">
                Error: {updateLocationMutation.error instanceof Error ? updateLocationMutation.error.message : 'Error desconocido'}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditingLocation(null)}>
                Cancelar
              </Button>
              <Button
                onClick={handleUpdateLocation}
                disabled={updateLocationMutation.isPending || !editCode.trim()}
              >
                {updateLocationMutation.isPending ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
