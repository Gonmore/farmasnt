import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Input, Button, Loading, ErrorState, EmptyState, Modal } from '../../components'
import { useNavigation } from '../../hooks'
import { formatDateOnlyUtc } from '../../lib/date'
import { matchesSearchQuery } from '../../lib/search'

type TraceMovement = {
  id: string
  type: 'OUT' | 'IN'
  createdAt: string
  createdByName?: string | null
  quantity?: number
  presentationQuantity?: number | null
  pendingQuantity?: number
  receivedQuantity?: number
  returnedQuantity?: number
  productId?: string
  presentationName?: string | null
  unitsPerPresentation?: number | null
  productSku?: string | null
  productName?: string | null
  genericName?: string | null
}

type MovementRequest = {
  id: string
  code: string
  status: 'OPEN' | 'SENT' | 'FULFILLED' | 'CANCELLED'
  requestedCity: string
  requestedByName: string | null
  note?: string | null
  createdAt: string
  fulfilledAt: string | null
  fulfilledByName?: string | null
  confirmedAt?: string | null
  confirmedByName?: string | null
  originWarehouse?: { id: string; code: string; name: string; city: string | null } | null
  warehouse?: { id: string; code: string | null; name: string | null; city: string | null } | null
  items?: Array<{
    id?: string
    productId?: string
    productSku?: string | null
    productName?: string | null
    genericName?: string | null
    presentationName?: string | null
    presentationQuantity?: number | null
    unitsPerPresentation?: number | null
    requestedQuantity?: number
    remainingQuantity?: number
  }>
  movements?: TraceMovement[]
}

async function listMovementRequests(token: string): Promise<{ items: MovementRequest[] }> {
  const response = await apiFetch<{ items: any[] }>('/api/v1/stock/movement-requests?take=100', { token })
  return {
    items: (response.items ?? []).map((r: any) => ({
      ...r,
      code: String(r.code ?? ''),
      items: (Array.isArray(r.items) ? r.items : []).map((it: any) => ({
        ...it,
        id: it.id ? String(it.id) : undefined,
        productId: it.productId ? String(it.productId) : undefined,
        requestedQuantity: Number(it.requestedQuantity ?? 0),
        remainingQuantity: Number(it.remainingQuantity ?? 0),
        presentationName: it.presentationName ?? it.presentation?.name ?? null,
        presentationQuantity:
          it.presentationQuantity === null || it.presentationQuantity === undefined ? null : Number(it.presentationQuantity),
        unitsPerPresentation:
          it.unitsPerPresentation === null || it.unitsPerPresentation === undefined
            ? it.presentation?.unitsPerPresentation === null || it.presentation?.unitsPerPresentation === undefined
              ? null
              : Number(it.presentation.unitsPerPresentation)
            : Number(it.unitsPerPresentation),
      })),
      movements: Array.isArray(r.movements)
        ? r.movements.map((m: any) => ({
            ...m,
            id: String(m.id),
            quantity: Number(m.quantity ?? 0),
            presentationQuantity:
              m.presentationQuantity === null || m.presentationQuantity === undefined ? null : Number(m.presentationQuantity),
            pendingQuantity: Number(m.pendingQuantity ?? 0),
            receivedQuantity: Number(m.receivedQuantity ?? 0),
            returnedQuantity: Number(m.returnedQuantity ?? 0),
            productId: m.productId ? String(m.productId) : undefined,
            presentationName: m.presentation?.name ?? null,
            unitsPerPresentation:
              m.unitsPerPresentation === null || m.unitsPerPresentation === undefined
                ? m.presentation?.unitsPerPresentation === null || m.presentation?.unitsPerPresentation === undefined
                  ? null
                  : Number(m.presentation.unitsPerPresentation)
                : Number(m.unitsPerPresentation),
          }))
        : [],
    })),
  }
}

function formatMaybeInt(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value)
  return Math.abs(value - rounded) < 1e-9 ? String(rounded) : value.toFixed(2)
}

