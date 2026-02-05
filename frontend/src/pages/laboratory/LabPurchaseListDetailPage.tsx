import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Loading, ErrorState, Table, Button, Modal, Input } from '../../components'

type PurchaseListLine = {
  id: string
  supplyId: string
  requestedQuantity: string
  receivedQuantity: string
  unit: string
  vendorName: string | null
  note: string | null
  sortOrder: number
  supply: { name: string; baseUnit: string }
}

type PurchaseListItem = {
  id: string
  number: string
  numberYear: number
  status: 'DRAFT' | 'SENT' | 'CLOSED' | 'CANCELLED'
  city: string | null
  laboratoryId: string | null
  note: string | null
  createdAt: string
  updatedAt: string
  lines: PurchaseListLine[]
}

type PurchaseListResponse = { item: PurchaseListItem }

type ReceiptLineDraft = {
  purchaseListLineId: string
  supplyId: string
  quantity: string
  unit: string
  lotNumber: string
  expiresAt: string
  note: string
}

async function fetchPurchaseList(token: string, id: string): Promise<PurchaseListResponse> {
  return apiFetch(`/api/v1/laboratory/purchase-lists/${encodeURIComponent(id)}`, { token })
}

async function createReceipt(
  token: string,
  body: {
    laboratoryId?: string | null
    purchaseListId?: string | null
    vendorName?: string | null
    receivedAt?: string | null
    note?: string | null
    lines: Array<{
      supplyId: string
      purchaseListLineId?: string | null
      quantity: number
      unit: string
      lotNumber?: string | null
      expiresAt?: string | null
      note?: string | null
    }>
  },
): Promise<{ id: string }> {
  return apiFetch('/api/v1/laboratory/receipts', { token, method: 'POST', body: JSON.stringify(body) })
}

function calcRemaining(requested: string, received: string): number {
  const rq = Number(requested)
  const rc = Number(received)
  if (!Number.isFinite(rq) || !Number.isFinite(rc)) return 0
  return Math.max(0, rq - rc)
}

