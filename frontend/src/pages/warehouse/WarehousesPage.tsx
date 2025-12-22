import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, PaginationCursor, Button, Modal, Input } from '../../components'
import { useNavigation } from '../../hooks'

type WarehouseListItem = { id: string; code: string; name: string; isActive: boolean }
type ListResponse = { items: WarehouseListItem[]; nextCursor: string | null }

async function fetchWarehouses(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/warehouses?${params}`, { token })
}

export function WarehousesPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()
  const [cursor, setCursor] = useState<string | undefined>()
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseListItem | null>(null)
  const [editName, setEditName] = useState('')
  const take = 50

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', take, cursor],
    queryFn: () => fetchWarehouses(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const updateWarehouseMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      return apiFetch(`/api/v1/warehouses/${id}`, {
        token: auth.accessToken!,
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      setEditingWarehouse(null)
      setEditName('')
    },
  })

  const handleEdit = (warehouse: WarehouseListItem) => {
    setEditingWarehouse(warehouse)
    setEditName(warehouse.name)
  }

  const handleSaveEdit = () => {
    if (editingWarehouse && editName.trim()) {
      updateWarehouseMutation.mutate({ id: editingWarehouse.id, name: editName.trim() })
    }
  }

  const handleCancelEdit = () => {
    setEditingWarehouse(null)
    setEditName('')
  }

  const handleLoadMore = () => {
    if (warehousesQuery.data?.nextCursor) {
      setCursor(warehousesQuery.data.nextCursor)
    }
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Almacenes">
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
                    accessor: (w) => (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(w)}
                          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => navigate(`/warehouse/warehouses/${w.id}/locations`)}
                          className="text-sm text-[var(--pf-primary)] hover:underline"
                        >
                          Ver Ubicaciones
                        </button>
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
              disabled={updateWarehouseMutation.isPending || !editName.trim()}
            >
              {updateWarehouseMutation.isPending ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>
    </MainLayout>
  )
}
