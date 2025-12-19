import { io, type Socket } from 'socket.io-client'
import { getAccessToken } from './auth'

// Default to 127.0.0.1 to avoid Windows localhost resolving to IPv6 (::1)
// while backend is bound on IPv4.
const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://127.0.0.1:6000'

let socket: Socket | null = null

export function connectSocket(): Socket | null {
  const token = getAccessToken()
  if (!token) return null

  if (!socket) {
    const isDev = import.meta.env.DEV
    socket = io(WS_URL, {
      autoConnect: false,
      auth: { token },
      ...(isDev
        ? {
            // When Vite proxies /socket.io, websocket upgrade can be noisy on Windows.
            // Polling-only still works and avoids ws proxy ECONNRESET spam.
            transports: ['polling'],
            upgrade: false,
          }
        : {}),
    })
  }

  socket.auth = { token }
  if (!socket.connected) socket.connect()
  return socket
}

export function disconnectSocket(): void {
  if (!socket) return
  socket.disconnect()
  socket = null
}
