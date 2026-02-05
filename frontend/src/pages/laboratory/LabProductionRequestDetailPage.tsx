import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Loading, ErrorState, Table, Button, Modal, Input } from '../../components'

type SupplyItem = { id: string; code: string | null; name: string; baseUnit: string; isActive: boolean }

type RequestItem = {
  id: string
  laboratoryId: string
  productId: string
  recipeId: string
  requestedOutputQuantity: string
  outputUnit: string
  status: 'DRAFT' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  neededBy: string | null
  note: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  createdAt: string
  updatedAt: string
  laboratory: { id: string; name: string; city: string | null }
  product: { sku: string; name: string }
  recipe: {
    id: string
    name: string
    items: Array<{ id: string; supplyId: string; quantity: string; unit: string }>
  }
  runs: Array<{ id: string; status: string; createdAt: string; startedAt: string | null; completedAt: string | null }>
}

async function fetchRequest(token: string, id: string): Promise<{ item: RequestItem }> {
  return apiFetch(`/api/v1/laboratory/production-requests/${encodeURIComponent(id)}`, { token })
}

async function approveRequest(token: string, id: string): Promise<{ ok: true; id: string }> {
  return apiFetch(`/api/v1/laboratory/production-requests/${encodeURIComponent(id)}/approve`, { token, method: 'POST' })
}

async function cancelRequest(token: string, id: string, note?: string | null): Promise<{ ok: true; id: string }> {
  return apiFetch(`/api/v1/laboratory/production-requests/${encodeURIComponent(id)}/cancel`, {
    token,
    method: 'POST',
    body: JSON.stringify({ note: note ?? null }),
  })
}

async function createRunFromRequest(token: string, requestId: string): Promise<{ id: string }> {
  return apiFetch('/api/v1/laboratory/production-runs', { token, method: 'POST', body: JSON.stringify({ requestId }) })
}

async function listSupplies(token: string): Promise<{ items: SupplyItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ take: '100' })
  params.set('category', 'RAW_MATERIAL')
  return apiFetch(`/api/v1/laboratory/supplies?${params}`, { token })
}

export function LabProductionRequestDetailPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { id } = useParams<{ id: string }>()
  const requestId = id ?? ''

  const canWrite = perms.hasPermission('stock:manage')

  const suppliesQuery = useQuery({
    queryKey: ['laboratory', 'supplies', { take: 100, cursor: undefined }],
    queryFn: () => listSupplies(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const supplyNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of suppliesQuery.data?.items ?? []) {
      if (!s.isActive) continue
      map.set(s.id, s.name)
    }
    return map
  }, [suppliesQuery.data])

  const requestQuery = useQuery({
    queryKey: ['laboratory', 'production-request', requestId],
    queryFn: () => fetchRequest(auth.accessToken!, requestId),
    enabled: !!auth.accessToken && !!requestId,
  })

  const item = requestQuery.data?.item

  const approveMutation = useMutation({
    mutationFn: () => approveRequest(auth.accessToken!, requestId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-request', requestId] })
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-requests'] })
    },
  })

  const [showCancel, setShowCancel] = useState(false)
  const [cancelNote, setCancelNote] = useState('')

  const cancelMutation = useMutation({
    mutationFn: () => cancelRequest(auth.accessToken!, requestId, cancelNote.trim() ? cancelNote.trim() : null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-request', requestId] })
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-requests'] })
      setShowCancel(false)
      setCancelNote('')
    },
  })

  const runMutation = useMutation({
    mutationFn: () => createRunFromRequest(auth.accessToken!, requestId),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-request', requestId] })
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-runs'] })
      navigate(`/laboratory/production-runs/${encodeURIComponent(res.id)}`)
    },
  })

  const recipeColumns = useMemo(
    () => [
      { header: 'Insumo', accessor: (x: any) => supplyNameById.get(x.supplyId) ?? x.supplyId, className: 'wrap' },
      { header: 'Cantidad', accessor: (x: any) => `${x.quantity} ${x.unit}` },
    ],
    [supplyNameById],
  )

  const runsColumns = useMemo(
    () => [
      { header: 'Estado', accessor: (r: any) => r.status },
      { header: 'Creado', accessor: (r: any) => new Date(r.createdAt).toLocaleString(), className: 'wrap' },
      { header: 'Inicio', accessor: (r: any) => (r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'), className: 'wrap' },
      { header: 'Fin', accessor: (r: any) => (r.completedAt ? new Date(r.completedAt).toLocaleString() : '—'), className: 'wrap' },
      {
        header: 'Acciones',
        accessor: (r: any) => (
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
      <PageContainer title={item ? `🧪 Solicitud — ${item.product.sku}` : '🧪 Solicitud'}>
        {requestQuery.isLoading ? (
          <Loading />
        ) : requestQuery.error ? (
          <ErrorState message={(requestQuery.error as any)?.message ?? 'Error al cargar solicitud'} />
        ) : !item ? (
          <ErrorState message="No encontrado" />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <div>Estado: {item.status}</div>
                <div>Laboratorio: {item.laboratory.name}</div>
                <div>Producto: {item.product.sku} — {item.product.name}</div>
                <div>Receta: {item.recipe.name}</div>
                <div>Solicitado: {item.requestedOutputQuantity} {item.outputUnit}</div>
                <div>Necesario: {item.neededBy ? new Date(item.neededBy).toLocaleDateString() : '—'}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => navigate('/laboratory/production-requests')}>
                  Volver
                </Button>
                <Button
                  onClick={() => approveMutation.mutate()}
                  disabled={!canWrite || approveMutation.isPending || item.status !== 'DRAFT'}
                >
                  Aprobar
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowCancel(true)}
                  disabled={!canWrite || item.status === 'CANCELLED' || item.status === 'COMPLETED'}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={() => runMutation.mutate()}
                  disabled={!canWrite || runMutation.isPending || item.status !== 'APPROVED'}
                >
                  Crear corrida
                </Button>
              </div>
            </div>

            {item.note ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200">
                {item.note}
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">Insumos de receta</div>
              <Table columns={recipeColumns as any} data={item.recipe.items ?? []} keyExtractor={(x: any) => x.id} />
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">(MVP: aquí mostramos supplyId; luego lo linkeamos a nombres)</div>
            </div>

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">Corridas</div>
              <Table columns={runsColumns as any} data={item.runs ?? []} keyExtractor={(r: any) => r.id} />
            </div>

            <Modal isOpen={showCancel} onClose={() => setShowCancel(false)} title="Cancelar solicitud" maxWidth="lg">
              <div className="space-y-4">
                <Input label="Nota (opcional)" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} />

                {cancelMutation.error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                    {(cancelMutation.error as any)?.message ?? 'Error al cancelar'}
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setShowCancel(false)} disabled={cancelMutation.isPending}>
                    Volver
                  </Button>
                  <Button onClick={() => cancelMutation.mutate()} disabled={!canWrite || cancelMutation.isPending}>
                    {cancelMutation.isPending ? 'Cancelando…' : 'Cancelar'}
                  </Button>
                </div>
              </div>
            </Modal>

            {approveMutation.error || runMutation.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {(approveMutation.error as any)?.message ?? (runMutation.error as any)?.message ?? 'Error'}
              </div>
            ) : null}
          </div>
        )}
      </PageContainer>
    </MainLayout>
  )
}
