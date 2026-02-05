import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Table, Loading, ErrorState, PaginationCursor, Button } from '../../components'

type RunListItem = {
  id: string
  laboratoryId: string
  requestId: string | null
  recipeId: string
  productId: string
  plannedOutputQuantity: string | null
  outputUnit: string | null
  actualOutputQuantity: string | null
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  laboratory: { id: string; name: string; city: string | null }
  product: { sku: string; name: string }
  recipe: { name: string }
}

type ListResponse<T> = { items: T[]; nextCursor: string | null }

async function listRuns(token: string, take: number, cursor?: string): Promise<ListResponse<RunListItem>> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/api/v1/laboratory/production-runs?${params}`, { token })
}

export function LabProductionRunsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const navigate = useNavigate()

  const canWrite = perms.hasPermission('stock:manage')

  const [cursor, setCursor] = useState<string | undefined>()
  const take = 50

  const runsQuery = useQuery({
    queryKey: ['laboratory', 'production-runs', { take, cursor }],
    queryFn: () => listRuns(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const columns = useMemo(
    () => [
      { header: 'Estado', accessor: (r: RunListItem) => r.status },
      { header: 'Laboratorio', accessor: (r: RunListItem) => r.laboratory.name, className: 'wrap' },
      { header: 'Producto', accessor: (r: RunListItem) => `${r.product.sku} — ${r.product.name}`, className: 'wrap' },
      { header: 'Receta', accessor: (r: RunListItem) => r.recipe.name, className: 'wrap' },
      {
        header: 'Plan',
        accessor: (r: RunListItem) =>
          r.plannedOutputQuantity && r.outputUnit ? `${r.plannedOutputQuantity} ${r.outputUnit}` : r.plannedOutputQuantity ? `${r.plannedOutputQuantity}` : '—',
      },
      {
        header: 'Real',
        accessor: (r: RunListItem) =>
          r.actualOutputQuantity && r.outputUnit ? `${r.actualOutputQuantity} ${r.outputUnit}` : r.actualOutputQuantity ? `${r.actualOutputQuantity}` : '—',
      },
      { header: 'Inicio', accessor: (r: RunListItem) => (r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'), className: 'wrap' },
      { header: 'Fin', accessor: (r: RunListItem) => (r.completedAt ? new Date(r.completedAt).toLocaleString() : '—'), className: 'wrap' },
      {
        header: 'Acciones',
        accessor: (r: RunListItem) => (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/laboratory/production-runs/${encodeURIComponent(r.id)}`)}>
              Ver
            </Button>
          </div>
        ),
      },
    ],
    [navigate],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="🧪 Laboratorio — Corridas">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm text-slate-600 dark:text-slate-300">Corridas de producción (outputs crean lote en cuarentena).</div>
          <Button onClick={() => navigate('/laboratory/production-requests')} disabled={!canWrite}>
            + Desde solicitud
          </Button>
        </div>

        {runsQuery.isLoading ? (
          <Loading />
        ) : runsQuery.error ? (
          <ErrorState message={(runsQuery.error as any)?.message ?? 'Error al cargar corridas'} />
        ) : (
          <>
            <Table columns={columns as any} data={runsQuery.data?.items ?? []} keyExtractor={(r: RunListItem) => r.id} />
            <div className="mt-3">
              <PaginationCursor
                hasMore={!!runsQuery.data?.nextCursor}
                onLoadMore={() => setCursor(runsQuery.data!.nextCursor!)}
                loading={runsQuery.isFetching}
              />
            </div>
          </>
        )}
      </PageContainer>
    </MainLayout>
  )
}
