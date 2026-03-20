import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import { ExportLegend } from './ExportLegend'
import { getChartColor } from './chartTheme'

export type SalesMarginsDocumentItem = {
  productId: string
  sku: string
  name: string
  qtySold: number
  revenue: number
  costTotal: number
  profit: number
  marginPct: number
}

export type SalesMarginsDocumentOrder = {
  id: string
  number: string
  status: string
  customerName: string
  total: number
  createdAt: string
  deliveredAt: string | null
  paidAt: string | null
}

export type SalesMarginsDocumentDetail = {
  productName: string
  sku: string
  qtySold: number
  revenue: number
  costTotal: number
  profit: number
  marginPct: number
  orders: SalesMarginsDocumentOrder[]
}

type Props = {
  title: string
  from: string
  to: string
  currency: string
  statusLabel: string
  hasCostData: boolean
  totals: {
    revenue: number
    costTotal: number
    profit: number
    avgMargin: number
  }
  items: SalesMarginsDocumentItem[]
  details: SalesMarginsDocumentDetail[]
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

export function SalesMarginsDocument({ title, from, to, currency, statusLabel, hasCostData, totals, items, details }: Props) {
  const leadProduct = items[0]
  const chartItems = items.slice(0, 10).map((item) => ({
    name: item.name.length > 18 ? `${item.name.slice(0, 18)}…` : item.name,
    revenue: item.revenue,
    profit: item.profit,
  }))
  const chartLegendItems = [
    { label: 'Ingreso', color: getChartColor(0, 'rainbow') },
    { label: 'Utilidad', color: '#10b981' },
  ]

  return (
    <div className="mx-auto w-[1200px] bg-white px-10 py-8 text-slate-900">
      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="text-2xl font-bold tracking-tight">{title}</div>
        <div className="mt-2 text-sm text-slate-600">Periodo: {from} a {to}</div>
        <div className="text-sm text-slate-600">Estado considerado: {statusLabel}</div>
      </div>

      {!hasCostData && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Los productos del periodo no tienen costo configurado. La utilidad y el margen exportados pueden no reflejar rentabilidad real.
        </div>
      )}

      <div className="mb-8 grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ingresos</div>
          <div className="mt-2 text-3xl font-bold text-sky-700">{money(totals.revenue)}</div>
          <div className="mt-1 text-sm text-slate-600">{currency}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Costo total</div>
          <div className="mt-2 text-3xl font-bold text-amber-700">{money(totals.costTotal)}</div>
          <div className="mt-1 text-sm text-slate-600">Base de costo vendida</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Utilidad bruta</div>
          <div className={`mt-2 text-3xl font-bold ${totals.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(totals.profit)}</div>
          <div className="mt-1 text-sm text-slate-600">{currency}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Margen promedio</div>
          <div className={`mt-2 text-3xl font-bold ${totals.avgMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{totals.avgMargin.toFixed(1)}%</div>
          <div className="mt-1 text-sm text-slate-600">{leadProduct ? `Lider: ${leadProduct.name}` : 'Sin datos'}</div>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-[560px_minmax(0,1fr)] gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Top margen por producto</div>
          <div className="flex justify-center">
              <BarChart width={520} height={320} data={chartItems} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={80} tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip formatter={(value: number | string | undefined, name: string | number | undefined) => [`${money(Number(value ?? 0))} ${currency}`, name === 'revenue' ? 'Ingreso' : 'Utilidad']} />
                <Bar dataKey="revenue" name="Ingreso" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  {chartItems.map((_, idx) => (
                    <Cell key={idx} fill={getChartColor(idx, 'rainbow')} />
                  ))}
                </Bar>
                <Bar dataKey="profit" name="Utilidad" fill="#10b981" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
          </div>
          <ExportLegend items={chartLegendItems} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Ranking de rentabilidad</div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="w-[14%] px-3 py-2">SKU</th>
                <th className="px-3 py-2">Producto</th>
                <th className="w-[12%] px-3 py-2 text-right">Unid.</th>
                <th className="w-[16%] px-3 py-2 text-right">Ingreso</th>
                <th className="w-[16%] px-3 py-2 text-right">Costo</th>
                <th className="w-[16%] px-3 py-2 text-right">Utilidad</th>
                <th className="w-[12%] px-3 py-2 text-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.productId} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3 font-mono text-xs">{item.sku}</td>
                  <td className="px-3 py-3 font-medium">{item.name}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.qtySold.toFixed(0)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(item.revenue)} {currency}</td>
                  <td className="px-3 py-3 text-right text-slate-600 tabular-nums">{money(item.costTotal)} {currency}</td>
                  <td className={`px-3 py-3 text-right font-semibold tabular-nums ${item.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(item.profit)} {currency}</td>
                  <td className={`px-3 py-3 text-right font-semibold tabular-nums ${item.marginPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{item.marginPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-4 text-lg font-bold tracking-tight">Detalle de ordenes por producto</div>
      <div className="space-y-6">
        {details.map((detail) => (
          <section key={`${detail.sku}-${detail.productName}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="text-base font-semibold">{detail.productName}</div>
              <div className="mt-1 text-sm text-slate-600">
                SKU {detail.sku} · {detail.qtySold.toFixed(0)} unidades · ingreso {money(detail.revenue)} {currency} · costo {money(detail.costTotal)} {currency} · utilidad {money(detail.profit)} {currency} · margen {detail.marginPct.toFixed(1)}%
              </div>
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
        ))}
      </div>
    </div>
  )
}