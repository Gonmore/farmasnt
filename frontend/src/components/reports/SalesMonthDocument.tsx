import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { ExportLegend } from './ExportLegend'
import { formatInteger, formatMoney } from '../../lib/numberFormat'
import { orderStatusLabel, toNumber } from './reportsUtils'
import type { SalesMonthlyDetailItem } from '../../pages/reports/SalesReportsPage'
import React from 'react'

export type SalesMonthDocumentItem = {
  day: string
  ordersCount: number
  linesCount: number
  quantity: number
  amount: number
}

export type SalesMonthDetailItem = SalesMonthlyDetailItem

type Props = {
  title: string
  from: string
  to: string
  currency: string
  statusLabel: string
  items: SalesMonthDocumentItem[]
  detailItems?: SalesMonthDetailItem[]
}

function money(n: number): string {
  return formatMoney(n)
}

export function SalesMonthDocument({ title, from, to, currency, statusLabel, items, detailItems }: Props) {
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
          <div className="mt-2 text-3xl font-bold">{formatInteger(totalOrders)}</div>
          <div className="mt-1 text-sm text-slate-600">En el periodo</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Lineas</div>
          <div className="mt-2 text-3xl font-bold">{formatInteger(totalLines)}</div>
          <div className="mt-1 text-sm text-slate-600">Items vendidos</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unidades</div>
          <div className="mt-2 text-3xl font-bold">{formatInteger(totalQuantity)}</div>
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
                  <td className="px-3 py-3 text-right tabular-nums">{formatInteger(item.ordersCount)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInteger(item.linesCount)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInteger(item.quantity)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-emerald-700 tabular-nums">{money(item.amount)} {currency}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(avgTicket)} {currency}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {detailItems && detailItems.length > 0 && (() => {
        const warehouseGroups: Record<string, SalesMonthlyDetailItem[]> = {}
        detailItems.forEach((item) => {
          const key = item.warehouseId || item.warehouseCode || 'sin-warehouse'
          if (!warehouseGroups[key]) warehouseGroups[key] = []
          warehouseGroups[key].push(item)
        })
        const warehouseEntries = Object.values(warehouseGroups).sort((a, b) => {
          const aName = a[0]?.warehouseName ?? a[0]?.warehouseCode ?? '-'
          const bName = b[0]?.warehouseName ?? b[0]?.warehouseCode ?? '-'
          return aName.localeCompare(bName)
        })

        return (
          <>
            <div className="mt-8 text-lg font-bold tracking-tight">Detalle de transacciones (líneas de venta)</div>
            <div className="space-y-6">
                {warehouseEntries.map((wsItems) => {
                const wsName = wsItems[0]?.warehouseName ?? wsItems[0]?.warehouseCode ?? '-'
                const wsCode = wsItems[0]?.warehouseCode ?? '-'
                const deptGroups: Record<string, SalesMonthlyDetailItem[]> = {}
                wsItems.forEach((item) => {
                  const dept = item.customerDepartment ?? '(sin dept.)'
                  if (!deptGroups[dept]) deptGroups[dept] = []
                  deptGroups[dept].push(item)
                })
                const depts = Object.keys(deptGroups).sort()
                const hasMultipleDepts = depts.length > 1
                const wsTotal = wsItems.reduce((sum, r) => sum + toNumber(r.lineTotal), 0)

                const orderGroups: Record<string, { order: SalesMonthlyDetailItem; lines: SalesMonthlyDetailItem[] }> = {}
                wsItems.forEach((item) => {
                  if (!orderGroups[item.orderId]) orderGroups[item.orderId] = { order: item, lines: [] }
                  orderGroups[item.orderId].lines.push(item)
                })
                const orderEntries = Object.values(orderGroups).sort(
                  (a, b) => new Date(b.order.createdAt).getTime() - new Date(a.order.createdAt).getTime()
                )

                return (
                  <div key={wsCode} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                      <div className="text-base font-semibold">{wsName}</div>
                      <div className="mt-1 text-sm text-slate-600">{wsCode}</div>
                    </div>
                    <div className="px-5 py-4">
                      <table className="w-full table-fixed border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                            <th className="w-[6%] px-3 py-2">Orden</th>
                            <th className="w-[8%] px-3 py-2">Estado</th>
                            <th className="w-[9%] px-3 py-2">Fecha</th>
                            <th className="w-[16%] px-3 py-2">Cliente</th>
                            {hasMultipleDepts && <th className="w-[9%] px-3 py-2">Depto.</th>}
                            <th className="w-[6%] px-3 py-2">SKU</th>
                            <th className="w-[18%] px-3 py-2">Producto</th>
                            <th className="w-[6%] px-3 py-2 text-right">Cant.</th>
                            <th className="w-[7%] px-3 py-2 text-right">Precio</th>
                            <th className="w-[9%] px-3 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orderEntries.map((og) => (
                            <React.Fragment key={og.order.orderId}>
                              <tr className="bg-slate-50">
                                <td colSpan={hasMultipleDepts ? 11 : 10} className="px-3 py-1 text-xs text-slate-700">
                                  Orden {og.order.orderNumber} · {orderStatusLabel(og.order.orderStatus)} · {new Date(og.order.createdAt).toLocaleDateString()} · {og.order.customerName}
                                </td>
                              </tr>
                              {og.lines
                                .slice()
                                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                                .map((r) => (
                                  <tr key={r.lineId} className="border-b border-slate-100 align-top">
                                    <td className="px-3 py-2 font-mono text-xs">{r.orderNumber}</td>
                                    <td className="px-3 py-2">{orderStatusLabel(r.orderStatus)}</td>
                                    <td className="px-3 py-2">{new Date(r.createdAt).toLocaleDateString()}</td>
                                    <td className="px-3 py-2">{r.customerName}</td>
                                    {hasMultipleDepts && <td className="px-3 py-2">{r.customerDepartment ?? '-'}</td>}
                                    <td className="px-3 py-2 font-mono text-xs">{r.productSku ?? '-'}</td>
                                    <td className="px-3 py-2">{r.productName}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{formatInteger(toNumber(r.quantity))}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{money(toNumber(r.unitPrice))}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{money(toNumber(r.lineTotal))}</td>
                                  </tr>
                                ))}
                            </React.Fragment>
                          ))}
                          <tr className="bg-slate-50">
                            <td colSpan={hasMultipleDepts ? 10 : 9} className="px-3 py-1 text-right text-xs font-semibold text-slate-700">
                              Total sucursal:
                            </td>
                            <td className="px-3 py-1 text-right tabular-nums font-semibold text-slate-900">
                              {money(wsTotal)} {currency}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )
      })()}
    </div>
  )
}