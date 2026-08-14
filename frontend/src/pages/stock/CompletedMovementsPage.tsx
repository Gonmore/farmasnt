import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { apiFetch } from '../../lib/api'
import { matchesSearchQuery } from '../../lib/search'
import { MainLayout, PageContainer, Table, Input, Loading, ErrorState, EmptyState, PaginationCursor, Modal, Button } from '../../components'
import type { Column } from '../../components'
import { useNavigation } from '../../hooks'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { exportPickingToPdf } from '../../lib/movementRequestDocsPdf'

type CompletedMovement = {
  id: string
  type: 'MOVEMENT' | 'BULK_TRANSFER' | 'FULFILL_REQUEST' | 'RETURN'
  typeLabel: string
  createdAt: string
  completedAt: string
  fromWarehouseCode?: string | null
  fromLocationCode?: string | null
  toWarehouseCode?: string | null
  toLocationCode?: string | null
  requestedByName?: string | null
  fulfilledByName?: string | null
  totalItems: number
  totalQuantity: number
  totalQuantityPresentations?: number | null
  receiptStatus?: 'RECEIVED' | 'PENDING' | null
  number?: string | null
  requestCode?: string | null
  canExportPicking: boolean
  canExportLabel: boolean
}

type PickingDetail = {
  meta: {
    requestId: string
    requestCode?: string | null
    movementCode?: string | null
    generatedAtIso: string
    fromWarehouseLabel: string
    fromLocationCode: string
    toWarehouseLabel: string
    toLocationCode: string
    requestedByName?: string | null
    sentByName?: string | null
  }
  requestedItems?: Array<{
    productLabel: string
    quantityUnits: number
    quantityPresentations?: number
    unitsPerPresentation?: number
    presentationLabel: string
  }>
  sentLines?: Array<{
    locationCode: string
    productLabel: string
    batchNumber: string | null
    expiresAt: string | null
    quantityUnits: number
    quantityPresentations?: number
    unitsPerPresentation?: number
    presentationLabel: string
    movementNumber?: string | null
  }>
}

function cleanCode(code: string | null | undefined): string {
  if (!code) return '—'
  return code.replace(/^SUC-/, '')
}

function locLabel(code: string | null | undefined): string {
  return code && code.trim() ? code : '—'
}

