// Prefer same-origin (works with Vite proxy and custom local domains via hosts file).
// Allow overriding with VITE_API_BASE_URL when backend is on a different origin.
import axios from 'axios';

type LogoutReason = 'SESSION_EXPIRED' | 'UNAUTHORIZED';

const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const API_BASE_URL = envBase.trim() ? envBase.trim() : window.location.origin;

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

// Axios instance with auth token injection
export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const LAST_ACTIVITY_KEY = 'pf.lastActivityAt'

function getLastActivityAtMs(): number {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY)
  const v = raw ? Number(raw) : NaN
  return Number.isFinite(v) ? v : Date.now()
}

function shouldAllowRefreshByActivity(): boolean {
  // Sliding session from the client side: if the user has been inactive for 2 hours,
  // we stop refreshing and force a clean re-login.
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000
  return Date.now() - getLastActivityAtMs() <= TWO_HOURS_MS
}

function setLogoutReason(reason: LogoutReason): void {
  try {
    sessionStorage.setItem('pf.logoutReason', reason)
  } catch {
    // ignore
  }
}

function dispatchLogout(reason: LogoutReason): void {
  setLogoutReason(reason)
  localStorage.removeItem('pf.accessToken')
  localStorage.removeItem('pf.refreshToken')
  window.dispatchEvent(new CustomEvent('pf:auth:logout', { detail: { reason } }))
}

function dispatchTokensUpdated(): void {
  window.dispatchEvent(new Event('pf:auth:tokens'))
}

function isAuthEndpoint(path: string): boolean {
  return (
    path.startsWith('/api/v1/auth/login') ||
    path.startsWith('/api/v1/auth/refresh') ||
    path.startsWith('/api/v1/auth/password-reset')
  )
}

type RefreshResponse = { accessToken: string; refreshToken: string }

let refreshInFlight: Promise<string | null> | null = null

async function tryRefreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const rt = localStorage.getItem('pf.refreshToken')
    if (!rt) return null
    if (!shouldAllowRefreshByActivity()) return null

    const url = `${API_BASE_URL}/api/v1/auth/refresh`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    })

    if (!resp.ok) return null
    const data = (await resp.json()) as RefreshResponse
    if (!data?.accessToken || !data?.refreshToken) return null

    localStorage.setItem('pf.accessToken', data.accessToken)
    localStorage.setItem('pf.refreshToken', data.refreshToken)
    dispatchTokensUpdated()
    return data.accessToken
  })()

  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = null
  }
}

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pf.accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If the backend returns 401, try refresh once; if it fails, logout cleanly.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const originalConfig = error?.config as any

    if (status === 401 && originalConfig && !originalConfig.__pfRetried) {
      // Never try to refresh on auth endpoints.
      const url = String(originalConfig?.url ?? '')
      if (url.includes('/api/v1/auth/')) {
        dispatchLogout('UNAUTHORIZED')
        return Promise.reject(error)
      }

      originalConfig.__pfRetried = true
      const newAccessToken = await tryRefreshAccessToken()
      if (newAccessToken) {
        originalConfig.headers = originalConfig.headers ?? {}
        originalConfig.headers.Authorization = `Bearer ${newAccessToken}`
        return api.request(originalConfig)
      }

      dispatchLogout('SESSION_EXPIRED')
    }
    return Promise.reject(error)
  },
);

export async function apiFetch<T>(path: string, init?: RequestInit & { token?: string | null }): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const headers = new Headers(init?.headers)
  const hasBody = init?.body !== undefined && init?.body !== null
  const contentTypeAlreadySet = !!headers.get('Content-Type')
  // Only set JSON content-type when we actually send a body.
  // Fastify will reject requests with Content-Type: application/json and an empty body.
  if (hasBody && !contentTypeAlreadySet) headers.set('Content-Type', 'application/json')
  const tokenToUse = init?.token === undefined ? localStorage.getItem('pf.accessToken') : init.token
  if (tokenToUse) headers.set('Authorization', `Bearer ${tokenToUse}`)

  // Track retries locally to avoid infinite loops.
  const shouldRetryOn401 = !isAuthEndpoint(path)
  const resp = await fetch(url, { ...init, headers })
  if (!resp.ok) {
    if (resp.status === 401 && shouldRetryOn401) {
      const newAccessToken = await tryRefreshAccessToken()
      if (newAccessToken) {
        const retryHeaders = new Headers(headers)
        retryHeaders.set('Authorization', `Bearer ${newAccessToken}`)
        const retryResp = await fetch(url, { ...init, headers: retryHeaders })
        if (retryResp.ok) return (await retryResp.json()) as T
        if (retryResp.status === 401) {
          dispatchLogout('SESSION_EXPIRED')
          throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
        }
        // Non-401 retry errors: surface the backend message.
        const retryContentType = retryResp.headers.get('content-type') ?? ''
        if (retryContentType.includes('application/json')) {
          const data = (await retryResp.json().catch(() => null)) as any
          const msg = data?.message
          throw new Error(typeof msg === 'string' && msg.trim() ? msg : `Request failed: ${retryResp.status}`)
        }
        const text = await retryResp.text().catch(() => '')
        throw new Error(text || `Request failed: ${retryResp.status}`)
      }

      dispatchLogout('SESSION_EXPIRED')
      throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
    }

    const contentType = resp.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try {
        const data = (await resp.json()) as any
        if (data && typeof data.message === 'string' && data.message.trim()) {
          if (Array.isArray(data.issues) && data.issues.length > 0) {
            const detail = data.issues
              .slice(0, 6)
              .map((i: any) => {
                const path = Array.isArray(i?.path) ? i.path.join('.') : ''
                const msg = typeof i?.message === 'string' ? i.message : JSON.stringify(i)
                return path ? `${path}: ${msg}` : msg
              })
              .join(' | ')
            throw new Error(`${data.message}: ${detail}`)
          }
          throw new Error(data.message)
        }
        throw new Error(typeof data === 'string' ? data : JSON.stringify(data))
      } catch (e: any) {
        throw new Error(e?.message ?? `Request failed: ${resp.status}`)
      }
    }

    const text = await resp.text().catch(() => '')
    throw new Error(text || `Request failed: ${resp.status}`)
  }
  return (await resp.json()) as T
}

export type PlatformTenantDomainListItem = {
  id: string
  domain: string
  isPrimary: boolean
  verifiedAt: string | null
  verificationTokenExpiresAt: string | null
  createdAt: string
}

export async function listPlatformTenantDomains(
  tenantId: string,
  opts: { token: string },
): Promise<{ items: PlatformTenantDomainListItem[] }> {
  return apiFetch(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/domains`, { token: opts.token })
}

export async function createPlatformTenantDomain(
  tenantId: string,
  input: { domain: string; isPrimary?: boolean },
  opts: { token: string },
): Promise<
  PlatformTenantDomainListItem & {
    tenantId: string
    verification: { token: string; url: string; expiresAt: string }
  }
> {
  return apiFetch(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/domains`, {
    method: 'POST',
    token: opts.token,
    body: JSON.stringify(input),
  })
}

export async function verifyPlatformTenantDomain(
  tenantId: string,
  domain: string,
  opts: { token: string; timeoutMs?: number },
): Promise<{ ok: true; verifiedAt: string }> {
  return apiFetch(
    `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domain)}/verify`,
    {
      method: 'POST',
      token: opts.token,
      body: JSON.stringify(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    },
  )
}