function getItemPresentationQty(item: {
  requestedQuantity?: number
  remainingQuantity?: number
  presentationQuantity?: number | null
  unitsPerPresentation?: number | null
}): { requested: number; remaining: number } {
  const rqUnits = Number(item.requestedQuantity ?? 0)
  const remUnits = Number(item.remainingQuantity ?? 0)

  const upp = Number(item.unitsPerPresentation ?? 0)
  const hasUPP = Number.isFinite(upp) && upp > 0

  const rq = item.presentationQuantity !== null && item.presentationQuantity !== undefined
    ? Number(item.presentationQuantity ?? 0)
    : hasUPP
      ? rqUnits / upp
      : rqUnits

  const rem = hasUPP ? remUnits / upp : remUnits
  return { requested: rq, remaining: rem }
}

function countRequestItems(r: MovementRequest): { requested: number; sent: number; pending: number } {
  const items = Array.isArray(r.items) ? r.items : []
  const requested = items.length
  const pending = items.filter((it) => Number(it.remainingQuantity ?? 0) > 1e-9).length
  const sent = items.filter((it) => Number(it.requestedQuantity ?? 0) - Number(it.remainingQuantity ?? 0) > 1e-9).length
  return { requested, sent, pending }
}

function getShipmentStateLabel(m: Pick<TraceMovement, 'pendingQuantity' | 'receivedQuantity' | 'returnedQuantity'>): {
  label: 'Pendiente de recepción' | 'Recibido' | 'Devuelto'
  className: string
} {
  const pending = Number(m.pendingQuantity ?? 0)
  const received = Number(m.receivedQuantity ?? 0)
  const returned = Number(m.returnedQuantity ?? 0)

  if (returned > 1e-9 && received <= 1e-9) {
    return { label: 'Devuelto', className: 'text-red-700 dark:text-red-400' }
  }

  if (pending > 1e-9) {
    return { label: 'Pendiente de recepción', className: 'text-amber-700 dark:text-amber-300 animate-pulse' }
  }

  return { label: 'Recibido', className: 'text-emerald-700 dark:text-emerald-400' }
}

function abbreviateCity(city: string): string {
  if (!city) return '—'
  const upper = city.toUpperCase()
  if (upper.includes('COCHABAMBA')) return 'CBBA'
  if (upper.includes('LA PAZ')) return 'LPZ'
  if (upper.includes('SANTA CRUZ')) return 'SCZ'
  if (upper.includes('ORURO')) return 'ORU'
  if (upper.includes('POTOSI')) return 'PTS'
  if (upper.includes('SUCRE')) return 'SCR'
  if (upper.includes('TARIJA')) return 'TJA'
  if (upper.includes('PANDO')) return 'PND'
  if (upper.includes('BENI')) return 'BNI'
  return upper.slice(0, 3)
}

