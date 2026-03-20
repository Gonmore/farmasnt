import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import { ExportLegend } from './ExportLegend'
import { getChartColor } from './chartTheme'

export type SalesByCustomerDocumentItem = {
  customerName: string
  city: string | null
  ordersCount: number
  quantity: number
  amount: number
}

export type SalesByCustomerDocumentOrder = {
  id: string
  number: string
  status: string
  customerName: string
  total: number
  createdAt: string
  deliveredAt: string | null
  paidAt: string | null
}

export type SalesByCustomerDocumentDetail = {
  customerName: string
  orders: SalesByCustomerDocumentOrder[]
}

type Props = {
  title: string
  from: string
  to: string
  currency: string
  statusLabel: string
  items: SalesByCustomerDocumentItem[]
  details: SalesByCustomerDocumentDetail[]
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function orderStatusLabel(status: string): string {
  if (status === 'DRAFT') return 'BORRADOR'
  if (status === 'CONFIRMED') return 'CONFIRMADO'
  if (status === 'FULFILLED') return 'ENTREGADO'
  if (status === 'CANCELLED') return 'ANULADO'
  return status
}

function orderStatusBadgeClass(status: string): string {
  if (status === 'FULFILLED') return 'bg-emerald-100 text-emerald-700'
  if (status === 'CANCELLED') return 'bg-rose-100 text-rose-700'
  if (status === 'CONFIRMED') return 'bg-blue-100 text-blue-700'
  return 'bg-slate-100 text-slate-700'
}

export function SalesByCustomerDocument({ title, from, to, currency, statusLabel, items, details }: Props) {
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0)
  const totalOrders = items.reduce((sum, item) => sum + item.ordersCount, 0)
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)
  const leadCustomer = items[0]
  const chartItems = items.slice(0, 10).map((item) => ({
    name: item.customerName.length > 18 ? `${item.customerName.slice(0, 18)}…` : item.customerName,
    amount: item.amount,
    ordersCount: item.ordersCount,
  }))
  const chartLegendItems = [
    { label: 'Facturado', color: getChartColor(0, 'rainbow') },
    { label: 'Ordenes', color: '#1d4ed8' },
  ]

  return (
    <div className="mx-auto w-[1200px] bg-white px-10 py-8 text-slate-900">
      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="text-2xl font-bold tracking-tight">{title}</div>
        <div className="mt-2 text-sm text-slate-600">Periodo: {from} a {to}</div>
        <div className="text-sm text-slate-600">Estado considerado: {statusLabel}</div>
      </div>

      <div className="mb-8 grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Clientes</div>
          <div className="mt-2 text-3xl font-bold">{items.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cliente lider</div>
          <div className="mt-2 text-xl font-bold">{leadCustomer?.customerName ?? '-'}</div>
          <div className="mt-1 text-sm text-slate-600">{money(leadCustomer?.amount ?? 0)} {currency}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Facturacion total</div>
          <div className="mt-2 text-3xl font-bold text-emerald-700">{money(totalAmount)}</div>
          <div className="mt-1 text-sm text-slate-600">{currency}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Volumen total</div>
          <div className="mt-2 text-3xl font-bold">{totalQuantity.toFixed(0)}</div>
          <div className="mt-1 text-sm text-slate-600">{totalOrders} ordenes</div>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-[560px_minmax(0,1fr)] gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Top clientes</div>
          <div className="flex justify-center">
              <BarChart width={520} height={320} data={chartItems} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={80} tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip formatter={(value: number | string | undefined, name: string | number | undefined) => [name === 'amount' ? `${money(Number(value ?? 0))} ${currency}` : Number(value ?? 0), name === 'amount' ? 'Facturado' : 'Ordenes']} />
                <Bar yAxisId="left" dataKey="amount" name="Facturado" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  {chartItems.map((_, idx) => (
                    <Cell key={idx} fill={getChartColor(idx, 'rainbow')} />
                  ))}
                </Bar>
                <Bar yAxisId="right" dataKey="ordersCount" name="Ordenes" fill="#1d4ed8" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
          </div>
          <ExportLegend items={chartLegendItems} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Ranking de clientes</div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Ciudad</th>
                <th className="px-3 py-2 text-right">Ordenes</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.customerName} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3 font-medium">{item.customerName}</td>
                  <td className="px-3 py-3">{item.city ?? '-'}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.ordersCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.quantity.toFixed(0)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-emerald-700 tabular-nums">{money(item.amount)} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-4 text-lg font-bold tracking-tight">Detalle de ordenes por cliente</div>
      <div className="space-y-6">
        {details.map((detail) => {
          const detailTotal = detail.orders.reduce((sum, order) => sum + order.total, 0)
          return (
            <section key={detail.customerName} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div className="text-base font-semibold">{detail.customerName}</div>
                <div className="mt-1 text-sm text-slate-600">{detail.orders.length} ordenes, total {money(detailTotal)} {currency}</div>
              </div>
              <table className="w-full table-fixed border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-white text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="w-[12%] px-4 py-3">Orden</th>
                    <th className="w-[28%] px-4 py-3">Cliente</th>
                    <th className="w-[14%] px-4 py-3">Estado</th>
                    <th className="w-[14%] px-4 py-3 text-right">Total</th>
                    <th className="w-[14%] px-4 py-3">Fecha</th>
                    <th className="w-[9%] px-4 py-3 text-center">Entrega</th>
                    <th className="w-[9%] px-4 py-3 text-center">Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.orders.map((order) => (
                    <tr key={order.id} className="border-b border-slate-100 align-top">
                      <td className="px-4 py-3 font-mono text-xs">{order.number}</td>
                      <td className="px-4 py-3">{order.customerName}</td>
                      <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${orderStatusBadgeClass(order.status)}`}>{orderStatusLabel(order.status)}</span></td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700 tabular-nums">{money(order.total)} {currency}</td>
                      <td className="px-4 py-3">{new Date(order.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-center">{order.deliveredAt ? 'Si' : 'No'}</td>
                      <td className="px-4 py-3 text-center">{order.paidAt ? 'Si' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )
        })}
      </div>
    </div>
  )
}