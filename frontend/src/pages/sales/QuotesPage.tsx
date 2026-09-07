import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { formatMoney } from '../../lib/numberFormat'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, PaginationCursor, Input, Select, Badge, Modal, Loading, ErrorState } from '../../components'
import { useNavigation, usePermissions } from '../../hooks'
import { EyeIcon, ArrowPathIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline'
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
  locationCode?: string | null
}

type ListResponse = { items: QuoteListItem[]; nextCursor: string | null }

type QuoteDetailLine = {
  id: string
  productId: string
  productName: string
  productSku: string
  quantity: number
  presentationQuantity: number | null
  presentationName: string | null
  baseUnitAbbreviation: string
}

type QuoteDetail = {
  id: string
  number: string
  customerCity: string | null
  locationId?: string | null
  locationCode?: string | null // <-- NUEVO
  locationName?: string | null // <-- NUEVO
  lines: QuoteDetailLine[]
}

type SubLocationItem = {
  id: string
  code: string
  warehouse: { id: string; code: string; name: string; city: string | null }
}

type FefoSuggestionItem = {
  batchId: string
  batchNumber: string
  expiresAt: string | null
  status: string
  quantity: string
}

type ProcessQuoteResponse = {
  id: string
  number: string
  status: string
  version: number
  createdAt: string
}

type AdminUserListItem = {
  id: string
  email: string
  fullName: string | null
  isActive: boolean
  createdAt: string
  roleIds?: string[]
  roles?: Array<{ id: string; code: string; name: string }>
}

async function fetchUsers(token: string): Promise<{ items: AdminUserListItem[] }> {
  return apiFetch(`/api/v1/admin/users`, { token })
}

async function fetchQuotes(token: string, take: number, cursor?: string, customerSearch?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  if (customerSearch) params.append('customerSearch', customerSearch)
  return apiFetch(`/api/v1/sales/quotes?${params}`, { token })
}

async function fetchQuoteDetail(token: string, quoteId: string): Promise<QuoteDetail> {
  return apiFetch(`/api/v1/sales/quotes/${encodeURIComponent(quoteId)}`, { token })
}

async function fetchSubLocations(token: string, city?: string, warehouseId?: string | null): Promise<{ items: SubLocationItem[] }> {
  const params = new URLSearchParams()
  if (city) params.set('city', city)
  if (warehouseId) params.set('warehouseId', warehouseId)
  return apiFetch(`/api/v1/warehouses/sub-locations?${params}`, { token })
}

async function fetchFefoSuggestions(token: string, locationId: string, productId: string): Promise<{ items: FefoSuggestionItem[] }> {
  const params = new URLSearchParams({ locationId, productId, take: '50' })
  return apiFetch(`/api/v1/stock/fefo-suggestions?${params}`, { token })
}

