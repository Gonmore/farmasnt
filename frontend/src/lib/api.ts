// Prefer same-origin (works with Vite proxy and custom local domains via hosts file).
// Allow overriding with VITE_API_BASE_URL when backend is on a different origin.
import axios from 'axios';

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

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pf.accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function apiFetch<T>(path: string, init?: RequestInit & { token?: string | null }): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const headers = new Headers(init?.headers)
  const hasBody = init?.body !== undefined && init?.body !== null
  const contentTypeAlreadySet = !!headers.get('Content-Type')
  // Only set JSON content-type when we actually send a body.
  // Fastify will reject requests with Content-Type: application/json and an empty body.
  if (hasBody && !contentTypeAlreadySet) headers.set('Content-Type', 'application/json')
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`)

  const resp = await fetch(url, { ...init, headers })
  if (!resp.ok) {
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
