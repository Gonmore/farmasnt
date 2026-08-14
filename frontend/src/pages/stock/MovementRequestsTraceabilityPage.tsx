import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Input, Button, Loading, ErrorState, EmptyState, Modal } from '../../components'
import { useNavigation } from '../../hooks'
import { formatDateOnlyUtc } from '../../lib/date'
import { matchesSearchQuery } from '../../lib/search'
import { useTenant } from '../../providers/TenantProvider'
import { exportTraceabilityToPDF } from '../../lib/traceabilityPdf'

type TraceMovement = {
  id: string
  number?: string | null
  numberYear?: number | null
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
  batchNumber?: string | null
  fromWarehouseCode?: string | null
  fromLocationCode?: string | null
  receptions?: TraceReception[]
}

type TraceReception = {
  type: 'RECEIPT' | 'RETURN'
  quantity: number
  note?: string | null
  createdBy?: string | null
  createdByName?: string | null
  createdAt?: string | null
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
  toLocationId?: string | null
  toLocation?: { id: string; code: string | null; warehouse?: { id: string; code: string | null; name: string | null; city: string | null } | null } | null
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
      toLocationId: r.toLocationId ? String(r.toLocationId) : null,
      toLocation: r.toLocation
        ? {
            id: String(r.toLocation.id),
            code: r.toLocation.code ?? null,
            warehouse: r.toLocation.warehouse
              ? {
                  id: String(r.toLocation.warehouse.id),
                  code: r.toLocation.warehouse.code ?? null,
                  name: r.toLocation.warehouse.name ?? null,
                  city: r.toLocation.warehouse.city ?? null,
                }
              : null,
          }
        : null,
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
            number: m.number ?? null,
            numberYear: m.numberYear ?? null,
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
            batchNumber: m.batch?.batchNumber ?? null,
            fromWarehouseCode: m.fromLocation?.warehouse?.code ?? null,
            fromLocationCode: m.fromLocation?.code ?? null,
            receptions: Array.isArray(m.receptions)
              ? m.receptions.map((rc: any) => ({
                  type: rc.type === 'RETURN' ? 'RETURN' : 'RECEIPT',
                  quantity: Number(rc.quantity ?? 0),
                  note: rc.note ?? null,
                  createdBy: rc.createdBy ?? null,
                  createdByName: rc.createdByName ?? null,
                  createdAt: rc.createdAt ?? null,
                }))
              : [],
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

function cleanCode(code: string | null | undefined): string {
  if (!code) return '—'
  return String(code).replace(/^SUC-/, '')
}

function locLabel(code: string | null | undefined): string {
  return code && String(code).trim() ? String(code) : '—'
}

// Reception notes embed the photo URL as "Foto: <url>" (legacy storage).
// Split it back into a clean note text + optional photo URL.
function parseReceptionNote(raw: string | null | undefined): { text: string; photoUrl: string | null } {
  if (!raw) return { text: '', photoUrl: null }
  const match = String(raw).match(/Foto:\s*(\S+)/i)
  const photoUrl = match ? match[1] : null
  const text = String(raw)
    .replace(/Foto:\s*\S+/i, '')
    .replace(/^\s*\|\s*/, '')
    .replace(/\s*\|\s*$/, '')
    .replace(/\s*\|\s*/g, ' • ')
    .trim()
  return { text, photoUrl }
}

// Origin label in "warehouse:location" format. For any request with shipments
// (SENT / partial / received) the product left a real location, so we use the
// first OUT movement's fromWarehouse:fromLocation. Falls back to warehouse only
// for created-only requests that have not shipped yet.
function buildOrigin(r: MovementRequest): string {
  const outMovements = (r.movements ?? []).filter((m) => m.type === 'OUT')
  if (outMovements.length > 0) {
    const firstOut = outMovements[0]
    const fromWarehouseCode = cleanCode(firstOut.fromWarehouseCode) ?? cleanCode(r.originWarehouse?.code)
    const fromLocCode = locLabel(firstOut.fromLocationCode)
    return `${fromWarehouseCode}:${fromLocCode}`
  }
  return `${cleanCode(r.originWarehouse?.code)}`
}

// Destination label in "warehouse:location" format (with SUC- removed).
function buildDest(r: MovementRequest): string {
  const toWarehouseCode = cleanCode(r.warehouse?.code) ?? cleanCode(r.requestedCity)
  const toLocCode = locLabel(r.toLocation?.code)
  return `${toWarehouseCode}:${toLocCode}`
}

// Builds the route string in "warehouse:location -> warehouse:location" format.
function buildRoute(r: MovementRequest): string {
  return `${buildOrigin(r)} -> ${buildDest(r)}`
}

export function MovementRequestsTraceabilityPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const { branding } = useTenant()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRequest, setSelectedRequest] = useState<MovementRequest | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)

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

  const handleExportPdf = async () => {
    if (!selectedRequest) return
    try {
      setExportingPdf(true)
      const route = buildRoute(selectedRequest)

      const items = (selectedRequest.items ?? []).map((it) => {
        const qty = getItemPresentationQty(it)
        return {
          productLabel: it.productName ?? it.productSku ?? it.genericName ?? 'Producto',
          presentationName: it.presentationName ?? null,
          requested: qty.requested,
          remaining: qty.remaining,
        }
      })

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

      const timeline = [
        `1) 🟡 Creada — ${formatDateOnlyUtc(selectedRequest.createdAt)} (${selectedRequest.requestedByName ?? '—'})`,
        `2) 🟠 Atendida/Parcial — ${selectedRequest.fulfilledAt ? formatDateOnlyUtc(selectedRequest.fulfilledAt) : '—'}${selectedRequest.fulfilledByName ? ` (${selectedRequest.fulfilledByName})` : ''}`,
        `3) 📦 Envíos — ${hasShipments ? `${outCount} envío(s)` : '—'}`,
        `4) Estado actual — ${s.label} • ${shipmentsLabel} • ${itemsPendingShipmentLabel}`,
      ]

      const shipments = [...outMovements]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((m) => ({
          productLabel: m.productName ?? m.productSku ?? m.genericName ?? 'Producto',
          batchNumber: m.batchNumber ?? null,
          movementNumber: m.number ?? null,
          createdAt: new Date(m.createdAt).toLocaleString(),
          createdByName: m.createdByName ?? null,
          sentQuantity:
            m.presentationQuantity !== null && m.presentationQuantity !== undefined
              ? `${formatMaybeInt(Number(m.presentationQuantity))}${m.presentationName ? ` x ${m.presentationName}` : ''}`
              : `${formatMaybeInt(Number(m.quantity ?? 0))} u`,
          stateLabel: getShipmentStateLabel(m).label,
        }))

      await exportTraceabilityToPDF({
        code: selectedRequest.code || '—',
        route,
        statusLabel: s.label,
        createdAt: new Date(selectedRequest.createdAt).toLocaleString(),
        requestedByName: selectedRequest.requestedByName ?? null,
        fulfilledAt: selectedRequest.fulfilledAt ? new Date(selectedRequest.fulfilledAt).toLocaleString() : null,
        fulfilledByName: selectedRequest.fulfilledByName ?? null,
        confirmedAt: selectedRequest.confirmedAt ? new Date(selectedRequest.confirmedAt).toLocaleString() : null,
        confirmedByName: selectedRequest.confirmedByName ?? null,
        note: selectedRequest.note ?? null,
        items,
        timeline,
        shipments,
        tenantName: branding?.tenantName ?? 'PharmaFlow',
        logoUrl: branding?.logoUrl ?? null,
      })
    } finally {
      setExportingPdf(false)
    }
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
          return (
            <div className="leading-tight">
              <div className="font-medium text-slate-900 dark:text-slate-100">{r.code || '—'}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">{buildOrigin(r)} -&gt; {buildDest(r)}</div>
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
        closeOnBackdropClick={false}
        actions={
          <Button variant="secondary" size="sm" onClick={handleExportPdf} loading={exportingPdf}>
            Exportar PDF
          </Button>
        }
      >
        {!selectedRequest ? null : (
          <div className="space-y-4">
            {(() => {
              const route = buildRoute(selectedRequest)
              const s = describeStatus(selectedRequest)

              return (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm">
                  <div className="rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-xs text-slate-500">Ruta</div>
                    <div className="font-medium text-slate-900 dark:text-slate-100 font-mono">{route}</div>
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
                    {sorted.map((m) => {
                      const fromWarehouseCode = cleanCode(m.fromWarehouseCode) ?? cleanCode(selectedRequest.originWarehouse?.code)
                      const fromLocCode = locLabel(m.fromLocationCode)
                      const fromCode = `${fromWarehouseCode}:${fromLocCode}`
                      const toWarehouseCode = cleanCode(selectedRequest.warehouse?.code) ?? cleanCode(selectedRequest.requestedCity)
                      const toLocCode = locLabel(selectedRequest.toLocation?.code)
                      const toCode = `${toWarehouseCode}:${toLocCode}`
return (
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
                          {m.number ? (
                            <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                              Movimiento: <span className="font-mono">{m.number}</span>
                            </div>
                          ) : null}
                          {m.batchNumber ? (
                            <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                              Lote: <span className="font-mono">{m.batchNumber}</span>
                            </div>
                          ) : null}
                          <div className="mt-1 text-xs text-slate-600 dark:text-slate-400 font-mono">
                            {fromCode} \u2192 {toCode}
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
                      )
                    })}
                  </div>
                )
              })()}
            </div>
            {(() => {
              type RecView = {
                outId: string
                productLabel: string
                sentQty: number
                receivedQty: number
                returnedQty: number
                photoUrl: string | null
                text: string
                createdByName: string | null
                createdAt: string | null
              }
              const outMovements = (selectedRequest.movements ?? []).filter((m) => m.type === 'OUT')
              const isReceived = !!selectedRequest.confirmedAt || selectedRequest.status === 'FULFILLED'
              if (!isReceived || outMovements.length === 0) return null

              const views: RecView[] = []
              let hasAbnormal = false
              for (const m of outMovements) {
                const receptions = Array.isArray(m.receptions) ? m.receptions : []
                if (receptions.length === 0) continue
                const receivedQty = receptions.filter((rc) => rc.type === 'RECEIPT').reduce((s, rc) => s + Number(rc.quantity ?? 0), 0)
                const returnedQty = receptions.filter((rc) => rc.type === 'RETURN').reduce((s, rc) => s + Number(rc.quantity ?? 0), 0)
                const note = receptions.map((rc) => parseReceptionNote(rc.note)).reduce<{ text: string; photoUrl: string | null }>(
                  (acc, cur) => ({
                    text: [acc.text, cur.text].filter(Boolean).join(' • '),
                    photoUrl: acc.photoUrl ?? cur.photoUrl,
                  }),
                  { text: '', photoUrl: null },
                )
                const sentQty = Number(m.quantity ?? 0)
                const isPartial = receivedQty + returnedQty < sentQty - 1e-9 || returnedQty > 1e-9
                if (note.text || note.photoUrl || isPartial) hasAbnormal = true
                views.push({
                  outId: m.id,
                  productLabel: m.productName ?? m.productSku ?? m.genericName ?? 'Producto',
                  sentQty,
                  receivedQty,
                  returnedQty,
                  photoUrl: note.photoUrl,
                  text: note.text,
                  createdByName: receptions[0].createdByName ?? null,
                  createdAt: receptions[0].createdAt ?? null,
                })
              }

              if (!hasAbnormal) return null

              return (
                <div className="rounded border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                  <div className="font-medium text-slate-900 dark:text-slate-100 mb-2">📥 Detalle de recepción</div>
                  <div className="space-y-2">
                    {views.map((v) => (
                      <div key={v.outId} className="rounded border border-slate-200 px-3 py-2 dark:border-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{v.productLabel}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {v.createdAt ? new Date(v.createdAt).toLocaleString() : ''}
                            {v.createdByName ? ` • ${v.createdByName}` : ''}
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <span>
                            <span className="text-slate-500 dark:text-slate-400">Enviado:</span>{' '}
                            <span className="text-slate-900 dark:text-slate-100">{formatMaybeInt(v.sentQty)} u</span>
                          </span>
                          <span>
                            <span className="text-slate-500 dark:text-slate-400">Recibido:</span>{' '}
                            <span className={v.receivedQty < v.sentQty - 1e-9 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400'}>
                              {formatMaybeInt(v.receivedQty)} u
                            </span>
                          </span>
                          {v.returnedQty > 1e-9 ? (
                            <span>
                              <span className="text-slate-500 dark:text-slate-400">Devuelto:</span>{' '}
                              <span className="text-red-700 dark:text-red-400">{formatMaybeInt(v.returnedQty)} u</span>
                            </span>
                          ) : null}
                        </div>
                        {v.text ? (
                          <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                            Nota: {v.text}
                          </div>
                        ) : null}
                        {v.photoUrl ? (
                          <div className="mt-2">
                            <a href={v.photoUrl} target="_blank" rel="noreferrer">
                              <img src={v.photoUrl} alt="Foto de recepción" className="max-h-40 rounded border border-slate-200 dark:border-slate-700" />
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

          </div>
        )}
      </Modal>
    </MainLayout>
  )
}