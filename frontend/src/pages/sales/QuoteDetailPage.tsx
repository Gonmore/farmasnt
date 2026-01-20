import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { exportQuoteToPDF } from '../../lib/quotePdf'
import { openWhatsAppShare } from '../../lib/whatsapp'
import { MainLayout, PageContainer, Button, Loading, ErrorState, Table } from '../../components'
import { useNavigation } from '../../hooks'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'

type QuoteDetail = {
  id: string
  number: string
  customerId: string
  customerName: string
  status: 'CREATED' | 'PROCESSED'
  quotedBy: string | null
  validityDays: number
  paymentMode: string
  deliveryDays: number
  deliveryCity: string | null
  deliveryZone: string | null
  deliveryAddress: string | null
  deliveryMapsUrl: string | null
  globalDiscountPct: number
  proposalValue: string | null
  note: string | null
  subtotal: number
  globalDiscountAmount: number
  total: number
  lines: Array<{
    id: string
    productId: string
    productName: string
    productSku: string
    quantity: number
    unitPrice: number
    discountPct: number
    total: number
  }>
  createdAt: string
  updatedAt: string
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function paymentLabel(code: string): string {
  if (code === 'CASH') return 'Pago al contado'
  if (code === 'CREDIT_7') return 'Crédito 7 días'
  if (code === 'CREDIT_14') return 'Crédito 14 días'
  return code
}

async function fetchQuote(token: string, id: string): Promise<QuoteDetail> {
  return apiFetch(`/api/v1/sales/quotes/${id}`, { token })
}

export function QuoteDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const auth = useAuth()
  const tenant = useTenant()
  const currency = tenant.branding?.currency || 'BOB'

  const quoteQuery = useQuery({
    queryKey: ['quote', id],
    queryFn: () => fetchQuote(auth.accessToken!, id!),
    enabled: !!auth.accessToken && !!id,
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="Cotización"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/sales/quotes')}>Volver</Button>
            {quoteQuery.data && (
              <>
                {quoteQuery.data.status !== 'PROCESSED' && (
                  <Button variant="secondary" onClick={() => navigate(`/catalog/seller?quoteId=${quoteQuery.data.id}`)}>Editar</Button>
                )}
                <Button
                  onClick={async () => {
                    const q = quoteQuery.data!
                    await exportQuoteToPDF({
                      quoteNumber: q.number,
                      customerName: q.customerName,
                      quotedBy: q.quotedBy ?? undefined,
                      validityDays: String(q.validityDays),
                      paymentMode: paymentLabel(q.paymentMode),
                      deliveryDays: String(q.deliveryDays),
                      deliveryCity: q.deliveryCity ?? undefined,
                      deliveryZone: q.deliveryZone ?? undefined,
                      deliveryAddress: q.deliveryAddress ?? undefined,
                      globalDiscountPct: String(q.globalDiscountPct),
                      proposalValue: q.proposalValue ?? '',
                      items: q.lines.map((l) => ({
                        sku: l.productSku,
                        name: l.productName,
                        quantity: l.quantity,
                        discountPct: l.discountPct,
                        unitPrice: l.unitPrice,
                        lineTotal: l.total,
                      })),
                      subtotal: q.subtotal,
                      globalDiscountAmount: q.globalDiscountAmount,
                      totalAfterGlobal: q.total,
                      currency,
                      tenant,
                      logoUrl: tenant.branding?.logoUrl || undefined,
                    })
                  }}
                >
                  📄 Exportar PDF
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const q = quoteQuery.data!
                    const origin = window.location.origin
                    const link = `${origin}/sales/quotes/${q.id}`
                    const msg = `Cotización ${q.number} (${q.customerName})\nTotal: ${money(q.total)} ${currency}\n${link}`
                    openWhatsAppShare(msg)
                  }}
                >
                  📲 WhatsApp
                </Button>
              </>
            )}
          </div>
        }
      >
        {quoteQuery.isLoading && <Loading />}
        {quoteQuery.error && <ErrorState message="Error al cargar la cotización" retry={quoteQuery.refetch} />}

        {quoteQuery.data && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="grid gap-2 md:grid-cols-2 text-sm">
                <div><strong>Número:</strong> {quoteQuery.data.number}</div>
                <div><strong>Cliente:</strong> {quoteQuery.data.customerName}</div>
                <div><strong>Estado:</strong> {quoteQuery.data.status === 'PROCESSED' ? 'PROCESADA' : 'CREADA'}</div>
                <div><strong>Cotizado por:</strong> {quoteQuery.data.quotedBy ?? '-'}</div>
                <div><strong>Validez:</strong> {quoteQuery.data.validityDays} día(s)</div>
                <div><strong>Forma de pago:</strong> {paymentLabel(quoteQuery.data.paymentMode)}</div>
                <div><strong>Entrega:</strong> {quoteQuery.data.deliveryDays} día(s)</div>
                <div><strong>Desc. global:</strong> {quoteQuery.data.globalDiscountPct}%</div>
                {(quoteQuery.data.deliveryAddress || quoteQuery.data.deliveryZone || quoteQuery.data.deliveryCity) && (
                  <div className="md:col-span-2">
                    <strong>Lugar de entrega:</strong>{' '}
                    {[quoteQuery.data.deliveryAddress, quoteQuery.data.deliveryZone, quoteQuery.data.deliveryCity]
                      .map((p) => (p ?? '').trim())
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                )}
                {quoteQuery.data.deliveryMapsUrl && (
                  <div className="md:col-span-2">
                    <strong>Mapa:</strong>{' '}
                    <a
                      href={quoteQuery.data.deliveryMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--pf-primary)] underline"
                    >
                      Ver ubicación
                    </a>
                  </div>
                )}
                {quoteQuery.data.proposalValue && <div className="md:col-span-2"><strong>Valor de propuesta:</strong> {quoteQuery.data.proposalValue}</div>}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <Table
                columns={[
                  { header: 'SKU', accessor: (r: any) => r.productSku },
                  { header: 'Producto', accessor: (r: any) => r.productName },
                  { header: 'Cant.', accessor: (r: any) => r.quantity },
                  { header: 'Desc.%', accessor: (r: any) => r.discountPct },
                  { header: 'P. unit.', accessor: (r: any) => `${money(r.unitPrice)} ${currency}` },
                  { header: 'Total', accessor: (r: any) => `${money(r.total)} ${currency}` },
                ]}
                data={quoteQuery.data.lines}
                keyExtractor={(r: any) => r.id}
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex justify-end gap-6">
                <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
                <span className="font-medium">{money(quoteQuery.data.subtotal)} {currency}</span>
              </div>
              <div className="flex justify-end gap-6">
                <span className="text-slate-600 dark:text-slate-400">Desc. global</span>
                <span className="font-medium">-{money(quoteQuery.data.globalDiscountAmount)} {currency}</span>
              </div>
              <div className="mt-2 flex justify-end gap-6 border-t border-slate-200 pt-2 dark:border-slate-700">
                <span className="font-semibold">Total</span>
                <span className="font-semibold">{money(quoteQuery.data.total)} {currency}</span>
              </div>
            </div>
          </div>
        )}
      </PageContainer>
    </MainLayout>
  )
}
