import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useTheme } from '../../providers'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, PaginationCursor, Input, Badge, Modal } from '../../components'
import { useNavigation } from '../../hooks'

type QuoteListItem = {
  id: string
  number: string
  customerId: string
  customerName: string
  status: 'CREATED' | 'PROCESSED'
  quotedBy: string | null
  total: number
  createdAt: string
  itemsCount: number
}

type ListResponse = { items: QuoteListItem[]; nextCursor: string | null }

type ProcessQuoteResponse = {
  id: string
  number: string
  status: string
  version: number
  createdAt: string
}

async function fetchQuotes(token: string, take: number, cursor?: string, customerSearch?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  if (customerSearch) params.append('customerSearch', customerSearch)
  return apiFetch(`/api/v1/sales/quotes?${params}`, { token })
}

async function processQuote(token: string, quoteId: string): Promise<ProcessQuoteResponse> {
  return apiFetch(`/api/v1/sales/quotes/${encodeURIComponent(quoteId)}/process`, { token, method: 'POST' })
}

export function QuotesPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const theme = useTheme()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight')
  const [cursor, setCursor] = useState<string | undefined>()
  const [customerSearch, setCustomerSearch] = useState('')
  const [stockErrorModalOpen, setStockErrorModalOpen] = useState(false)
  const [stockErrorMessage, setStockErrorMessage] = useState<string>('')

  const tableRef = useRef<HTMLDivElement>(null)
  const [showExtraColumns, setShowExtraColumns] = useState(true)

  useEffect(() => {
    const element = tableRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const table = element.querySelector('table')
      if (table) {
        const hasOverflow = table.scrollWidth > element.clientWidth
        setShowExtraColumns(!hasOverflow)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const quotesQuery = useQuery({
    queryKey: ['quotes', cursor, customerSearch],
    queryFn: () => fetchQuotes(auth.accessToken!, 20, cursor, customerSearch || undefined),
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

  const processMutation = useMutation({
    mutationFn: async (quoteId: string) => processQuote(auth.accessToken!, quoteId),
    onError: (err: any) => {
      const msg = String(err?.message ?? '')
      if (msg.toLowerCase().includes('cantidad de existencias insuficientes')) {
        setStockErrorMessage(msg)
        setStockErrorModalOpen(true)
      }
    },
    onSuccess: async (createdOrder) => {
      await queryClient.invalidateQueries({ queryKey: ['quotes'] })
      await queryClient.invalidateQueries({ queryKey: ['orders'] })

      // Jump to Orders list and highlight the created order.
      navigate(`/sales/orders?highlight=${encodeURIComponent(createdOrder.id)}`)
    },
  })

  const processErrorMsg = String((processMutation.error as any)?.message ?? '')
  const isStockError = processMutation.isError && processErrorMsg.toLowerCase().includes('cantidad de existencias insuficientes')

  const iconClass = theme.mode === 'dark' ? 'text-slate-100' : 'text-slate-900'
  const ICON_VIEW = `◉\uFE0E`
  const ICON_EDIT = `✎\uFE0E`
  const ICON_PROCESS = `⟳\uFE0E`

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Cotizaciones" actions={<Button onClick={() => navigate('/catalog/seller')}>Crear Cotización</Button>}>
        {processMutation.isError && !isStockError && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            Error al procesar cotización: {(processMutation.error as any)?.message ?? 'Error'}
          </div>
        )}

        <Modal
          isOpen={stockErrorModalOpen}
          onClose={() => {
            setStockErrorModalOpen(false)
            setStockErrorMessage('')
            processMutation.reset()
          }}
          title="Existencias insuficientes"
          maxWidth="lg"
        >
          <div className="space-y-4">
            <div className="text-slate-900 dark:text-slate-100">{stockErrorMessage}</div>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  // Placeholder: will implement later.
                  window.alert('Funcionalidad "solicitar existencias" pendiente')
                  setStockErrorModalOpen(false)
                  setStockErrorMessage('')
                  processMutation.reset()
                }}
              >
                Solicitar existencias
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setStockErrorModalOpen(false)
                  setStockErrorMessage('')
                  processMutation.reset()
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </Modal>
        <div className="mb-4">
          <Input
            placeholder="Buscar por cliente..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>
        <div ref={tableRef} className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {quotesQuery.isLoading && <Loading />}
          {quotesQuery.error && <ErrorState message="Error al cargar cotizaciones" retry={quotesQuery.refetch} />}
          {quotesQuery.data && quotesQuery.data.items.length === 0 && <EmptyState message="No hay cotizaciones" />}
          {quotesQuery.data && quotesQuery.data.items.length > 0 && (
            <>
              <Table<QuoteListItem>
                columns={[
                  { header: 'Número', accessor: (q) => q.number },
                  { header: 'Cliente', accessor: (q) => q.customerName },
                  {
                    header: 'Estado',
                    accessor: (q) => (
                      <Badge variant={q.status === 'PROCESSED' ? 'success' : 'default'}>
                        {q.status === 'PROCESSED' ? 'PROCESADA' : 'CREADA'}
                      </Badge>
                    ),
                  },
                  { header: 'Cotizado por', accessor: (q) => q.quotedBy ?? '-', className: showExtraColumns ? '' : 'hidden' },
                  { header: 'Productos', accessor: (q) => `${q.itemsCount} productos`, className: showExtraColumns ? '' : 'hidden' },
                  {
                    header: 'Total',
                    accessor: (q) => `Bs. ${q.total.toLocaleString('es-BO', { minimumFractionDigits: 2 })}`
                  },
                  { header: 'Fecha', accessor: (q) => new Date(q.createdAt).toLocaleDateString(), className: showExtraColumns ? '' : 'hidden' },
                  {
                    header: 'Acciones',
                    accessor: (q) => (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Ver"
                          onClick={() => navigate(`/sales/quotes/${q.id}`)}
                          className={iconClass}
                        >
                          {ICON_VIEW}
                        </Button>
                        {q.status !== 'PROCESSED' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Editar"
                              onClick={() => navigate(`/catalog/seller?quoteId=${q.id}`)}
                              className={iconClass}
                            >
                              {ICON_EDIT}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Procesar cotización"
                              onClick={() => processMutation.mutate(q.id)}
                              loading={processMutation.isPending}
                              className={iconClass}
                            >
                              {ICON_PROCESS}
                            </Button>
                          </>
                        )}
                        {q.status === 'PROCESSED' && (
                          <span className={iconClass} title="Procesada">✓</span>
                        )}
                      </div>
                    ),
                    className: 'sticky right-0 bg-white dark:bg-slate-900 z-10'
                  },
                ]}
                data={quotesQuery.data.items}
                keyExtractor={(q) => q.id}
                rowClassName={(q) =>
                  highlightId && q.id === highlightId
                    ? 'ring-2 ring-emerald-500 ring-inset animate-pulse bg-emerald-50/40 dark:bg-emerald-900/10'
                    : ''
                }
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