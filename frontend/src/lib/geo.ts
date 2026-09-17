import { geoApi, type Country, type AdminLevel1, type City } from './geoService'

export type GeoOption = { value: string; label: string }

export { geoApi }

export async function searchCities(query: string, country?: string): Promise<GeoOption[]> {
  if (!query || query.length < 2) return []
  if (!country) return []

  const countryCode = getCountryCode(country)
  if (!countryCode) return []

  try {
    const { items } = await geoApi.searchCities(countryCode, query)
    return items.map((c) => ({
      value: normalizeGeoValue(c.name),
      label: c.name,
    }))
  } catch {
    return []
  }
}

export async function searchCountries(query: string): Promise<GeoOption[]> {
  try {
    const { items } = await geoApi.searchCountries(query)
    return items.map((c) => ({ value: c.code, label: c.name }))
  } catch {
    return []
  }
}

export function normalizeGeoValue(value: string): string {
  return value.trim().toUpperCase()
}

function getCountryCode(country?: string): string | undefined {
  if (!country) return undefined
  const upper = normalizeGeoValue(country)
  const map: Record<string, string> = {
    BOLIVIA: 'BO',
    PERU: 'PE',
    ARGENTINA: 'AR',
    CHILE: 'CL',
    BRASIL: 'BR',
    PARAGUAY: 'PY',
    URUGUAY: 'UY',
    COLOMBIA: 'CO',
    ECUADOR: 'EC',
    VENEZUELA: 'VE',
    MEXICO: 'MX',
    ESPANA: 'ES',
  }
  return map[upper] ?? upper
}

export type { Country, AdminLevel1, City }
