import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, PaginationCursor, Input } from '../../components'
import { useNavigation } from '../../hooks'

type QuoteListItem = {
  id: string
  number: string
  customerId: string
  customerName: string
  total: number
  createdAt: string
  itemsCount: number
}

type ListResponse = { items: QuoteListItem[]; nextCursor: string | null }

async function fetchQuotes(token: string, take: number, cursor?: string, customerSearch?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  if (customerSearch) params.append('customerSearch', customerSearch)
  return apiFetch(`/api/v1/sales/quotes?${params}`, { token })
}

export function QuotesPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const [cursor, setCursor] = useState<string | undefined>()
  const [customerSearch, setCustomerSearch] = useState('')

  const quotesQuery = useQuery({
    queryKey: ['quotes', cursor, customerSearch],
    queryFn: () => fetchQuotes(auth.accessToken!, 20, cursor, customerSearch || undefined),
    enabled: !!auth.accessToken,
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Cotizaciones" actions={<Button onClick={() => navigate('/catalog/seller')}>Crear Cotización</Button>}>
        <div className="mb-4">
          <Input
            placeholder="Buscar por cliente..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {quotesQuery.isLoading && <Loading />}
          {quotesQuery.error && <ErrorState message="Error al cargar cotizaciones" retry={quotesQuery.refetch} />}
          {quotesQuery.data && quotesQuery.data.items.length === 0 && <EmptyState message="No hay cotizaciones" />}
          {quotesQuery.data && quotesQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'Número', accessor: (q) => q.number },
                  { header: 'Cliente', accessor: (q) => q.customerName },
                  { header: 'Productos', accessor: (q) => `${q.itemsCount} productos` },
                  {
                    header: 'Total',
                    accessor: (q) => `Bs. ${q.total.toLocaleString('es-BO', { minimumFractionDigits: 2 })}`
                  },
                  { header: 'Fecha', accessor: (q) => new Date(q.createdAt).toLocaleDateString() },
                  {
                    header: 'Acciones',
                    accessor: (q) => (
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/quotes/${q.id}`)}>
                          Ver
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/catalog/seller?quoteId=${q.id}`)}>
                          Editar
                        </Button>
                      </div>
                    ),
                  },
                ]}
                data={quotesQuery.data.items}
                keyExtractor={(q) => q.id}
              />
              <PaginationCursor
                hasMore={!!quotesQuery.data.nextCursor}
                onLoadMore={() => setCursor(quotesQuery.data!.nextCursor!)}
                loading={quotesQuery.isFetching}
              />
            </>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}