import { io, type Socket } from 'socket.io-client'
import { getAccessToken } from './auth'
import { getApiBaseUrl } from './api'

// Use the same base URL as API calls.
// IMPORTANT: Socket.IO expects an HTTP(S) base URL even if it later upgrades to WebSocket.
// Passing ws:// can break polling-only mode.
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

  // Keep http(s) URL as-is.
  return baseUrl
}

let socket: Socket | null = null

export function connectSocket(): Socket | null {
  const token = getAccessToken()
  if (!token) return null

  if (!socket) {
    socket = io(getWebSocketUrl(), {
      autoConnect: false,
      auth: { token },
      // Allow websocket upgrade when possible (more reliable behind reverse proxies).
      // Keep polling as a fallback.
      transports: ['websocket', 'polling'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
    })

    socket.on('connect', () => {
      console.log('Socket connected:', true, 'id=', socket?.id)
    })
    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason)
    })
    socket.on('connect_error', (err) => {
      console.log('Socket connect_error:', err?.message ?? err)
    })
  }

  socket.auth = { token }
  if (!socket.connected) {
    console.log('Connecting socket...')
    socket.connect()
  }
  console.log('Socket connected:', socket.connected)
  return socket
}

export function disconnectSocket(): void {
  if (!socket) return
  socket.disconnect()
  socket = null
}