export default function CompletedMovementsPage() {
  const auth = useAuth()
  const { branding } = useTenant()
  const navGroups = useNavigation()

  const [searchQuery, setSearchQuery] = useState('')
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const [detailMovement, setDetailMovement] = useState<CompletedMovement | null>(null)
  const [detailData, setDetailData] = useState<PickingDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const openDetail = async (m: CompletedMovement) => {
    setDetailMovement(m)
    setDetailData(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const data = await apiFetch<PickingDetail>(
        `/api/v1/stock/completed-movements/${encodeURIComponent(m.id)}/picking?type=${encodeURIComponent(m.type)}`,
        { token: auth.accessToken! },
      )
      setDetailData(data)
    } catch (e: any) {
      setDetailError(e?.message ?? 'No se pudo cargar el detalle')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleExportPicking = async (m: CompletedMovement) => {
    try {
      const data = await apiFetch<PickingDetail>(
        `/api/v1/stock/completed-movements/${encodeURIComponent(m.id)}/picking?type=${encodeURIComponent(m.type)}`,
        { token: auth.accessToken! },
      )
      const meta = data.meta
      await exportPickingToPdf(
        {
          requestId: meta.requestId,
          requestCode: meta.requestCode ?? null,
          movementCode: meta.movementCode ?? m.number ?? null,
          generatedAtIso: meta.generatedAtIso,
          fromWarehouseLabel: meta.fromWarehouseLabel,
          fromLocationCode: meta.fromLocationCode,
          toWarehouseLabel: meta.toWarehouseLabel,
          toLocationCode: meta.toLocationCode,
          requestedByName: meta.requestedByName ?? null,
          sentByName: meta.sentByName ?? m.fulfilledByName ?? null,
        },
        data.requestedItems ?? [],
        data.sentLines ?? [],
        { logoUrl: branding?.logoUrl ?? null },
      )
    } catch (e: any) {
      setDetailError(e?.message ?? 'No se pudo exportar el picking')
    }
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('highlight')
    if (!id) {
      setHighlightId(null)
      return
    }
    setHighlightId(id)
    const t = setTimeout(() => setHighlightId(null), 4500)
    return () => clearTimeout(t)
  }, [])

  const take = 50

  const movementsQuery = useQuery<{ items: CompletedMovement[]; nextCursor: string | null }>({
    queryKey: ['completed-movements', take, cursor],
    queryFn: () => {
      const params = new URLSearchParams({ take: String(take) })
      if (cursor) params.append('cursor', cursor)
      return apiFetch(`/api/v1/stock/completed-movements?${params}`, { token: auth.accessToken! })
    },
    enabled: !!auth.accessToken,
  })

  const movements = movementsQuery.data?.items || []

  const visibleMovements = useMemo(() => {
    const items = movements
    const q = searchQuery
    const filtered = items.filter((m) => {
      const fromCode = m.fromWarehouseCode ? String(m.fromWarehouseCode).replace(/^SUC-/, '') : ''
      const toCode = m.toWarehouseCode ? String(m.toWarehouseCode).replace(/^SUC-/, '') : ''
      const date = m.createdAt ? new Date(m.createdAt) : null
      const dateStr = date ? date.toLocaleString('es-ES', { timeZone: 'America/La_Paz' }) : ''

      return matchesSearchQuery(q, [
        m.type,
        m.typeLabel,
        m.createdAt,
        m.completedAt,
        dateStr,
        fromCode,
        toCode,
        m.requestedByName,
        m.fulfilledByName,
        m.totalItems,
        m.totalQuantity,
      ])
    })

    return [...filtered].sort((a, b) => {
      const diff =
        new Date(b.completedAt || b.createdAt).getTime() -
        new Date(a.completedAt || a.createdAt).getTime()
      return diff
    })
  }, [movements, searchQuery])

  const [tab, setTab] = useState<'all' | 'pending'>('all')

  const pendingMovements = visibleMovements.filter((m) => m.receiptStatus === 'PENDING')

  if (movementsQuery.isLoading) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="📋 Movimientos Realizados">
          <Loading />
        </PageContainer>
      </MainLayout>
    )
  }

  if (movementsQuery.isError) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="📋 Movimientos Realizados">
          <ErrorState
            message="No se pudieron cargar los movimientos realizados."
            retry={movementsQuery.refetch}
          />
        </PageContainer>
      </MainLayout>
    )
  }

  const columns: Column<CompletedMovement>[] = [
    {
      header: 'Tipo',
      accessor: (m: CompletedMovement) => <span className="text-sm">{m.typeLabel}</span>,
    },
    {
      header: 'Fecha',
      accessor: (m: CompletedMovement) => (
        <span className="text-sm whitespace-nowrap">
          {m.completedAt
            ? new Date(m.completedAt).toLocaleString('es-ES', { timeZone: 'America/La_Paz' })
            : '—'}
        </span>
      ),
    },
    {
      header: 'Origen → Destino',
      accessor: (m: CompletedMovement) => (
        <span className="text-sm font-mono">
          {cleanCode(m.fromWarehouseCode)}:{locLabel(m.fromLocationCode)} → {cleanCode(m.toWarehouseCode)}:{locLabel(m.toLocationCode)}
        </span>
      ),
    },
    {
      header: 'Solicitante',
      accessor: (m: CompletedMovement) => (
        <div className="text-sm leading-tight">
          <div>{m.requestedByName || '—'}</div>
          {m.fulfilledByName && m.fulfilledByName !== m.requestedByName && (
            <div className="text-xs text-slate-500">Real: {m.fulfilledByName}</div>
          )}
        </div>
      ),
    },
    {
      header: 'Items',
      accessor: (m: CompletedMovement) => <span className="text-sm">{m.totalItems}</span>,
    },
    {
      header: 'Cantidad',
      accessor: (m: CompletedMovement) => {
        const v = typeof m.totalQuantityPresentations === 'number' ? m.totalQuantityPresentations : m.totalQuantity
        return <span className="text-sm">{v}</span>
      },
    },
    {
      header: 'Acciones',
      accessor: (m: CompletedMovement) => (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => openDetail(m)}>
            Ver
          </Button>
          {m.canExportPicking && (
            <Button size="sm" variant="ghost" onClick={() => handleExportPicking(m)}>
              Picking
            </Button>
          )}
        </div>
      ),
    },
  ]

  const rowClassName = (m: CompletedMovement) => {
    if (!highlightId) return ''
    if (m.id !== highlightId) return ''
    return 'ring-2 ring-green-500 ring-inset bg-green-50 dark:bg-green-900/20'
  }

  return (
    <MainLayout navGroups={navGroups}>
      <MovementQuickActions currentPath="/stock/completed-movements" />
      <PageContainer title="📋 Movimientos Realizados">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant={tab === 'all' ? 'primary' : 'ghost'} onClick={() => setTab('all')}>
            Todos
          </Button>
          <Button size="sm" variant={tab === 'pending' ? 'primary' : 'ghost'} onClick={() => setTab('pending')}>
            Por recepcionar ({pendingMovements.length})
          </Button>
        </div>

        <div className="mb-3 max-w-xl">
          <Input
            label="Buscar"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Sucursal, ubicación, solicitante, fecha, tipo…"
          />
        </div>

         {tab === 'pending' ? (
          pendingMovements.length === 0 ? (
            <EmptyState message="No hay movimientos pendientes de recepción para tu sucursal." />
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <Table
                    columns={[
                      { header: 'Tipo', accessor: (m) => <span className="text-sm">{m.typeLabel}</span> },
                      {
                        header: 'Origen → Destino',
                        accessor: (m) => (
                          <span className="text-sm font-mono">
                            {cleanCode(m.fromWarehouseCode)}:{locLabel(m.fromLocationCode)} → {cleanCode(m.toWarehouseCode)}:{locLabel(m.toLocationCode)}
                          </span>
                        ),
                      },
                      { header: 'Código', accessor: (m) => <span className="font-mono text-sm">{m.number ?? m.requestCode ?? '—'}</span> },
                      { header: 'Items', accessor: (m) => <span className="text-sm">{m.totalItems}</span> },
                      { header: 'Cantidad', accessor: (m) => <span className="text-sm">{m.totalQuantity}</span> },
                      {
                        header: 'Acciones',
                        accessor: (m) => (
                          <Button size="sm" variant="ghost" onClick={() => openDetail(m)}>
                            Ver
                          </Button>
                        ),
                      },
                    ]}
                    data={pendingMovements}
                    keyExtractor={(m) => m.id}
                  />
                </div>
              </div>
               <p className="text-sm text-slate-500">
                 Estas transferencias y atenciones de solicitud se recepcionan en <span className="font-medium">Recepción/Devolución</span> (pestaña del módulo de Stock), únicamente por el administrador de la sucursal destino.
               </p>
            </div>
          )
        ) : movements.length === 0 ? (
          <EmptyState message="Aún no hay movimientos completados en el sistema." />
        ) : visibleMovements.length === 0 ? (
          <EmptyState message="No se encontraron movimientos para el criterio ingresado." />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <Table columns={columns} data={visibleMovements} keyExtractor={(m) => m.id} rowClassName={rowClassName} />
            </div>
          </div>
        )}

        {tab === 'all' && movements.length > 0 && (
          <PaginationCursor
            hasMore={!!movementsQuery.data?.nextCursor}
            onLoadMore={() => {
              setCursorHistory((prev) => [...prev, cursor || ''])
              setCursor(movementsQuery.data!.nextCursor ?? undefined)
              setCurrentPage((prev) => prev + 1)
            }}
            loading={movementsQuery.isFetching}
            currentCount={visibleMovements.length}
            currentPage={currentPage}
            take={take}
            canGoBack={cursorHistory.length > 0}
            onGoBack={() => {
              const previousCursor = cursorHistory[cursorHistory.length - 1]
              setCursorHistory((prev) => prev.slice(0, -1))
              setCursor(previousCursor || undefined)
              setCurrentPage((prev) => Math.max(1, prev - 1))
            }}
            onGoToStart={() => {
              setCursor(undefined)
              setCursorHistory([])
              setCurrentPage(1)
            }}
          />
        )}
      </PageContainer>

      <Modal
        isOpen={!!detailMovement}
        onClose={() => setDetailMovement(null)}
        maxWidth="5xl"
        closeOnBackdropClick={false}
        title={detailMovement ? `Detalle de movimiento — ${detailMovement.typeLabel}` : 'Detalle de movimiento'}
        actions={
          <>
            {detailMovement?.canExportPicking && (
              <Button size="sm" variant="ghost" onClick={() => handleExportPicking(detailMovement)}>
                Picking
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => setDetailMovement(null)}>
              Cerrar
            </Button>
          </>
        }
      >
        {detailLoading ? (
          <Loading />
        ) : detailError ? (
          <ErrorState message={detailError} retry={() => detailMovement && openDetail(detailMovement)} />
        ) : detailData ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
               <div>
                 <div className="text-slate-500">Código de movimiento</div>
                 <div className="font-mono font-semibold">{detailData.meta.movementCode ?? detailMovement?.number ?? '—'}</div>
               </div>
              {detailData.meta.requestCode ? (
                <div>
                  <div className="text-slate-500">Código de solicitud</div>
                  <div className="font-mono font-semibold">{detailData.meta.requestCode}</div>
                </div>
              ) : null}
              <div>
                <div className="text-slate-500">Estado recepción</div>
                <div>{detailMovement?.receiptStatus === 'PENDING' ? 'En tránsito (pendiente)' : 'Recibido'}</div>
              </div>
              <div>
                <div className="text-slate-500">Origen</div>
                <div className="font-mono">
                  {cleanCode(detailData.meta.fromWarehouseLabel)}:{locLabel(detailData.meta.fromLocationCode)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Destino</div>
                <div className="font-mono">
                  {cleanCode(detailData.meta.toWarehouseLabel)}:{locLabel(detailData.meta.toLocationCode)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Solicitante</div>
                <div>{detailData.meta.requestedByName ?? '—'}</div>
              </div>
              <div>
                <div className="text-slate-500">Enviado por</div>
                <div>{detailData.meta.sentByName ?? detailMovement?.fulfilledByName ?? '—'}</div>
              </div>
            </div>

            {detailData.sentLines && detailData.sentLines.length > 0 && (
              <div>
                <div className="font-semibold mb-1">Líneas enviadas</div>
                <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
                  <Table
                    columns={[
                      { header: 'Mov', accessor: (l) => <span className="font-mono">{l.movementNumber ?? '—'}</span> },
                      { header: 'Ubicación', accessor: (l) => <span className="font-mono">{locLabel(l.locationCode)}</span> },
                      { header: 'Producto', accessor: (l) => <span>{l.productLabel}</span> },
                      { header: 'Lote', accessor: (l) => <span>{l.batchNumber ?? '—'}</span> },
                      {
                        header: 'Vence',
                        accessor: (l) => <span>{l.expiresAt ? new Date(l.expiresAt).toLocaleDateString('es-ES') : '—'}</span>,
                      },
                      {
                        header: 'Cant',
                        accessor: (l) => <span>{l.quantityPresentations ?? l.quantityUnits}</span>,
                      },
                      { header: 'Pres', accessor: (l) => <span>{l.presentationLabel}</span> },
                    ]}
                    data={detailData.sentLines}
                    keyExtractor={(l: any) => `${l.movementNumber}-${l.locationCode}-${l.batchNumber}-${l.productLabel}`}
                  />
                </div>
              </div>
            )}

            {(!detailData.sentLines || detailData.sentLines.length === 0) && (
              <div className="text-slate-500">Este movimiento no tiene líneas de envío (movimiento de entrada/ajuste).</div>
            )}
          </div>
        ) : null}
      </Modal>
    </MainLayout>
  )
}
