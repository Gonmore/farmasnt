import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, Badge, Modal, Input, Select, ImageUpload, PaginationCursor } from '../../components'
import { apiFetch } from '../../lib/api'
import { formatMoney } from '../../lib/numberFormat'
import { useNavigation, useCursorPagination } from '../../hooks'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { EyeIcon, CheckCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'

type PaymentStatus = 'DUE' | 'PAID' | 'ALL'

type PaymentListItem = {
  id: string
  number: string
  version: number
  customerId: string
  customerName: string
  paymentMode: string
  paymentReceiptType: string | null
  paymentReceiptRef: string | null
  paymentReceiptPhotoUrl: string | null
  paymentReceiptPhotoKey: string | null
  deliveryDate: string | null
  deliveredAt: string | null
  dueAt: string
  total: number
  paidAmount: number
  remaining: number
  paidAt: string | null
}

type ListResponse = { items: PaymentListItem[]; nextCursor: string | null }

type PaymentReceiptType = 'CASH' | 'TRANSFER_QR' | 'CHECK'
type PaymentProofUpload = { uploadUrl: string; publicUrl: string; key: string; method?: string }

type OrderPayment = {
  id: string
  amount: number
  paymentMode: string
  paymentReceiptType: string | null
  paymentReceiptRef: string | null
  paymentReceiptPhotoUrl: string | null
  paymentReceiptPhotoKey: string | null
  createdAt: string
  paidByName: string | null
}

async function fetchOrderPayments(token: string, orderId: string): Promise<{ items: OrderPayment[] }> {
  return apiFetch(`/api/v1/sales/orders/${encodeURIComponent(orderId)}/payments`, { token })
}

function money(n: number): string {
  return formatMoney(n)
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

async function fetchPayments(token: string, status: PaymentStatus, take: number, cursor?: string, q?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ status, take: String(take) })
  if (cursor) params.append('cursor', cursor)
  if (q && q.trim()) params.append('q', q.trim())
  return apiFetch(`/api/v1/sales/payments?${params}`, { token })
}