export function LabPurchaseListDetailPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { id } = useParams<{ id: string }>()
  const purchaseListId = id ?? ''

  const canWrite = perms.hasPermission('stock:manage')

  const itemQuery = useQuery({
    queryKey: ['laboratory', 'purchase-list', purchaseListId],
    queryFn: () => fetchPurchaseList(auth.accessToken!, purchaseListId),
    enabled: !!auth.accessToken && !!purchaseListId,
  })

  const item = itemQuery.data?.item

  const [showCreateReceipt, setShowCreateReceipt] = useState(false)
  const [vendorName, setVendorName] = useState('')
  const [receivedAt, setReceivedAt] = useState('')
  const [note, setNote] = useState('')
  const [receiptLines, setReceiptLines] = useState<ReceiptLineDraft[]>([])

  const openCreateReceipt = () => {
    if (!item) return

    setVendorName('')
    setReceivedAt('')
    setNote('')

    const lines = item.lines
      .map((l) => {
        const remaining = calcRemaining(l.requestedQuantity, l.receivedQuantity)
        return {
          purchaseListLineId: l.id,
          supplyId: l.supplyId,
          quantity: remaining > 0 ? String(remaining) : '0',
          unit: l.unit,
          lotNumber: '',
          expiresAt: '',
          note: '',
        }
      })
      .filter((l) => Number(l.quantity) > 0)

    setReceiptLines(lines)
    setShowCreateReceipt(true)
  }

  const createReceiptMutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error('Lista no cargada')

      const lines = receiptLines
        .map((l) => ({
          supplyId: l.supplyId,
          purchaseListLineId: l.purchaseListLineId,
          quantity: Number(l.quantity),
          unit: l.unit.trim() || 'UN',
          lotNumber: l.lotNumber.trim() ? l.lotNumber.trim() : null,
          expiresAt: l.expiresAt.trim() ? new Date(l.expiresAt).toISOString() : null,
          note: l.note.trim() ? l.note.trim() : null,
        }))
        .filter((l) => l.supplyId && Number.isFinite(l.quantity) && l.quantity > 0)

      if (!lines.length) throw new Error('No hay líneas con cantidad > 0')

      return createReceipt(auth.accessToken!, {
        laboratoryId: item.laboratoryId ?? null,
        purchaseListId: item.id,
        vendorName: vendorName.trim() ? vendorName.trim() : null,
        receivedAt: receivedAt.trim() ? new Date(receivedAt).toISOString() : null,
        note: note.trim() ? note.trim() : null,
        lines,
      })
    },
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'purchase-list', purchaseListId] })
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'receipts'] })
      setShowCreateReceipt(false)
      navigate(`/laboratory/receipts/${encodeURIComponent(res.id)}`)
    },
  })

  const columns = useMemo(
    () => [
      { header: 'Insumo', accessor: (l: PurchaseListLine) => l.supply.name, className: 'wrap' },
      { header: 'Solicitado', accessor: (l: PurchaseListLine) => `${l.requestedQuantity} ${l.unit}` },
      { header: 'Recibido', accessor: (l: PurchaseListLine) => `${l.receivedQuantity} ${l.unit}` },
      {
        header: 'Pendiente',
        accessor: (l: PurchaseListLine) => {
          const remaining = calcRemaining(l.requestedQuantity, l.receivedQuantity)
          return `${remaining} ${l.unit}`
        },
      },
      { header: 'Proveedor', accessor: (l: PurchaseListLine) => l.vendorName ?? '—', className: 'wrap' },
    ],
    [],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title={item ? `🧪 Lista de compra ${item.number}` : '🧪 Lista de compra'}>
        {itemQuery.isLoading ? (
          <Loading />
        ) : itemQuery.error ? (
          <ErrorState message={(itemQuery.error as any)?.message ?? 'Error al cargar lista'} />
        ) : !item ? (
          <ErrorState message="No encontrado" />
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <div>Estado: {item.status}</div>
                <div>Ciudad: {item.city ?? '—'}</div>
                <div>Actualizado: {new Date(item.updatedAt).toLocaleString()}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => navigate('/laboratory/purchase-lists')}>
                  Volver
                </Button>
                <Button onClick={openCreateReceipt} disabled={!canWrite}>
                  Crear recepción
                </Button>
              </div>
            </div>

            {item.note ? (
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200">
                {item.note}
              </div>
            ) : null}

            <Table columns={columns as any} data={item.lines} keyExtractor={(l: PurchaseListLine) => l.id} />

            <Modal
              isOpen={showCreateReceipt}
              onClose={() => setShowCreateReceipt(false)}
              title="Crear recepción desde lista"
              maxWidth="2xl"
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Input label="Proveedor (opcional)" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
                  <Input
                    label="Fecha recepción (opcional)"
                    type="datetime-local"
                    value={receivedAt}
                    onChange={(e) => setReceivedAt(e.target.value)}
                  />
                  <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>

                {receiptLines.length === 0 ? (
                  <div className="text-sm text-slate-600 dark:text-slate-300">No hay cantidades pendientes para recibir.</div>
                ) : (
                  <div className="space-y-2">
                    {receiptLines.map((l) => {
                      const lineInfo = item.lines.find((x) => x.id === l.purchaseListLineId)
                      const label = lineInfo ? lineInfo.supply.name : l.supplyId
                      return (
                        <div key={l.purchaseListLineId} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-12">
                          <div className="md:col-span-5">
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{label}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Línea: {l.purchaseListLineId}</div>
                          </div>
                          <div className="md:col-span-2">
                            <Input
                              label="Cantidad"
                              type="number"
                              min={0}
                              step={0.01}
                              value={l.quantity}
                              onChange={(e) =>
                                setReceiptLines((prev) => prev.map((x) => (x.purchaseListLineId === l.purchaseListLineId ? { ...x, quantity: e.target.value } : x)))
                              }
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Input
                              label="Unidad"
                              value={l.unit}
                              onChange={(e) =>
                                setReceiptLines((prev) => prev.map((x) => (x.purchaseListLineId === l.purchaseListLineId ? { ...x, unit: e.target.value } : x)))
                              }
                            />
                          </div>
                          <div className="md:col-span-3">
                            <Input
                              label="Lote (opcional)"
                              value={l.lotNumber}
                              onChange={(e) =>
                                setReceiptLines((prev) => prev.map((x) => (x.purchaseListLineId === l.purchaseListLineId ? { ...x, lotNumber: e.target.value } : x)))
                              }
                            />
                          </div>
                          <div className="md:col-span-3">
                            <Input
                              label="Vence (opcional)"
                              type="date"
                              value={l.expiresAt}
                              onChange={(e) =>
                                setReceiptLines((prev) => prev.map((x) => (x.purchaseListLineId === l.purchaseListLineId ? { ...x, expiresAt: e.target.value } : x)))
                              }
                            />
                          </div>
                          <div className="md:col-span-9">
                            <Input
                              label="Nota línea (opcional)"
                              value={l.note}
                              onChange={(e) =>
                                setReceiptLines((prev) => prev.map((x) => (x.purchaseListLineId === l.purchaseListLineId ? { ...x, note: e.target.value } : x)))
                              }
                            />
                          </div>
                          <div className="md:col-span-12 flex justify-end">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setReceiptLines((prev) => prev.filter((x) => x.purchaseListLineId !== l.purchaseListLineId))}
                            >
                              Quitar
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {createReceiptMutation.error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                    {(createReceiptMutation.error as any)?.message ?? 'Error al crear recepción'}
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setShowCreateReceipt(false)} disabled={createReceiptMutation.isPending}>
                    Cancelar
                  </Button>
                  <Button onClick={() => createReceiptMutation.mutate()} disabled={!canWrite || createReceiptMutation.isPending}>
                    {createReceiptMutation.isPending ? 'Creando…' : 'Crear'}
                  </Button>
                </div>
              </div>
            </Modal>
          </>
        )}
      </PageContainer>
    </MainLayout>
  )
}
