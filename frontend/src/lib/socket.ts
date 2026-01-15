import { io, type Socket } from 'socket.io-client'
import { getAccessToken } from './auth'
import { getApiBaseUrl } from './api'

// Use the same base URL as API calls, but convert to WebSocket protocol
function getWebSocketUrl(): string {
  const apiUrl = getApiBaseUrl()
  // In production, backend is on port 6000 of the same domain
  const isProduction = !import.meta.env.DEV
  const baseUrl = isProduction ? apiUrl.replace(/:\d+$/, '') + ':6000' : apiUrl
  // Convert https:// to wss:// and http:// to ws://
  return baseUrl.replace(/^https?:\/\//, (match) => match === 'https://' ? 'wss://' : 'ws://')
}

let socket: Socket | null = null

export function connectSocket(): Socket | null {
  const token = getAccessToken()
  if (!token) return null

  if (!socket) {
    const isDev = import.meta.env.DEV
    socket = io(getWebSocketUrl(), {
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
