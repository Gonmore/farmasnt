// Prefer same-origin (works with Vite proxy and custom local domains via hosts file).
// Allow overriding with VITE_API_BASE_URL when backend is on a different origin.
const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
const API_BASE_URL = envBase.trim() ? envBase.trim() : window.location.origin

export function getApiBaseUrl(): string {
  return API_BASE_URL
}

export async function apiFetch<T>(path: string, init?: RequestInit & { token?: string | null }): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json')
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`)

  const resp = await fetch(url, { ...init, headers })
  if (!resp.ok) {
    const contentType = resp.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try {
        const data = (await resp.json()) as any
        if (data && typeof data.message === 'string' && data.message.trim()) {
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
