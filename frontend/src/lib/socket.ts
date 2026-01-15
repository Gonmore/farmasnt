import { io, type Socket } from 'socket.io-client'
import { getAccessToken } from './auth'
import { getApiBaseUrl } from './api'

// Use the same base URL as API calls, but convert to WebSocket protocol
function getWebSocketUrl(): string {
  const apiUrl = getApiBaseUrl()
  // In production with configured API URL, use relative URLs for proxy redirection
  const isProduction = !import.meta.env.DEV
  const hasConfiguredApiUrl = (import.meta.env.VITE_API_BASE_URL as string)?.trim()
  const baseUrl = (isProduction && hasConfiguredApiUrl) ? '' : apiUrl

  if (baseUrl === '') {
    // Use relative URL - Socket.IO will connect to same origin
    return ''
  }

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
        : {
            // In production, use polling to avoid unsafe port issues
            transports: ['polling'],
            upgrade: false,
          }),
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
