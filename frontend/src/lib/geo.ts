export type GeoOption = { value: string; label: string }

// Default countries for initial setup - can be expanded dynamically
export const COUNTRY_OPTIONS: GeoOption[] = [
  { value: 'BOLIVIA', label: 'Bolivia' },
  { value: 'PERU', label: 'Perú' },
  { value: 'ARGENTINA', label: 'Argentina' },
  { value: 'CHILE', label: 'Chile' },
  { value: 'BRASIL', label: 'Brasil' },
  { value: 'PARAGUAY', label: 'Paraguay' },
  { value: 'URUGUAY', label: 'Uruguay' },
]

// Default cities by country - can be expanded with dynamic search
const CITIES_BY_COUNTRY: Record<string, GeoOption[]> = {
  BOLIVIA: [
    { value: 'LA PAZ', label: 'La Paz' },
    { value: 'EL ALTO', label: 'El Alto' },
    { value: 'COCHABAMBA', label: 'Cochabamba' },
    { value: 'SANTA CRUZ', label: 'Santa Cruz' },
    { value: 'ORURO', label: 'Oruro' },
    { value: 'POTOSI', label: 'Potosí' },
    { value: 'SUCRE', label: 'Sucre' },
    { value: 'TARIJA', label: 'Tarija' },
    { value: 'TRINIDAD', label: 'Trinidad' },
    { value: 'COBIJA', label: 'Cobija' },
  ],
  PERU: [
    { value: 'LIMA', label: 'Lima' },
    { value: 'AREQUIPA', label: 'Arequipa' },
    { value: 'CUSCO', label: 'Cusco' },
  ],
  ARGENTINA: [
    { value: 'BUENOS AIRES', label: 'Buenos Aires' },
    { value: 'CORDOBA', label: 'Córdoba' },
    { value: 'ROSARIO', label: 'Rosario' },
  ],
  CHILE: [
    { value: 'SANTIAGO', label: 'Santiago' },
    { value: 'VALPARAISO', label: 'Valparaíso' },
    { value: 'CONCEPCION', label: 'Concepción' },
  ],
  BRASIL: [
    { value: 'SAO PAULO', label: 'São Paulo' },
    { value: 'RIO DE JANEIRO', label: 'Rio de Janeiro' },
    { value: 'BRASILIA', label: 'Brasília' },
  ],
  PARAGUAY: [
    { value: 'ASUNCION', label: 'Asunción' },
    { value: 'CIUDAD DEL ESTE', label: 'Ciudad del Este' },
  ],
  URUGUAY: [
    { value: 'MONTEVIDEO', label: 'Montevideo' },
    { value: 'PUNTA DEL ESTE', label: 'Punta del Este' },
  ],
}

export function normalizeGeoValue(value: string): string {
  return value.trim().toUpperCase()
}

export function getCityOptions(country: string | null | undefined): GeoOption[] {
  const key = typeof country === 'string' ? normalizeGeoValue(country) : ''
  return CITIES_BY_COUNTRY[key] ?? []
}

// Dynamic city search using OpenStreetMap Nominatim
export async function searchCities(query: string, country?: string): Promise<GeoOption[]> {
  if (!query || query.length < 2) return []

  try {
    const countryCode = getCountryCode(country)
    const searchQuery = countryCode ? `${query}, ${countryCode}` : query

    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=10&addressdetails=1&countrycodes=${countryCode || 'bo,pe,ar,cl,br,py,uy'}&featuretype=city,town,village`
    )

    if (!response.ok) return []

    const data = await response.json()

    return data
      .filter((item: any) => {
        // Filter for cities, towns, and villages
        const type = item.type || ''
        return ['city', 'town', 'village', 'municipality', 'locality'].includes(type) ||
               item.class === 'place' ||
               (item.address && (item.address.city || item.address.town || item.address.village))
      })
      .map((item: any) => {
        const cityName = item.address?.city || item.address?.town || item.address?.village || item.display_name.split(',')[0]
        return {
          value: normalizeGeoValue(cityName),
          label: cityName
        }
      })
      .filter((item: GeoOption, index: number, self: GeoOption[]) =>
        // Remove duplicates
        index === self.findIndex(t => t.value === item.value)
      )
      .slice(0, 8) // Limit to 8 results
  } catch (error) {
    console.error('Error searching cities:', error)
    return []
  }
}

// Get country code for Nominatim search
function getCountryCode(country?: string): string | undefined {
  if (!country) return undefined

  const countryMap: Record<string, string> = {
    'BOLIVIA': 'bo',
    'PERU': 'pe',
    'ARGENTINA': 'ar',
    'CHILE': 'cl',
    'BRASIL': 'br',
    'PARAGUAY': 'py',
    'URUGUAY': 'uy'
  }

  return countryMap[normalizeGeoValue(country)]
}

// Dynamic country search
export async function searchCountries(query: string): Promise<GeoOption[]> {
  if (!query || query.length < 2) return COUNTRY_OPTIONS

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=10&featuretype=country`
    )

    if (!response.ok) return COUNTRY_OPTIONS

    const data = await response.json()

    const foundCountries = data
      .filter((item: any) => item.type === 'country' || item.class === 'boundary')
      .map((item: any) => ({
        value: normalizeGeoValue(item.display_name.split(',')[0]),
        label: item.display_name.split(',')[0]
      }))
      .filter((item: GeoOption, index: number, self: GeoOption[]) =>
        index === self.findIndex(t => t.value === item.value)
      )

    // Merge with default countries and remove duplicates
    const allCountries = [...COUNTRY_OPTIONS, ...foundCountries]
    return allCountries.filter((item, index, self) =>
      index === self.findIndex(t => t.value === item.value)
    )
  } catch (error) {
    console.error('Error searching countries:', error)
    return COUNTRY_OPTIONS
  }
}

// Birthday options for contact birth date
export const MONTH_OPTIONS: GeoOption[] = [
  { value: '1', label: 'Enero' },
  { value: '2', label: 'Febrero' },
  { value: '3', label: 'Marzo' },
  { value: '4', label: 'Abril' },
  { value: '5', label: 'Mayo' },
  { value: '6', label: 'Junio' },
  { value: '7', label: 'Julio' },
  { value: '8', label: 'Agosto' },
  { value: '9', label: 'Septiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' },
]

export const DAY_OPTIONS: GeoOption[] = Array.from({ length: 31 }, (_, i) => ({
  value: (i + 1).toString(),
  label: (i + 1).toString(),
}))
