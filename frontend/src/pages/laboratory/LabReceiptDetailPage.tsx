import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { formatDateOnlyUtc } from '../../lib/date'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Loading, ErrorState, Button } from '../../components'

type ReceiptLine = {
  id: string
  supplyId: string
  lotId: string | null
  lotNumber: string | null
  expiresAt: string | null
  quantity: string
  unit: string
  note: string | null
  supply: { name: string; baseUnit: string }
}

type ReceiptItem = {
  id: string
  number: string
  numberYear: number
  status: 'DRAFT' | 'POSTED' | 'CANCELLED'
  vendorName: string | null
  vendorDocument: string | null
  receivedAt: string | null
  postedAt: string | null
  note: string | null
  laboratoryId: string | null
  purchaseListId: string | null
  createdAt: string
  updatedAt: string
  lines: ReceiptLine[]
}

type ReceiptResponse = { item: ReceiptItem }

async function fetchReceipt(token: string, id: string): Promise<ReceiptResponse> {
  return apiFetch(`/api/v1/laboratory/receipts/${encodeURIComponent(id)}`, { token })
}

async function postReceipt(token: string, id: string): Promise<any> {
  return apiFetch(`/api/v1/laboratory/receipts/${encodeURIComponent(id)}/post`, { token, method: 'POST' })
}

export function LabReceiptDetailPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const queryClient = useQueryClient()

  const { id } = useParams<{ id: string }>()
  const receiptId = id ?? ''

  const canWrite = perms.hasPermission('stock:manage')

  const receiptQuery = useQuery({
    queryKey: ['laboratory', 'receipt', receiptId],
    queryFn: () => fetchReceipt(auth.accessToken!, receiptId),
    enabled: !!auth.accessToken && !!receiptId,
  })

  const postMutation = useMutation({
    mutationFn: () => postReceipt(auth.accessToken!, receiptId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'receipt', receiptId] })
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'receipts'] })
    },
  })

  const item = receiptQuery.data?.item

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title={item ? `🧪 Recepción ${item.number}` : '🧪 Recepción'}>
        {receiptQuery.isLoading ? (
          <Loading />
        ) : receiptQuery.error ? (
          <ErrorState message={(receiptQuery.error as any)?.message ?? 'Error al cargar recepción'} />
        ) : !item ? (
          <ErrorState message="No encontrado" />
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">Estado</div>
                  <div className="text-lg font-semibold text-slate-900 dark:text-white">{item.status}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => postMutation.mutate()}
                    disabled={!canWrite || postMutation.isPending || item.status !== 'DRAFT'}
                  >
                    {postMutation.isPending ? 'Posteando…' : 'Postear (crear stock)'}
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">Proveedor</div>
                  <div className="font-medium text-slate-900 dark:text-white">{item.vendorName ?? '—'}</div>
                </div>
                <div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">Recibido</div>
                  <div className="font-medium text-slate-900 dark:text-white">
                    {item.receivedAt ? new Date(item.receivedAt).toLocaleString() : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">Posteado</div>
                  <div className="font-medium text-slate-900 dark:text-white">
                    {item.postedAt ? new Date(item.postedAt).toLocaleString() : '—'}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">Líneas</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300">
                      <th className="py-2 pr-3">Insumo</th>
                      <th className="py-2 pr-3">Cantidad</th>
                      <th className="py-2 pr-3">Unidad</th>
                      <th className="py-2 pr-3">Lote</th>
                      <th className="py-2 pr-3">Vence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.lines.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100 text-sm text-slate-900 dark:border-slate-800 dark:text-slate-100">
                        <td className="py-2 pr-3">{l.supply.name}</td>
                        <td className="py-2 pr-3">{l.quantity}</td>
                        <td className="py-2 pr-3">{l.unit}</td>
                        <td className="py-2 pr-3">{l.lotNumber ?? '—'}</td>
                        <td className="py-2 pr-3">{l.expiresAt ? formatDateOnlyUtc(l.expiresAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {postMutation.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {(postMutation.error as any)?.message ?? 'Error al postear'}
              </div>
            ) : null}
          </div>
        )}
      </PageContainer>
    </MainLayout>
  )
}
