import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getProductDisplayName } from '../../lib/productName'
import { MainLayout, PageContainer, Button, Loading, ErrorState, Table, Badge } from '../../components'
import { useNavigation } from '../../hooks'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'

type OrderLine = {
  id: string
  productId: string
  batchId: string | null
  quantity: string | number
  unitPrice: string | number
  product: { sku: string; name: string; genericName?: string | null }
}

type SalesOrderDetail = {
  id: string
  number: string
  customerId: string
  quoteId: string | null
  status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'
  note: string | null
  version: number
  createdAt: string
  updatedAt: string
  processedBy: string | null
  deliveryDate: string | null
  deliveryCity: string | null
  deliveryZone: string | null
  deliveryAddress: string | null
  deliveryMapsUrl: string | null
  customer: { id: string; name: string; nit: string | null }
  quote: { id: string; number: string } | null
  lines: OrderLine[]
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

async function fetchOrder(token: string, id: string): Promise<SalesOrderDetail> {
  return apiFetch(`/api/v1/sales/orders/${id}`, { token })
}

export function OrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const auth = useAuth()
  const tenant = useTenant()
  const currency = tenant.branding?.currency || 'BOB'

  const orderQuery = useQuery({
    queryKey: ['order', id],
    queryFn: () => fetchOrder(auth.accessToken!, id!),
    enabled: !!auth.accessToken && !!id,
  })

  const total = (orderQuery.data?.lines ?? []).reduce((sum, l) => {
    const qty = toNumber(l.quantity)
    const unit = toNumber(l.unitPrice)
    return sum + qty * unit
  }, 0)

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="Orden de venta"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/sales/orders')}>Volver</Button>
            {orderQuery.data?.quote?.id && (
              <Button variant="secondary" onClick={() => navigate(`/sales/quotes/${orderQuery.data!.quote!.id}`)}>
                Ver cotización
              </Button>
            )}
          </div>
        }
      >
        {orderQuery.isLoading && <Loading />}
        {orderQuery.error && <ErrorState message="Error al cargar la orden" retry={orderQuery.refetch} />}

        {orderQuery.data && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{orderQuery.data.number}</div>
                <Badge
                  variant={
                    orderQuery.data.status === 'FULFILLED'
                      ? 'success'
                      : orderQuery.data.status === 'CONFIRMED'
                        ? 'info'
                        : orderQuery.data.status === 'CANCELLED'
                          ? 'danger'
                          : 'default'
                  }
                >
                  {orderQuery.data.status}
                </Badge>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <div><strong>Cliente:</strong> {orderQuery.data.customer?.name ?? '-'}</div>
                <div><strong>NIT:</strong> {orderQuery.data.customer?.nit ?? '-'}</div>
                <div><strong>Procesado por:</strong> {orderQuery.data.processedBy ?? '-'}</div>
                <div><strong>Última actualización:</strong> {new Date(orderQuery.data.updatedAt).toLocaleString()}</div>

                {orderQuery.data.deliveryDate && (
                  <div><strong>Fecha de entrega:</strong> {new Date(orderQuery.data.deliveryDate).toLocaleDateString()}</div>
                )}

                {(orderQuery.data.deliveryAddress || orderQuery.data.deliveryZone || orderQuery.data.deliveryCity) && (
                  <div className="md:col-span-2">
                    <strong>Lugar de entrega:</strong>{' '}
                    {[orderQuery.data.deliveryAddress, orderQuery.data.deliveryZone, orderQuery.data.deliveryCity]
                      .map((p) => (p ?? '').trim())
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                )}

                {orderQuery.data.deliveryMapsUrl && (
                  <div className="md:col-span-2">
                    <strong>Mapa:</strong>{' '}
                    <a
                      href={orderQuery.data.deliveryMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--pf-primary)] underline"
                    >
                      Ver ubicación
                    </a>
                  </div>
                )}

                {orderQuery.data.quote?.number && (
                  <div className="md:col-span-2"><strong>Origen:</strong> cotización {orderQuery.data.quote.number}</div>
                )}

                {orderQuery.data.note && (
                  <div className="md:col-span-2"><strong>Nota:</strong> {orderQuery.data.note}</div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <Table
                columns={[
                  { header: 'SKU', accessor: (r: any) => r.product.sku },
                  { header: 'Producto', accessor: (r: any) => getProductDisplayName(r.product) },
                  { header: 'Cant.', accessor: (r: any) => toNumber(r.quantity) },
                  { header: 'Unit.', accessor: (r: any) => `${money(toNumber(r.unitPrice))} ${currency}` },
                  { header: 'Total', accessor: (r: any) => `${money(toNumber(r.quantity) * toNumber(r.unitPrice))} ${currency}` },
                ]}
                data={orderQuery.data.lines}
                keyExtractor={(r: any) => r.id}
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex justify-end gap-6">
                <span className="font-semibold">Total</span>
                <span className="font-semibold">{money(total)} {currency}</span>
              </div>
            </div>
          </div>
        )}
      </PageContainer>
    </MainLayout>
  )
}
