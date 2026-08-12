import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../providers/AuthProvider'
import { usePermissions } from '../hooks'

export type QuickActionBadgeDetail = {
  label: string
  count: number
}

export type QuickActionBadgeInfo = {
  count: number
  tone?: 'warning' | 'info' | 'success'
  ariaLabel?: string
  hoverTitle?: string
  details?: QuickActionBadgeDetail[]
}

type MovementRequestsByCityItem = {
  city: string | null
  total: number
  open: number
  fulfilled: number
  cancelled: number
  pending: number
  accepted: number
  rejected: number
}

type PendingReceptionRequest = {
  id: string
  movements?: Array<{
    pendingQuantity?: number | null
  }>
}

async function fetchMovementRequestsByCity(token: string): Promise<{ items: MovementRequestsByCityItem[] }> {
  const params = new URLSearchParams({ take: '100' })
  return apiFetch(`/api/v1/reports/stock/movement-requests/by-city?${params.toString()}`, { token })
}

async function listPendingReceptionRequests(token: string, warehouseId?: string): Promise<{ items: PendingReceptionRequest[] }> {
  const fetchByStatus = async (status: 'SENT' | 'OPEN') => {
    const params = new URLSearchParams({ take: '100', status })
    if (warehouseId) params.set('warehouseId', warehouseId)
    return apiFetch<{ items: PendingReceptionRequest[] }>(`/api/v1/stock/movement-requests?${params.toString()}`, { token })
  }

  const [sent, open] = await Promise.all([fetchByStatus('SENT'), fetchByStatus('OPEN')])

  const hasPendingShipment = (request: PendingReceptionRequest) => {
    const movements = Array.isArray(request.movements) ? request.movements : []
    const pending = movements.reduce((sum, movement) => sum + Number(movement.pendingQuantity ?? 0), 0)
    return pending > 0
  }

  const dedup = new Map<string, PendingReceptionRequest>()
  for (const request of [...(sent.items ?? []).filter(hasPendingShipment), ...(open.items ?? []).filter(hasPendingShipment)]) {
    dedup.set(String(request.id), request)
  }

  return { items: Array.from(dedup.values()) }
}

function formatBadgeCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count > 99) return '99+'
  return String(Math.round(count))
}

function badgeToneClasses(tone: QuickActionBadgeInfo['tone']): string {
  switch (tone) {
    case 'info':
      return 'bg-sky-600 text-white ring-sky-200 dark:bg-sky-500 dark:ring-sky-900/60'
    case 'success':
      return 'bg-emerald-600 text-white ring-emerald-200 dark:bg-emerald-500 dark:ring-emerald-900/60'
    case 'warning':
    default:
      return 'bg-amber-500 text-slate-950 ring-amber-200 dark:bg-amber-400 dark:text-slate-950 dark:ring-amber-900/60'
  }
}

