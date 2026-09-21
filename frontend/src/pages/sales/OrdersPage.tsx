import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, Badge, PaginationCursor, Input } from '../../components'
import { useNavigation, useCursorPagination } from '../../hooks'
import { EyeIcon, TrashIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { useNotifications } from '../../providers/NotificationsProvider'

type OrderListItem = {
  id: string
  number: string
  customerId: string
  customerName: string
  status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'
  version: number
  updatedAt: string
  deliveredAt?: string | null
  paidAt?: string | null
  paidAmount?: number
}

type ListResponse = { items: OrderListItem[]; nextCursor: string | null }

function orderStatusLabel(status: OrderListItem['status']): string {
  if (status === 'DRAFT') return 'Borrador'
  if (status === 'CONFIRMED') return 'Confirmada'
  if (status === 'FULFILLED') return 'Entregada'
  if (status === 'CANCELLED') return 'Cancelada'
  return status
}

async function fetchOrders(token: string, take: number, cursor?: string, customerSearch?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  if (customerSearch) params.append('customerSearch', customerSearch)
  return apiFetch(`/api/v1/sales/orders?${params}`, { token })
}

async function cancelOrder(token: string, id: string, version: number): Promise<{ order: any; quote: any | null }> {
  return apiFetch(`/api/v1/sales/orders/${encodeURIComponent(id)}/cancel`, {
    token,
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}

export function OrdersPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()
  const notifications = useNotifications()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight')
   const [customerSearch, setCustomerSearch] = useState('')
   const [appliedSearch, setAppliedSearch] = useState('')
   const take = 50
   const pag = useCursorPagination()

   const ordersQuery = useQuery({
     queryKey: ['orders', take, pag.currentCursor, appliedSearch],
     queryFn: () => fetchOrders(auth.accessToken!, take, pag.currentCursor, appliedSearch || undefined),
     enabled: !!auth.accessToken,
   })

  const cancelMutation = useMutation({
    mutationFn: async (o: OrderListItem) => cancelOrder(auth.accessToken!, o.id, o.version),
    onSuccess: async (resp) => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      notifications.notify({
        kind: 'success',
        title: 'Orden anulada',
        body: resp?.quote?.id ? 'La cotización volvió a estar disponible.' : 'La orden fue anulada.',
      })
    },
    onError: (err: any) => {
      notifications.notify({ kind: 'error', title: 'No se pudo anular', body: err?.message ?? 'Error desconocido' })
    },
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
        <div className="mb-4">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setAppliedSearch(customerSearch.trim())
              pag.reset()
            }}
            className="flex gap-2 max-w-sm"
          >
            <Input
              placeholder="Buscar por cliente, departamento o ciudad..."
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" icon={<MagnifyingGlassIcon />} type="submit" disabled={customerSearch.length === 0}>
              Buscar
            </Button>
          </form>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {ordersQuery.isLoading && <Loading />}
          {ordersQuery.error && <ErrorState message="Error al cargar órdenes" retry={ordersQuery.refetch} />}
          {ordersQuery.data && ordersQuery.data.items.length === 0 && <EmptyState message="No hay órdenes" />}
          {ordersQuery.data && ordersQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'Número', width: '130px', accessor: (o) => o.number },
                  { header: 'Cliente', width: '200px', accessor: (o) => <span className="truncate block" title={o.customerName}>{o.customerName}</span> },
                  {
                    header: 'Estado',
                    width: '140px',
                    accessor: (o) => (
                      <Badge
                        variant={
                          o.status === 'FULFILLED'
                            ? 'success'
                            : o.status === 'CONFIRMED'
                              ? 'info'
                              : o.status === 'CANCELLED'
                                ? 'danger'
                                : 'default'
                        }
                      >
                        {orderStatusLabel(o.status)}
                      </Badge>
                    ),
                  },
                  { header: 'Última actualización', width: '170px', accessor: (o) => new Date(o.updatedAt).toLocaleDateString() },
                  {
                    header: 'Acciones',
                    className: 'text-center',
                    width: '120px',
                    accessor: (o) => (
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" icon={<EyeIcon className="w-4 h-4" />} onClick={() => navigate(`/sales/orders/${o.id}`)}>Ver</Button>
                        {(() => {
                          const deliveredAt = (o as any).deliveredAt ?? null
                          const paidAt = (o as any).paidAt ?? null
                          const paidAmount = Number((o as any).paidAmount ?? 0)
                          const canCancel = o.status !== 'CANCELLED' && o.status !== 'FULFILLED' && !deliveredAt && !paidAt && paidAmount <= 0
                          if (!canCancel) return null
                          return (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Anular"
                              icon={<TrashIcon className="w-4 h-4 text-red-600" />}
                              disabled={cancelMutation.isPending}
                              onClick={() => {
                                if (cancelMutation.isPending) return
                                const ok = window.confirm('¿Anular esta orden de venta? Esto liberará reservas y la cotización volverá a “no procesada”.')
                                if (!ok) return
                                cancelMutation.mutate(o)
                              }}
                            />
                          )
                        })()}
                      </div>
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
                 onLoadMore={() => pag.goForward(ordersQuery.data!.nextCursor)}
                 loading={ordersQuery.isFetching}
                 currentCount={ordersQuery.data.items.length}
                 currentPage={pag.currentPage}
                 maxPage={ordersQuery.data.nextCursor ? pag.maxVisitedPage + 1 : pag.maxVisitedPage}
                 take={take}
                 canGoBack={pag.canGoBack}
                 onGoBack={pag.goBack}
                 onGoToStart={pag.goToStart}
                 onGoToPage={(page) => pag.goToPage(page)}
              />
            </>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