async function processQuote(
  token: string,
  quoteId: string,
  body?: { locationId?: string; sellerId?: string; lineBatches?: Array<{ quoteLineId: string; batchId: string }> },
): Promise<ProcessQuoteResponse> {
  return apiFetch(`/api/v1/sales/quotes/${encodeURIComponent(quoteId)}/process`, {
    token,
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

async function deleteQuote(token: string, quoteId: string): Promise<{ success: true }> {
  return apiFetch(`/api/v1/sales/quotes/${encodeURIComponent(quoteId)}`, { token, method: 'DELETE' })
}

async function requestQuoteStock(token: string, quoteId: string): Promise<{ ok: true; city: string; items: any[] }> {
  return apiFetch(`/api/v1/sales/quotes/${encodeURIComponent(quoteId)}/request-stock`, { token, method: 'POST' })
}

export function QuotesPage() {
   const auth = useAuth()
   const navigate = useNavigate()
   const navGroups = useNavigation()
   const permissions = usePermissions()
   const userWarehouseId = permissions.warehouseId ?? null
  const queryClient = useQueryClient()
  const notifications = useNotifications()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight')
  const [cursor, setCursor] = useState<string | undefined>()
  const [customerSearch, setCustomerSearch] = useState('')
  const [stockErrorModalOpen, setStockErrorModalOpen] = useState(false)
  const [stockErrorMessage, setStockErrorMessage] = useState<string>('')
  const [processSellerId, setProcessSellerId] = useState<string>('')

  // Modal de procesamiento
  const [processModalQuoteId, setProcessModalQuoteId] = useState<string | null>(null)
  const [processLocationId, setProcessLocationId] = useState<string>('')
  const [lineBatchSelections, setLineBatchSelections] = useState<Record<string, string>>({})

  const quoteDetailQuery = useQuery({
    queryKey: ['quotes', 'detail', processModalQuoteId],
    queryFn: () => fetchQuoteDetail(auth.accessToken!, processModalQuoteId!),
    enabled: !!auth.accessToken && !!processModalQuoteId,
  })

  // Usar la ubicación de la cotización si ya viene definida, o el selector local
  const effectiveLocationId = processLocationId || quoteDetailQuery.data?.locationId || ''

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => fetchUsers(auth.accessToken!),
    enabled: !!auth.accessToken && !!processModalQuoteId,
  })

  const subLocationsQuery = useQuery({
    queryKey: ['warehouses', 'sub-locations', quoteDetailQuery.data?.customerCity ?? '', userWarehouseId],
    queryFn: () => fetchSubLocations(auth.accessToken!, quoteDetailQuery.data?.customerCity ?? undefined, userWarehouseId),
    enabled: !!auth.accessToken && !!processModalQuoteId && !!quoteDetailQuery.data && !!userWarehouseId,
  })

  const quoteLines = quoteDetailQuery.data?.lines ?? []
  
  // Consulta automática de sugerencias FEFO para cada producto de la cotización
  const fefoQueries = useQueries({
    queries: quoteLines.map((line) => ({
      queryKey: ['stock', 'fefo-suggestions', effectiveLocationId, line.productId],
      queryFn: () => fetchFefoSuggestions(auth.accessToken!, effectiveLocationId, line.productId),
      enabled: !!auth.accessToken && !!effectiveLocationId,
    })),
  })

  const fefoByProductId = new Map(quoteLines.map((line, idx) => [line.productId, fefoQueries[idx]]))

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
    mutationFn: async (args: { quoteId: string; locationId?: string; sellerId?: string; lineBatches?: Array<{ quoteLineId: string; batchId: string }> }) =>
      processQuote(auth.accessToken!, args.quoteId, { locationId: args.locationId, sellerId: args.sellerId, lineBatches: args.lineBatches }),
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
      closeProcessModal()
      navigate(`/sales/orders?highlight=${encodeURIComponent(createdOrder.id)}`)
    },
  })

  const openProcessModal = (quoteId: string) => {
    setProcessModalQuoteId(quoteId)
    setProcessLocationId('')
    setProcessSellerId('')
    setLineBatchSelections({})
    processMutation.reset()
  }

  const closeProcessModal = () => {
    setProcessModalQuoteId(null)
    setProcessLocationId('')
    setProcessSellerId('')
    setLineBatchSelections({})
  }

  const confirmProcess = () => {
    if (!processModalQuoteId) return
    
    // Si el usuario seleccionó lotes específicos manualmente los enviamos; de lo contrario el backend usará FEFO automático
    const lineBatches = Object.entries(lineBatchSelections)
      .filter(([, batchId]) => !!batchId)
      .map(([quoteLineId, batchId]) => ({ quoteLineId, batchId }))

    processMutation.mutate({
      quoteId: processModalQuoteId,
      locationId: effectiveLocationId || undefined,
      sellerId: processSellerId || undefined,
      lineBatches: lineBatches.length > 0 ? lineBatches : undefined,
    })
  }

  const requestStockMutation = useMutation({
    mutationFn: async (quoteId: string) => requestQuoteStock(auth.accessToken!, quoteId),
  })

  const deleteMutation = useMutation({
    mutationFn: async (quoteId: string) => deleteQuote(auth.accessToken!, quoteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      notifications.notify({ kind: 'success', title: 'Cotización desactivada', body: 'La cotización ha sido desactivada exitosamente.' })
    },
    onError: (err: any) => {
      notifications.notify({ kind: 'error', title: 'Error al desactivar', body: err?.message ?? 'Error desconocido' })
    },
  })

  const processErrorMsg = String((processMutation.error as any)?.message ?? '')
  const isStockError = processMutation.isError && processErrorMsg.toLowerCase().includes('cantidad de existencias insuficientes')

  // Obtener los nombres de forma segura para mostrarlos u compararlos
    const originalLocationId = quoteDetailQuery.data?.locationId ?? ''
    
    // Si processLocationId está vacío, significa que se usará la ubicación por defecto (la misma de la cotización)
    const finalProcessLocationId = processLocationId || originalLocationId

    const originalLocationName = 
      quoteDetailQuery.data?.locationCode || 
      subLocationsQuery.data?.items.find(l => l.id === originalLocationId)?.code || 
      'la ubicación original'

    const newLocationName = 
      subLocationsQuery.data?.items.find(l => l.id === finalProcessLocationId)?.code || 
      subLocationsQuery.data?.items.find(l => l.id === finalProcessLocationId)?.warehouse?.code || 
      'la nueva ubicación'

    // LOG de depuración para que veas exactamente qué IDs y nombres se están comparando en consola
    console.log('[DEBUG UMBRAL]:', {
      originalLocationId,
      processLocationId,
      finalProcessLocationId,
      originalLocationName,
      newLocationName
    })

    // Hay desajuste ÚNICAMENTE si el usuario seleccionó explícitamente un ID distinto 
    // Y los nombres normalizados son diferentes. Si se llaman igual ("Privado" y "Privado"), no salta la alerta.
    const isLocationMismatch = Boolean(
      processLocationId && 
      originalLocationId && 
      processLocationId !== originalLocationId &&
      originalLocationName.trim().toLowerCase() !== newLocationName.trim().toLowerCase()
    )

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
          closeOnBackdropClick={false}
          maxWidth="lg"
        >
          <div className="space-y-4">
            <div className="text-slate-900 dark:text-slate-100">{stockErrorMessage}</div>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                loading={requestStockMutation.isPending}
                onClick={async () => {
                  const quoteId = processMutation.variables?.quoteId
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

        {/* Modal: Procesar Cotización con resumen de productos y lotes */}
        <Modal
          isOpen={!!processModalQuoteId}
          onClose={closeProcessModal}
          title="Procesar cotización a Orden de Venta"
          maxWidth="xl"
          closeOnBackdropClick={false}
        >
          <div className="space-y-4">
            {quoteDetailQuery.isLoading && <Loading />}
            {quoteDetailQuery.error && (
              <ErrorState message={quoteDetailQuery.error instanceof Error ? quoteDetailQuery.error.message : 'Error al cargar la cotización'} />
            )}
            {quoteDetailQuery.data && (
              <>
                <Select
                  label="Vendedor encargado (Opcional)"
                  value={processSellerId}
                  onChange={(e) => setProcessSellerId(e.target.value)}
                  options={[
                    { value: '', label: 'Asignar automáticamente (creador de cotización)' },
                    ...(usersQuery.data?.items ?? []).map((u) => ({
                      value: u.id,
                      label: u.fullName || u.email,
                    })),
                  ]}
                />

                <Select
                  label="Ubicación / Sub almacén"
                  value={effectiveLocationId}
                  onChange={(e) => {
                    setProcessLocationId(e.target.value)
                    setLineBatchSelections({})
                  }}
                  options={[
                    { value: '', label: !userWarehouseId ? 'Sin sucursal asignada' : 'Automático (cualquier ubicación de mi sucursal en la ciudad del cliente)' },
                    ...(subLocationsQuery.data?.items ?? []).map((l) => ({
                      value: l.id,
                      label: `${l.warehouse.code} - ${l.code}`,
                    })),
                  ]}
                  disabled={!userWarehouseId}
                />
                {/* --- NUEVA ADVERTENCIA AQUÍ --- */}
                {isLocationMismatch && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                    <strong>⚠️ Advertencia:</strong> La cotización se realizó a <strong>{originalLocationName}</strong>, pero se usará el stock de <strong>{newLocationName}</strong>. La orden de venta se creará con los lotes de esta última ubicación.
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Productos a reservar y asignación de Lotes
                  </h4>
                  
                  <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-slate-50/50 p-3 dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900/50">
                    {quoteDetailQuery.data.lines.map((line) => {
                      const suggestionsQuery = fefoByProductId.get(line.productId)
                      const items = suggestionsQuery?.data?.items ?? []
                      const autoBatch = items[0] // Selección FEFO por defecto (primer lote disponible)
                      const selectedBatchId = lineBatchSelections[line.id] ?? (autoBatch?.batchId || '')

                      return (
                        <div key={line.id} className="py-2.5 first:pt-0 last:pb-0">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm">
                              <span className="font-medium text-slate-900 dark:text-slate-100">{line.productName}</span>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                Cantidad: <span className="font-semibold text-slate-700 dark:text-slate-300">{line.quantity} {line.baseUnitAbbreviation}</span>
                              </div>
                            </div>

                            <div className="w-full sm:w-72">
                              <Select
                                className="text-sm"
                                value={selectedBatchId}
                                onChange={(e) =>
                                  setLineBatchSelections((prev) => ({
                                    ...prev,
                                    [line.id]: e.target.value,
                                  }))
                                }
                                options={
                                  suggestionsQuery?.isLoading
                                    ? [{ value: '', label: 'Cargando lotes disponilbes...' }]
                                    : items.length === 0
                                    ? [{ value: '', label: '⚠️ Sin stock/lotes disponibles' }]
                                    : items.map((b, idx) => ({
                                        value: b.batchId,
                                        label: `${idx === 0 ? '✨ (Auto FEFO) ' : ''}Lote: ${b.batchNumber}${
                                          b.expiresAt ? ` · Vence ${new Date(b.expiresAt).toLocaleDateString('es-ES')}` : ''
                                        } (Disp: ${b.quantity})`,
                                      }))
                                }
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {processMutation.isError && (
              <div className="text-sm text-red-600 dark:text-red-400">
                Error: {(processMutation.error as any)?.message ?? 'Error desconocido'}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={closeProcessModal}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                loading={processMutation.isPending}
                disabled={quoteDetailQuery.isLoading || !quoteDetailQuery.data}
                onClick={confirmProcess}
              >
                Procesar y Generar Orden
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

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {quotesQuery.data && quotesQuery.data.items.length > 0 && (
            <>
              <Table<QuoteListItem>
                alwaysVisibleHorizontalScroll
                columns={[
                  { header: 'Número', accessor: (q) => q.number.split('-').pop() ?? q.number },
                  { header: 'Cliente', accessor: (q) => q.customerName.length > 15 ? `${q.customerName.slice(0, 15)}...` : q.customerName },
                  {
                    header: 'Estado',
                    accessor: (q) => (
                      <Badge variant={q.status === 'PROCESSED' ? 'success' : 'default'}>
                        {q.status === 'PROCESSED' ? 'PROCESADA' : 'CREADA'}
                      </Badge>
                    ),
                  },
                  {
  header: 'Tipo',
  accessor: (q) => q.locationCode ? (
    // Cambia "outline" por un variant que tu componente soporte, ej: "secondary" o "default"
    <Badge variant="info">{q.locationCode}</Badge> 
  ) : (
    <span className="text-slate-400 dark:text-slate-500">Sin asignar</span>
  ),
},
                  
                  { header: 'Cotizado por', className: 'hidden md:table-cell', accessor: (q) => q.quotedBy ?? '-' },
                  { header: 'Fecha', accessor: (q) => new Date(q.createdAt).toLocaleString('es-ES', { timeZone: 'America/La_Paz' }) },
                  {
                    header: 'TOTAL(BOB)',
                    accessor: (q) => `${formatMoney(q.total)} BOB`
                  },
                  {
                    header: 'Acciones',
                    className: 'text-center',
                    accessor: (q) => (
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<EyeIcon className="w-4 h-4" />}
                          onClick={() => navigate(`/sales/quotes/${q.id}`)}
                        >
                          <span className="hidden md:inline">Ver</span>
                        </Button>
                        {q.status !== 'PROCESSED' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<ArrowPathIcon className="w-4 h-4" />}
                              onClick={() => openProcessModal(q.id)}
                              loading={processMutation.isPending && processModalQuoteId === q.id}
                            >
                              <span className="hidden md:inline">Procesar</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<TrashIcon className="w-4 h-4 text-red-500" />}
                              onClick={() => {
                                if (confirm('¿Estás seguro de que quieres eliminar esta cotización?')) {
                                  deleteMutation.mutate(q.id)
                                }
                              }}
                              loading={deleteMutation.isPending}
                            />
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