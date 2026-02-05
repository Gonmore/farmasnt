import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import {
  MainLayout,
  PageContainer,
  Table,
  Loading,
  ErrorState,
  PaginationCursor,
  Button,
  Modal,
  Input,
  Select,
} from '../../components'

type LabItem = { id: string; name: string; city: string | null; isActive: boolean }

type SupplyItem = {
  id: string
  code: string | null
  name: string
  baseUnit: string
  isActive: boolean
}

type PurchaseListListItem = {
  id: string
  number: string
  numberYear: number
  status: 'DRAFT' | 'SENT' | 'CLOSED' | 'CANCELLED'
  city: string | null
  laboratoryId: string | null
  createdAt: string
  updatedAt: string
}

type PurchaseListLineDraft = {
  supplyId: string
  requestedQuantity: string
  unit: string
  vendorName: string
  note: string
}

type ListResponse<T> = { items: T[]; nextCursor: string | null }

async function listLabs(token: string): Promise<{ items: LabItem[] }> {
  return apiFetch('/api/v1/laboratories', { token })
}

async function listSupplies(token: string, take: number, cursor?: string): Promise<ListResponse<SupplyItem>> {
  const params = new URLSearchParams({ take: String(take) })
  params.set('category', 'RAW_MATERIAL')
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/api/v1/laboratory/supplies?${params}`, { token })
}

async function listPurchaseLists(token: string, take: number, cursor?: string): Promise<ListResponse<PurchaseListListItem>> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/api/v1/laboratory/purchase-lists?${params}`, { token })
}

async function createPurchaseList(
  token: string,
  body: {
    laboratoryId?: string | null
    note?: string | null
    lines: Array<{
      supplyId: string
      requestedQuantity: number
      unit: string
      vendorName?: string | null
      note?: string | null
      sortOrder?: number
    }>
  },
): Promise<{ id: string }> {
  return apiFetch('/api/v1/laboratory/purchase-lists', { token, method: 'POST', body: JSON.stringify(body) })
}

