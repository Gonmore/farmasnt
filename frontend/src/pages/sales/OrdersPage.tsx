import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, Badge, PaginationCursor } from '../../components'
import { useNavigation } from '../../hooks'

type OrderListItem = {
  id: string
  number: string
  customerId: string
  status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'
  updatedAt: string
}

type ListResponse = { items: OrderListItem[]; nextCursor: string | null }

async function fetchOrders(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/sales/orders?${params}`, { token })
}

export function OrdersPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight')
  const [cursor, setCursor] = useState<string | undefined>()

  const ordersQuery = useQuery({
    queryKey: ['orders', cursor],
    queryFn: () => fetchOrders(auth.accessToken!, 20, cursor),
    enabled: !!auth.accessToken,
  })

  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      next.delete('highlight')
      setSearchParams(next, { replace: true })
    }, 4500)
    return () => clearTimeout(t)
  }, [highlightId, searchParams, setSearchParams])

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Órdenes de Venta" actions={<Button onClick={() => navigate('/sales/quotes')}>Ir a cotizaciones</Button>}>
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {ordersQuery.isLoading && <Loading />}
          {ordersQuery.error && <ErrorState message="Error al cargar órdenes" retry={ordersQuery.refetch} />}
          {ordersQuery.data && ordersQuery.data.items.length === 0 && <EmptyState message="No hay órdenes" />}
          {ordersQuery.data && ordersQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'Número', accessor: (o) => o.number },
                  {
                    header: 'Estado',
                    accessor: (o) => (
                      <Badge variant={o.status === 'FULFILLED' ? 'success' : o.status === 'CONFIRMED' ? 'info' : 'default'}>
                        {o.status}
                      </Badge>
                    ),
                  },
                  { header: 'Última actualización', accessor: (o) => new Date(o.updatedAt).toLocaleDateString() },
                  {
                    header: 'Acciones',
                    accessor: (o) => (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/orders/${o.id}`)}>
                        Ver
                      </Button>
                    ),
                  },
                ]}
                data={ordersQuery.data.items}
                keyExtractor={(o) => o.id}
                rowClassName={(o) =>
                  highlightId && o.id === highlightId
                    ? 'ring-2 ring-emerald-500 ring-inset animate-pulse bg-emerald-50/40 dark:bg-emerald-900/10'
                    : ''
                }
              />
              <PaginationCursor
                hasMore={!!ordersQuery.data.nextCursor}
                onLoadMore={() => setCursor(ordersQuery.data!.nextCursor!)}
                loading={ordersQuery.isFetching}
              />
            </>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
