import React from 'react'
import { formatInteger, formatMoney } from '../../lib/numberFormat'
import { formatDateOnlyUtc } from '../../lib/date'
import { getProductLabel } from '../../lib/productName'

type MovementRequestDocumentItem = {
  id: string
  requestedQuantity: number
  remainingQuantity: number
  presentationId: string | null
  presentationName: string | null
  presentationQuantity: number | null
  unitsPerPresentation: number | null
  presentation?: { id: string; name: string; unitsPerPresentation: number } | null
  productSku: string | null
  productName: string | null
  genericName: string | null
}

type MovementRequestDocumentMovement = {
  id: string
  type: string
  quantity: number
  presentationQuantity: number | null
  productId: string
  productSku: string | null
  productName: string | null
  genericName: string | null
  presentation?: { id: string; name: string; unitsPerPresentation: number } | null
  batch?: { batchNumber: string; expiresAt: string | null } | null
  createdAt: string
  createdByName?: string | null
  pendingQuantity?: number | null
}

type MovementRequestDocument = {
  code: string
  status: string
  requestedByName: string | null
  requestedCity: string
  note?: string | null
  createdAt: string
  fulfilledAt?: string | null
  fulfilledByName?: string | null
  confirmedByName?: string | null
  originWarehouse?: { code: string | null; name: string | null; city: string | null } | null
  toLocation?: { code: string | null; warehouse?: { code: string | null; name: string | null; city: string | null } | null } | null
  items: MovementRequestDocumentItem[]
  movements?: MovementRequestDocumentMovement[]
}

type Props = {
  request: MovementRequestDocument
  companyName: string
  logoUrl?: string
  from?: string
  to?: string
}

function formatQty(v: number): string {
  if (!Number.isFinite(v)) return '0'
  const rounded = Math.round(v)
  if (Math.abs(v - rounded) <= 1e-9) return String(rounded)
  return String(Number(v.toFixed(2)))
}

function statusLabel(status: string): string {
  if (status === 'OPEN') return 'PENDIENTE'
  if (status === 'SENT') return 'ENVIADA'
  if (status === 'FULFILLED') return 'RECEPCIONADA'
  if (status === 'CANCELLED') return 'CANCELADA'
  return status
}

function statusBadge(status: string): string {
  if (status === 'FULFILLED') return 'bg-emerald-100 text-emerald-800'
  if (status === 'SENT') return 'bg-blue-100 text-blue-800'
  if (status === 'OPEN') return 'bg-amber-100 text-amber-800'
  if (status === 'CANCELLED') return 'bg-rose-100 text-rose-800'
  return 'bg-slate-100 text-slate-800'
}

function presentacionLabel(it: MovementRequestDocumentItem): string {
  const presName = it.presentation?.name ?? it.presentationName ?? ''
  if (!presName) return '-'
  const presQty = Number(it.presentationQuantity ?? 0)
  const unitsPer = Number(it.presentation?.unitsPerPresentation ?? it.unitsPerPresentation ?? 1)
  if (Number.isFinite(presQty) && presQty > 0) {
    return `${formatQty(presQty)} ${presName}${Number.isFinite(unitsPer) && unitsPer > 0 ? ` (${formatQty(unitsPer)}u)` : ''}`
  }
  return presName
}

function destinoLabel(r: MovementRequestDocument): string {
  const wh = r.toLocation?.warehouse
  const whCode = wh?.code
  const locCode = r.toLocation?.code
  if (whCode && locCode) return `${whCode}:${locCode}`
  if (whCode) return whCode
  if (wh?.name) return wh.name
  if (wh?.city) return wh.city.toUpperCase()
  return r.requestedCity ? r.requestedCity.toUpperCase() : '-'
}

function origenLabel(r: MovementRequestDocument): string {
  const wh = r.originWarehouse
  if (wh?.code) return wh.code
  if (wh?.name) return wh.name
  return '-'
}

