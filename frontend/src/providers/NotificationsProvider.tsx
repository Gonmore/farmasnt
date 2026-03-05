import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { connectSocket, disconnectSocket } from '../lib/socket'
import { useAuth } from './AuthProvider'
import { playNotificationChime } from '../lib/sound'
import { usePermissions } from '../hooks/usePermissions'
import { apiFetch } from '../lib/api'

export type AppNotification = {
  id: string
  createdAt: string
  title: string
  body?: string
  kind: 'info' | 'success' | 'warning' | 'error'
  linkTo?: string
}

type NotificationsContextType = {
  notifications: AppNotification[]
  unreadCount: number
  toast: AppNotification | null
  dismissToast: () => void
  markAllRead: () => void
  clear: () => void
  notify: (n: Omit<AppNotification, 'id' | 'createdAt'>) => void
}

const NotificationsContext = createContext<NotificationsContextType | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const perms = usePermissions()
  const [serverNotifications, setServerNotifications] = useState<AppNotification[]>([])
  const [localNotifications, setLocalNotifications] = useState<AppNotification[]>([])
  const [lastReadAt, setLastReadAt] = useState<string | null>(null)
  const [toast, setToast] = useState<AppNotification | null>(null)

  const toastTimerRef = useRef<number | null>(null)
  const invalidateTimerRef = useRef<number | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const pushLocalRef = useRef<null | ((n: Omit<AppNotification, 'id' | 'createdAt'>) => void)>(null)

  const refreshFromServer = async () => {
    if (!auth.accessToken) return
    const data = await apiFetch<{
      lastReadAt: string
      items: Array<{ id: string; createdAt: string; title: string; body?: string | null; kind?: string | null; linkTo?: string | null }>
    }>(`/api/v1/notifications?take=50`, { token: auth.accessToken })

    const normalizeKind = (k: any): AppNotification['kind'] => {
      const v = typeof k === 'string' ? k : ''
      if (v === 'success' || v === 'warning' || v === 'error' || v === 'info') return v
      return 'info'
    }

    setLastReadAt(data?.lastReadAt ?? new Date().toISOString())
    setServerNotifications(
      (Array.isArray(data?.items) ? data.items : []).map((n) => ({
        id: String(n.id),
        createdAt: String(n.createdAt),
        title: String(n.title ?? ''),
        body: n.body ? String(n.body) : undefined,
        kind: normalizeKind(n.kind),
        linkTo: n.linkTo ? String(n.linkTo) : undefined,
      })),
    )
  }

  const scheduleRefresh = () => {
    if (refreshTimerRef.current) return
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      refreshFromServer().catch((e) => console.warn('notifications.refresh.failed', e))
    }, 250)
  }

  const showToast = (n: Omit<AppNotification, 'id' | 'createdAt'>) => {
    const now = new Date().toISOString()
    const full: AppNotification = {
      id: `toast-${now}-${Math.random().toString(16).slice(2)}`,
      createdAt: now,
      ...n,
    }
    setToast(full)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 10_000)
    playNotificationChime()
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      disconnectSocket()
      setServerNotifications((prev) => (prev.length > 0 ? [] : prev))
      setLocalNotifications((prev) => (prev.length > 0 ? [] : prev))
      setLastReadAt((prev) => (prev !== null ? null : prev))
      setToast((prev) => (prev !== null ? null : prev))
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      return
    }

    refreshFromServer().catch((e) => console.warn('notifications.initial_load.failed', e))

    const socket = connectSocket()
    if (!socket) return

    console.log('Setting up socket listeners')

    const pushLocal = (n: Omit<AppNotification, 'id' | 'createdAt'>) => {
      const now = new Date().toISOString()
      const full: AppNotification = {
        id: `local-${now}-${Math.random().toString(16).slice(2)}`,
        createdAt: now,
        ...n,
      }
      setLocalNotifications((prev) => [full, ...prev].slice(0, 25))
      showToast(n)
    }

    pushLocalRef.current = pushLocal

    const onOrderCreated = (payload: any) => {
      console.log('Notification: Order created', payload)
      showToast({ kind: 'info', title: '🧾 Pedido creado', body: payload?.number ? `Orden: ${payload.number}` : undefined })
      scheduleRefresh()
    }
    const onOrderConfirmed = (payload: any) => {
      console.log('Notification: Order confirmed', payload)
      showToast({ kind: 'success', title: '✅ Pedido confirmado', body: payload?.number ? `Orden: ${payload.number}` : undefined })
      scheduleRefresh()
    }
    const onOrderFulfilled = (payload: any) => {
      console.log('Notification: Order fulfilled', payload)
      showToast({ kind: 'success', title: '📦 Pedido entregado', body: payload?.number ? `Orden: ${payload.number}` : undefined })
      scheduleRefresh()
    }

    const onOrderDelivered = (payload: any) => {
      const orderNumber = payload?.number ? String(payload.number) : null
      const orderId = payload?.id ? String(payload.id) : null

      const isVentas = perms.roles.some((r) => r.code === 'VENTAS')
      const isLogistica = perms.roles.some((r) => r.code === 'LOGISTICA')

      // Seller-facing: congratulations
      if (isVentas && orderId) {
        showToast({
          kind: 'success',
          title: '🎉 Venta finalizada — ¡felicitaciones!',
          body: orderNumber ? `Orden: ${orderNumber}` : undefined,
          linkTo: `/sales/orders/${encodeURIComponent(orderId)}`,
        })
        scheduleRefresh()
        return
      }

      // Logistics/admin: delivery completed
      showToast({
        kind: 'success',
        title: isLogistica ? '✅ Entrega marcada como realizada' : '✅ Orden entregada',
        body: orderNumber ? `Orden: ${orderNumber}` : undefined,
        linkTo: orderId ? `/sales/orders/${encodeURIComponent(orderId)}` : '/sales/deliveries',
      })

      scheduleRefresh()
    }

    const onPaymentDue = (payload: any) => {
      console.log('Notification: Payment due', payload)
      const orderNumber = payload?.number ? String(payload.number) : null
      const orderId = payload?.id ? String(payload.id) : null
      const creditDays = typeof payload?.creditDays === 'number' ? payload.creditDays : Number(payload?.creditDays)
      const dueAt = payload?.dueAt ? String(payload.dueAt) : null

      const isVentas = perms.roles.some((r) => r.code === 'VENTAS')
      if (!isVentas) return

      const dueLabel = Number.isFinite(creditDays) && creditDays > 0 ? `Cobrar en ${creditDays} día(s)` : 'Cobrar ahora'
      const dueDateLabel = dueAt ? new Date(dueAt).toLocaleDateString() : null

      // Keep A/R list fresh
      queryClient.invalidateQueries({ queryKey: ['payments'] })

      showToast({
        kind: 'warning',
        title: `💳 ${dueLabel}`,
        body: [orderNumber ? `Orden: ${orderNumber}` : null, dueDateLabel ? `Fecha: ${dueDateLabel}` : null]
          .filter(Boolean)
          .join(' • '),
        linkTo: orderId ? `/sales/orders/${encodeURIComponent(orderId)}` : '/sales/payments',
      })

      scheduleRefresh()
    }

    const onOrderPaid = (payload: any) => {
      console.log('Notification: Order paid', payload)
      const orderNumber = payload?.number ? String(payload.number) : null
      const orderId = payload?.id ? String(payload.id) : null

      // Keep A/R list + orders fresh
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })

      showToast({
        kind: 'success',
        title: '✅ Orden cobrada',
        body: orderNumber ? `Orden: ${orderNumber}` : undefined,
        linkTo: orderId ? `/sales/orders/${encodeURIComponent(orderId)}` : '/sales/payments',
      })

      scheduleRefresh()
    }

    const onQuoteProcessed = (payload: any) => {
      console.log('Notification: Quote processed', payload)
      const quoteNumber = payload?.quoteNumber ? String(payload.quoteNumber) : null
      const orderNumber = payload?.orderNumber ? String(payload.orderNumber) : null
      const orderId = payload?.orderId ? String(payload.orderId) : null
      const customerName = payload?.customerName ? String(payload.customerName) : null
      const paymentMode = payload?.paymentMode ? String(payload.paymentMode) : null
      const deliveryDays = typeof payload?.deliveryDays === 'number' ? payload.deliveryDays : null
      const deliveryDate = payload?.deliveryDate ? String(payload.deliveryDate) : null

      const isVentas = perms.roles.some((r) => r.code === 'VENTAS')
      const isLogistica = perms.roles.some((r) => r.code === 'LOGISTICA')
      const city = payload?.city ? String(payload.city) : null

      const paymentLabel = paymentMode
        ? paymentMode.toUpperCase().includes('CREDIT')
          ? 'CRÉDITO'
          : paymentMode.toUpperCase().includes('CONT')
            ? 'CONTADO'
            : paymentMode
        : null

      const headerParts = [
        quoteNumber ? `COT ${quoteNumber}` : null,
        orderNumber ? `→ ORD ${orderNumber}` : null,
        customerName ? customerName : null,
      ].filter(Boolean)

      const extraParts = [
        paymentLabel ? `Pago: ${paymentLabel}` : null,
        typeof deliveryDays === 'number' ? `Entrega en ${deliveryDays} día(s)` : null,
        city ? `Ciudad: ${city}` : null,
        deliveryDate ? `Fecha: ${new Date(deliveryDate).toLocaleDateString()}` : null,
      ].filter(Boolean)

      const reservations = Array.isArray(payload?.reservations) ? payload.reservations : []
      const lines = reservations
        .map((r: any) => {
          const name = r?.productName ? String(r.productName) : null
          const sku = r?.productSku ? String(r.productSku) : null
          const batch = r?.batchNumber ? String(r.batchNumber) : null
          const qty = typeof r?.quantity === 'number' ? r.quantity : Number(r?.quantity)
          if (!name || !Number.isFinite(qty)) return null
          const left = sku ? `${name} (${sku})` : name
          const lot = batch ? `Lote ${batch}` : 'Sin lote'
          return `• ${left} — ${lot}: ${qty}`
        })
        .filter(Boolean)
        .slice(0, 6)

      const reservationsBlock = lines.length > 0 ? `Reservas:\n${lines.join('\n')}` : null

      showToast({
        kind: 'info',
        title: '🧾 Cotización procesada (reserva realizada)',
        body: [headerParts.join(' • '), extraParts.join(' • '), reservationsBlock].filter(Boolean).join('\n'),
        linkTo: orderId ? `/sales/orders/${encodeURIComponent(orderId)}` : undefined,
      })

      scheduleRefresh()

      // Extra requested notification: Logistics needs to know about upcoming delivery + payment terms
      if (isLogistica) {
        const parts = [
          orderNumber ? `Orden: ${orderNumber}` : null,
          customerName ? `Cliente: ${customerName}` : null,
          paymentLabel ? `Pago: ${paymentLabel}` : null,
          typeof deliveryDays === 'number' ? `Plazo: ${deliveryDays} día(s)` : null,
          deliveryDate ? `Fecha: ${new Date(deliveryDate).toLocaleDateString()}` : null,
        ].filter(Boolean)

        showToast({
          kind: 'warning',
          title: '🚚 Entrega pendiente (nueva venta)',
          body: parts.join(' • '),
          linkTo: '/sales/deliveries',
        })
      }

      // Seller-friendly: quick link to the created order
      if (isVentas && orderId) {
        showToast({
          kind: 'success',
          title: '✅ Venta generada',
          body: [orderNumber ? `Orden: ${orderNumber}` : null, customerName ? customerName : null]
            .filter(Boolean)
            .join(' • '),
          linkTo: `/sales/orders/${encodeURIComponent(orderId)}`,
        })
      }
    }

    const onQuoteStockRequested = (payload: any) => {
      const actorUserId = payload?.actorUserId ? String(payload.actorUserId) : null
      const meUserId = perms.user?.id ? String(perms.user.id) : null
      // The requester already gets a local bell notification from the UI action.
      // Ignore the socket echo to avoid duplicates.
      if (actorUserId && meUserId && actorUserId === meUserId) return

      const actorEmail = payload?.actorEmail ? String(payload.actorEmail) : 'Un usuario'
      const quoteNumber = payload?.quoteNumber ? String(payload.quoteNumber) : null
      const city = payload?.city ? String(payload.city) : null

      const items = Array.isArray(payload?.items) ? payload.items : []
      const lines = items
        .map((i: any) => {
          const name = i?.productName ? String(i.productName) : null
          const missing = typeof i?.missing === 'number' ? i.missing : Number(i?.missing)
          if (!name) return null
          const miss = Number.isFinite(missing) && missing > 0 ? `: ${missing}` : ''
          return `• ${name}${miss}`
        })
        .filter(Boolean)
        .slice(0, 8)

      const header = `${actorEmail} intentó procesar la ${quoteNumber ? `COT ${quoteNumber}` : 'cotización'}, pero faltan existencias${city ? ` en el almacén de ${city}` : ''}.`
      const body = lines.length > 0 ? `${header}\n\nFaltantes:\n${lines.join('\n')}` : header

      showToast({
        kind: 'warning',
        title: '📣 Solicitud de existencias',
        body,
        linkTo: '/stock/movements',
      })

      scheduleRefresh()
    }

    const onMovementRequestFulfilled = (payload: any) => {
      const city = payload?.requestedCity ? String(payload.requestedCity) : null
      showToast({
        kind: 'success',
        title: '✅ Solicitud de movimiento atendida',
        body: city ? `Destino: ${city}` : undefined,
        linkTo: '/stock/movements',
      })

      scheduleRefresh()

      // Keep movement-requests list fresh where used.
      queryClient.invalidateQueries({ queryKey: ['movementRequests'] })
    }

    const onStockBalanceChanged = () => {
      // Debounce invalidations to avoid refetch storms when many balances change.
      if (invalidateTimerRef.current) return
      invalidateTimerRef.current = window.setTimeout(() => {
        invalidateTimerRef.current = null
        queryClient.invalidateQueries({ queryKey: ['balances'] })
        queryClient.invalidateQueries({ queryKey: ['balancesExpanded'] })
        queryClient.invalidateQueries({ queryKey: ['warehouseStock'] })
      }, 500)
    }

    socket.on('sales.order.created', onOrderCreated)
    socket.on('sales.order.confirmed', onOrderConfirmed)
    socket.on('sales.order.fulfilled', onOrderFulfilled)
    socket.on('sales.order.delivered', onOrderDelivered)
    socket.on('sales.order.payment.due', onPaymentDue)
    socket.on('sales.order.paid', onOrderPaid)
    socket.on('sales.quote.processed', onQuoteProcessed)
    socket.on('sales.quote.stock_requested', onQuoteStockRequested)
    socket.on('stock.movement_request.fulfilled', onMovementRequestFulfilled)
    socket.on('stock.balance.changed', onStockBalanceChanged)

    return () => {
      socket.off('sales.order.created', onOrderCreated)
      socket.off('sales.order.confirmed', onOrderConfirmed)
      socket.off('sales.order.fulfilled', onOrderFulfilled)
      socket.off('sales.order.delivered', onOrderDelivered)
      socket.off('sales.order.payment.due', onPaymentDue)
      socket.off('sales.order.paid', onOrderPaid)
      socket.off('sales.quote.processed', onQuoteProcessed)
      socket.off('sales.quote.stock_requested', onQuoteStockRequested)
      socket.off('stock.movement_request.fulfilled', onMovementRequestFulfilled)
      socket.off('stock.balance.changed', onStockBalanceChanged)

      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      if (invalidateTimerRef.current) window.clearTimeout(invalidateTimerRef.current)
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)

      if (pushLocalRef.current) pushLocalRef.current = null
    }
  }, [auth.isAuthenticated, queryClient, perms.roles])

  const notifications = useMemo(() => {
    // Local (ephemeral) notifications first, then persisted server notifications.
    return [...localNotifications, ...serverNotifications].slice(0, 50)
  }, [localNotifications, serverNotifications])

  const unreadCount = useMemo(() => {
    if (!lastReadAt) return notifications.length
    const last = new Date(lastReadAt).getTime()
    return notifications.filter((n) => new Date(n.createdAt).getTime() > last).length
  }, [notifications, lastReadAt])

  const value: NotificationsContextType = {
    notifications,
    unreadCount,
    toast,
    dismissToast: () => setToast(null),
    markAllRead: () => {
      const fallback = new Date().toISOString()
      if (!auth.accessToken) {
        setLastReadAt(fallback)
        return
      }
      apiFetch<{ lastReadAt: string }>('/api/v1/notifications/mark-all-read', {
        token: auth.accessToken,
        method: 'POST',
      })
        .then((r) => setLastReadAt(r?.lastReadAt ?? fallback))
        .catch((e) => {
          console.warn('notifications.markAllRead.failed', e)
          setLastReadAt(fallback)
        })
    },
    clear: () => {
      setLocalNotifications([])
      setServerNotifications([])
      const now = new Date().toISOString()
      setLastReadAt(now)
      if (auth.accessToken) {
        apiFetch<{ lastReadAt: string }>('/api/v1/notifications/mark-all-read', {
          token: auth.accessToken,
          method: 'POST',
        })
          .then((r) => setLastReadAt(r?.lastReadAt ?? now))
          .catch((e) => console.warn('notifications.clear.markAllRead.failed', e))
      }
    },
    notify: (n) => {
      pushLocalRef.current?.(n)
    },
  }

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider')
  return ctx
}