async function markPaid(
  token: string,
  input: {
    id: string
    version: number
    paymentAmountType: 'TOTAL' | 'PARTIAL'
    amount?: number
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
      paymentAmountType: input.paymentAmountType,
      amount: input.amount,
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
  const [searchQuery, setSearchQuery] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const take = 50
  const pag = useCursorPagination()
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [payTarget, setPayTarget] = useState<PaymentListItem | null>(null)
  const [amountType, setAmountType] = useState<'TOTAL' | 'PARTIAL'>('TOTAL')
  const [partialAmount, setPartialAmount] = useState('')
  const [receiptType, setReceiptType] = useState<PaymentReceiptType>('CASH')
  const [receiptRef, setReceiptRef] = useState('')
  const [receiptPhoto, setReceiptPhoto] = useState<{ url: string; key: string } | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptError, setReceiptError] = useState('')
  const [uploadingProof, setUploadingProof] = useState(false)
  const [paymentDetail, setPaymentDetail] = useState<PaymentListItem | null>(null)

   const paymentsQuery = useQuery({
     queryKey: ['payments', status, take, pag.currentCursor, appliedSearch],
     queryFn: () => fetchPayments(auth.accessToken!, status, take, pag.currentCursor, appliedSearch || undefined),
     enabled: !!auth.accessToken,
   })

  const payMutation = useMutation({
    mutationFn: (vars: {
      id: string
      version: number
      paymentAmountType: 'TOTAL' | 'PARTIAL'
      amount?: number
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
      setAmountType('TOTAL')
      setPartialAmount('')
      setReceiptType('CASH')
      setReceiptRef('')
      setReceiptPhoto(null)
      setReceiptFile(null)
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
    setAmountType('TOTAL')
    setPartialAmount('')
    setReceiptType('CASH')
    setReceiptRef('')
    setReceiptPhoto(null)
    setReceiptError('')
    setPayModalOpen(true)
  }

  const handleSelectProof = (file: File) => {
    setReceiptFile(file)
    setReceiptPhoto(null)
    setReceiptError('')
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Pagos">
        <div className="mb-4">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setAppliedSearch(searchQuery.trim())
              pag.reset()
            }}
            className="flex gap-2 max-w-sm"
          >
            <Input
              placeholder="Buscar por cliente o número de orden..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" icon={<MagnifyingGlassIcon />} type="submit" disabled={searchQuery.length === 0}>
              Buscar
            </Button>
          </form>
        </div>

        {/* Botones de filtro - segunda fila en móvil */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={status === 'DUE' ? 'primary' : 'ghost'}
            onClick={() => {
              setStatus('DUE')
              pag.reset()
            }}
          >
            Por cobrar
          </Button>
          <Button
            size="sm"
            variant={status === 'PAID' ? 'primary' : 'ghost'}
            onClick={() => {
              setStatus('PAID')
              pag.reset()
            }}
          >
            Cobradas
          </Button>
          <div className="w-px self-stretch bg-slate-200 dark:bg-slate-700" />
          <Button
            size="sm"
            variant={status === 'ALL' ? 'primary' : 'ghost'}
            onClick={() => {
              setStatus('ALL')
              pag.reset()
            }}
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
                {
                  header: `Pagado / Debe (${currency})`,
                  accessor: (p) => {
                    const isPartial = p.paidAmount > 0 && p.remaining > 0
                    return (
                      <div className="space-y-1">
                        <div className="text-sm">
                          <span className="text-slate-600 dark:text-slate-400">Pagado:</span>{' '}
                          <span className="font-medium text-slate-900 dark:text-slate-100">{money(p.paidAmount)}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-slate-600 dark:text-slate-400">Debe:</span>{' '}
                          <span className="font-medium text-slate-900 dark:text-slate-100">{money(p.remaining)}</span>
                        </div>
                        {isPartial && <Badge variant="warning">PARCIAL</Badge>}
                      </div>
                    )
                  },
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
                        onClick={() => setPaymentDetail(p)}
                      >
                        <span className="hidden md:inline">Ver</span>
                      </Button>
                      {!p.paidAt && (
                        <Button
                          size="sm"
                          variant="success"
                          icon={<CheckCircleIcon className="w-4 h-4" />}
                          disabled={payMutation.isPending}
                          onClick={() => {
                            handleOpenPayModal(p)
                          }}
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
          {paymentsQuery.data && items.length > 0 && (
            <PaginationCursor
              hasMore={!!paymentsQuery.data.nextCursor}
              onLoadMore={() => pag.goForward(paymentsQuery.data!.nextCursor)}
              loading={paymentsQuery.isFetching}
              currentCount={items.length}
              currentPage={pag.currentPage}
              maxPage={paymentsQuery.data.nextCursor ? pag.maxVisitedPage + 1 : pag.maxVisitedPage}
              take={take}
              canGoBack={pag.canGoBack}
              onGoBack={pag.goBack}
              onGoToStart={pag.goToStart}
              onGoToPage={(page) => pag.goToPage(page)}
            />
          )}
        </div>

        <Modal
          isOpen={payModalOpen}
          onClose={() => {
            if (payMutation.isPending) return
            setPayModalOpen(false)
            setPayTarget(null)
            setAmountType('TOTAL')
            setPartialAmount('')
            setReceiptType('CASH')
            setReceiptRef('')
            setReceiptPhoto(null)
            setReceiptError('')
          }}
          title={payTarget ? `Confirmar pago de ${payTarget.number}` : 'Confirmar pago'}
          maxWidth="lg"
          closeOnBackdropClick={false}
        >
          <div className="space-y-4">
            {payTarget && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>Total: <span className="font-semibold">{money(payTarget.total)} {currency}</span></div>
                  <div>Pagado: <span className="font-semibold">{money(payTarget.paidAmount)} {currency}</span></div>
                  <div>Pendiente: <span className="font-semibold">{money(payTarget.remaining)} {currency}</span></div>
                </div>
              </div>
            )}

            <Select
              label="Monto a cobrar"
              value={amountType}
              onChange={(e) => {
                const v = (e.target.value as any) as 'TOTAL' | 'PARTIAL'
                setAmountType(v)
                setReceiptError('')
                if (v === 'TOTAL') setPartialAmount('')
              }}
              options={[
                { value: 'TOTAL', label: 'Total' },
                { value: 'PARTIAL', label: 'Parcial' },
              ]}
              disabled={payMutation.isPending}
            />

            {amountType === 'PARTIAL' && (
              <Input
                label="Monto parcial"
                type="number"
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                placeholder={payTarget ? `Máx: ${money(payTarget.remaining)}` : '0.00'}
                disabled={payMutation.isPending}
              />
            )}

            <Select
              label="Tipo de pago"
              value={receiptType}
              onChange={(e) => setReceiptType(e.target.value as PaymentReceiptType)}
              options={[
                { value: 'CASH', label: 'Al contado' },
                { value: 'TRANSFER_QR', label: 'Transferencia/QR' },
                { value: 'CHECK', label: 'Cheque' },
              ]}
              disabled={payMutation.isPending}
            />

            {(receiptType === 'TRANSFER_QR' || receiptType === 'CHECK') && (
              <div className="space-y-3">
                <Input
                  label={receiptType === 'CHECK' ? 'Número de cheque (opcional)' : 'Número de transacción (opcional)'}
                  value={receiptRef}
                  onChange={(e) => setReceiptRef(e.target.value)}
                  placeholder={receiptType === 'CHECK' ? 'Ej: 00012345' : 'Ej: 123456789'}
                  disabled={payMutation.isPending}
                />
                <div>
                  <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                    {receiptType === 'CHECK' ? 'Foto o PDF del cheque (opcional)' : 'Foto o Captura (opcional)'}
                  </div>
                   <ImageUpload
                     mode="select"
                     accept="image/png,image/jpeg,image/webp,application/pdf"
                     currentImageUrl={receiptPhoto?.url ?? null}
                     currentFileType={receiptFile?.type === 'application/pdf' ? 'pdf' : 'image'}
                     fallbackUrl={receiptPhoto?.key ? `/api/v1/s3/get/${encodeURIComponent(receiptPhoto.key)}` : null}
                     onImageSelect={handleSelectProof}
                     onImageRemove={() => { setReceiptFile(null); setReceiptPhoto(null) }}
                     loading={uploadingProof}
                     disabled={payMutation.isPending || uploadingProof}
                   />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {receiptType === 'CHECK'
                    ? 'Debe ingresar el número de cheque o subir una imagen.'
                    : 'Debe ingresar numero de transaccion o subir una imagen.'}
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
                   setAmountType('TOTAL')
                   setPartialAmount('')
                   setReceiptType('CASH')
                   setReceiptRef('')
                   setReceiptPhoto(null)
                   setReceiptFile(null)
                   setReceiptError('')
                   setUploadingProof(false)
                 }}
                disabled={payMutation.isPending}
              >
                Cancelar
              </Button>
               <Button
                 variant="primary"
                 loading={payMutation.isPending || uploadingProof}
                 disabled={!payTarget || payMutation.isPending}
                 onClick={async () => {
                   if (!payTarget || !auth.accessToken) return

                   const remaining = Number(payTarget.remaining)
                   const resolvedAmount = amountType === 'TOTAL' ? remaining : Number(partialAmount)
                   if (amountType === 'PARTIAL') {
                     if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
                       setReceiptError('Ingresá un monto parcial válido.')
                       return
                     }
                     if (resolvedAmount > remaining + 1e-9) {
                       setReceiptError('El monto parcial excede el saldo pendiente.')
                       return
                     }
                   }

                   const needsProof = receiptType === 'TRANSFER_QR' || receiptType === 'CHECK'
                   const hasRef = receiptRef.trim().length > 0
                   const hasPhoto = !!receiptPhoto?.url || !!receiptFile
                   if (needsProof && !hasRef && !hasPhoto) {
                     setReceiptError(receiptType === 'CHECK'
                       ? 'Ingrese el número de cheque o suba una imagen.'
                       : 'Ingrese número de transacción o suba una imagen.')
                     return
                   }

                   setReceiptError('')

                   // Upload proof file first, then confirm payment
                   let photoUrl: string | undefined
                   let photoKey: string | undefined

                   if (receiptFile) {
                     setUploadingProof(true)
                     try {
                       const presign = await presignPaymentProof(auth.accessToken, receiptFile)
                       const res = await fetch(presign.uploadUrl, {
                         method: presign.method ?? 'PUT',
                         body: receiptFile,
                         headers: { 'Content-Type': receiptFile.type },
                       })
                       if (!res.ok) throw new Error('No se pudo subir la imagen')
                       photoUrl = presign.publicUrl
                       photoKey = presign.key
                     } catch (err: any) {
                       setReceiptError(err?.message ?? 'No se pudo subir la imagen')
                       setUploadingProof(false)
                       return
                     } finally {
                       setUploadingProof(false)
                     }
                   } else if (receiptPhoto?.url) {
                     photoUrl = receiptPhoto.url
                     photoKey = receiptPhoto.key
                   }

                   payMutation.mutate({
                     id: payTarget.id,
                     version: payTarget.version,
                     paymentAmountType: amountType,
                     ...(amountType === 'PARTIAL' ? { amount: resolvedAmount } : {}),
                     paymentReceiptType: receiptType,
                     paymentReceiptRef: receiptRef.trim() || undefined,
                     paymentReceiptPhotoUrl: photoUrl,
                     paymentReceiptPhotoKey: photoKey,
                   })
                 }}
               >
                 Confirmar pago
               </Button>
            </div>
          </div>
         </Modal>

        {paymentDetail && (
          <PaymentDetailModal
            payment={paymentDetail}
            onClose={() => setPaymentDetail(null)}
            onNavigateToOrder={() => {
              setPaymentDetail(null)
              navigate(`/sales/orders/${encodeURIComponent(paymentDetail.id)}`)
            }}
          />
        )}
      </PageContainer>
    </MainLayout>
  )
}

interface PaymentDetailModalProps {
  payment: PaymentListItem
  onClose: () => void
  onNavigateToOrder: () => void
}

function PaymentDetailModal({ payment, onClose, onNavigateToOrder }: PaymentDetailModalProps) {
  const auth = useAuth()
  const paymentsQuery = useQuery({
    queryKey: ['order-payments', payment.id],
    queryFn: () => fetchOrderPayments(auth.accessToken!, payment.id),
    enabled: !!auth.accessToken,
  })
  const payments = paymentsQuery.data?.items ?? []

  const receiptTypeText = (rt: string | null) => {
    if (rt === 'CASH') return 'CONTADO'
    if (rt === 'TRANSFER_QR') return 'Transferencia / QR'
    if (rt === 'CHECK') return 'Cheque'
    return rt ?? '-'
  }

  const isPdfKey = (key: string) => key.toLowerCase().endsWith('.pdf')

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Orden ${payment.number} - Detalle de pagos`}
      maxWidth="3xl"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button variant="primary" onClick={onNavigateToOrder}>Ver orden de venta</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="grid gap-2 md:grid-cols-2">
          <div><strong>Estado:</strong> {payment.paidAt ? 'PAGADO' : 'PENDIENTE'}</div>
          <div><strong>Fecha de vencimiento:</strong> {new Date(payment.dueAt).toLocaleDateString()}</div>
          <div><strong>Monto total:</strong> {formatMoney(payment.total)}</div>
          <div><strong>Total pagado:</strong> {formatMoney(payment.paidAmount)}</div>
          <div><strong>Saldo pendiente:</strong> {formatMoney(payment.remaining)}</div>
          {payment.paidAt && payment.remaining === 0 && (
            <div><strong>Tipo de pago:</strong> <Badge variant="success">COMPLETO</Badge></div>
          )}
          {payment.paidAt && payment.remaining > 0 && (
            <div><strong>Tipo de pago:</strong> <Badge variant="warning">PARCIAL</Badge></div>
          )}
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
          <div className="font-semibold text-slate-700 dark:text-slate-300 mb-2">Historial de pagos</div>
          {payments.length === 0 ? (
            <div className="text-slate-500 dark:text-slate-400">No hay pagos registrados.</div>
          ) : (
            <div className="space-y-4">
              {payments.map((p, idx) => {
                const key = p.paymentReceiptPhotoKey
                const hasReceipt = !!key
                const isPdf = hasReceipt && key && isPdfKey(key)
                const displayUrl = p.paymentReceiptPhotoUrl
                  ? p.paymentReceiptPhotoUrl
                  : hasReceipt && key
                    ? `/api/v1/s3/get/${encodeURIComponent(key)}`
                    : null
                return (
                  <div key={p.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">Pago #{idx + 1}</div>
                      <Badge variant={p.paymentReceiptType ? 'default' : 'info'}>
                        {formatMoney(p.amount)}
                      </Badge>
                    </div>
                    <div className="grid gap-1 mt-2 md:grid-cols-2 text-xs">
                      <div><strong>Fecha:</strong> {new Date(p.createdAt).toLocaleString()}</div>
                      {p.paidByName && <div><strong>Pagado por:</strong> {p.paidByName}</div>}
                      <div><strong>Tipo:</strong> {receiptTypeText(p.paymentReceiptType)}</div>
                      {p.paymentReceiptRef && <div><strong>Referencia:</strong> {p.paymentReceiptRef}</div>}
                    </div>
                    {hasReceipt && displayUrl && (
                      <div className="mt-2">
                        <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                          Comprobante: {isPdf ? 'PDF' : 'Imagen'}
                        </div>
                        <div className="flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 min-h-40">
                          {isPdf ? (
                            <iframe src={displayUrl} title="Comprobante PDF" className="h-60 w-full rounded" />
                          ) : (
                            <img src={displayUrl} alt="Comprobante" className="max-h-60 max-w-full object-contain" />
                          )}
                        </div>
                        {p.paymentReceiptPhotoUrl && (
                          <div className="mt-1 text-center">
                            <a
                              href={p.paymentReceiptPhotoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Abrir en nueva pestaña
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}