import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '../../lib/api'
import { getProductLabel } from '../../lib/productName'
import { useNavigation } from '../../hooks'
import { useAuth } from '../../providers/AuthProvider'

import { Button, EmptyState, ErrorState, Input, Loading, MainLayout, Modal, PageContainer, Table } from '../../components'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { exportLabelToPdf } from '../../lib/movementRequestDocsPdf'

type MovementRequestItem = {
  id: string
  productId: string
  productSku: string | null
  productName: string | null
  genericName: string | null
  requestedQuantity: number
  remainingQuantity: number
  presentationId: string | null
  presentationQuantity: number | null
  presentation: { id: string; name: string; unitsPerPresentation: unknown } | null
}

type MovementRequest = {
  id: string
  status: 'OPEN' | 'SENT' | 'FULFILLED' | 'CANCELLED'
  requestedCity: string
  requestedByName: string | null
  createdAt: string
  warehouseId: string | null
  warehouse: { id: string; code: string; name: string; city: string | null } | null
  items: MovementRequestItem[]
}

function formatPresentationLabel(p: { name: string; unitsPerPresentation: unknown } | null | undefined): string {
  if (!p) return '—'
  const name = String(p.name ?? '').trim()
  const units = Number(p.unitsPerPresentation)
  if (!name) return '—'
  if (Number.isFinite(units) && units > 1) return `${name} (${units}u)`
  return name
}

async function listOpenMovementRequests(token: string): Promise<{ items: MovementRequest[] }> {
  const params = new URLSearchParams({ take: '100', status: 'OPEN' })
  const response = await apiFetch<{ items: any[] }>(`/api/v1/stock/movement-requests?${params.toString()}`, { token })
  return {
    items: (response.items ?? []).map((req: any) => ({
      id: req.id,
      status: req.status,
      requestedCity: req.requestedCity,
      requestedByName: req.requestedByName ?? null,
      createdAt: req.createdAt,
      warehouseId: req.warehouseId ?? null,
      warehouse: req.warehouse ?? null,
      items: (req.items ?? []).map((it: any) => ({
        id: it.id,
        productId: it.productId,
        productSku: it.productSku ?? null,
        productName: it.productName ?? null,
        genericName: it.genericName ?? null,
        requestedQuantity: Number(it.requestedQuantity ?? 0),
        remainingQuantity: Number(it.remainingQuantity ?? 0),
        presentationId: it.presentation?.id ?? it.presentationId ?? null,
        presentationQuantity: it.presentationQuantity === null || it.presentationQuantity === undefined ? null : Number(it.presentationQuantity),
        presentation: it.presentation
          ? { id: String(it.presentation.id), name: String(it.presentation.name), unitsPerPresentation: it.presentation.unitsPerPresentation }
          : null,
      })),
    })),
  }
}

