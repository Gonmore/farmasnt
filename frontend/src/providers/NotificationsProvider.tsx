import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { connectSocket, disconnectSocket } from '../lib/socket'
import { useAuth } from './AuthProvider'
import { playNotificationChime } from '../lib/sound'
import { usePermissions } from '../hooks/usePermissions'

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
}

const NotificationsContext = createContext<NotificationsContextType | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const perms = usePermissions()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [lastReadAt, setLastReadAt] = useState<string | null>(null)
  const [toast, setToast] = useState<AppNotification | null>(null)

  const toastTimerRef = useRef<number | null>(null)
  const invalidateTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!auth.isAuthenticated) {
      disconnectSocket()
      setNotifications([])
      setLastReadAt(null)
      setToast(null)
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      return
    }

    const socket = connectSocket()
    if (!socket) return

    const push = (n: Omit<AppNotification, 'id' | 'createdAt'>) => {
      const now = new Date().toISOString()
      const full: AppNotification = {
        id: `${now}-${Math.random().toString(16).slice(2)}`,
        createdAt: now,
        ...n,
      }

      setNotifications((prev) => [full, ...prev].slice(0, 50))

      // Toast under bell for 10 seconds (does not mark as read)
      setToast(full)
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = window.setTimeout(() => setToast(null), 10_000)

      // Sound
      playNotificationChime()
    }

    const onOrderCreated = (payload: any) => {
      push({ kind: 'info', title: '🧾 Pedido creado', body: payload?.number ? `Orden: ${payload.number}` : undefined })
    }
    const onOrderConfirmed = (payload: any) => {
      push({ kind: 'success', title: '✅ Pedido confirmado', body: payload?.number ? `Orden: ${payload.number}` : undefined })
    }
    const onOrderFulfilled = (payload: any) => {
      push({ kind: 'success', title: '📦 Pedido entregado', body: payload?.number ? `Orden: ${payload.number}` : undefined })
    }

    const onOrderDelivered = (payload: any) => {
      const orderNumber = payload?.number ? String(payload.number) : null
      const orderId = payload?.id ? String(payload.id) : null

      const isVentas = perms.roles.some((r) => r.code === 'VENTAS')
      const isLogistica = perms.roles.some((r) => r.code === 'LOGISTICA')

      // Seller-facing: congratulations
      if (isVentas && orderId) {
        push({
          kind: 'success',
          title: '🎉 Venta finalizada — ¡felicitaciones!',
          body: orderNumber ? `Orden: ${orderNumber}` : undefined,
          linkTo: `/sales/orders/${encodeURIComponent(orderId)}`,
        })
        return
      }

      // Logistics/admin: delivery completed
      push({
        kind: 'success',
        title: isLogistica ? '✅ Entrega marcada como realizada' : '✅ Orden entregada',
        body: orderNumber ? `Orden: ${orderNumber}` : undefined,
        linkTo: orderId ? `/sales/orders/${encodeURIComponent(orderId)}` : '/sales/deliveries',
      })
    }

    const onQuoteProcessed = (payload: any) => {
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

      push({
        kind: 'info',
        title: '🧾 Cotización procesada (reserva realizada)',
        body: [headerParts.join(' • '), extraParts.join(' • '), reservationsBlock].filter(Boolean).join('\n'),
        linkTo: orderId ? `/sales/orders/${encodeURIComponent(orderId)}` : undefined,
      })

      // Extra requested notification: Logistics needs to know about upcoming delivery + payment terms
      if (isLogistica) {
        const parts = [
          orderNumber ? `Orden: ${orderNumber}` : null,
          customerName ? `Cliente: ${customerName}` : null,
          paymentLabel ? `Pago: ${paymentLabel}` : null,
          typeof deliveryDays === 'number' ? `Plazo: ${deliveryDays} día(s)` : null,
          deliveryDate ? `Fecha: ${new Date(deliveryDate).toLocaleDateString()}` : null,
        ].filter(Boolean)

        push({
          kind: 'warning',
          title: '🚚 Entrega pendiente (nueva venta)',
          body: parts.join(' • '),
          linkTo: '/sales/deliveries',
        })
      }

      // Seller-friendly: quick link to the created order
      if (isVentas && orderId) {
        push({
          kind: 'success',
          title: '✅ Venta generada',
          body: [orderNumber ? `Orden: ${orderNumber}` : null, customerName ? customerName : null]
            .filter(Boolean)
            .join(' • '),
          linkTo: `/sales/orders/${encodeURIComponent(orderId)}`,
        })
      }
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
    socket.on('sales.quote.processed', onQuoteProcessed)
    socket.on('stock.balance.changed', onStockBalanceChanged)

    return () => {
      socket.off('sales.order.created', onOrderCreated)
      socket.off('sales.order.confirmed', onOrderConfirmed)
      socket.off('sales.order.fulfilled', onOrderFulfilled)
      socket.off('sales.order.delivered', onOrderDelivered)
      socket.off('sales.quote.processed', onQuoteProcessed)
      socket.off('stock.balance.changed', onStockBalanceChanged)

      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      if (invalidateTimerRef.current) window.clearTimeout(invalidateTimerRef.current)
    }
  }, [auth.isAuthenticated, queryClient, perms.roles])

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
    markAllRead: () => setLastReadAt(new Date().toISOString()),
    clear: () => {
      setNotifications([])
      setLastReadAt(new Date().toISOString())
    },
  }

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider')
  return ctx
}
