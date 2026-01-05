import { createContext, useContext, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './AuthProvider'
import { apiFetch } from '../lib/api'

// Helper para ajustar brillo de colores hex
function adjustBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + percent))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + percent))
  const b = Math.max(0, Math.min(255, (num & 0xff) + percent))
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

export type TenantBranding = {
  tenantId: string
  tenantName: string
  logoUrl: string | null
  brandPrimary: string | null
  brandSecondary: string | null
  brandTertiary: string | null
  defaultTheme: 'LIGHT' | 'DARK'
}

export type TenantContextValue = {
  tenantId: string | null
  userId: string | null
  branding: TenantBranding | null
  brandingLoading: boolean
}

const TenantContext = createContext<TenantContextValue | null>(null)

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  return atob(b64 + pad)
}

function parseJwtClaims(token: string): { sub?: string; tenantId?: string } {
  const parts = token.split('.')
  if (parts.length !== 3) return {}
  try {
    const json = base64UrlDecode(parts[1] ?? '')
    const data = JSON.parse(json) as any
    return { sub: data?.sub, tenantId: data?.tenantId }
  } catch {
    return {}
  }
}

export function TenantProvider(props: { children: React.ReactNode }) {
  const { accessToken } = useAuth()

  const publicBrandingQuery = useQuery({
    queryKey: ['publicTenantBranding'],
    enabled: !accessToken,
    queryFn: async () => apiFetch<TenantBranding>('/api/v1/public/tenant/branding', {}),
    staleTime: 60_000,
    retry: false,
  })

  const brandingQuery = useQuery({
    queryKey: ['tenantBranding'],
    enabled: Boolean(accessToken),
    queryFn: async () => apiFetch<TenantBranding>('/api/v1/tenant/branding', { token: accessToken }),
    staleTime: 60_000,
  })

  const effectiveBranding = (brandingQuery.data ?? publicBrandingQuery.data) ?? null

  useEffect(() => {
    const data = effectiveBranding
    if (!data) return

    const root = document.documentElement
    
    if (data.brandPrimary) {
      root.style.setProperty('--pf-primary', data.brandPrimary)
      // Oscurecer para hover/active en modo claro
      root.style.setProperty('--pf-primary-dark', adjustBrightness(data.brandPrimary, -20))
      // Aclarar para modo oscuro
      root.style.setProperty('--pf-primary-light', adjustBrightness(data.brandPrimary, 40))
    }
    
    if (data.brandSecondary) {
      root.style.setProperty('--pf-secondary', data.brandSecondary)
      root.style.setProperty('--pf-secondary-dark', adjustBrightness(data.brandSecondary, -20))
      root.style.setProperty('--pf-secondary-light', adjustBrightness(data.brandSecondary, 40))
    }
    
    if (data.brandTertiary) {
      root.style.setProperty('--pf-tertiary', data.brandTertiary)
      root.style.setProperty('--pf-tertiary-dark', adjustBrightness(data.brandTertiary, -20))
      root.style.setProperty('--pf-tertiary-light', adjustBrightness(data.brandTertiary, 40))
    }
  }, [effectiveBranding])

  const value = useMemo<TenantContextValue>(() => {
    if (!accessToken) {
      return {
        tenantId: null,
        userId: null,
        branding: publicBrandingQuery.data ?? null,
        brandingLoading: publicBrandingQuery.isLoading,
      }
    }

    const claims = parseJwtClaims(accessToken)
    return {
      tenantId: typeof claims.tenantId === 'string' ? claims.tenantId : null,
      userId: typeof claims.sub === 'string' ? claims.sub : null,
      branding: brandingQuery.data ?? null,
      brandingLoading: brandingQuery.isLoading,
    }
  }, [accessToken, brandingQuery.data, brandingQuery.isLoading, publicBrandingQuery.data, publicBrandingQuery.isLoading])

  return <TenantContext.Provider value={value}>{props.children}</TenantContext.Provider>
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within <TenantProvider>')
  return ctx
}
