import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  clearAccessToken,
  clearRefreshToken,
  getAccessToken,
  getRefreshToken,
  login as apiLogin,
  refresh as apiRefresh,
  setAccessToken,
  setRefreshToken,
} from '../lib/auth'

export type AuthContextValue = {
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider(props: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [accessTokenState, setAccessTokenState] = useState<string | null>(() => getAccessToken())
  const [refreshTokenState, setRefreshTokenState] = useState<string | null>(() => getRefreshToken())

  useEffect(() => {
    const handleLogout = () => {
      clearAccessToken()
      clearRefreshToken()
      setAccessTokenState(null)
      setRefreshTokenState(null)
      queryClient.clear()
    }

    const handleTokens = () => {
      // Refresh flow in lib/api.ts updates localStorage and emits this event.
      setAccessTokenState(getAccessToken())
      setRefreshTokenState(getRefreshToken())
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'pf.accessToken' || e.key === 'pf.refreshToken') {
        // Keep state in sync with storage changes from other tabs/windows.
        setAccessTokenState(getAccessToken())
        setRefreshTokenState(getRefreshToken())
      }
    }

    window.addEventListener('pf:auth:logout', handleLogout)
    window.addEventListener('pf:auth:tokens', handleTokens)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('pf:auth:logout', handleLogout)
      window.removeEventListener('pf:auth:tokens', handleTokens)
      window.removeEventListener('storage', handleStorage)
    }
  }, [queryClient])

  useEffect(() => {
    // Track user activity for inactivity-based session expiry behavior.
    const KEY = 'pf.lastActivityAt'
    let lastWrite = 0
    const write = () => {
      const now = Date.now()
      // Throttle to avoid spamming localStorage.
      if (now - lastWrite < 30_000) return
      lastWrite = now
      try {
        localStorage.setItem(KEY, String(now))
      } catch {
        // ignore
      }
    }

    write()
    const events: Array<keyof WindowEventMap> = ['mousedown', 'keydown', 'touchstart', 'scroll']
    for (const ev of events) window.addEventListener(ev, write, { passive: true })
    const onVisibility = () => {
      if (document.visibilityState === 'visible') write()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      for (const ev of events) window.removeEventListener(ev, write)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    return {
      accessToken: accessTokenState,
      refreshToken: refreshTokenState,
      isAuthenticated: Boolean(accessTokenState),
      login: async (email: string, password: string) => {
        const res = await apiLogin(email, password)
        setAccessToken(res.accessToken)
        setRefreshToken(res.refreshToken)
        setAccessTokenState(res.accessToken)
        setRefreshTokenState(res.refreshToken)
        // Invalidar queries de autenticación y permisos para forzar refetch
        queryClient.invalidateQueries({ queryKey: ['auth'] })
        queryClient.invalidateQueries({ queryKey: ['tenant'] })
      },
      logout: () => {
        clearAccessToken()
        clearRefreshToken()
        setAccessTokenState(null)
        setRefreshTokenState(null)
        // Limpiar todas las queries al hacer logout
        queryClient.clear()
      },
      refresh: async () => {
        const rt = getRefreshToken()
        if (!rt) throw new Error('Missing refresh token')
        const res = await apiRefresh(rt)
        setAccessToken(res.accessToken)
        setRefreshToken(res.refreshToken)
        setAccessTokenState(res.accessToken)
        setRefreshTokenState(res.refreshToken)
        // Invalidar queries después de refresh
        queryClient.invalidateQueries({ queryKey: ['auth'] })
        queryClient.invalidateQueries({ queryKey: ['tenant'] })
      },
    }
  }, [accessTokenState, refreshTokenState, queryClient])

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