export function LabPurchaseListsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const canWrite = perms.hasPermission('stock:manage')

  const [cursor, setCursor] = useState<string | undefined>()
  const take = 50

  const listsQuery = useQuery({
    queryKey: ['laboratory', 'purchase-lists', { take, cursor }],
    queryFn: () => listPurchaseLists(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const labsQuery = useQuery({
    queryKey: ['laboratory', 'labs'],
    queryFn: () => listLabs(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const suppliesQuery = useQuery({
    queryKey: ['laboratory', 'supplies', { take: 100, cursor: undefined }],
    queryFn: () => listSupplies(auth.accessToken!, 100, undefined),
    enabled: !!auth.accessToken,
  })

  const activeLabs = (labsQuery.data?.items ?? []).filter((l) => l.isActive)
  const supplies = (suppliesQuery.data?.items ?? []).filter((s) => s.isActive)

  const [showCreate, setShowCreate] = useState(false)
  const [createLabId, setCreateLabId] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [lines, setLines] = useState<PurchaseListLineDraft[]>([
    { supplyId: '', requestedQuantity: '1', unit: 'UN', vendorName: '', note: '' },
  ])

  const addLine = () => setLines((prev) => [...prev, { supplyId: '', requestedQuantity: '1', unit: 'UN', vendorName: '', note: '' }])
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx))

  const createMutation = useMutation({
    mutationFn: async () => {
      const parsedLines = lines
        .map((l, idx) => ({
          supplyId: l.supplyId,
          requestedQuantity: Number(l.requestedQuantity),
          unit: l.unit.trim() || 'UN',
          vendorName: l.vendorName.trim() ? l.vendorName.trim() : null,
          note: l.note.trim() ? l.note.trim() : null,
          sortOrder: idx,
        }))
        .filter((l) => l.supplyId && Number.isFinite(l.requestedQuantity) && l.requestedQuantity > 0)

      if (!parsedLines.length) throw new Error('Agregá al menos una línea válida')

      return createPurchaseList(auth.accessToken!, {
        laboratoryId: createLabId ? createLabId : null,
        note: createNote.trim() ? createNote.trim() : null,
        lines: parsedLines,
      })
    },
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'purchase-lists'] })
      setShowCreate(false)
      setCreateLabId('')
      setCreateNote('')
      setLines([{ supplyId: '', requestedQuantity: '1', unit: 'UN', vendorName: '', note: '' }])
      navigate(`/laboratory/purchase-lists/${encodeURIComponent(res.id)}`)
    },
  })

  const columns = useMemo(
    () => [
      { header: 'Nro', accessor: (p: PurchaseListListItem) => p.number },
      { header: 'Estado', accessor: (p: PurchaseListListItem) => p.status },
      { header: 'Ciudad', accessor: (p: PurchaseListListItem) => p.city ?? '—' },
      { header: 'Actualizado', accessor: (p: PurchaseListListItem) => new Date(p.updatedAt).toLocaleString(), className: 'wrap' },
      {
        header: 'Acciones',
        accessor: (p: PurchaseListListItem) => (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/laboratory/purchase-lists/${encodeURIComponent(p.id)}`)}>
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
      <PageContainer title="🧪 Laboratorio — Listas de compra">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm text-slate-600 dark:text-slate-300">Listas de compra de insumos (SPL).</div>
          <Button onClick={() => setShowCreate(true)} disabled={!canWrite}>
            Nueva lista
          </Button>
        </div>

        {listsQuery.isLoading ? (
          <Loading />
        ) : listsQuery.error ? (
          <ErrorState message={(listsQuery.error as any)?.message ?? 'Error al cargar listas'} />
        ) : (
          <>
            <Table columns={columns as any} data={listsQuery.data?.items ?? []} keyExtractor={(p: PurchaseListListItem) => p.id} />
            <div className="mt-3">
              <PaginationCursor
                hasMore={!!listsQuery.data?.nextCursor}
                onLoadMore={() => setCursor(listsQuery.data!.nextCursor!)}
                loading={listsQuery.isFetching}
              />
            </div>
          </>
        )}

        <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nueva lista de compra" maxWidth="2xl">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                label="Laboratorio (opcional)"
                value={createLabId}
                onChange={(e) => setCreateLabId(e.target.value)}
                options={[
                  { value: '', label: '—' },
                  ...activeLabs.map((l) => ({ value: l.id, label: `${l.name}${l.city ? ` (${l.city})` : ''}` })),
                ]}
              />
              <Input label="Nota (opcional)" value={createNote} onChange={(e) => setCreateNote(e.target.value)} />
            </div>

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Líneas</div>
                <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                  + Agregar
                </Button>
              </div>

              <div className="space-y-3">
                {lines.map((l, idx) => (
                  <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                    <div className="md:col-span-5">
                      <Select
                        label={idx === 0 ? 'Insumo' : undefined}
                        value={l.supplyId}
                        onChange={(e) =>
                          setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, supplyId: e.target.value } : x)))
                        }
                        options={[
                          { value: '', label: 'Seleccionar…' },
                          ...supplies.map((s) => ({ value: s.id, label: `${s.name}${s.code ? ` (${s.code})` : ''}` })),
                        ]}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Input
                        label={idx === 0 ? 'Cantidad' : undefined}
                        type="number"
                        min={0}
                        step={0.01}
                        value={l.requestedQuantity}
                        onChange={(e) =>
                          setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, requestedQuantity: e.target.value } : x)))
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Input
                        label={idx === 0 ? 'Unidad' : undefined}
                        value={l.unit}
                        onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Input
                        label={idx === 0 ? 'Proveedor' : undefined}
                        value={l.vendorName}
                        onChange={(e) =>
                          setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, vendorName: e.target.value } : x)))
                        }
                      />
                    </div>
                    <div className="md:col-span-1 flex items-end justify-end">
                      <Button type="button" variant="secondary" size="sm" onClick={() => removeLine(idx)}>
                        ✕
                      </Button>
                    </div>
                    <div className="md:col-span-12">
                      <Input
                        label={idx === 0 ? 'Nota línea (opcional)' : undefined}
                        value={l.note}
                        onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x)))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {createMutation.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {(createMutation.error as any)?.message ?? 'Error al crear'}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={createMutation.isPending}>
                Cancelar
              </Button>
              <Button onClick={() => createMutation.mutate()} disabled={!canWrite || createMutation.isPending}>
                {createMutation.isPending ? 'Creando…' : 'Crear'}
              </Button>
            </div>
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
