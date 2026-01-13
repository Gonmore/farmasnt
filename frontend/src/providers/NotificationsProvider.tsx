import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { connectSocket, disconnectSocket } from '../lib/socket'
import { useAuth } from './AuthProvider'

export type AppNotification = {
  id: string
  createdAt: string
  title: string
  body?: string
  kind: 'info' | 'success' | 'warning' | 'error'
}

type NotificationsContextType = {
  notifications: AppNotification[]
  unreadCount: number
  markAllRead: () => void
  clear: () => void
}

const NotificationsContext = createContext<NotificationsContextType | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [lastReadAt, setLastReadAt] = useState<string | null>(null)

  useEffect(() => {
    if (!auth.isAuthenticated) {
      disconnectSocket()
      setNotifications([])
      setLastReadAt(null)
      return
    }

    const socket = connectSocket()
    if (!socket) return

    const push = (n: Omit<AppNotification, 'id' | 'createdAt'>) => {
      const now = new Date().toISOString()
      setNotifications((prev) => [
        {
          id: `${now}-${Math.random().toString(16).slice(2)}`,
          createdAt: now,
          ...n,
        },
        ...prev,
      ].slice(0, 30))
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

    socket.on('sales.order.created', onOrderCreated)
    socket.on('sales.order.confirmed', onOrderConfirmed)
    socket.on('sales.order.fulfilled', onOrderFulfilled)

    return () => {
      socket.off('sales.order.created', onOrderCreated)
      socket.off('sales.order.confirmed', onOrderConfirmed)
      socket.off('sales.order.fulfilled', onOrderFulfilled)
    }
  }, [auth.isAuthenticated])

  const unreadCount = useMemo(() => {
    if (!lastReadAt) return notifications.length
    const last = new Date(lastReadAt).getTime()
    return notifications.filter((n) => new Date(n.createdAt).getTime() > last).length
  }, [notifications, lastReadAt])

  const value: NotificationsContextType = {
    notifications,
    unreadCount,
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
