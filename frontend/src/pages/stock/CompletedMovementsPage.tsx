import { useQuery } from '@tanstack/react-query'
import { MainLayout, PageContainer, Button, Loading, ErrorState, EmptyState, Table } from '../../components'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useNavigation } from '../../hooks'
import { apiFetch } from '../../lib/api'
import { exportLabelToPdf, exportPickingToPdf } from '../../lib/movementRequestDocsPdf'
import type { LabelPdfData, PickingPdfMeta, PickingPdfRequestedLine, PickingPdfSentLine } from '../../lib/movementRequestDocsPdf'
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

  const exportLabel = async (movement: CompletedMovement) => {
    if (!movement.canExportLabel) return
    try {
      const data = await apiFetch<LabelPdfData>(
        `/api/v1/stock/completed-movements/${movement.id}/label?type=${movement.type}`,
        { token: auth.accessToken! },
      )
      exportLabelToPdf(data)
    } catch (error) {
      console.error('Error exporting label:', error)
      alert('Error al exportar rótulo')
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
          <Button size="sm" variant="outline" disabled={!m.canExportPicking} onClick={() => exportPicking(m)}>
            Picking PDF
          </Button>
          <Button size="sm" variant="outline" disabled={!m.canExportLabel} onClick={() => exportLabel(m)}>
            Rótulo PDF
          </Button>
        </div>
      ),
    },
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
    </MainLayout>
  )
}