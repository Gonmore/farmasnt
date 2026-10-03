import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import { ExportLegend } from './ExportLegend'
import { getChartColor } from './chartTheme'
import { formatInteger, formatMoney } from '../../lib/numberFormat'

export type SalesBranchSummary = {
  totalRevenue: string
  totalOrders: number
  totalUnits: string
  distinctCustomers: number
  distinctProducts: number
}

export type SalesBranchCustomerItem = {
  customerId: string
  customerName: string
  city: string | null
  department: string | null
  ordersCount: number
  quantity: string
  amount: string
}

export type SalesBranchProductItem = {
  productId: string
  sku: string | null
  productName: string
  presentationId: string | null
  presentationName: string
  quantity: string
  amount: string
}

type Props = {
  title: string
  from: string
  to: string
  currency: string
  statusLabel: string
  warehouseName?: string | null
  summary: SalesBranchSummary
  customers: SalesBranchCustomerItem[]
  products: SalesBranchProductItem[]
}

function money(n: number): string {
  return formatMoney(n)
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function SalesBranchDocument({ title, from, to, currency, statusLabel, warehouseName, summary, customers, products }: Props) {
  const totalAmount = toNumber(summary.totalRevenue)
  const totalUnits = toNumber(summary.totalUnits)

  const customerItems = customers.slice(0, 10).map((item) => ({
    name: item.customerName.length > 18 ? `${item.customerName.slice(0, 18)}…` : item.customerName,
    amount: toNumber(item.amount),
    ordersCount: item.ordersCount,
  }))
  const chartLegendItems = [
    { label: 'Facturado', color: getChartColor(0, 'rainbow') },
    { label: 'Órdenes', color: '#1d4ed8' },
  ]

  return (
    <div className="mx-auto w-[1200px] bg-white px-10 py-8 text-slate-900">
      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="text-2xl font-bold tracking-tight">{title}</div>
        <div className="mt-2 text-sm text-slate-600">Periodo: {from} a {to}{warehouseName && ` · Sucursal: ${warehouseName}`}</div>
        <div className="text-sm text-slate-600">Estado considerado: {statusLabel}</div>
      </div>

      <div className="mb-8 grid grid-cols-5 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Facturación total</div>
          <div className="mt-2 text-3xl font-bold text-emerald-700">{money(totalAmount)}</div>
          <div className="mt-1 text-sm text-slate-600">{currency}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Órdenes</div>
          <div className="mt-2 text-3xl font-bold">{summary.totalOrders}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unidades vendidas</div>
          <div className="mt-2 text-3xl font-bold">{formatInteger(totalUnits)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Clientes</div>
          <div className="mt-2 text-3xl font-bold">{summary.distinctCustomers}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Productos distintos</div>
          <div className="mt-2 text-3xl font-bold">{summary.distinctProducts}</div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Top clientes</div>
          <div className="flex justify-center">
            <BarChart width={520} height={320} data={customerItems} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={80} tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip formatter={(value: number | string | undefined, name: string | number | undefined) => [name === 'amount' ? `${money(Number(value ?? 0))} ${currency}` : Number(value ?? 0), name === 'amount' ? 'Facturado' : 'Órdenes']} />
              <Bar yAxisId="left" dataKey="amount" name="Facturado" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {customerItems.map((_, idx) => (
                  <Cell key={idx} fill={getChartColor(idx, 'rainbow')} />
                ))}
              </Bar>
              <Bar yAxisId="right" dataKey="ordersCount" name="Órdenes" fill="#1d4ed8" radius={[6, 6, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </div>
          <ExportLegend items={chartLegendItems} />
        </div>
      </div>

      <div className="mb-8">
        <div className="mb-4 text-lg font-bold tracking-tight">Ranking de clientes</div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Ciudad</th>
                <th className="px-3 py-2">Departamento</th>
                <th className="px-3 py-2 text-right">Órdenes</th>
                <th className="px-3 py-2 text-right">Unidades</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {customers
                .slice()
                .sort((a, b) => toNumber(b.amount) - toNumber(a.amount))
                .map((item) => (
                  <tr key={item.customerId} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-3 font-medium">{item.customerName}</td>
                    <td className="px-3 py-3">{item.city ?? '-'}</td>
                    <td className="px-3 py-3">{item.department ?? '-'}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatInteger(item.ordersCount)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatInteger(toNumber(item.quantity))}</td>
                    <td className="px-3 py-3 text-right font-semibold text-emerald-700 tabular-nums">{money(toNumber(item.amount))} {currency}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-4 text-lg font-bold tracking-tight">Productos y presentaciones vendidos</div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Presentación</th>
              <th className="px-3 py-2 text-right">Unidades</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {products
              .slice()
              .sort((a, b) => toNumber(b.amount) - toNumber(a.amount))
              .map((item) => (
                <tr key={`${item.productId}-${item.presentationId ?? 'unidad'}`} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3 font-mono text-xs">{item.sku ?? '-'}</td>
                  <td className="px-3 py-3">{item.productName}</td>
                  <td className="px-3 py-3">{item.presentationName}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInteger(toNumber(item.quantity))}</td>
                  <td className="px-3 py-3 text-right font-semibold text-emerald-700 tabular-nums">{money(toNumber(item.amount))} {currency}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
