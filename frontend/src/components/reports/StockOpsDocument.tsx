import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'
import { ExportLegend } from './ExportLegend'
import { getChartColor } from './chartTheme'

export type StockOpsDocumentSummary = {
  total: number
  open: number
  fulfilled: number
  cancelled: number
  pending: number
  accepted: number
  rejected: number
}

export type StockOpsDocumentCityItem = {
  city: string
  total: number
  open: number
  fulfilled: number
  cancelled: number
  pending: number
  accepted: number
  rejected: number
}

export type StockOpsDocumentFlowItem = {
  origin: string
  destination: string
  requestsCount: number
  avgMinutes: number | null
}

export type StockOpsDocumentFulfilledItem = {
  id: string
  destination: string
  origin: string
  requestedByName: string
  createdAt: string
  fulfilledAt: string
  minutesToFulfill: number
  itemsCount: number
  movementsCount: number
}

export type StockOpsDocumentTraceRequestedItem = {
  id: string
  product: string
  presentation: string
  requestedQuantity: number
}

export type StockOpsDocumentTraceSentLine = {
  id: string
  createdAt: string
  origin: string
  destination: string
  product: string
  batchNumber: string | null
  expiresAt: string | null
  quantity: number
}

export type StockOpsDocumentTraceDetail = {
  requestId: string
  destination: string
  requestedAt: string
  fulfilledAt: string | null
  minutesToFulfill: number | null
  requestedByName: string
  fulfilledByName: string
  requestedItems: StockOpsDocumentTraceRequestedItem[]
  sentLines: StockOpsDocumentTraceSentLine[]
}

export type StockOpsDocumentReturnsSummary = {
  returnsCount: number
  itemsCount: number
  quantity: number
}

export type StockOpsDocumentReturnWarehouseItem = {
  warehouse: string
  city: string
  returnsCount: number
  itemsCount: number
  quantity: number
}

type Props = {
  title: string
  from: string
  to: string
  summary: StockOpsDocumentSummary
  byCity: StockOpsDocumentCityItem[]
  flows: StockOpsDocumentFlowItem[]
  fulfilled: StockOpsDocumentFulfilledItem[]
  traces: StockOpsDocumentTraceDetail[]
  returnsSummary: StockOpsDocumentReturnsSummary
  returnsByWarehouse: StockOpsDocumentReturnWarehouseItem[]
}

function formatMinutes(minutes: number | null | undefined): string {
  const value = Number(minutes ?? 0)
  if (!Number.isFinite(value) || value <= 0) return '—'
  const total = Math.round(value)
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours <= 0) return `${mins} min`
  return `${hours}h ${String(mins).padStart(2, '0')}m`
}

