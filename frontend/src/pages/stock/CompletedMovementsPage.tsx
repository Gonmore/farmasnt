import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../providers/AuthProvider'
import { apiFetch } from '../../lib/api'
import { matchesSearchQuery } from '../../lib/search'
import { MainLayout, PageContainer, Table, Input, Loading, ErrorState, EmptyState, PaginationCursor } from '../../components'
import type { Column } from '../../components'
import { useNavigation } from '../../hooks'
import { MovementQuickActions } from '../../components/MovementQuickActions'

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
  canExportPicking: boolean
  canExportLabel: boolean
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
  const navGroups = useNavigation()

  const [searchQuery, setSearchQuery] = useState('')
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [highlightId, setHighlightId] = useState<string | null>(null)

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
        new Date(a.completedAt || a.createdAt).getTime() -
        new Date(b.completedAt || b.createdAt).getTime()
      return diff
    })
  }, [movements, searchQuery])

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
        <div className="mb-3 max-w-xl">
          <Input
            label="Buscar"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Sucursal, ubicación, solicitante, fecha, tipo…"
          />
        </div>

        {movements.length === 0 ? (
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

        {movements.length > 0 && (
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
    </MainLayout>
  )
}
