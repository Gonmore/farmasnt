import { createContext, useContext, useMemo, useState } from 'react'
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
  const [accessTokenState, setAccessTokenState] = useState<string | null>(() => getAccessToken())
  const [refreshTokenState, setRefreshTokenState] = useState<string | null>(() => getRefreshToken())

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
      },
      logout: () => {
        clearAccessToken()
        clearRefreshToken()
        setAccessTokenState(null)
        setRefreshTokenState(null)
      },
      refresh: async () => {
        const rt = getRefreshToken()
        if (!rt) throw new Error('Missing refresh token')
        const res = await apiRefresh(rt)
        setAccessToken(res.accessToken)
        setRefreshToken(res.refreshToken)
        setAccessTokenState(res.accessToken)
        setRefreshTokenState(res.refreshToken)
      },
    }
  }, [accessTokenState, refreshTokenState])

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
