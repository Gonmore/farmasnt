import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'

export type SalesComparisonDocumentItem = {
  month: string
  orderCount: number
  linesCount: number
  quantity: number
  total: number
}

type Props = {
  title: string
  from: string
  to: string
  currency: string
  statusLabel: string
  items: SalesComparisonDocumentItem[]
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

export function SalesComparisonDocument({ title, from, to, currency, statusLabel, items }: Props) {
  const latest = items[items.length - 1]
  const previous = items[items.length - 2]
  const growthPct = previous && previous.total > 0 ? ((latest.total - previous.total) / previous.total) * 100 : 0
  const avgMonthly = items.length > 0 ? items.reduce((sum, item) => sum + item.total, 0) / items.length : 0
  return (
    <div className="mx-auto w-[1200px] bg-white px-10 py-8 text-slate-900">
      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="text-2xl font-bold tracking-tight">{title}</div>
        <div className="mt-2 text-sm text-slate-600">Periodo: {from} a {to}</div>
        <div className="text-sm text-slate-600">Estado considerado: {statusLabel}</div>
      </div>
      <div className="mb-8 grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ultimo mes</div><div className="mt-2 text-3xl font-bold">{money(latest?.total ?? 0)}</div><div className="mt-1 text-sm text-slate-600">{latest?.month ?? '-'} · {currency}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Mes anterior</div><div className="mt-2 text-3xl font-bold">{money(previous?.total ?? 0)}</div><div className="mt-1 text-sm text-slate-600">{previous?.month ?? '-'} · {currency}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Crecimiento</div><div className={`mt-2 text-3xl font-bold ${growthPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{growthPct >= 0 ? '+' : ''}{growthPct.toFixed(1)}%</div><div className="mt-1 text-sm text-slate-600">vs mes anterior</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Promedio mensual</div><div className="mt-2 text-3xl font-bold">{money(avgMonthly)}</div><div className="mt-1 text-sm text-slate-600">{items.length} meses · {currency}</div></div>
      </div>
      <div className="mb-8 rounded-2xl border border-slate-200 bg-white px-4 py-5"><div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Evolucion mensual</div><div className="flex justify-center"><AreaChart width={1120} height={340} data={items} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}><defs><linearGradient id="salesComparisonArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.8} /><stop offset="95%" stopColor="#10b981" stopOpacity={0.08} /></linearGradient></defs><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 11, fill: '#475569' }} /><YAxis tick={{ fontSize: 11, fill: '#475569' }} /><Tooltip formatter={(value: number | string | undefined) => [`${money(Number(value ?? 0))} ${currency}`, 'Ventas']} /><Area type="monotone" dataKey="total" stroke="#10b981" fill="url(#salesComparisonArea)" strokeWidth={3} isAnimationActive={false} /></AreaChart></div></div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5"><div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Detalle mensual</div><table className="w-full table-fixed border-collapse text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><th className="w-[18%] px-3 py-2">Mes</th><th className="w-[14%] px-3 py-2 text-right">Ordenes</th><th className="w-[14%] px-3 py-2 text-right">Lineas</th><th className="w-[14%] px-3 py-2 text-right">Unidades</th><th className="w-[20%] px-3 py-2 text-right">Ventas</th><th className="w-[20%] px-3 py-2 text-right">Variacion</th></tr></thead><tbody>{items.map((item, idx) => { const prev = items[idx - 1]; const pct = prev && prev.total > 0 ? ((item.total - prev.total) / prev.total) * 100 : null; return <tr key={item.month} className="border-b border-slate-100"><td className="px-3 py-3">{item.month}</td><td className="px-3 py-3 text-right tabular-nums">{item.orderCount}</td><td className="px-3 py-3 text-right tabular-nums">{item.linesCount}</td><td className="px-3 py-3 text-right tabular-nums">{item.quantity.toFixed(0)}</td><td className="px-3 py-3 text-right font-semibold text-emerald-700 tabular-nums">{money(item.total)} {currency}</td><td className={`px-3 py-3 text-right tabular-nums ${pct === null ? 'text-slate-500' : pct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{pct === null ? '-' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}</td></tr>})}</tbody></table></div>
    </div>
  )
}