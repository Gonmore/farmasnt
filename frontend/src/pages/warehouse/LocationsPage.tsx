import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, PaginationCursor } from '../../components'
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

  const locationsQuery = useQuery({
    queryKey: ['locations', warehouseId, take, cursor],
    queryFn: () => fetchLocations(auth.accessToken!, warehouseId!, take, cursor),
    enabled: !!auth.accessToken && !!warehouseId,
  })

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
          <Button variant="secondary" onClick={() => navigate('/warehouse/warehouses')}>
            Volver a Almacenes
          </Button>
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
          {locationsQuery.data && locationsQuery.data.items.length === 0 && (
            <EmptyState message="No hay ubicaciones" />
          )}
          {locationsQuery.data && locationsQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'Código', accessor: (l) => l.code },
                  { header: 'Tipo', accessor: (l) => l.type },
                  {
                    header: 'Estado',
                    accessor: (l) => (
                      <span className={l.isActive ? 'text-green-600' : 'text-slate-400'}>
                        {l.isActive ? 'Activo' : 'Inactivo'}
                      </span>
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
      </PageContainer>
    </MainLayout>
  )
}