function QuickActionCard(props: { to: string; title: string; subtitle: string; icon: string; isActive?: boolean; badge?: QuickActionBadgeInfo }) {
  return (
    <Link
      to={props.to}
      className={`group relative rounded-lg border p-4 pb-8 transition ${
        props.isActive
          ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
          : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-600 dark:hover:bg-slate-800'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl">{props.icon}</div>
        <div className="min-w-0">
          <div className={`font-semibold transition ${
            props.isActive
              ? 'text-blue-900 dark:text-blue-200'
              : 'text-slate-900 group-hover:text-blue-900 dark:text-slate-100 dark:group-hover:text-blue-200'
          }`}>
            {props.title}
          </div>
          <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{props.subtitle}</div>
        </div>
      </div>

      {props.badge && props.badge.count > 0 && (
        <div className="group/badge absolute bottom-2 left-2 z-10">
          <div
            className={`flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-extrabold shadow-sm ring-2 ${badgeToneClasses(props.badge.tone)}`}
            aria-label={props.badge.ariaLabel ?? `${props.badge.count} pendientes`}
            title={props.badge.ariaLabel ?? `${props.badge.count} pendientes`}
          >
            {formatBadgeCount(props.badge.count)}
          </div>

          {props.badge.details && props.badge.details.length > 0 && (
            <div className="pointer-events-none absolute bottom-full left-0 mb-2 min-w-48 rounded-md bg-slate-950 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/badge:opacity-100 dark:bg-slate-100 dark:text-slate-950">
              {props.badge.hoverTitle && <div className="mb-1 font-semibold">{props.badge.hoverTitle}</div>}
              <div className="space-y-1">
                {props.badge.details.map((detail) => (
                  <div key={detail.label} className="flex items-center justify-between gap-3 whitespace-nowrap">
                    <span>{detail.label}</span>
                    <span className="font-semibold">{detail.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Link>
  )
}

export function MovementQuickActions({ currentPath, badges }: { currentPath: string; badges?: Record<string, QuickActionBadgeInfo | undefined> }) {
  const auth = useAuth()
  const permissions = usePermissions()
  const branchWarehouseId = permissions.hasPermission('scope:branch') && !permissions.isTenantAdmin ? permissions.user?.warehouseId ?? undefined : undefined

  const movementRequestsByCityQuery = useQuery({
    queryKey: ['movementRequestsByCity', 'quickActions'],
    queryFn: () => fetchMovementRequestsByCity(auth.accessToken!),
    enabled: !!auth.accessToken,
    refetchInterval: 15_000,
  })

  const pendingReceptionRequestsQuery = useQuery({
    queryKey: ['pendingReceptionRequests', 'quickActions', branchWarehouseId],
    queryFn: () => listPendingReceptionRequests(auth.accessToken!, branchWarehouseId),
    enabled: !!auth.accessToken,
    refetchInterval: 15_000,
  })

  const internalBadges = useMemo<Record<string, QuickActionBadgeInfo | undefined>>(() => {
    const nextBadges: Record<string, QuickActionBadgeInfo | undefined> = {}

    const openByCity = (movementRequestsByCityQuery.data?.items ?? [])
      .filter((item) => Number(item.open ?? 0) > 0)
      .sort((a, b) => Number(b.open ?? 0) - Number(a.open ?? 0))

    const openTotal = openByCity.reduce((sum, item) => sum + Number(item.open ?? 0), 0)
    if (openTotal > 0) {
      nextBadges['/stock/fulfill-requests'] = {
        count: openTotal,
        tone: 'warning',
        ariaLabel: `${openTotal} solicitudes pendientes de atención`,
        hoverTitle: 'Pendientes por sucursal',
        details: openByCity.map((item) => ({
          label: String(item.city ?? '').trim() || 'Sin ciudad',
          count: Number(item.open ?? 0),
        })),
      }
    }

    const pendingReceptionCount = pendingReceptionRequestsQuery.data?.items.length ?? 0
    if (pendingReceptionCount > 0) {
      nextBadges['/stock/returns'] = {
        count: pendingReceptionCount,
        tone: 'info',
        ariaLabel: `${pendingReceptionCount} envíos pendientes de recepción o devolución`,
      }
    }

    return nextBadges
  }, [movementRequestsByCityQuery.data?.items, pendingReceptionRequestsQuery.data?.items])

  const resolvedBadges = useMemo(
    () => ({ ...internalBadges, ...(badges ?? {}) }),
    [badges, internalBadges],
  )

  return (
    <div className="mb-6">
      <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Accesos rápidos</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <QuickActionCard
          to="/stock/movements"
          icon="🚚"
          title="Movimientos"
          subtitle="Entradas, transferencias, bajas, ajustes"
          isActive={currentPath === '/stock/movements'}
          badge={resolvedBadges['/stock/movements']}
        />
        <QuickActionCard
          to="/stock/bulk-transfer"
          icon="📦"
          title="Transferencia masiva"
          subtitle="Mover múltiples líneas en una operación"
          isActive={currentPath === '/stock/bulk-transfer'}
          badge={resolvedBadges['/stock/bulk-transfer']}
        />
        <QuickActionCard
          to="/stock/fulfill-requests"
          icon="✅"
          title="Atender solicitudes"
          subtitle="Enviar stock a solicitudes OPEN"
          isActive={currentPath === '/stock/fulfill-requests'}
          badge={resolvedBadges['/stock/fulfill-requests']}
        />
        <QuickActionCard
          to="/stock/completed-movements"
          icon="📋"
          title="Realizados"
          subtitle="Historial con PDFs de picking y rótulos"
          isActive={currentPath === '/stock/completed-movements'}
          badge={resolvedBadges['/stock/completed-movements']}
        />
        <QuickActionCard
          to="/stock/returns"
          icon="↩️"
          title="Recepción/Devolución"
          subtitle="Recepción de envíos y devoluciones con evidencia"
          isActive={currentPath === '/stock/returns'}
          badge={resolvedBadges['/stock/returns']}
        />
      </div>
    </div>
  )
}