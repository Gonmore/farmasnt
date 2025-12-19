import { createContext, useContext, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './AuthProvider'
import { apiFetch } from '../lib/api'

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
    if (data.brandPrimary) root.style.setProperty('--pf-primary', data.brandPrimary)
    if (data.brandSecondary) root.style.setProperty('--pf-secondary', data.brandSecondary)
    if (data.brandTertiary) root.style.setProperty('--pf-tertiary', data.brandTertiary)
    if (data.logoUrl) root.style.setProperty('--pf-logo-url', `url(${data.logoUrl})`)
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
