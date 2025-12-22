import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, PaginationCursor } from '../../components'
import { useNavigation } from '../../hooks'

type ProductListItem = {
  id: string
  sku: string
  name: string
  isActive: boolean
  version: number
  updatedAt: string
}

type ListResponse = { items: ProductListItem[]; nextCursor: string | null }

async function fetchProducts(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/products?${params}`, { token })
}

export function ProductsListPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const [cursor, setCursor] = useState<string | undefined>()
  const take = 20

  const productsQuery = useQuery({
    queryKey: ['products', take, cursor],
    queryFn: () => fetchProducts(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const handleLoadMore = () => {
    if (productsQuery.data?.nextCursor) {
      setCursor(productsQuery.data.nextCursor)
    }
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="Productos"
        actions={
          <Button onClick={() => navigate('/catalog/products/new')}>
            Crear Producto
          </Button>
        }
      >
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {productsQuery.isLoading && <Loading />}
          {productsQuery.error && (
            <ErrorState
              message={productsQuery.error instanceof Error ? productsQuery.error.message : 'Error al cargar productos'}
              retry={productsQuery.refetch}
            />
          )}
          {productsQuery.data && productsQuery.data.items.length === 0 && (
            <EmptyState
              message="No hay productos"
              action={
                <Button onClick={() => navigate('/catalog/products/new')}>
                  Crear primer producto
                </Button>
              }
            />
          )}
          {productsQuery.data && productsQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'SKU', accessor: (p) => p.sku },
                  { header: 'Nombre', accessor: (p) => p.name },
                  {
                    header: 'Estado',
                    accessor: (p) => (
                      <span className={p.isActive ? 'text-green-600' : 'text-slate-400'}>
                        {p.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    ),
                  },
                  {
                    header: 'Acciones',
                    accessor: (p) => (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/catalog/products/${p.id}`)}>
                        Ver
                      </Button>
                    ),
                  },
                ]}
                data={productsQuery.data.items}
                keyExtractor={(p) => p.id}
              />
              <PaginationCursor
                hasMore={!!productsQuery.data.nextCursor}
                onLoadMore={handleLoadMore}
                loading={productsQuery.isFetching}
              />
            </>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
