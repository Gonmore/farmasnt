import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, Badge } from '../../components'
import { apiFetch } from '../../lib/api'
import { useNavigation } from '../../hooks'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { EyeIcon } from '@heroicons/react/24/outline'

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

async function markPaid(token: string, id: string, version: number): Promise<void> {
  await apiFetch(`/api/v1/sales/payments/${encodeURIComponent(id)}/pay`, {
    token,
    method: 'POST',
    body: JSON.stringify({ version }),
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

  const paymentsQuery = useQuery({
    queryKey: ['payments', status],
    queryFn: () => fetchPayments(auth.accessToken!, status),
    enabled: !!auth.accessToken,
  })

  const payMutation = useMutation({
    mutationFn: (vars: { id: string; version: number }) => markPaid(auth.accessToken!, vars.id, vars.version),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
      ])
    },
    onError: (err: any) => {
      const msg = (err?.message as string | undefined) ?? 'No se pudo marcar como pagado'
      window.alert(msg)
    },
  })

  const actions = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
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
    ),
    [status],
  )

  const items = paymentsQuery.data?.items ?? []

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Pagos" actions={actions}>
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {paymentsQuery.isLoading && <Loading />}
          {paymentsQuery.error && <ErrorState message="Error al cargar pagos" retry={paymentsQuery.refetch} />}
          {paymentsQuery.data && items.length === 0 && <EmptyState message="No hay pagos" />}

          {paymentsQuery.data && items.length > 0 && (
            <Table
              columns={[
                { header: 'Orden', accessor: (p) => p.number },
                {
                  header: 'Cliente',
                  accessor: (p) => (
                    <button
                      className="text-left text-slate-900 underline-offset-2 hover:underline dark:text-slate-100"
                      onClick={() => navigate(`/sales/customers/${encodeURIComponent(p.customerId)}`)}
                      type="button"
                    >
                      {p.customerName}
                    </button>
                  ),
                },
                { header: 'Pago', accessor: (p) => paymentModeLabel(p.paymentMode) },
                {
                  header: 'Entrega',
                  accessor: (p) => {
                    const d = p.deliveredAt ?? p.deliveryDate
                    return d ? new Date(d).toLocaleDateString() : '-'
                  },
                },
                {
                  header: 'Cobro',
                  accessor: (p) => {
                    const d = daysUntil(p.dueAt)
                    const label = d <= 0 ? 'Hoy' : `En ${d}d`
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
                  accessor: (p) => (
                    <Badge variant={p.paidAt ? 'success' : 'warning'}>{p.paidAt ? 'COBRADA' : 'PENDIENTE'}</Badge>
                  ),
                },
                {
                  header: 'Acciones',
                  className: 'text-center w-auto',
                  accessor: (p) => (
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<EyeIcon className="w-4 h-4" />}
                        onClick={() => navigate(`/sales/orders/${encodeURIComponent(p.id)}`)}
                      >
                        Ver
                      </Button>
                      {!p.paidAt && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={payMutation.isPending}
                          onClick={() => {
                            const ok = window.confirm(`¿Marcar como pagada la orden ${p.number}?`)
                            if (!ok) return
                            payMutation.mutate({ id: p.id, version: p.version })
                          }}
                        >
                          Pagado
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
      </PageContainer>
    </MainLayout>
  )
}