export function MovementRequestDocument({ request, companyName, logoUrl, from, to }: Props) {
  const itemCount = request.items.length
  const totalRequested = request.items.reduce((sum, it) => sum + Number(it.requestedQuantity ?? 0), 0)
  const totalRemaining = request.items.reduce((sum, it) => sum + Number(it.remainingQuantity ?? 0), 0)
  const totalShipped = request.items.reduce((sum, it) => {
    const rq = Number(it.requestedQuantity ?? 0)
    const rem = Number(it.remainingQuantity ?? 0)
    return sum + Math.max(0, rq - rem)
  }, 0)

  const hasOutMovements = (request.movements ?? []).some((m) => m.type === 'OUT')
  const outMovements = (request.movements ?? []).filter((m) => m.type === 'OUT')

  return (
    <div className="relative mx-auto w-[1200px] bg-white px-10 py-8 text-slate-900">
      {logoUrl && (
        <div className="absolute left-10 top-6 h-16 w-16 rounded bg-slate-100" style={{ backgroundImage: `url(${logoUrl})`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
          {!logoUrl && <span className="text-xs">Logo</span>}
        </div>
      )}

      <div
        className="absolute inset-0 flex items-center justify-center opacity-5"
        style={{ transform: 'rotate(-25deg)', fontSize: '120px', fontWeight: 800, letterSpacing: '0.3em' }}
      >
        {request.code || '—'}
      </div>

      <div className="relative mb-6 flex items-end justify-between">
        <div className="pt-16">
          <div className="text-2xl font-bold tracking-tight text-slate-900">{companyName || 'Empresa'}</div>
          <div className="mt-1 text-sm text-slate-600">Detalle de solicitud de movimiento de stock</div>
        </div>
        <div className="text-right">
          {from && to && <div className="text-sm text-slate-600">Periodo: {from} a {to}</div>}
          <div className="mt-1 text-sm text-slate-600">Generado: {new Date().toLocaleString('es-BO')}</div>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="mb-3 text-xl font-bold">Solicitud {request.code || '—'}</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <span className="font-semibold text-slate-600">Estado:</span>
            <span className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge(request.status)}`}>{statusLabel(request.status)}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Solicitado por:</span>
            <span className="ml-2 text-slate-900">{request.requestedByName ?? '-'}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Origen:</span>
            <span className="ml-2 font-mono text-slate-900">{origenLabel(request)}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Destino:</span>
            <span className="ml-2 font-mono text-slate-900">{destinoLabel(request)}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Ciudad:</span>
            <span className="ml-2 text-slate-900">{request.requestedCity ? request.requestedCity.toUpperCase() : '-'}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Creado:</span>
            <span className="ml-2 text-slate-900">{new Date(request.createdAt).toLocaleString()}</span>
          </div>
          {request.fulfilledAt && (
            <div>
              <span className="font-semibold text-slate-600">Atendido:</span>
              <span className="ml-2 text-slate-900">{new Date(request.fulfilledAt).toLocaleString()}</span>
            </div>
          )}
          {request.fulfilledByName && request.fulfilledAt && (
            <div>
              <span className="font-semibold text-slate-600">Atendido por:</span>
              <span className="ml-2 text-slate-900">{request.fulfilledByName}</span>
            </div>
          )}
          {request.note && (
            <div className="col-span-2">
              <span className="font-semibold text-slate-600">Nota:</span>
              <span className="ml-2 text-slate-900">{request.note}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-700">
        Resumen ({itemCount} {itemCount === 1 ? 'producto' : 'productos'})
      </div>

      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Productos solicitados</div>
          <div className="mt-2 text-3xl font-bold text-blue-700">{formatInteger(itemCount)}</div>
          <div className="mt-1 text-sm text-slate-600">Líneas de productos</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unidades solicitadas</div>
          <div className="mt-2 text-3xl font-bold text-emerald-700">{formatInteger(totalRequested)}</div>
          <div className="mt-1 text-sm text-slate-600">Total unidades</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unidades enviadas</div>
          <div className="mt-2 text-3xl font-bold text-blue-700">{formatInteger(totalShipped)}</div>
          <div className="mt-1 text-sm text-slate-600">De la cantidad solicitada</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unidades pendientes</div>
          <div className="mt-2 text-3xl font-bold text-amber-700">{formatInteger(Math.max(0, totalRemaining))}</div>
          <div className="mt-1 text-sm text-slate-600">Por atender</div>
        </div>
      </div>

      <div className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-700">
        Detalle de productos ({itemCount} {itemCount === 1 ? 'producto solicitado' : 'productos solicitados'})
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-12 gap-2 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">
          <div className="col-span-4">Producto / Presentación</div>
          <div className="col-span-2">Solicitado</div>
          <div className="col-span-2">Pendiente</div>
          <div className="col-span-2">Precio</div>
          <div className="col-span-2">Unidad</div>
        </div>
        <div className="divide-y divide-slate-200">
          {request.items.map((it) => {
            const requestedUnits = Number(it.requestedQuantity ?? 0)
            const remainingUnits = Number(it.remainingQuantity ?? 0)
            const unitsPerPresentation = Number(it.presentation?.unitsPerPresentation ?? it.unitsPerPresentation ?? 0)
            const presQty = Number(it.presentationQuantity ?? 0)

            const requestedPres =
              it.presentationQuantity != null && Number.isFinite(presQty) && presQty > 0
                ? presQty
                : unitsPerPresentation > 0
                  ? requestedUnits / unitsPerPresentation
                  : requestedUnits

            const remainingPres =
              unitsPerPresentation > 0 ? remainingUnits / unitsPerPresentation : remainingUnits

            const presName = it.presentation?.name ?? it.presentationName ?? '-'
            const label = getProductLabel({ sku: it.productSku, name: it.productName, genericName: it.genericName } as any) || String(it.productId)

            return (
              <div key={it.id} className="grid grid-cols-12 gap-2 px-4 py-2 text-sm">
                <div className="col-span-4">
                  <div className="font-medium text-slate-900">{label}</div>
                  <div className="text-xs text-slate-600">{presName !== '-' ? presentacionLabel(it) : '-'}</div>
                  {it.productSku && <div className="text-xs text-slate-500 font-mono">SKU: {it.productSku}</div>}
                </div>
                <div className="col-span-2">
                  {unitsPerPresentation > 0
                    ? `${formatQty(requestedPres)} (${formatInteger(requestedUnits)}u)`
                    : formatInteger(requestedUnits)}
                </div>
                <div className="col-span-2">
                  {Math.max(0, remainingUnits) > 0
                    ? (unitsPerPresentation > 0
                        ? `${formatQty(Math.max(0, remainingPres))} (${formatInteger(Math.max(0, remainingUnits))}u)`
                        : formatInteger(Math.max(0, remainingUnits)))
                    : '0'}
                </div>
                <div className="col-span-2 text-slate-600">-</div>
                <div className="col-span-2 text-slate-600">
                  {it.productSku ?? '-'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {hasOutMovements && outMovements.length > 0 && (
        <>
          <div className="mb-4 mt-6 text-sm font-medium uppercase tracking-wider text-slate-700">
            Movimientos de envío ({outMovements.length})
          </div>
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="grid grid-cols-12 gap-2 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">
              <div className="col-span-4">Producto / Lote</div>
              <div className="col-span-2">Enviado</div>
              <div className="col-span-2">Vencimiento</div>
              <div className="col-span-2">Fecha</div>
              <div className="col-span-2">Por</div>
            </div>
            <div className="divide-y divide-slate-200">
              {outMovements.map((m) => {
                const unitsPerMov = Number(m.presentation?.unitsPerPresentation ?? 0)
                const qtyPres =
                  m.presentationQuantity != null && Number.isFinite(Number(m.presentationQuantity))
                    ? Number(m.presentationQuantity)
                    : unitsPerMov > 0
                      ? Number(m.quantity ?? 0) / unitsPerMov
                      : Number(m.quantity ?? 0)

                const movLabel =
                  getProductLabel({
                    sku: m.productSku,
                    name: m.productName,
                    genericName: m.genericName,
                  } as any) || String(m.productId)

                return (
                  <div key={m.id} className="grid grid-cols-12 gap-2 px-4 py-2 text-sm">
                    <div className="col-span-4">
                      <div className="font-medium text-slate-900">{movLabel}</div>
                      {m.batch?.batchNumber && (
                        <div className="text-xs text-slate-500 font-mono">Lote: {m.batch.batchNumber}</div>
                      )}
                    </div>
                    <div className="col-span-2">
                      {unitsPerMov > 0
                        ? `${formatQty(qtyPres)} (${formatInteger(Number(m.quantity ?? 0))}u)`
                        : formatInteger(Number(m.quantity ?? 0))}
                    </div>
                    <div className="col-span-2 text-slate-600">
                      {m.batch?.expiresAt ? formatDateOnlyUtc(m.batch.expiresAt) : '-'}
                    </div>
                    <div className="col-span-2 text-slate-600">{m.createdAt ? new Date(m.createdAt).toLocaleString() : '-'}</div>
                    <div className="col-span-2 text-slate-600">{m.createdByName ?? '-'}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {request.requestedByName && (
        <div className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
          Solicitud elaborada por: {request.requestedByName}
        </div>
      )}
    </div>
  )
}
