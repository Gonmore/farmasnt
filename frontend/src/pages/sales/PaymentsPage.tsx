import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, Badge, Modal, Input, Select, ImageUpload } from '../../components'
import { apiFetch } from '../../lib/api'
import { useNavigation } from '../../hooks'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { EyeIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

type PaymentStatus = 'DUE' | 'PAID' | 'ALL'

type PaymentListItem = {
  id: string
  number: string
  version: number
  customerId: string
  customerName: string
  paymentMode: string
  deliveryDate: string | null
  deliveredAt: string | null
  dueAt: string
  total: number
  paidAt: string | null
}

type ListResponse = { items: PaymentListItem[] }

type PaymentReceiptType = 'CASH' | 'TRANSFER_QR'
type PaymentProofUpload = { uploadUrl: string; publicUrl: string; key: string; method?: string }

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function daysUntil(dateIso: string): number {
  const target = new Date(dateIso).getTime()
  const now = Date.now()
  const msDay = 24 * 60 * 60 * 1000
  return Math.ceil((target - now) / msDay)
}

function paymentModeLabel(mode: string): string {
  const m = (mode ?? '').toUpperCase()
  if (m === 'CASH') return 'CONTADO'
  if (m.startsWith('CREDIT_')) return `CRÉDITO ${m.replace('CREDIT_', '')}D`
  return mode
}

async function fetchPayments(token: string, status: PaymentStatus): Promise<ListResponse> {
  const params = new URLSearchParams({ status, take: '200' })
  return apiFetch(`/api/v1/sales/payments?${params}`, { token })
}

async function markPaid(
  token: string,
  input: {
    id: string
    version: number
    paymentReceiptType: PaymentReceiptType
    paymentReceiptRef?: string
    paymentReceiptPhotoUrl?: string
    paymentReceiptPhotoKey?: string
  },
): Promise<void> {
  await apiFetch(`/api/v1/sales/payments/${encodeURIComponent(input.id)}/pay`, {
    token,
    method: 'POST',
    body: JSON.stringify({
      version: input.version,
      paymentReceiptType: input.paymentReceiptType,
      paymentReceiptRef: input.paymentReceiptRef,
      paymentReceiptPhotoUrl: input.paymentReceiptPhotoUrl,
      paymentReceiptPhotoKey: input.paymentReceiptPhotoKey,
    }),
  })
}

async function presignPaymentProof(token: string, file: File): Promise<PaymentProofUpload> {
  return apiFetch('/api/v1/sales/payments/proof-upload', {
    token,
    method: 'POST',
    body: JSON.stringify({ fileName: file.name, contentType: file.type }),
  })
}

export function PaymentsPage() {
  const auth = useAuth()
  const tenant = useTenant()
  const currency = tenant.branding?.currency || 'BOB'

  const navigate = useNavigate()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<PaymentStatus>('DUE')
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [payTarget, setPayTarget] = useState<PaymentListItem | null>(null)
  const [receiptType, setReceiptType] = useState<PaymentReceiptType>('CASH')
  const [receiptRef, setReceiptRef] = useState('')
  const [receiptPhoto, setReceiptPhoto] = useState<{ url: string; key: string } | null>(null)
  const [receiptError, setReceiptError] = useState('')
  const [uploadingProof, setUploadingProof] = useState(false)

  const paymentsQuery = useQuery({
    queryKey: ['payments', status],
    queryFn: () => fetchPayments(auth.accessToken!, status),
    enabled: !!auth.accessToken,
  })

  const payMutation = useMutation({
    mutationFn: (vars: {
      id: string
      version: number
      paymentReceiptType: PaymentReceiptType
      paymentReceiptRef?: string
      paymentReceiptPhotoUrl?: string
      paymentReceiptPhotoKey?: string
    }) => markPaid(auth.accessToken!, vars),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
      ])
      setPayModalOpen(false)
      setPayTarget(null)
      setReceiptType('CASH')
      setReceiptRef('')
      setReceiptPhoto(null)
      setReceiptError('')
    },
    onError: (err: any) => {
      const msg = (err?.message as string | undefined) ?? 'No se pudo marcar como pagado'
      setReceiptError(msg)
    },
  })

  const items = paymentsQuery.data?.items ?? []

  const handleOpenPayModal = (p: PaymentListItem) => {
    setPayTarget(p)
    setReceiptType('CASH')
    setReceiptRef('')
    setReceiptPhoto(null)
    setReceiptError('')
    setPayModalOpen(true)
  }

  const handleUploadProof = async (file: File) => {
    if (!auth.accessToken) return
    setUploadingProof(true)
    setReceiptError('')
    try {
      const presign = await presignPaymentProof(auth.accessToken, file)
      const res = await fetch(presign.uploadUrl, {
        method: presign.method ?? 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!res.ok) throw new Error('No se pudo subir la imagen')
      setReceiptPhoto({ url: presign.publicUrl, key: presign.key })
    } catch (err: any) {
      setReceiptError(err?.message ?? 'No se pudo subir la imagen')
    } finally {
      setUploadingProof(false)
    }
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Pagos">
        {/* Botones de filtro - segunda fila en móvil */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={status === 'DUE' ? 'primary' : 'ghost'}
            onClick={() => setStatus('DUE')}
          >
            Por cobrar
          </Button>
          <Button
            size="sm"
            variant={status === 'PAID' ? 'primary' : 'ghost'}
            onClick={() => setStatus('PAID')}
          >
            Cobradas
          </Button>
          <div className="w-px self-stretch bg-slate-200 dark:bg-slate-700" />
          <Button
            size="sm"
            variant={status === 'ALL' ? 'primary' : 'ghost'}
            onClick={() => setStatus('ALL')}
          >
            Ver todas
          </Button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {paymentsQuery.isLoading && <Loading />}
          {paymentsQuery.error && <ErrorState message="Error al cargar pagos" retry={paymentsQuery.refetch} />}
          {paymentsQuery.data && items.length === 0 && <EmptyState message="No hay pagos" />}

          {paymentsQuery.data && items.length > 0 && (
            <Table
              columns={[
                { header: 'Orden', accessor: (p) => p.number.split('-').pop() ?? p.number },
                {
                  header: 'Cliente',
                  accessor: (p) => p.customerName.length > 15 ? `${p.customerName.slice(0, 15)}...` : p.customerName,
                },
                { header: 'Pago', accessor: (p) => <span className="truncate block" title={paymentModeLabel(p.paymentMode)}>{paymentModeLabel(p.paymentMode)}</span> },
                {
                  header: 'Entregado',
                  accessor: (p) => p.deliveredAt ? 'ENTREGADO' : (p.deliveryDate ? new Date(p.deliveryDate).toLocaleDateString() : '-'),
                },
                {
                  header: 'Cobro',
                  accessor: (p) => {
                    const d = daysUntil(p.dueAt)
                    const label = d < 0 ? `Hace ${Math.abs(d)}d` : d === 0 ? 'Hoy' : `En ${d}d`
                    return (
                      <div className="flex items-center gap-2">
                        <span>{new Date(p.dueAt).toLocaleDateString()}</span>
                        <Badge variant={d < 0 ? 'danger' : d === 0 ? 'warning' : 'default'}>{label}</Badge>
                      </div>
                    )
                  },
                },
                { header: `Total (${currency})`, accessor: (p) => money(p.total) },
                {
                  header: 'Estado',
                  className: 'hidden md:table-cell',
                  accessor: (p) => (
                    <Badge variant={p.paidAt ? 'success' : 'warning'}>{p.paidAt ? 'COBRADA' : 'POR COBRAR'}</Badge>
                  ),
                },
                {
                  header: 'Acciones',
                  className: 'text-center',
                  accessor: (p) => (
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<EyeIcon className="w-4 h-4" />}
                        onClick={() => navigate(`/sales/orders/${encodeURIComponent(p.id)}`)}
                      >
                        <span className="hidden md:inline">Ver</span>
                      </Button>
                      {!p.paidAt && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<CheckCircleIcon className="w-4 h-4" />}
                          disabled={payMutation.isPending}
                          onClick={() => {
                            handleOpenPayModal(p)
                          }}
                          className="!border-green-600 !text-green-700 hover:!bg-green-50 dark:!border-green-500 dark:!text-green-400 dark:hover:!bg-green-900/20"
                        >
                          <span className="hidden md:inline">Confirmar Pago</span>
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
              data={items}
              keyExtractor={(p) => p.id}
            />
          )}
        </div>

        <Modal
          isOpen={payModalOpen}
          onClose={() => {
            if (payMutation.isPending) return
            setPayModalOpen(false)
            setPayTarget(null)
            setReceiptType('CASH')
            setReceiptRef('')
            setReceiptPhoto(null)
            setReceiptError('')
          }}
          title={payTarget ? `Confirmar pago de ${payTarget.number}` : 'Confirmar pago'}
          maxWidth="lg"
        >
          <div className="space-y-4">
            <Select
              label="Tipo de pago"
              value={receiptType}
              onChange={(e) => setReceiptType(e.target.value as PaymentReceiptType)}
              options={[
                { value: 'CASH', label: 'Al contado' },
                { value: 'TRANSFER_QR', label: 'Transferencia/QR' },
              ]}
              disabled={payMutation.isPending}
            />

            {receiptType === 'TRANSFER_QR' && (
              <div className="space-y-3">
                <Input
                  label="Numero de transaccion (opcional)"
                  value={receiptRef}
                  onChange={(e) => setReceiptRef(e.target.value)}
                  placeholder="Ej: 123456789"
                  disabled={payMutation.isPending}
                />
                <div>
                  <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Foto o captura (opcional)</div>
                  <ImageUpload
                    mode="select"
                    currentImageUrl={receiptPhoto?.url ?? null}
                    onImageSelect={handleUploadProof}
                    onImageRemove={() => setReceiptPhoto(null)}
                    loading={uploadingProof}
                    disabled={payMutation.isPending || uploadingProof}
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Debe ingresar numero de transaccion o subir una imagen.
                </p>
              </div>
            )}

            {receiptError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
                {receiptError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  if (payMutation.isPending) return
                  setPayModalOpen(false)
                  setPayTarget(null)
                  setReceiptType('CASH')
                  setReceiptRef('')
                  setReceiptPhoto(null)
                  setReceiptError('')
                }}
                disabled={payMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                loading={payMutation.isPending}
                disabled={!payTarget || uploadingProof || payMutation.isPending}
                onClick={() => {
                  if (!payTarget) return
                  const needsProof = receiptType === 'TRANSFER_QR'
                  const hasRef = receiptRef.trim().length > 0
                  const hasPhoto = !!receiptPhoto?.url
                  if (needsProof && !hasRef && !hasPhoto) {
                    setReceiptError('Ingrese numero de transaccion o suba una imagen.')
                    return
                  }

                  payMutation.mutate({
                    id: payTarget.id,
                    version: payTarget.version,
                    paymentReceiptType: receiptType,
                    paymentReceiptRef: receiptRef.trim() || undefined,
                    paymentReceiptPhotoUrl: receiptPhoto?.url ?? undefined,
                    paymentReceiptPhotoKey: receiptPhoto?.key ?? undefined,
                  })
                }}
              >
                Confirmar pago
              </Button>
            </div>
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
