import { useQuery } from '@tanstack/react-query'
import { MainLayout, PageContainer, Button, Loading, ErrorState, EmptyState, Table, Modal } from '../../components'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useNavigation } from '../../hooks'
import { apiFetch } from '../../lib/api'
import { exportPickingToPdf } from '../../lib/movementRequestDocsPdf'
import type { PickingPdfMeta, PickingPdfRequestedLine, PickingPdfSentLine } from '../../lib/movementRequestDocsPdf'
import { formatDateOnlyUtc } from '../../lib/date'
import { useAuth } from '../../providers/AuthProvider'

type CompletedMovement = {
  id: string
  type: 'MOVEMENT' | 'BULK_TRANSFER' | 'FULFILL_REQUEST' | 'RETURN'
  typeLabel: string
  createdAt: string
  completedAt: string
  fromWarehouseCode?: string
  toWarehouseCode?: string
  requestedByName?: string
  fulfilledByName?: string
  totalItems: number
  totalQuantity: number
  note?: string
  canExportPicking: boolean
  canExportLabel: boolean
}

export default function CompletedMovementsPage() {
  const navGroups = useNavigation()
  const auth = useAuth()

  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<CompletedMovement | null>(null)

  const [searchParams] = useSearchParams()
  const [highlightId, setHighlightId] = useState<string | null>(null)

  useEffect(() => {
    const id = searchParams.get('highlight')
    if (!id) return
    setHighlightId(id)
    const t = setTimeout(() => setHighlightId(null), 4500)
    return () => clearTimeout(t)
  }, [searchParams])

  const completedMovementsQuery = useQuery<{ items: CompletedMovement[] }>({
    queryKey: ['completed-movements'],
    queryFn: () => apiFetch('/api/v1/stock/completed-movements', {
      token: auth.accessToken!
    }),
    enabled: !!auth.accessToken,
  })

  const pickingDataQuery = useQuery<{ meta: PickingPdfMeta; requestedItems: PickingPdfRequestedLine[]; sentLines: PickingPdfSentLine[] }>({
    queryKey: ['completed-movement-picking', selected?.id, selected?.type],
    queryFn: () =>
      apiFetch(`/api/v1/stock/completed-movements/${selected!.id}/picking?type=${selected!.type}`, {
        token: auth.accessToken!,
      }),
    enabled: !!auth.accessToken && detailOpen && !!selected && selected.canExportPicking,
  })

  const exportPicking = async (movement: CompletedMovement) => {
    if (!movement.canExportPicking) return
    try {
      const data = await apiFetch<{ meta: PickingPdfMeta; requestedItems: PickingPdfRequestedLine[]; sentLines: PickingPdfSentLine[] }>(
        `/api/v1/stock/completed-movements/${movement.id}/picking?type=${movement.type}`,
        { token: auth.accessToken! },
      )
      exportPickingToPdf(data.meta, data.requestedItems ?? [], data.sentLines ?? [])
    } catch (error) {
      console.error('Error exporting picking:', error)
      alert('Error al exportar picking')
    }
  }

  if (completedMovementsQuery.isLoading) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="📋 Movimientos Realizados">
          <Loading />
        </PageContainer>
      </MainLayout>
    )
  }

  if (completedMovementsQuery.isError) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="📋 Movimientos Realizados">
          <ErrorState message="No se pudieron cargar los movimientos realizados." />
        </PageContainer>
      </MainLayout>
    )
  }

  const movements = completedMovementsQuery.data?.items || []

  const openDetail = (m: CompletedMovement) => {
    setSelected(m)
    setDetailOpen(true)
  }

  const closeDetail = () => {
    setDetailOpen(false)
    setSelected(null)
  }

  const rowClassName = (m: CompletedMovement) => {
    if (!highlightId) return ''
    if (m.id !== highlightId) return ''
    return 'ring-2 ring-green-500 ring-inset bg-green-50 dark:bg-green-900/20'
  }

  const columns = [
    { 
      header: 'Tipo', 
      accessor: (m: CompletedMovement) => {
        const parts = m.typeLabel.split(' (parcial)')
        if (parts.length > 1) {
          return (
            <div>
              <div>{parts[0]}</div>
              <div className="text-xs text-slate-500">(parcial)</div>
            </div>
          )
        }
        return m.typeLabel
      }
    },
    { header: 'Fecha', accessor: (m: CompletedMovement) => new Date(m.createdAt).toLocaleString('es-ES', { timeZone: 'America/La_Paz' }) },
    { 
      header: 'Origen → Destino', 
      accessor: (m: CompletedMovement) => {
        const fromCode = m.fromWarehouseCode ? m.fromWarehouseCode.replace(/^SUC-/, '') : '—'
        const toCode = m.toWarehouseCode ? m.toWarehouseCode.replace(/^SUC-/, '') : '—'
        return `${fromCode} → ${toCode}`
      }
    },
    { header: 'Solicitante', accessor: (m: CompletedMovement) => m.requestedByName || '—' },
    { header: 'Realizado por', accessor: (m: CompletedMovement) => m.fulfilledByName || '—' },
    { header: 'Items', accessor: (m: CompletedMovement) => m.totalItems },
    { header: 'Cantidad', accessor: (m: CompletedMovement) => m.totalQuantity },
    {
      header: 'Acciones',
      accessor: (m: CompletedMovement) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => openDetail(m)}>
            Ver
          </Button>
        </div>
      ),
    },
  ]

  const sentLinesColumns = [
    { header: 'Producto', accessor: (l: PickingPdfSentLine) => l.productLabel },
    { header: 'Presentación', accessor: (l: PickingPdfSentLine) => l.presentationLabel || '—' },
    { header: 'Cantidad', accessor: (l: PickingPdfSentLine) => l.quantityUnits },
    { header: 'Lote', accessor: (l: PickingPdfSentLine) => l.batchNumber || '—' },
    {
      header: 'Vence',
      accessor: (l: PickingPdfSentLine) => (l.expiresAt ? formatDateOnlyUtc(l.expiresAt, 'es-ES') : '—'),
    },
    { header: 'Ubicación', accessor: (l: PickingPdfSentLine) => l.locationCode || '—' },
  ]

  return (
    <MainLayout navGroups={navGroups}>
      <MovementQuickActions currentPath="/stock/completed-movements" />
      <PageContainer title="📋 Movimientos Realizados">
        <div className="mb-4 text-sm text-slate-700 dark:text-slate-300">
          Historial de movimientos completados con acceso a documentos PDF
        </div>

        {movements.length === 0 ? (
          <EmptyState message="Aún no se han completado movimientos en el sistema." />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <Table columns={columns} data={movements} keyExtractor={(m) => m.id} rowClassName={rowClassName} />
            </div>
          </div>
        )}
      </PageContainer>

      <Modal isOpen={detailOpen} onClose={closeDetail} title={selected ? selected.typeLabel : 'Movimiento'} maxWidth="2xl">
        {!selected ? null : (
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 p-4 text-sm dark:border-slate-700">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <div className="text-slate-500">Fecha</div>
                  <div className="text-slate-900 dark:text-slate-100">
                    {new Date(selected.createdAt).toLocaleString('es-ES', { timeZone: 'America/La_Paz' })}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Origen → Destino</div>
                  <div className="text-slate-900 dark:text-slate-100">
                    {(selected.fromWarehouseCode ? selected.fromWarehouseCode.replace(/^SUC-/, '') : '—') +
                      ' → ' +
                      (selected.toWarehouseCode ? selected.toWarehouseCode.replace(/^SUC-/, '') : '—')}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Solicitante</div>
                  <div className="text-slate-900 dark:text-slate-100">{selected.requestedByName || '—'}</div>
                </div>
                <div>
                  <div className="text-slate-500">Realizado por</div>
                  <div className="text-slate-900 dark:text-slate-100">{selected.fulfilledByName || '—'}</div>
                </div>
                <div>
                  <div className="text-slate-500">Items</div>
                  <div className="text-slate-900 dark:text-slate-100">{selected.totalItems}</div>
                </div>
                <div>
                  <div className="text-slate-500">Cantidad</div>
                  <div className="text-slate-900 dark:text-slate-100">{selected.totalQuantity}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!selected.canExportPicking} onClick={() => exportPicking(selected)}>
                Picking PDF
              </Button>
              <Button variant="secondary" onClick={closeDetail}>
                Cerrar
              </Button>
            </div>

            {selected.canExportPicking ? (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Ítems enviados</div>

                {pickingDataQuery.isLoading ? (
                  <div className="py-4">
                    <Loading />
                  </div>
                ) : pickingDataQuery.isError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                    No se pudo cargar el detalle del picking.
                  </div>
                ) : (pickingDataQuery.data?.sentLines?.length ?? 0) === 0 ? (
                  <div className="text-sm text-slate-500">Sin ítems enviados para mostrar.</div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    <div className="overflow-x-auto">
                      <Table
                        columns={sentLinesColumns}
                        data={pickingDataQuery.data!.sentLines}
                        keyExtractor={(l) =>
                          [
                            l.productLabel,
                            l.presentationLabel ?? '',
                            String(l.quantityUnits ?? ''),
                            l.batchNumber ?? '',
                            l.expiresAt ?? '',
                            l.locationCode ?? '',
                          ].join('|')
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </MainLayout>
  )
}