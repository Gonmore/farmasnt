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
  currency: string
  country?: string | null
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

function normalizeCountry(country?: string | null): string {
  const value = (country ?? '').trim()
  return value ? value.toUpperCase() : 'BOLIVIA'
}

export function TenantProvider(props: { children: React.ReactNode }) {
  const { accessToken } = useAuth()

  const publicBrandingQuery = useQuery({
    queryKey: ['publicTenantBranding'],
    enabled: !accessToken,
    queryFn: async () => {
      // Add timeout to prevent infinite loading on first access
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const result = await apiFetch<TenantBranding>('/api/v1/public/tenant/branding', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Request timeout - tenant branding not available');
        }
        throw error;
      }
    },
    staleTime: 60_000,
    retry: (failureCount, error) => {
      // Don't retry on 404 (tenant not found), timeout, or other client errors
      if (error && typeof error === 'object') {
        if ('status' in error) {
          const status = (error as any).status;
          if (status >= 400 && status < 500) return false;
        }
        if ('message' in error && (error as any).message?.includes('timeout')) return false;
      }
      return failureCount < 2;
    },
    retryDelay: 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
      const publicBranding = publicBrandingQuery.data
      const isLoading = publicBrandingQuery.isLoading || publicBrandingQuery.isFetching
      const hasError = publicBrandingQuery.isError

      // If there's an error and we're not loading, provide fallback branding
      const effectiveBranding = hasError && !isLoading ? {
        tenantId: 'fallback',
        tenantName: 'PharmaFlow',
        logoUrl: null,
        brandPrimary: null,
        brandSecondary: null,
        brandTertiary: null,
        defaultTheme: 'LIGHT' as const,
        currency: 'BOB',
        country: 'BOLIVIA'
      } : publicBranding

      return {
        tenantId: null,
        userId: null,
        branding: effectiveBranding ? { ...effectiveBranding, country: normalizeCountry(effectiveBranding.country) } : null,
        brandingLoading: isLoading,
      }
    }

    const claims = parseJwtClaims(accessToken)
    const branding = brandingQuery.data
    return {
      tenantId: typeof claims.tenantId === 'string' ? claims.tenantId : null,
      userId: typeof claims.sub === 'string' ? claims.sub : null,
      branding: branding ? { ...branding, country: normalizeCountry(branding.country) } : null,
      brandingLoading: brandingQuery.isLoading,
    }
  }, [accessToken, brandingQuery.data, brandingQuery.isLoading, publicBrandingQuery.data, publicBrandingQuery.isLoading, publicBrandingQuery.isFetching, publicBrandingQuery.isError])

  return <TenantContext.Provider value={value}>{props.children}</TenantContext.Provider>
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within <TenantProvider>')
  return ctx
}
