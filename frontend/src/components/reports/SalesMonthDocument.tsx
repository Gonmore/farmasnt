import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { ExportLegend } from './ExportLegend'

export type SalesMonthDocumentItem = {
  day: string
  ordersCount: number
  linesCount: number
  quantity: number
  amount: number
}

type Props = {
  title: string
  from: string
  to: string
  currency: string
  statusLabel: string
  items: SalesMonthDocumentItem[]
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

export function SalesMonthDocument({ title, from, to, currency, statusLabel, items }: Props) {
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0)
  const totalOrders = items.reduce((sum, item) => sum + item.ordersCount, 0)
  const totalLines = items.reduce((sum, item) => sum + item.linesCount, 0)
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)
  const chartItems = items.map((item) => ({
    label: new Date(item.day).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }),
    amount: item.amount,
    ordersCount: item.ordersCount,
  }))

  return (
    <div className="mx-auto w-[1200px] bg-white px-10 py-8 text-slate-900">
      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="text-2xl font-bold tracking-tight">{title}</div>
        <div className="mt-2 text-sm text-slate-600">Periodo: {from} a {to}</div>
        <div className="text-sm text-slate-600">Estado considerado: {statusLabel}</div>
      </div>

      <div className="mb-8 grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Facturacion</div>
          <div className="mt-2 text-3xl font-bold text-emerald-700">{money(totalAmount)}</div>
          <div className="mt-1 text-sm text-slate-600">{currency}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ordenes</div>
          <div className="mt-2 text-3xl font-bold">{totalOrders}</div>
          <div className="mt-1 text-sm text-slate-600">En el periodo</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Lineas</div>
          <div className="mt-2 text-3xl font-bold">{totalLines}</div>
          <div className="mt-1 text-sm text-slate-600">Items vendidos</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unidades</div>
          <div className="mt-2 text-3xl font-bold">{totalQuantity.toFixed(0)}</div>
          <div className="mt-1 text-sm text-slate-600">Total despachado</div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white px-4 py-5">
        <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Evolucion diaria</div>
        <div className="flex justify-center">
            <AreaChart width={1120} height={340} data={chartItems} margin={{ top: 10, right: 20, left: 10, bottom: 60 }}>
              <defs>
                <linearGradient id="salesMonthAmount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="label" angle={-35} textAnchor="end" interval={0} height={70} tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip formatter={(value: number | string | undefined, name: string | number | undefined) => [name === 'amount' ? `${money(Number(value ?? 0))} ${currency}` : Number(value ?? 0), name === 'amount' ? 'Facturado' : 'Ordenes']} />
              <Area yAxisId="left" type="monotone" dataKey="amount" stroke="#10b981" fill="url(#salesMonthAmount)" strokeWidth={3} name="Facturado" isAnimationActive={false} />
              <Area yAxisId="right" type="monotone" dataKey="ordersCount" stroke="#2563eb" fillOpacity={0} strokeWidth={2} name="Ordenes" isAnimationActive={false} />
            </AreaChart>
        </div>
        <ExportLegend items={[{ label: 'Facturado', color: '#10b981' }, { label: 'Ordenes', color: '#2563eb' }]} />
      </div>

      <div className="text-lg font-bold tracking-tight">Detalle diario</div>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-5">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="w-[18%] px-3 py-2">Dia</th>
              <th className="w-[14%] px-3 py-2 text-right">Ordenes</th>
              <th className="w-[14%] px-3 py-2 text-right">Lineas</th>
              <th className="w-[14%] px-3 py-2 text-right">Unidades</th>
              <th className="w-[20%] px-3 py-2 text-right">Facturado</th>
              <th className="w-[20%] px-3 py-2 text-right">Ticket prom.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const avgTicket = item.ordersCount > 0 ? item.amount / item.ordersCount : 0
              return (
                <tr key={item.day} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3">{new Date(item.day).toLocaleDateString()}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.ordersCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.linesCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.quantity.toFixed(0)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-emerald-700 tabular-nums">{money(item.amount)} {currency}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(avgTicket)} {currency}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}