export function MovementRequestsTraceabilityPage() {
  const auth = useAuth()
  const navGroups = useNavigation()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRequest, setSelectedRequest] = useState<MovementRequest | null>(null)

  const movementRequestsQuery = useQuery({
    queryKey: ['movementRequests', 'traceability'],
    queryFn: () => listMovementRequests(auth.accessToken!),
    enabled: !!auth.accessToken,
    refetchInterval: 15_000,
  })

  const filtered = useMemo(() => {
    const items = movementRequestsQuery.data?.items ?? []
    const q = searchQuery

    return items
      .filter((r) => {
        const origin = r.originWarehouse
        const dest = r.warehouse
        const outMovements = (r.movements ?? []).filter((m) => m.type === 'OUT')
        const itemText = (r.items ?? [])
          .map((it) => [it.productSku, it.productName, it.genericName, it.presentationName].filter(Boolean).join(' '))
          .join(' ')
        const movementText = outMovements
          .map((m) => [m.productSku, m.productName, m.genericName, m.createdByName].filter(Boolean).join(' '))
          .join(' ')

        return matchesSearchQuery(q, [
          r.code,
          r.status,
          r.requestedCity,
          r.requestedByName,
          r.fulfilledByName,
          r.confirmedByName,
          r.note,
          r.createdAt,
          r.fulfilledAt,
          r.confirmedAt,
          formatDateOnlyUtc(r.createdAt),
          r.fulfilledAt ? formatDateOnlyUtc(r.fulfilledAt) : '',
          r.confirmedAt ? formatDateOnlyUtc(r.confirmedAt) : '',
          origin?.code,
          origin?.name,
          origin?.city,
          dest?.code,
          dest?.name,
          dest?.city,
          itemText,
          movementText,
        ])
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [movementRequestsQuery.data, searchQuery])

  const describeStatus = (r: MovementRequest): { label: string; pending: number; outCount: number } => {
    if (r.status === 'CANCELLED') return { label: '⛔ Cancelada', pending: 0, outCount: 0 }
    const outMovements = (r.movements ?? []).filter((m) => m.type === 'OUT')
    const outCount = outMovements.length
    const pending = outMovements.reduce((sum, m) => sum + Number(m.pendingQuantity ?? 0), 0)
    if (outCount === 0) return { label: '🟡 Creada', pending, outCount }
    if (r.status === 'OPEN') return { label: pending > 0 ? '🟠 Atendida parcial (pendiente)' : '🟠 Atendida parcial', pending, outCount }
    if (pending > 0) return { label: '📦 Enviada (pendiente recepción)', pending, outCount }
    return { label: '✅ Recepcionada', pending, outCount }
  }

  const columns = useMemo(
    () => [
      {
        header: 'Fecha solicitud',
        width: '150px',
        accessor: (r: MovementRequest) => {
          const d = new Date(r.createdAt)
          return (
            <div>
              <div>{d.toLocaleDateString()}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          )
        },
      },
      {
        header: 'Código / Ruta',
        accessor: (r: MovementRequest) => {
          const fromCode = r.originWarehouse?.city
            ? abbreviateCity(r.originWarehouse.city)
            : r.originWarehouse?.code?.replace(/^SUC-/, '') ?? '—'

          const toCode = r.warehouse?.city
            ? abbreviateCity(r.warehouse.city)
            : r.requestedCity
              ? abbreviateCity(r.requestedCity)
              : r.warehouse?.code?.replace(/^SUC-/, '') ?? '—'

          return (
            <div className="leading-tight">
              <div className="font-medium text-slate-900 dark:text-slate-100">{r.code || '—'}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{fromCode} -&gt; {toCode}</div>
            </div>
          )
        },
      },
      { header: 'Solicitante', width: '200px', accessor: (r: MovementRequest) => r.requestedByName ?? '-' },
      {
        header: 'Estado',
        width: '260px',
        accessor: (r: MovementRequest) => {
          if (r.status === 'CANCELLED') return '⛔ Cancelada'

          const outMovements = (r.movements ?? []).filter((m) => m.type === 'OUT')
          const outCount = outMovements.length
          const totalPending = outMovements.reduce((sum, m) => sum + Number(m.pendingQuantity ?? 0), 0)

          if (outCount === 0) return '🟡 Creada'
          if (r.status === 'OPEN') return totalPending > 0 ? '🟠 Atendida parcial (pendiente)' : '🟠 Atendida parcial'
          if (totalPending > 0) return '📦 Enviada (pendiente recepción)'
          return '✅ Recepcionada'
        },
      },
      {
        header: 'Ítems',
        width: '190px',
        accessor: (r: MovementRequest) => {
          const c = countRequestItems(r)
          return (
            <div className="text-sm">
              <div>Sol: {c.requested} • Env: {c.sent}</div>
              <div className={c.pending === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'}>
                Pend: {c.pending}
              </div>
            </div>
          )
        },
      },
    ],
    [],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="🧭 Trazabilidad de solicitudes">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="max-w-xl w-full">
            <Input
              label="Buscar"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Código (SOL…), solicitante, ciudad, fecha, producto…"
            />
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => movementRequestsQuery.refetch()}
            loading={movementRequestsQuery.isFetching}
          >
            Actualizar
          </Button>
        </div>

        {movementRequestsQuery.isLoading && <Loading />}
        {movementRequestsQuery.error && <ErrorState message="Error cargando solicitudes" retry={movementRequestsQuery.refetch} />}

        {!movementRequestsQuery.isLoading && !movementRequestsQuery.error && filtered.length === 0 && (
          <EmptyState message="No hay resultados." />
        )}

        {filtered.length > 0 && (
          <Table
            columns={columns as any}
            data={filtered as any}
            keyExtractor={(r: any) => r.id}
            onRowClick={(r: any) => setSelectedRequest(r as MovementRequest)}
          />
        )}
      </PageContainer>

      <Modal
        isOpen={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        title={`🧭 Detalle de solicitud${selectedRequest?.code ? ` — ${selectedRequest.code}` : ''}`}
        maxWidth="3xl"
      >
        {!selectedRequest ? null : (
          <div className="space-y-4">
            {(() => {
              const origin = selectedRequest.originWarehouse
              const dest = selectedRequest.warehouse

              const fromCode = origin?.city ? abbreviateCity(origin.city) : origin?.code?.replace(/^SUC-/, '') ?? '—'
              const toCode = dest?.city
                ? abbreviateCity(dest.city)
                : selectedRequest.requestedCity
                  ? abbreviateCity(selectedRequest.requestedCity)
                  : dest?.code?.replace(/^SUC-/, '') ?? '—'

              const s = describeStatus(selectedRequest)

              return (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm">
                  <div className="rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-xs text-slate-500">Ruta</div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">{fromCode} -&gt; {toCode}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-xs text-slate-500">Estado</div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">{s.label}</div>
                    {s.outCount > 0 ? (
                      <div className="text-xs text-slate-500 dark:text-slate-400">Envíos: {s.outCount} • Pendiente: {Math.round(s.pending)}</div>
                    ) : null}
                  </div>

                  <div className="rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-xs text-slate-500">Creada</div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">{new Date(selectedRequest.createdAt).toLocaleString()}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Solicitante: {selectedRequest.requestedByName ?? '—'}</div>
                  </div>

                  <div className="rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-xs text-slate-500">Atención / Confirmación</div>
                    <div className="text-slate-700 dark:text-slate-200">
                      <div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">Atendida:</span>{' '}
                        {selectedRequest.fulfilledAt ? new Date(selectedRequest.fulfilledAt).toLocaleString() : '—'}
                        {selectedRequest.fulfilledByName ? ` • ${selectedRequest.fulfilledByName}` : ''}
                      </div>
                      <div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">Recepción/confirmación:</span>{' '}
                        {selectedRequest.confirmedAt ? new Date(selectedRequest.confirmedAt).toLocaleString() : '—'}
                        {selectedRequest.confirmedByName ? ` • ${selectedRequest.confirmedByName}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {selectedRequest.note ? (
              <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500">Nota</div>
                <div className="text-slate-900 dark:text-slate-100">{selectedRequest.note}</div>
              </div>
            ) : null}

            <div className="rounded border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="font-medium text-slate-900 dark:text-slate-100 mb-2">📝 Ítems solicitados</div>
              {Array.isArray(selectedRequest.items) && selectedRequest.items.length > 0 ? (
                <div className="space-y-2">
                  {selectedRequest.items.map((it, idx) => {
                    const label = it.productName ?? it.productSku ?? it.genericName ?? 'Producto'
                    const qty = getItemPresentationQty(it)
                    const hasQty = Number.isFinite(qty.requested) || Number.isFinite(qty.remaining)
                    const pendingIsZero = Math.abs(Number(qty.remaining ?? 0)) <= 1e-9
                    return (
                      <div key={it.id ?? `${label}-${idx}`} className="rounded border border-slate-200 px-3 py-2 dark:border-slate-700">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{label}</div>
                        {it.presentationName ? <div className="text-xs text-slate-500 dark:text-slate-400">{it.presentationName}</div> : null}
                        {hasQty ? (
                          <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                            <span>
                              Solicitado: {formatMaybeInt(qty.requested)}{it.presentationName ? ` x ${it.presentationName}` : ''}
                            </span>
                            <span className="mx-2 text-slate-400">•</span>
                            <span className={pendingIsZero ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                              Pendiente: {formatMaybeInt(qty.remaining)}{it.presentationName ? ` x ${it.presentationName}` : ''}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-slate-600 dark:text-slate-400">Sin ítems.</div>
              )}
            </div>

            <div className="rounded border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="font-medium text-slate-900 dark:text-slate-100 mb-2">📌 Timeline</div>
              {(() => {
                const s = describeStatus(selectedRequest)
                const c = countRequestItems(selectedRequest)
                const outMovements = (selectedRequest.movements ?? []).filter((m) => m.type === 'OUT')
                const outCount = outMovements.length
                const hasShipments = outCount > 0
                const shipmentsPendingReception = outMovements.filter((m) => Number(m.pendingQuantity ?? 0) > 1e-9).length

                const shipmentsLabel = !hasShipments
                  ? 'sin envíos'
                  : shipmentsPendingReception > 0
                    ? `${shipmentsPendingReception} envío(s) pendiente(s) de recepción`
                    : `${outCount} envío(s) recibidos`

                const itemsPendingShipmentLabel = c.pending > 0
                  ? `${c.pending} ítem(s) pendiente(s) de envío`
                  : 'sin ítems pendientes de envío'

                return (
                  <div className="space-y-2">
                    <div>1) 🟡 Creada — {formatDateOnlyUtc(selectedRequest.createdAt)} ({selectedRequest.requestedByName ?? '—'})</div>
                    <div>
                      2) 🟠 Atendida/Parcial — {selectedRequest.fulfilledAt ? formatDateOnlyUtc(selectedRequest.fulfilledAt) : '—'}
                      {selectedRequest.fulfilledByName ? ` (${selectedRequest.fulfilledByName})` : ''}
                    </div>
                    <div>3) 📦 Envíos — {hasShipments ? `${outCount} envío(s)` : '—'}</div>
                    <div>
                      4) Estado actual — {s.label} • {shipmentsLabel} • {itemsPendingShipmentLabel}
                    </div>
                  </div>
                )
              })()}
            </div>

            <div className="rounded border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="font-medium text-slate-900 dark:text-slate-100 mb-2">📤 Envíos</div>
              {(() => {
                const outMovements = (selectedRequest.movements ?? []).filter((m) => m.type === 'OUT')
                if (outMovements.length === 0) return <div className="text-slate-600 dark:text-slate-400">Sin envíos.</div>

                const sorted = [...outMovements].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                return (
                  <div className="space-y-2">
                    {sorted.map((m) => (
                      <div key={m.id} className="rounded border border-slate-200 px-3 py-2 dark:border-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {m.productName ?? m.productSku ?? m.genericName ?? 'Producto'}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{new Date(m.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                          Enviado por: {m.createdByName ?? '—'}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">Enviado:</span>{' '}
                            {m.presentationQuantity !== null && m.presentationQuantity !== undefined ? (
                              <span className="text-slate-900 dark:text-slate-100">
                                {formatMaybeInt(Number(m.presentationQuantity))}{m.presentationName ? ` x ${m.presentationName}` : ''}
                              </span>
                            ) : (
                              <span className="text-slate-900 dark:text-slate-100">{formatMaybeInt(Number(m.quantity ?? 0))} u</span>
                            )}
                          </div>
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">Estado de envío:</span>{' '}
                            {(() => {
                              const st = getShipmentStateLabel(m)
                              return <span className={st.className}>{st.label}</span>
                            })()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>
        )}
      </Modal>
    </MainLayout>
  )
}
