import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Loading, ErrorState, Table, PaginationCursor, Button, Modal, Input } from '../../components'

type BatchItem = {
  id: string
  productId: string
  batchNumber: string
  manufacturingDate: string | null
  expiresAt: string | null
  status: 'QUARANTINE' | 'RELEASED'
  qcNote: string | null
  qcReleasedAt: string | null
  qcReleasedBy: string | null
  sourceType: string | null
  sourceId: string | null
  createdAt: string
  product: { sku: string; name: string }
}

type ListResponse<T> = { items: T[]; nextCursor: string | null }

async function listQuarantineBatches(token: string, take: number, cursor?: string): Promise<ListResponse<BatchItem>> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/api/v1/laboratory/qc/quarantine-batches?${params}`, { token })
}

async function releaseBatch(token: string, batchId: string, qcNote?: string | null): Promise<{ item: any }> {
  return apiFetch(`/api/v1/laboratory/batches/${encodeURIComponent(batchId)}/release`, { token, method: 'POST', body: JSON.stringify({ qcNote: qcNote ?? null }) })
}

export function LabQCQuarantineBatchesPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const qc = useQueryClient()

  const canWrite = perms.hasPermission('stock:manage')

  const [cursor, setCursor] = useState<string | undefined>()
  const take = 50

  const listQuery = useQuery({
    queryKey: ['laboratory', 'qc', 'quarantine-batches', { take, cursor }],
    queryFn: () => listQuarantineBatches(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const [releaseBatchId, setReleaseBatchId] = useState<string | null>(null)
  const [qcNote, setQcNote] = useState('')

  const releaseMutation = useMutation({
    mutationFn: () => releaseBatch(auth.accessToken!, releaseBatchId!, qcNote.trim() ? qcNote.trim() : null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'qc', 'quarantine-batches'] })
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-run'] })
      setReleaseBatchId(null)
      setQcNote('')
    },
  })

  const columns = useMemo(
    () => [
      { header: 'Lote', accessor: (b: BatchItem) => b.batchNumber, className: 'wrap' },
      { header: 'Producto', accessor: (b: BatchItem) => `${b.product.sku} — ${b.product.name}`, className: 'wrap' },
      { header: 'F. Fab', accessor: (b: BatchItem) => (b.manufacturingDate ? new Date(b.manufacturingDate).toLocaleDateString() : '—') },
      { header: 'Vence', accessor: (b: BatchItem) => (b.expiresAt ? new Date(b.expiresAt).toLocaleDateString() : '—') },
      { header: 'Estado', accessor: (b: BatchItem) => b.status },
      {
        header: 'Acciones',
        accessor: (b: BatchItem) => (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setReleaseBatchId(b.id)
                setQcNote('')
              }}
              disabled={!canWrite || b.status !== 'QUARANTINE'}
            >
              Liberar
            </Button>
          </div>
        ),
      },
    ],
    [canWrite],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="🧪 Laboratorio — QC (Cuarentena)">
        {listQuery.isLoading ? (
          <Loading />
        ) : listQuery.error ? (
          <ErrorState message={(listQuery.error as any)?.message ?? 'Error al cargar lotes en cuarentena'} />
        ) : (
          <>
            <Table columns={columns as any} data={listQuery.data?.items ?? []} keyExtractor={(b: BatchItem) => b.id} />
            <div className="mt-3">
              <PaginationCursor
                hasMore={!!listQuery.data?.nextCursor}
                onLoadMore={() => setCursor(listQuery.data!.nextCursor!)}
                loading={listQuery.isFetching}
              />
            </div>
          </>
        )}

        <Modal isOpen={!!releaseBatchId} onClose={() => setReleaseBatchId(null)} title="Liberar QC" maxWidth="lg">
          <div className="space-y-4">
            <Input label="Nota QC (opcional)" value={qcNote} onChange={(e) => setQcNote(e.target.value)} />

            {releaseMutation.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {(releaseMutation.error as any)?.message ?? 'Error al liberar'}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReleaseBatchId(null)} disabled={releaseMutation.isPending}>
                Cancelar
              </Button>
              <Button onClick={() => releaseMutation.mutate()} disabled={!canWrite || releaseMutation.isPending}>
                {releaseMutation.isPending ? 'Liberando…' : 'Liberar'}
              </Button>
            </div>
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
