import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Table, Loading, ErrorState, PaginationCursor, Button, Modal, Input, Select } from '../../components'

type LaboratoryListItem = { id: string; name: string; city: string | null; warehouseId: string; isActive: boolean }

type SupplyListItem = { id: string; name: string; baseUnit: string; isActive: boolean }

type ReceiptListItem = {
  id: string
  number: string
  numberYear: number
  status: 'DRAFT' | 'POSTED' | 'CANCELLED'
  laboratoryId: string | null
  purchaseListId: string | null
  vendorName: string | null
  receivedAt: string | null
  postedAt: string | null
  createdAt: string
}

type ListResponse = { items: ReceiptListItem[]; nextCursor: string | null }

type CreateLine = {
  supplyId: string
  quantity: string
  unit: string
  lotNumber: string
  expiresAt: string
}

async function listReceipts(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/api/v1/laboratory/receipts?${params}`, { token })
}

async function listLaboratories(token: string): Promise<{ items: LaboratoryListItem[] }> {
  return apiFetch('/api/v1/laboratories', { token })
}

async function listSupplies(token: string): Promise<{ items: SupplyListItem[] }> {
  return apiFetch('/api/v1/laboratory/supplies?take=100&category=RAW_MATERIAL', { token })
}

async function createReceipt(
  token: string,
  body: {
    laboratoryId: string
    vendorName?: string | null
    vendorDocument?: string | null
    receivedAt?: string | null
    note?: string | null
    lines: Array<{
      supplyId: string
      quantity: number
      unit: string
      lotNumber?: string | null
      expiresAt?: string | null
    }>
  },
): Promise<{ id: string }> {
  return apiFetch('/api/v1/laboratory/receipts', {
    token,
    method: 'POST',
    body: JSON.stringify({
      ...body,
      receivedAt: body.receivedAt ? new Date(body.receivedAt).toISOString() : null,
      lines: body.lines.map((l) => ({
        ...l,
        expiresAt: l.expiresAt ? new Date(l.expiresAt).toISOString() : null,
      })),
    }),
  })
}

export function LabReceiptsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const canWrite = perms.hasPermission('stock:manage')

  const [cursor, setCursor] = useState<string | undefined>()
  const take = 50

  const receiptsQuery = useQuery({
    queryKey: ['laboratory', 'receipts', { take, cursor }],
    queryFn: () => listReceipts(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const labsQuery = useQuery({
    queryKey: ['laboratory', 'labs', 'forReceipts'],
    queryFn: () => listLaboratories(auth.accessToken!),
    enabled: !!auth.accessToken && canWrite,
  })

  const suppliesQuery = useQuery({
    queryKey: ['laboratory', 'supplies', 'forReceiptCreate'],
    queryFn: () => listSupplies(auth.accessToken!),
    enabled: !!auth.accessToken && canWrite,
  })

  const activeLabs = useMemo(() => (labsQuery.data?.items ?? []).filter((l) => l.isActive), [labsQuery.data])
  const activeSupplies = useMemo(() => (suppliesQuery.data?.items ?? []).filter((s) => s.isActive), [suppliesQuery.data])

  const [showCreate, setShowCreate] = useState(false)
  const [createLabId, setCreateLabId] = useState('')
  const [createVendor, setCreateVendor] = useState('')
  const [createReceivedAt, setCreateReceivedAt] = useState('')
  const [lines, setLines] = useState<CreateLine[]>([{ supplyId: '', quantity: '1', unit: 'UN', lotNumber: '', expiresAt: '' }])

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!createLabId) throw new Error('Seleccioná un laboratorio')
      const normalizedLines = lines
        .map((l) => ({
          supplyId: l.supplyId,
          quantity: Number(l.quantity),
          unit: l.unit.trim(),
          lotNumber: l.lotNumber.trim(),
          expiresAt: l.expiresAt.trim(),
        }))
        .filter((l) => l.supplyId)

      if (normalizedLines.length === 0) throw new Error('Agregá al menos 1 línea')
      for (const l of normalizedLines) {
        if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new Error('Cantidad inválida')
        if (!l.unit) throw new Error('Unidad inválida')
      }

      return createReceipt(auth.accessToken!, {
        laboratoryId: createLabId,
        vendorName: createVendor.trim() || null,
        receivedAt: createReceivedAt.trim() || null,
        lines: normalizedLines.map((l) => ({
          supplyId: l.supplyId,
          quantity: l.quantity,
          unit: l.unit,
          lotNumber: l.lotNumber || null,
          expiresAt: l.expiresAt || null,
        })),
      })
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'receipts'] })
      setShowCreate(false)
      setCreateLabId('')
      setCreateVendor('')
      setCreateReceivedAt('')
      setLines([{ supplyId: '', quantity: '1', unit: 'UN', lotNumber: '', expiresAt: '' }])
      navigate(`/laboratory/receipts/${encodeURIComponent(data.id)}`)
    },
  })

  const columns = useMemo(
    () => [
      { header: 'Nro', accessor: (r: ReceiptListItem) => r.number },
      { header: 'Estado', accessor: (r: ReceiptListItem) => r.status },
      { header: 'Proveedor', accessor: (r: ReceiptListItem) => r.vendorName ?? '—', className: 'wrap' },
      { header: 'Recibido', accessor: (r: ReceiptListItem) => (r.receivedAt ? new Date(r.receivedAt).toLocaleString() : '—'), className: 'wrap' },
      {
        header: 'Acciones',
        accessor: (r: ReceiptListItem) => (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/laboratory/receipts/${encodeURIComponent(r.id)}`)}>
              Ver
            </Button>
          </div>
        ),
      },
    ],
    [navigate],
  )

  const addLine = () => setLines((prev) => [...prev, { supplyId: '', quantity: '1', unit: 'UN', lotNumber: '', expiresAt: '' }])
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx))

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="🧪 Laboratorio — Recepciones">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm text-slate-600 dark:text-slate-300">Recepciones de insumos (DRAFT → POSTED crea movimientos IN).</div>
          <Button onClick={() => setShowCreate(true)} disabled={!canWrite}>
            Nueva recepción
          </Button>
        </div>

        {receiptsQuery.isLoading ? (
          <Loading />
        ) : receiptsQuery.error ? (
          <ErrorState message={(receiptsQuery.error as any)?.message ?? 'Error al cargar recepciones'} />
        ) : (
          <>
            <Table columns={columns as any} data={receiptsQuery.data?.items ?? []} keyExtractor={(r: ReceiptListItem) => r.id} />
            <div className="mt-3">
              <PaginationCursor
                hasMore={!!receiptsQuery.data?.nextCursor}
                onLoadMore={() => setCursor(receiptsQuery.data!.nextCursor!)}
                loading={receiptsQuery.isFetching}
              />
            </div>
          </>
        )}

        <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nueva recepción" maxWidth="2xl">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Select
                label="Laboratorio"
                value={createLabId}
                onChange={(e) => setCreateLabId(e.target.value)}
                options={[
                  { value: '', label: 'Seleccionar…' },
                  ...activeLabs.map((l) => ({ value: l.id, label: `${l.name}${l.city ? ` (${l.city})` : ''}` })),
                ]}
              />
              <Input label="Proveedor (opcional)" value={createVendor} onChange={(e) => setCreateVendor(e.target.value)} />
              <Input
                label="Fecha recepción (opcional)"
                type="datetime-local"
                value={createReceivedAt}
                onChange={(e) => setCreateReceivedAt(e.target.value)}
              />
            </div>

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">Líneas</div>
                <Button variant="secondary" size="sm" onClick={addLine}>
                  + Agregar
                </Button>
              </div>

              <div className="space-y-3">
                {lines.map((l, idx) => (
                  <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-6">
                    <div className="md:col-span-2">
                      <Select
                        label={idx === 0 ? 'Insumo' : undefined}
                        value={l.supplyId}
                        onChange={(e) => {
                          const supplyId = e.target.value
                          const supply = activeSupplies.find((s) => s.id === supplyId)
                          setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, supplyId, unit: supply?.baseUnit ?? x.unit } : x)))
                        }}
                        options={[
                          { value: '', label: 'Seleccionar…' },
                          ...activeSupplies.map((s) => ({ value: s.id, label: `${s.name} (${s.baseUnit})` })),
                        ]}
                      />
                    </div>
                    <Input
                      label={idx === 0 ? 'Cantidad' : undefined}
                      value={l.quantity}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))}
                    />
                    <Input
                      label={idx === 0 ? 'Unidad' : undefined}
                      value={l.unit}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                    />
                    <Input
                      label={idx === 0 ? 'Lote (opcional)' : undefined}
                      value={l.lotNumber}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, lotNumber: e.target.value } : x)))}
                    />
                    <Input
                      label={idx === 0 ? 'Vence (opcional)' : undefined}
                      type="date"
                      value={l.expiresAt}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, expiresAt: e.target.value } : x)))}
                    />

                    <div className="flex items-end justify-end">
                      <Button variant="secondary" size="sm" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                        Quitar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancelar
              </Button>
              <Button onClick={() => createMutation.mutate()} disabled={!canWrite || createMutation.isPending}>
                {createMutation.isPending ? 'Creando…' : 'Crear (DRAFT)'}
              </Button>
            </div>

            {createMutation.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {(createMutation.error as any)?.message ?? 'Error al crear'}
              </div>
            ) : null}
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
