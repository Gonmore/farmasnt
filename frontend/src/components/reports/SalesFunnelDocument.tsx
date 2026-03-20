import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import { getChartColor } from './chartTheme'

export type SalesFunnelDocumentItem = {
  key: string
  label: string
  value: number
}

type Props = {
  title: string
  from: string
  to: string
  currency: string
  items: SalesFunnelDocumentItem[]
  totals: {
    amountFulfilled: number
    amountPaid: number
  }
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

export function SalesFunnelDocument({ title, from, to, currency, items, totals }: Props) {
  const conversion = items[0]?.value ? ((items[items.length - 1]?.value ?? 0) / items[0].value) * 100 : 0
  return (
    <div className="mx-auto w-[1200px] bg-white px-10 py-8 text-slate-900">
      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="text-2xl font-bold tracking-tight">{title}</div>
        <div className="mt-2 text-sm text-slate-600">Periodo: {from} a {to}</div>
      </div>
      <div className="mb-8 grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Etapas</div><div className="mt-2 text-3xl font-bold">{items.length}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Conversion final</div><div className="mt-2 text-3xl font-bold text-emerald-700">{conversion.toFixed(1)}%</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total entregado</div><div className="mt-2 text-3xl font-bold">{money(totals.amountFulfilled)}</div><div className="mt-1 text-sm text-slate-600">{currency}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total cobrado</div><div className="mt-2 text-3xl font-bold">{money(totals.amountPaid)}</div><div className="mt-1 text-sm text-slate-600">{currency}</div></div>
      </div>
      <div className="mb-8 rounded-2xl border border-slate-200 bg-white px-4 py-5">
        <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Embudo</div>
        <div className="flex justify-center">
            <BarChart width={1120} height={340} data={items} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip formatter={(value: number | string | undefined) => [Number(value ?? 0), 'Cantidad']} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {items.map((_, idx) => <Cell key={idx} fill={getChartColor(idx, 'rainbow')} />)}
              </Bar>
            </BarChart>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
        <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Detalle por etapa</div>
        <table className="w-full table-fixed border-collapse text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><th className="px-3 py-2">Etapa</th><th className="px-3 py-2 text-right">Cantidad</th><th className="px-3 py-2 text-right">Conversion acumulada</th></tr></thead>
          <tbody>
            {items.map((item, idx) => {
              const base = items[0]?.value || 0
              const pct = base > 0 ? (item.value / base) * 100 : 0
              return <tr key={item.key} className="border-b border-slate-100"><td className="px-3 py-3">{idx + 1}. {item.label}</td><td className="px-3 py-3 text-right tabular-nums">{item.value}</td><td className="px-3 py-3 text-right tabular-nums">{pct.toFixed(1)}%</td></tr>
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}