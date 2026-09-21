import { apiFetch } from './api'

export interface Country {
  code: string
  code3: string
  name: string
  currency: string
  phoneCode: string
}

export interface AdminLevel1 {
  code: string
  name: string
  countryCode: string
  type: 'department' | 'state' | 'province' | 'region'
}

export interface City {
  id: string
  name: string
  adminLevel1Code: string
  countryCode: string
  lat: number
  lng: number
  population?: number
  featureType: 'city' | 'town' | 'village' | 'municipality' | 'province'
}

export interface Address {
  formatted: string
  country: Country
  adminLevel1?: AdminLevel1
  city?: City
  lat: number
  lng: number
}

function buildUrl(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value)
    }
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

export const geoApi = {
  searchCountries: (query: string) =>
    apiFetch<{ items: Country[] }>(
      buildUrl('/api/v1/geo/countries', { q: query }),
    ),

  getCountry: (code: string) =>
    apiFetch<Country>(`/api/v1/geo/countries/${encodeURIComponent(code)}`),

  searchAdminLevel1: (countryCode: string, query: string) =>
    apiFetch<{ items: AdminLevel1[] }>(
      buildUrl('/api/v1/geo/admin-level1', { countryCode, q: query }),
    ),

  searchCities: (countryCode: string, query: string, adminLevel1Code?: string) =>
    apiFetch<{ items: City[] }>(
      buildUrl('/api/v1/geo/cities', { countryCode, q: query, adminLevel1Code }),
    ),

  reverseGeocode: (lat: number, lng: number) =>
    apiFetch<Address | null>(
      buildUrl('/api/v1/geo/reverse', { lat: String(lat), lng: String(lng) }),
    ),

  getCurrency: (countryCode: string) =>
    apiFetch<{ currency: string }>(`/api/v1/geo/currency/${encodeURIComponent(countryCode)}`),

  resolveDepartment: (city: string, countryCode?: string, adminLevel1Code?: string) =>
    apiFetch<{ department: string | null }>(
      buildUrl('/api/v1/geo/resolve-department', { city, countryCode, adminLevel1Code }),
    ),
}