export function BulkFulfillRequestsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()

  const [selectedRequestId, setSelectedRequestId] = useState<string>('')

  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false)
  const [labelBultos, setLabelBultos] = useState('')
  const [labelResponsable, setLabelResponsable] = useState('')
  const [labelObservaciones, setLabelObservaciones] = useState('')

  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState<null | { requestId: string; status: string; movements: number }>(null)

  const requestsQuery = useQuery({
    queryKey: ['movementRequests', 'fulfillRequestsV2'],
    queryFn: () => listOpenMovementRequests(auth.accessToken!),
    enabled: !!auth.accessToken,
    refetchInterval: 10_000,
  })

  const selectedRequest = useMemo(() => {
    return (requestsQuery.data?.items ?? []).find((r) => r.id === selectedRequestId) ?? null
  }, [requestsQuery.data?.items, selectedRequestId])

  const groupedRequests = useMemo(() => {
    const groups = new Map<string, { key: string; title: string; items: MovementRequest[] }>()
    for (const r of requestsQuery.data?.items ?? []) {
      const key = r.warehouse?.id ? `wh:${r.warehouse.id}` : `city:${(r.requestedCity ?? '').trim().toUpperCase()}`
      const title = r.warehouse
        ? `${r.warehouse.code} - ${r.warehouse.name}${r.warehouse.city ? ` (${r.warehouse.city})` : ''}`
        : `Ciudad: ${r.requestedCity}`
      const g = groups.get(key) ?? { key, title, items: [] }
      g.items.push(r)
      groups.set(key, g)
    }
    return [...groups.values()].map((g) => ({
      ...g,
      items: g.items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    }))
  }, [requestsQuery.data?.items])

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="✅ Atender solicitudes (sin selección de stock)">
        <MovementQuickActions currentPath="/stock/fulfill-requests" />
        <div className="mb-4 text-sm text-slate-700 dark:text-slate-300">
          Selecciona una solicitud para atender.
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">Solicitudes OPEN (agrupadas)</div>
            {requestsQuery.isLoading ? (
              <Loading />
            ) : requestsQuery.error ? (
              <ErrorState message="Error cargando solicitudes" retry={requestsQuery.refetch} />
            ) : groupedRequests.length === 0 ? (
              <EmptyState message="No hay solicitudes OPEN" />
            ) : (
              <div className="space-y-4">
                {groupedRequests.map((g) => (
                  <div key={g.key}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{g.title}</div>
                    <div className="space-y-2">
                      {g.items.map((r) => {
                        const isSelected = r.id === selectedRequestId
                        const itemsCount = (r.items ?? []).length
                        return (
                          <button
                            key={r.id}
                            className={`w-full rounded-md border p-3 text-left transition ${
                              isSelected
                                ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/50'
                            }`}
                            onClick={() => {
                              setSelectedRequestId(r.id)
                              setSubmitError('')
                              setSubmitSuccess(null)
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                                {r.requestedByName ?? '—'} · {new Date(r.createdAt).toLocaleString()}
                              </div>
                              <div className="shrink-0 text-xs text-slate-600 dark:text-slate-400">{itemsCount} ítems</div>
                            </div>
                            <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">Destino: {r.warehouse?.name ?? r.requestedCity}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">Detalles de la solicitud</div>
            {!selectedRequest ? (
              <EmptyState message="Selecciona una solicitud para ver detalles" />
            ) : (
              <div className="space-y-4">
                <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <div className="text-slate-900 dark:text-slate-100">
                    <span className="font-medium">Solicitante:</span> {selectedRequest.requestedByName ?? '—'}
                  </div>
                  <div className="text-slate-700 dark:text-slate-300">
                    <span className="font-medium">Destino:</span>{' '}
                    {selectedRequest.warehouse ? `${selectedRequest.warehouse.code} - ${selectedRequest.warehouse.name}` : selectedRequest.requestedCity}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      if (!selectedRequest) return
                      setIsLabelModalOpen(true)
                    }}
                  >
                    Generar rótulo PDF
                  </Button>
                </div>

                {submitError && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                    {submitError}
                  </div>
                )}
                {submitSuccess && (
                  <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
                    Listo. Solicitud {submitSuccess.requestId} → {submitSuccess.status}. Movimientos: {submitSuccess.movements}
                  </div>
                )}

                <div>
                  <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">Ítems solicitados</div>
                  {(selectedRequest.items ?? []).length === 0 ? (
                    <EmptyState message="Sin ítems" />
                  ) : (
                    <Table
                      data={selectedRequest.items}
                      keyExtractor={(it) => it.id}
                      columns={[
                        {
                          header: 'Producto',
                          accessor: (it) => (
                            <span className={it.remainingQuantity < it.requestedQuantity ? 'line-through text-slate-400 dark:text-slate-500' : ''}>
                              {getProductLabel({
                                sku: it.productSku ?? '—',
                                name: it.productName ?? '—',
                                genericName: it.genericName ?? null,
                              })}
                            </span>
                          ),
                        },
                        {
                          header: 'Presentación',
                          accessor: (it) => (
                            <span className={it.remainingQuantity < it.requestedQuantity ? 'line-through text-slate-400 dark:text-slate-500' : ''}>
                              {formatPresentationLabel(it.presentation ? { name: it.presentation.name, unitsPerPresentation: it.presentation.unitsPerPresentation } : null)}
                            </span>
                          ),
                        },
                        {
                          header: 'Solicitado (u)',
                          className: 'w-32',
                          accessor: (it) => (
                            <span className={it.remainingQuantity < it.requestedQuantity ? 'line-through text-slate-400 dark:text-slate-500' : ''}>
                              {String(Number(it.requestedQuantity ?? 0))}
                            </span>
                          ),
                        },
                        {
                          header: 'Pendiente (u)',
                          className: 'w-32',
                          accessor: (it) => (
                            <span className={it.remainingQuantity < it.requestedQuantity ? 'line-through text-slate-400 dark:text-slate-500' : ''}>
                              {String(Number(it.remainingQuantity ?? 0))}
                            </span>
                          ),
                        },
                      ]}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <Modal isOpen={isLabelModalOpen} onClose={() => setIsLabelModalOpen(false)} title="Rótulo (PDF)" maxWidth="lg">
          <div className="space-y-3">
            <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="text-slate-900 dark:text-slate-100">
                <span className="font-medium">Solicitud:</span> {selectedRequest?.id ?? '—'}
              </div>
              <div className="text-slate-700 dark:text-slate-300">
                <span className="font-medium">Destino:</span>{' '}
                {selectedRequest?.warehouse ? `${selectedRequest.warehouse.code} - ${selectedRequest.warehouse.name}` : selectedRequest?.requestedCity}
              </div>
              <div className="text-slate-700 dark:text-slate-300">
                <span className="font-medium">Solicitante:</span> {selectedRequest?.requestedByName ?? '—'}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Bultos" value={labelBultos} onChange={(e) => setLabelBultos(e.target.value)} placeholder="Ej: 3" />
              <Input
                label="Responsable"
                value={labelResponsable}
                onChange={(e) => setLabelResponsable(e.target.value)}
                placeholder="Ej: Juan Pérez"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Observaciones</label>
              <textarea
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                rows={3}
                value={labelObservaciones}
                onChange={(e) => setLabelObservaciones(e.target.value)}
                placeholder="Opcional"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  if (!selectedRequest) return

                  exportLabelToPdf({
                    requestId: selectedRequest.id,
                    generatedAtIso: new Date().toISOString(),
                    fromWarehouseLabel: '—',
                    fromLocationCode: '—',
                    toWarehouseLabel: selectedRequest.warehouse ? `${selectedRequest.warehouse.code} - ${selectedRequest.warehouse.name}` : selectedRequest.requestedCity,
                    toLocationCode: '—',
                    requestedByName: selectedRequest.requestedByName ?? null,
                    bultos: labelBultos,
                    responsable: labelResponsable,
                    observaciones: labelObservaciones,
                  })
                  setIsLabelModalOpen(false)
                }}
              >
                Descargar rótulo PDF
              </Button>
              <Button variant="secondary" onClick={() => setIsLabelModalOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </Modal>
        {/* SECCIÓN STOCK ORIGEN ELIMINADA COMPLETAMENTE - TIMESTAMP: 2026-02-02T12:00:00.000Z */}
      </PageContainer>
    </MainLayout>
  )
}