export function StockOpsDocument({ title, from, to, summary, byCity, flows, fulfilled, traces, returnsSummary, returnsByWarehouse }: Props) {
  const statusPieData = [
    { name: 'Abiertas', value: summary.open, color: '#3b82f6' },
    { name: 'Atendidas', value: summary.fulfilled, color: '#10b981' },
    { name: 'Canceladas', value: summary.cancelled, color: '#f59e0b' },
  ].filter((item) => item.value > 0)

  const cityChartData = byCity.slice(0, 12)
  const returnsChartData = returnsByWarehouse.slice(0, 12).map((item) => ({
    warehouse: item.warehouse.length > 22 ? `${item.warehouse.slice(0, 22)}…` : item.warehouse,
    devoluciones: item.returnsCount,
    unidades: item.quantity,
  }))

  return (
    <div className="mx-auto w-[1240px] bg-white px-10 py-8 text-slate-900">
      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="text-2xl font-bold tracking-tight">{title}</div>
        <div className="mt-2 text-sm text-slate-600">Periodo: {from} a {to}</div>
        <div className="text-sm text-slate-600">Documento estructurado de solicitudes y devoluciones</div>
      </div>

      <div className="mb-8 grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Solicitudes</div>
          <div className="mt-2 text-3xl font-bold">{summary.total}</div>
          <div className="mt-1 text-sm text-slate-600">Total del periodo</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Atendidas</div>
          <div className="mt-2 text-3xl font-bold text-emerald-700">{summary.fulfilled}</div>
          <div className="mt-1 text-sm text-slate-600">Abiertas: {summary.open}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Confirmacion</div>
          <div className="mt-2 text-3xl font-bold text-indigo-700">{summary.accepted}</div>
          <div className="mt-1 text-sm text-slate-600">Pendientes: {summary.pending} · Rechazadas: {summary.rejected}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Devoluciones</div>
          <div className="mt-2 text-3xl font-bold text-rose-700">{returnsSummary.returnsCount}</div>
          <div className="mt-1 text-sm text-slate-600">{returnsSummary.itemsCount} lineas · {returnsSummary.quantity.toFixed(0)} unidades</div>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-[420px_minmax(0,1fr)] gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Distribucion de solicitudes</div>
          <div className="flex justify-center">
              <PieChart width={380} height={300}>
                <Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} isAnimationActive={false}>
                  {statusPieData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number | string | undefined) => [Number(value ?? 0), 'Solicitudes']} />
              </PieChart>
          </div>
          <ExportLegend items={statusPieData.map((item) => ({ label: item.name, color: item.color }))} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Solicitudes por ciudad</div>
          <div className="flex justify-center">
              <BarChart width={760} height={300} data={cityChartData} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis type="category" dataKey="city" width={110} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="fulfilled" name="Atendidas" stackId="a" fill="#10b981" isAnimationActive={false} />
                <Bar dataKey="open" name="Abiertas" stackId="a" fill="#3b82f6" isAnimationActive={false} />
                <Bar dataKey="cancelled" name="Canceladas" stackId="a" fill="#f59e0b" isAnimationActive={false} />
              </BarChart>
          </div>
          <ExportLegend items={[{ label: 'Atendidas', color: '#10b981' }, { label: 'Abiertas', color: '#3b82f6' }, { label: 'Canceladas', color: '#f59e0b' }]} />
        </div>
      </div>

      <div className="mb-8 grid grid-cols-[minmax(0,1fr)_420px] gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Flujos completados</div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="w-[34%] px-3 py-2">Origen</th>
                <th className="w-[34%] px-3 py-2">Destino</th>
                <th className="w-[16%] px-3 py-2 text-right">Completadas</th>
                <th className="w-[16%] px-3 py-2 text-right">T. prom.</th>
              </tr>
            </thead>
            <tbody>
              {flows.map((item) => (
                <tr key={`${item.origin}-${item.destination}`} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3">{item.origin}</td>
                  <td className="px-3 py-3">{item.destination}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.requestsCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatMinutes(item.avgMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Devoluciones por sucursal</div>
          <div className="flex justify-center">
              <BarChart width={380} height={320} data={returnsChartData} margin={{ top: 10, right: 20, left: 0, bottom: 65 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="warehouse" angle={-35} textAnchor="end" interval={0} height={80} tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="devoluciones" name="Devoluciones" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  {returnsChartData.map((_, idx) => (
                    <Cell key={idx} fill={getChartColor(idx, 'rainbow')} />
                  ))}
                </Bar>
                <Bar dataKey="unidades" name="Unidades" fill="#f59e0b" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
          </div>
          <ExportLegend items={[{ label: 'Devoluciones', color: getChartColor(0, 'rainbow') }, { label: 'Unidades', color: '#f59e0b' }]} />
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Detalle por ciudad</div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="w-[24%] px-3 py-2">Ciudad</th>
                <th className="w-[10%] px-3 py-2 text-right">Total</th>
                <th className="w-[10%] px-3 py-2 text-right">Ab.</th>
                <th className="w-[10%] px-3 py-2 text-right">At.</th>
                <th className="w-[10%] px-3 py-2 text-right">Can.</th>
                <th className="w-[10%] px-3 py-2 text-right">Pen.</th>
                <th className="w-[10%] px-3 py-2 text-right">Acep.</th>
                <th className="w-[10%] px-3 py-2 text-right">Rech.</th>
              </tr>
            </thead>
            <tbody>
              {byCity.map((item) => (
                <tr key={item.city} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3">{item.city}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.total}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.open}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.fulfilled}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.cancelled}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.pending}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.accepted}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Solicitudes atendidas</div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="w-[18%] px-3 py-2">ID</th>
                <th className="w-[28%] px-3 py-2">Destino</th>
                <th className="w-[20%] px-3 py-2">Origen</th>
                <th className="w-[12%] px-3 py-2 text-right">Tiempo</th>
                <th className="w-[10%] px-3 py-2 text-right">Items</th>
                <th className="w-[12%] px-3 py-2 text-right">Envios</th>
              </tr>
            </thead>
            <tbody>
              {fulfilled.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3 font-mono text-xs">{item.id}</td>
                  <td className="px-3 py-3">{item.destination}</td>
                  <td className="px-3 py-3">{item.origin}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatMinutes(item.minutesToFulfill)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.itemsCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.movementsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white px-4 py-5">
        <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Detalle de devoluciones</div>
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="w-[32%] px-3 py-2">Sucursal</th>
              <th className="w-[18%] px-3 py-2">Ciudad</th>
              <th className="w-[16%] px-3 py-2 text-right">Devoluciones</th>
              <th className="w-[16%] px-3 py-2 text-right">Items</th>
              <th className="w-[18%] px-3 py-2 text-right">Unidades</th>
            </tr>
          </thead>
          <tbody>
            {returnsByWarehouse.map((item) => (
              <tr key={`${item.warehouse}-${item.city}`} className="border-b border-slate-100 align-top">
                <td className="px-3 py-3">{item.warehouse}</td>
                <td className="px-3 py-3">{item.city}</td>
                <td className="px-3 py-3 text-right tabular-nums">{item.returnsCount}</td>
                <td className="px-3 py-3 text-right tabular-nums">{item.itemsCount}</td>
                <td className="px-3 py-3 text-right tabular-nums">{item.quantity.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-4 text-lg font-bold tracking-tight">Trazabilidad por solicitud atendida</div>
      <div className="space-y-6">
        {traces.map((trace) => (
          <section key={trace.requestId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="text-base font-semibold">Solicitud {trace.requestId}</div>
              <div className="mt-1 text-sm text-slate-600">
                Destino {trace.destination} · solicitada por {trace.requestedByName} · atendida por {trace.fulfilledByName} · tiempo {formatMinutes(trace.minutesToFulfill)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-0 border-b border-slate-200 text-sm">
              <div className="border-r border-slate-200 px-5 py-4">
                <div className="mb-3 font-semibold text-slate-700">Solicitado</div>
                <div className="mb-3 text-xs text-slate-500">{new Date(trace.requestedAt).toLocaleString()}</div>
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="w-[52%] pb-2 pr-2">Producto</th>
                      <th className="w-[30%] pb-2 pr-2">Presentacion</th>
                      <th className="w-[18%] pb-2 text-right">Cant.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.requestedItems.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-2">{item.product}</td>
                        <td className="py-2 pr-2">{item.presentation}</td>
                        <td className="py-2 text-right tabular-nums">{item.requestedQuantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-4">
                <div className="mb-3 font-semibold text-slate-700">Enviado</div>
                <div className="mb-3 text-xs text-slate-500">{trace.fulfilledAt ? new Date(trace.fulfilledAt).toLocaleString() : 'Sin confirmacion final'}</div>
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="w-[20%] pb-2 pr-2">Fecha</th>
                      <th className="w-[20%] pb-2 pr-2">Origen</th>
                      <th className="w-[20%] pb-2 pr-2">Destino</th>
                      <th className="w-[22%] pb-2 pr-2">Producto</th>
                      <th className="w-[8%] pb-2 pr-2">Lote</th>
                      <th className="w-[10%] pb-2 text-right">Cant.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.sentLines.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-2">{new Date(item.createdAt).toLocaleString()}</td>
                        <td className="py-2 pr-2">{item.origin}</td>
                        <td className="py-2 pr-2">{item.destination}</td>
                        <td className="py-2 pr-2">{item.product}</td>
                        <td className="py-2 pr-2">{item.batchNumber ?? '—'}</td>
                        <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}