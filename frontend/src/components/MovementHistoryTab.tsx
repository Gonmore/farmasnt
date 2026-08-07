import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { Button, EmptyState, ErrorState, Input, Loading, Table } from './index'

// ─── Types ───────────────────────────────────────────────────────────────────

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
  totalQuantityUnits?: number | null
  totalQuantityPresentations?: number | null
  note?: string | null
  canExportPicking: boolean
  canExportLabel: boolean
}

type PickingLine = {
  productLabel?: string | null
  batchNumber?: string | null
}

type PickingDetail = {
  sentLines?: PickingLine[]
}

type PickingInfo = {
  lines: Array<{ batchNumber: string; productLabel: string }>
}

type FilterMode = 'fecha' | 'lote' | 'producto' | 'usuario'

// ─── Constants ───────────────────────────────────────────────────────────────

const MODE_LABELS: Record<FilterMode, string> = {
  fecha: '📅 Por fecha',
  lote: '🗂 Por lote',
  producto: '📦 Por producto',
  usuario: '👤 Por usuario',
}

const MODE_PROMPTS: Record<FilterMode, string> = {
  fecha: '',
  lote: 'Ingresá el número de lote para ver los movimientos asociados.',
  producto: 'Ingresá el nombre o código del producto para ver sus movimientos.',
  usuario: 'Ingresá el nombre del usuario para ver los movimientos que realizó.',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatQty(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n))
  return n.toFixed(2)
}

function cleanWarehouseCode(code: string | null | undefined): string {
  if (!code) return '—'
  return code.replace(/^SUC-/, '')
}

function locLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return code
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MovementHistoryTab({ token }: { token: string }) {
  const [filterMode, setFilterMode] = useState<FilterMode>('fecha')
  const [dateOrder, setDateOrder] = useState<'asc' | 'desc'>('desc')
  const [specificDate, setSpecificDate] = useState('')
  // searchInput = what user is typing; selectedValue = confirmed selection from suggestions
  const [searchInput, setSearchInput] = useState('')
  const [selectedValue, setSelectedValue] = useState<string | null>(null)

  const [pickingCache, setPickingCache] = useState<Record<string, PickingInfo>>({})
  const [pickingsLoaded, setPickingsLoaded] = useState(false)
  const [loadingPickings, setLoadingPickings] = useState(false)
  const loadingRef = useRef(false)

  // ─── Data fetch ──────────────────────────────────────────────────────────

  const historyQuery = useQuery<{ items: CompletedMovement[] }>({
    queryKey: ['movement-history'],
    queryFn: () => apiFetch('/api/v1/stock/completed-movements', { token }),
    enabled: !!token,
  })

  const movements = historyQuery.data?.items ?? []

  // ─── Load picking details when lote/producto mode is active ──────────────

  useEffect(() => {
    if (filterMode !== 'lote' && filterMode !== 'producto') return
    if (pickingsLoaded || loadingRef.current || movements.length === 0) return

    const pickable = movements.filter((m) => m.canExportPicking)
    if (pickable.length === 0) {
      setPickingsLoaded(true)
      return
    }

    loadingRef.current = true
    setLoadingPickings(true)

    const load = async () => {
      try {
        const results = await Promise.allSettled(
          pickable.map(async ({ id, type }) => {
            const data = await apiFetch<PickingDetail>(
              `/api/v1/stock/completed-movements/${encodeURIComponent(id)}/picking?type=${encodeURIComponent(type)}`,
              { token },
            )
            const lines = (data.sentLines ?? []).map((l) => ({
              batchNumber: l.batchNumber ?? '',
              productLabel: l.productLabel ?? '',
            }))
            return { id, lines }
          }),
        )
        const next: Record<string, PickingInfo> = {}
        for (const r of results) {
          if (r.status === 'fulfilled') {
            next[r.value.id] = { lines: r.value.lines }
          }
        }
        for (const { id } of pickable) {
          if (!(id in next)) next[id] = { lines: [] }
        }
        setPickingCache((prev) => ({ ...prev, ...next }))
        setPickingsLoaded(true)
      } finally {
        loadingRef.current = false
        setLoadingPickings(false)
      }
    }

    void load()
  }, [filterMode, movements, pickingsLoaded, token])

  // ─── Mode change & selection handlers ─────────────────────────────────────

  const handleModeChange = (mode: FilterMode) => {
    setFilterMode(mode)
    setSearchInput('')
    setSelectedValue(null)
    setSpecificDate('')
  }

  const handleInputChange = (value: string) => {
    setSearchInput(value)
    // If user edits input after selecting, clear the selection
    if (selectedValue !== null) setSelectedValue(null)
  }

  const handleSelectSuggestion = (value: string) => {
    setSelectedValue(value)
    setSearchInput(value)
  }

  const handleClearSelection = () => {
    setSelectedValue(null)
    setSearchInput('')
  }

  // ─── Suggestions ─────────────────────────────────────────────────────────

  const suggestions = useMemo((): string[] => {
    if (filterMode === 'fecha') return []
    if (selectedValue !== null) return []
    const q = searchInput.toLowerCase().trim()
    if (!q) return []

    if (filterMode === 'usuario') {
      const names = new Set<string>()
      for (const m of movements) {
        if (m.fulfilledByName) names.add(m.fulfilledByName)
        if (m.requestedByName) names.add(m.requestedByName)
      }
      return [...names].filter((n) => n.toLowerCase().includes(q)).sort().slice(0, 12)
    }

    if (filterMode === 'lote') {
      const batches = new Set<string>()
      for (const info of Object.values(pickingCache)) {
        for (const line of info.lines) {
          if (line.batchNumber) batches.add(line.batchNumber)
        }
      }
      return [...batches].filter((b) => b.toLowerCase().includes(q)).sort().slice(0, 12)
    }

    if (filterMode === 'producto') {
      const products = new Set<string>()
      for (const info of Object.values(pickingCache)) {
        for (const line of info.lines) {
          if (line.productLabel) products.add(line.productLabel)
        }
      }
      return [...products].filter((p) => p.toLowerCase().includes(q)).sort().slice(0, 12)
    }

    return []
  }, [filterMode, searchInput, selectedValue, movements, pickingCache])

  // ─── Filtered & sorted results ───────────────────────────────────────────

  const results = useMemo((): CompletedMovement[] | null => {
    const byDateDesc = (a: CompletedMovement, b: CompletedMovement) =>
      new Date(b.completedAt || b.createdAt).getTime() - new Date(a.completedAt || a.createdAt).getTime()

    switch (filterMode) {
      case 'fecha': {
        let filtered = [...movements]
        if (specificDate) {
          filtered = filtered.filter(
            (m) => (m.completedAt || m.createdAt).slice(0, 10) === specificDate,
          )
        }
        return filtered.sort((a, b) => {
          const diff =
            new Date(a.completedAt || a.createdAt).getTime() -
            new Date(b.completedAt || b.createdAt).getTime()
          return dateOrder === 'asc' ? diff : -diff
        })
      }

      case 'usuario': {
        if (selectedValue === null) return null
        const q = selectedValue.toLowerCase()
        return [...movements]
          .filter(
            (m) =>
              (m.fulfilledByName ?? '').toLowerCase() === q ||
              (m.requestedByName ?? '').toLowerCase() === q,
          )
          .sort(byDateDesc)
      }

      case 'lote': {
        if (selectedValue === null) return null
        const q = selectedValue.toLowerCase()
        return [...movements]
          .filter((m) =>
            (pickingCache[m.id]?.lines ?? []).some((l) => l.batchNumber.toLowerCase() === q),
          )
          .sort(byDateDesc)
      }

      case 'producto': {
        if (selectedValue === null) return null
        const q = selectedValue.toLowerCase()
        return [...movements]
          .filter((m) =>
            (pickingCache[m.id]?.lines ?? []).some((l) => l.productLabel.toLowerCase() === q),
          )
          .sort(byDateDesc)
      }

      default:
        return [...movements]
    }
  }, [movements, filterMode, dateOrder, specificDate, selectedValue, pickingCache])

  // ─── Table columns ───────────────────────────────────────────────────────

  const columns = useMemo(
    () => [
      {
        header: 'Tipo',
        accessor: (m: CompletedMovement) => <span className="text-sm">{m.typeLabel}</span>,
      },
      {
        header: 'Fecha',
        accessor: (m: CompletedMovement) => (
          <span className="text-sm whitespace-nowrap">
            {new Date(m.completedAt || m.createdAt).toLocaleString('es-ES', { timeZone: 'America/La_Paz' })}
          </span>
        ),
      },
      {
        header: 'Origen → Destino',
        accessor: (m: CompletedMovement) => (
          <span className="text-sm font-mono">
            {cleanWarehouseCode(m.fromWarehouseCode)}:{locLabel(m.fromLocationCode)} → {cleanWarehouseCode(m.toWarehouseCode)}:{locLabel(m.toLocationCode)}
          </span>
        ),
      },
      {
        header: 'Producto / Lote',
        accessor: (m: CompletedMovement) => {
          const info = pickingCache[m.id]
          if (!info || info.lines.length === 0) return <span className="text-xs text-slate-400">—</span>
          const shown = info.lines.slice(0, 3)
          return (
            <div className="text-xs leading-tight space-y-0.5">
              {shown.map((l, i) => (
                <div key={i}>
                  {l.productLabel && (
                    <span className="text-slate-800 dark:text-slate-100">{l.productLabel}</span>
                  )}
                  {l.batchNumber && (
                    <span className="ml-1 text-slate-500 dark:text-slate-400">({l.batchNumber})</span>
                  )}
                </div>
              ))}
              {info.lines.length > 3 && (
                <div className="text-slate-400">+{info.lines.length - 3} más</div>
              )}
            </div>
          )
        },
      },
      {
        header: 'Realizado por',
        accessor: (m: CompletedMovement) => (
          <div className="text-sm leading-tight">
            <div>{m.fulfilledByName || '—'}</div>
            {m.requestedByName && m.requestedByName !== m.fulfilledByName && (
              <div className="text-xs text-slate-500">Sol: {m.requestedByName}</div>
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
        accessor: (m: CompletedMovement) => (
          <span className="text-sm">
            {formatQty(m.totalQuantityPresentations ?? m.totalQuantity)}
          </span>
        ),
      },
    ],
    [pickingCache],
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  if (historyQuery.isLoading) {
    return (
      <div className="py-8">
        <Loading />
      </div>
    )
  }

  if (historyQuery.isError) {
    return (
      <ErrorState
        message="No se pudo cargar el historial de movimientos."
        retry={historyQuery.refetch}
      />
    )
  }

  return (
    <div className="space-y-4">

      {/* Selector de modo */}
      <div className="flex flex-wrap items-center gap-2">
        {(['fecha', 'lote', 'producto', 'usuario'] as FilterMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => handleModeChange(mode)}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
              filterMode === mode
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {MODE_LABELS[mode]}
          </button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => historyQuery.refetch()}
          loading={historyQuery.isFetching}
        >
          Actualizar
        </Button>
      </div>

      {/* Controles de fecha */}
      {filterMode === 'fecha' && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="flex gap-2">
            <button
              onClick={() => setDateOrder('desc')}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                dateOrder === 'desc'
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400'
              }`}
            >
              ↓ Más recientes
            </button>
            <button
              onClick={() => setDateOrder('asc')}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                dateOrder === 'asc'
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400'
              }`}
            >
              ↑ Más antiguos
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div className="min-w-52">
              <Input
                type="date"
                label="Fecha específica (opcional)"
                value={specificDate}
                onChange={(e) => setSpecificDate(e.target.value)}
              />
            </div>
            {specificDate && (
              <Button size="sm" variant="secondary" onClick={() => setSpecificDate('')}>
                Limpiar
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Buscador para lote / producto / usuario */}
      {(filterMode === 'lote' || filterMode === 'producto' || filterMode === 'usuario') && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">

          {/* Chip de selección activa */}
          {selectedValue !== null ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {filterMode === 'lote'
                    ? 'Lote seleccionado'
                    : filterMode === 'producto'
                      ? 'Producto seleccionado'
                      : 'Usuario seleccionado'}
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                  {selectedValue}
                </span>
              </div>
              <button
                onClick={handleClearSelection}
                className="ml-4 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cambiar
              </button>
            </div>
          ) : (
            /* Input + dropdown de sugerencias */
            <div className="relative">
              <Input
                label={
                  filterMode === 'lote'
                    ? 'Buscar número de lote'
                    : filterMode === 'producto'
                      ? 'Buscar producto (nombre o código)'
                      : 'Buscar usuario'
                }
                value={searchInput}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder={
                  filterMode === 'lote'
                    ? 'Ej: CUI-26007, L-0001…'
                    : filterMode === 'producto'
                      ? 'Ej: crema, amoxicilina, AMO-500…'
                      : 'Ej: Juan Pérez…'
                }
                autoFocus
              />

              {/* Loading pickings */}
              {(filterMode === 'lote' || filterMode === 'producto') && loadingPickings && (
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                  Indexando {filterMode === 'lote' ? 'lotes' : 'productos'} desde el servidor…
                </div>
              )}

              {/* Dropdown de sugerencias */}
              {suggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {suggestions.map((s) => (
                    <li key={s}>
                      <button
                        onMouseDown={(e) => {
                          // onMouseDown prevents input blur before click fires
                          e.preventDefault()
                          handleSelectSuggestion(s)
                        }}
                        className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Sin coincidencias */}
              {searchInput.trim() && suggestions.length === 0 && !loadingPickings && (
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {(filterMode === 'lote' || filterMode === 'producto') && !pickingsLoaded
                    ? 'Cargando datos…'
                    : 'Sin coincidencias. Intentá con otro término.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Resultados */}
      {movements.length === 0 ? (
        <EmptyState message="Aún no hay movimientos completados en el sistema." />
      ) : results === null ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-400">
          {MODE_PROMPTS[filterMode]}
        </div>
      ) : results.length === 0 ? (
        <EmptyState message="No se encontraron movimientos para el criterio ingresado." />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <Table columns={columns} data={results} keyExtractor={(m) => m.id} />
          </div>
          <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {results.length} de {movements.length} movimientos
          </div>
        </div>
      )}
    </div>
  )
}
