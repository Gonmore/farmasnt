import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Table, Loading, ErrorState, Button, Modal, Input } from '../../components'

type RunListItem = {
  id: string
  laboratoryId: string
  recipeId: string
  productId: string
  plannedOutputQuantity: string | null
  outputUnit: string | null
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  startedAt: string | null
  estimatedCompleteAt: string | null
  note: string | null
  laboratory: { id: string; name: string; city: string | null }
  product: { sku: string; name: string }
  recipe: { name: string }
}

type ListResponse<T> = { items: T[]; nextCursor: string | null }

async function listInProgressRuns(token: string): Promise<ListResponse<RunListItem>> {
  const params = new URLSearchParams({ take: '100', status: 'IN_PROGRESS' })
  return apiFetch(`/api/v1/laboratory/production-runs?${params}`, { token })
}

async function updateRun(
  token: string,
  id: string,
  body: { estimatedCompleteAt?: string | null; note?: string | null },
): Promise<{ ok: true; id: string }> {
  return apiFetch(`/api/v1/laboratory/production-runs/${encodeURIComponent(id)}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.estimatedCompleteAt !== undefined
        ? { estimatedCompleteAt: body.estimatedCompleteAt ? new Date(body.estimatedCompleteAt).toISOString() : null }
        : {}),
    }),
  })
}

export function LabWipPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const canWrite = perms.hasPermission('stock:manage')

  const runsQuery = useQuery({
    queryKey: ['laboratory', 'production-runs', 'wip'],
    queryFn: () => listInProgressRuns(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const [editing, setEditing] = useState<RunListItem | null>(null)
  const [editEta, setEditEta] = useState('')
  const [editNote, setEditNote] = useState('')

  const openEdit = (r: RunListItem) => {
    setEditing(r)
    setEditEta(r.estimatedCompleteAt ? new Date(r.estimatedCompleteAt).toISOString().slice(0, 16) : '')
    setEditNote(r.note ?? '')
  }

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('Seleccioná una corrida')
      return updateRun(auth.accessToken!, editing.id, {
        estimatedCompleteAt: editEta.trim() ? editEta.trim() : null,
        note: editNote.trim() ? editNote.trim() : null,
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-runs'] })
      setEditing(null)
    },
  })

  const columns = useMemo(
    () => [
      { header: 'Laboratorio', accessor: (r: RunListItem) => r.laboratory.name, className: 'wrap' },
      { header: 'Producto', accessor: (r: RunListItem) => `${r.product.sku} — ${r.product.name}`, className: 'wrap' },
      { header: 'Receta', accessor: (r: RunListItem) => r.recipe.name, className: 'wrap' },
      {
        header: 'Plan',
        accessor: (r: RunListItem) =>
          r.plannedOutputQuantity && r.outputUnit
            ? `${r.plannedOutputQuantity} ${r.outputUnit}`
            : r.plannedOutputQuantity
              ? `${r.plannedOutputQuantity}`
              : '—',
      },
      { header: 'Inicio', accessor: (r: RunListItem) => (r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'), className: 'wrap' },
      {
        header: 'ETA',
        accessor: (r: RunListItem) => (r.estimatedCompleteAt ? new Date(r.estimatedCompleteAt).toLocaleString() : '—'),
        className: 'wrap',
      },
      { header: 'Nota', accessor: (r: RunListItem) => r.note ?? '—', className: 'wrap' },
      {
        header: 'Acciones',
        accessor: (r: RunListItem) => (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/laboratory/production-runs/${encodeURIComponent(r.id)}`)}>
              Ver
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openEdit(r)} disabled={!canWrite}>
              ETA/Nota
            </Button>
          </div>
        ),
      },
    ],
    [canWrite, navigate],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="🧪 Laboratorio — Producto en proceso">
        <div className="mb-3 text-sm text-slate-600 dark:text-slate-300">Corridas en curso (IN_PROGRESS) con ETA y observaciones.</div>

        {runsQuery.isLoading ? (
          <Loading />
        ) : runsQuery.error ? (
          <ErrorState message={(runsQuery.error as any)?.message ?? 'Error al cargar WIP'} />
        ) : (
          <Table columns={columns as any} data={runsQuery.data?.items ?? []} keyExtractor={(r: RunListItem) => r.id} />
        )}

        <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing ? `Actualizar: ${editing.product.sku}` : 'Actualizar'} maxWidth="lg">
          {!editing ? null : (
            <div className="space-y-4">
              <Input label="ETA (opcional)" type="datetime-local" value={editEta} onChange={(e) => setEditEta(e.target.value)} />
              <Input label="Observación (opcional)" value={editNote} onChange={(e) => setEditNote(e.target.value)} />

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
                <Button onClick={() => updateMutation.mutate()} disabled={!canWrite || updateMutation.isPending}>
                  {updateMutation.isPending ? 'Guardando…' : 'Guardar'}
                </Button>
              </div>

              {updateMutation.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                  {(updateMutation.error as any)?.message ?? 'Error al guardar'}
                </div>
              ) : null}
            </div>
          )}
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
