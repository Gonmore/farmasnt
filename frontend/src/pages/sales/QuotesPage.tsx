import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, PaginationCursor, Input, Badge, Modal } from '../../components'
import { useNavigation } from '../../hooks'
import { EyeIcon, PencilIcon, ArrowPathIcon, PlusIcon } from '@heroicons/react/24/outline'
import { useNotifications } from '../../providers/NotificationsProvider'

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

async function requestQuoteStock(token: string, quoteId: string): Promise<{ ok: true; city: string; items: any[] }> {
  return apiFetch(`/api/v1/sales/quotes/${encodeURIComponent(quoteId)}/request-stock`, { token, method: 'POST' })
}

export function QuotesPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()
  const notifications = useNotifications()
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

  const requestStockMutation = useMutation({
    mutationFn: async (quoteId: string) => requestQuoteStock(auth.accessToken!, quoteId),
  })

  const processErrorMsg = String((processMutation.error as any)?.message ?? '')
  const isStockError = processMutation.isError && processErrorMsg.toLowerCase().includes('cantidad de existencias insuficientes')

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Cotizaciones" actions={<Button variant="primary" icon={<PlusIcon />} onClick={() => navigate('/catalog/seller')}>Crear Cotización</Button>}>
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
                loading={requestStockMutation.isPending}
                onClick={async () => {
                  const quoteId = processMutation.variables
                  if (!quoteId) return

                  try {
                    const res = await requestStockMutation.mutateAsync(quoteId)
                    notifications.notify({
                      kind: 'warning',
                      title: '📣 Solicitud de existencias enviada',
                      body: (res as any)?.items?.length
                        ? `Se generó la solicitud y se notificó a los usuarios.`
                        : 'No se detectaron faltantes; no se generó solicitud.',
                      linkTo: '/stock/movements',
                    })
                    setStockErrorModalOpen(false)
                    setStockErrorMessage('')
                    processMutation.reset()
                  } catch (e: any) {
                    notifications.notify({ kind: 'error', title: 'No se pudo enviar la solicitud', body: e?.message ?? 'Error', linkTo: '/stock/movements' })
                  }
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
                    className: 'text-center w-auto',
                    accessor: (q) => (
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<EyeIcon className="w-4 h-4" />}
                          onClick={() => navigate(`/sales/quotes/${q.id}`)}
                        >
                          Ver
                        </Button>
                        {q.status !== 'PROCESSED' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<PencilIcon className="w-4 h-4" />}
                              onClick={() => navigate(`/catalog/seller?quoteId=${q.id}`)}
                            >
                              Editar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<ArrowPathIcon className="w-4 h-4" />}
                              onClick={() => processMutation.mutate(q.id)}
                              loading={processMutation.isPending}
                            >
                              Procesar
                            </Button>
                          </>
                        )}
                      </div>
                    ),
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