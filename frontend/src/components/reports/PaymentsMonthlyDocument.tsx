import { formatMoney } from '../../lib/numberFormat'

export type PaymentsMonthlyGroup = {
  department: string | null
  totalReceived: number
  paymentCount: number
  orders: Array<{
    number: string
    customerId: string
    customerName: string
    customerDepartment: string | null
    paidAmount: number
    paidAt: string | null
    total: number
    remaining: number
  }>
}

export type PaymentsMonthlyDocumentProps = {
  year: number
  month: number
  totalReceived: number
  groups: PaymentsMonthlyGroup[]
  currency: string
}

function monthLabel(year: number, month: number): string {
  const names = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  return `${names[month - 1]} ${year}`
}

function money(n: number): string {
  return formatMoney(n)
}

export function PaymentsMonthlyDocument({ year, month, totalReceived, groups, currency }: PaymentsMonthlyDocumentProps) {
  const period = monthLabel(year, month)
  const departmentCount = groups.filter((g) => g.paymentCount > 0).length

  return (
    <div className="relative mx-auto w-[1200px] bg-white px-10 py-8 text-slate-900">
      <div
        className="absolute inset-0 flex items-center justify-center opacity-3"
        style={{ transform: 'rotate(-25deg)', fontSize: '90px', fontWeight: 800, letterSpacing: '0.4em' }}
      >
        PAGOS
      </div>

      <div className="relative mb-6" style={{ zIndex: 10 }}>
        <div className="mb-6 text-xl font-bold tracking-tight text-slate-900">Reporte de pagos mensuales — {period}</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total recibido</div>
            <div className="mt-2 text-3xl font-bold text-emerald-700">{money(totalReceived)}</div>
            <div className="mt-1 text-sm text-slate-600">{currency}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Departamentos con pagos</div>
            <div className="mt-2 text-3xl font-bold text-blue-700">{departmentCount}</div>
            <div className="mt-1 text-sm text-slate-600">De {groups.length} departamentos</div>
          </div>
        </div>

        <div className="mt-8 text-sm font-medium uppercase tracking-wider text-slate-700">
          Resumen por departamento
        </div>

        <div className="mt-2 rounded-lg border border-slate-200 bg-white">
          <div className="grid grid-cols-12 gap-2 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">
            <div className="col-span-4">Departamento</div>
            <div className="col-span-2">Total recibido</div>
            <div className="col-span-2"># Pagos</div>
            <div className="col-span-2">Órdenes</div>
            <div className="col-span-2"># Clientes</div>
          </div>
          <div className="divide-y divide-slate-200">
            {groups
              .filter((g) => g.paymentCount > 0)
              .sort((a, b) => b.totalReceived - a.totalReceived)
              .map((g) => {
                const uniqueCustomers = new Set(g.orders.map((o) => o.customerId)).size
                return (
                  <div key={g.department ?? '__null__'} className="grid grid-cols-12 gap-2 px-4 py-2 text-sm">
                    <div className="col-span-4 font-medium text-slate-900">
                      {g.department ? g.department.toUpperCase() : '-'}
                    </div>
                    <div className="col-span-2 text-emerald-700">{money(g.totalReceived)}</div>
                    <div className="col-span-2">{g.paymentCount}</div>
                    <div className="col-span-2">{g.orders.length}</div>
                    <div className="col-span-2">{uniqueCustomers}</div>
                  </div>
                )
              })}
          </div>
        </div>

        <div className="mt-8 text-sm font-medium uppercase tracking-wider text-slate-700">
          Detalle de órdenes pagadas — {period}
        </div>

        <div className="mt-2 rounded-lg border border-slate-200 bg-white">
          <div className="grid grid-cols-12 gap-2 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">
            <div className="col-span-2">Orden</div>
            <div className="col-span-3">Cliente</div>
            <div className="col-span-2">Departamento</div>
            <div className="col-span-1">Total</div>
            <div className="col-span-1">Pagado</div>
            <div className="col-span-1">Saldo</div>
            <div className="col-span-1">Fecha pago</div>
            <div className="col-span-2">Detalle</div>
          </div>
          <div className="divide-y divide-slate-200">
            {groups
              .flatMap((g) =>
                g.orders.map((o) => ({
                  ...o,
                  departmentGroup: g.department,
                })),
              )
              .sort((a, b) => (b.paidAt ?? '0').localeCompare(a.paidAt ?? '0'))
              .map((o) => (
                <div key={o.number} className="grid grid-cols-12 gap-2 px-4 py-2 text-sm">
                  <div className="col-span-2 font-mono text-slate-900">{o.number}</div>
                  <div className="col-span-3 text-slate-900">{o.customerName}</div>
                  <div className="col-span-2 text-slate-600">{(o.customerDepartment || o.departmentGroup || '-').toUpperCase()}</div>
                  <div className="col-span-1 text-slate-600">{money(o.total)}</div>
                  <div className="col-span-1 font-medium text-emerald-700">{money(o.paidAmount)}</div>
                  <div className="col-span-1 text-slate-600">{money(o.remaining)}</div>
                  <div className="col-span-1 text-slate-600">{o.paidAt ? new Date(o.paidAt).toLocaleDateString('es-BO') : '-'}</div>
                  <div className="col-span-2 text-xs text-slate-500">
                    {o.remaining === 0 ? 'COMPLETO' : 'PARCIAL'}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
