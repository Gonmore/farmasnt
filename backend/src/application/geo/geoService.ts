import { getEnv } from '../../shared/env.js'
import type { Country, AdminLevel1, City, Address, GeoServiceConfig, AdminLevel1Type, CityFeatureType } from './types.js'

const DEFAULT_CONFIG: Required<Pick<GeoServiceConfig, 'rateLimitMs' | 'userAgent'>> = {
  rateLimitMs: 1000,
  userAgent: 'PharmaFlow-Bolivia/2.1.1 (geo-service)',
}

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

interface NominatimSearchResult {
  lat: string
  lon: string
  display_name: string
  class: string
  type: string
  importance: number
  place_id: number
  osm_id?: string
  address?: Record<string, string>
  boundingbox?: [string, string, string, string]
}

interface NominatimReverseResult {
  lat: string
  lon: string
  display_name: string
  address?: Record<string, string>
}

const STATIC_COUNTRIES: Country[] = [
  { code: 'BO', code3: 'BOL', name: 'Bolivia', currency: 'BOB', phoneCode: '+591' },
  { code: 'AR', code3: 'ARG', name: 'Argentina', currency: 'ARS', phoneCode: '+54' },
  { code: 'BR', code3: 'BRA', name: 'Brasil', currency: 'BRL', phoneCode: '+55' },
  { code: 'CL', code3: 'CHL', name: 'Chile', currency: 'CLP', phoneCode: '+56' },
  { code: 'PY', code3: 'PRY', name: 'Paraguay', currency: 'PYG', phoneCode: '+595' },
  { code: 'PE', code3: 'PER', name: 'Perú', currency: 'PEN', phoneCode: '+51' },
  { code: 'UY', code3: 'URY', name: 'Uruguay', currency: 'UYU', phoneCode: '+598' },
  { code: 'CO', code3: 'COL', name: 'Colombia', currency: 'COP', phoneCode: '+57' },
  { code: 'EC', code3: 'ECU', name: 'Ecuador', currency: 'USD', phoneCode: '+593' },
  { code: 'VE', code3: 'VEN', name: 'Venezuela', currency: 'VEF', phoneCode: '+58' },
  { code: 'US', code3: 'USA', name: 'Estados Unidos', currency: 'USD', phoneCode: '+1' },
  { code: 'ES', code3: 'ESP', name: 'España', currency: 'EUR', phoneCode: '+34' },
  { code: 'MX', code3: 'MEX', name: 'México', currency: 'MXN', phoneCode: '+52' },
]

const BOLIVIA_ADMIN_LEVEL1: AdminLevel1[] = [
  { code: 'BO01', name: 'Chuquisaca', countryCode: 'BO', type: 'department' },
  { code: 'BO02', name: 'Cochabamba', countryCode: 'BO', type: 'department' },
  { code: 'BO03', name: 'La Paz', countryCode: 'BO', type: 'department' },
  { code: 'BO04', name: 'Oruro', countryCode: 'BO', type: 'department' },
  { code: 'BO05', name: 'Pando', countryCode: 'BO', type: 'department' },
  { code: 'BO06', name: 'Potosí', countryCode: 'BO', type: 'department' },
  { code: 'BO07', name: 'Santa Cruz', countryCode: 'BO', type: 'department' },
  { code: 'BO08', name: 'Tarija', countryCode: 'BO', type: 'department' },
  { code: 'BO09', name: 'Beni', countryCode: 'BO', type: 'department' },
]

const BOLIVIA_CITIES: City[] = [
  { id: 'BO-LAPAZ-001', name: 'La Paz', adminLevel1Code: 'BO03', countryCode: 'BO', lat: -16.4897, lng: -68.1193, population: 2729072, featureType: 'city' },
  { id: 'BO-ELALTO-001', name: 'El Alto', adminLevel1Code: 'BO03', countryCode: 'BO', lat: -16.4975, lng: -68.1436, population: 2076328, featureType: 'city' },
  { id: 'BO-COCHABAMBA-001', name: 'Cochabamba', adminLevel1Code: 'BO02', countryCode: 'BO', lat: -17.2878, lng: -66.1623, population: 945415, featureType: 'city' },
  { id: 'BO-SANTACRUZ-001', name: 'Santa Cruz de la Sierra', adminLevel1Code: 'BO07', countryCode: 'BO', lat: -17.7833, lng: -63.1821, population: 1440000, featureType: 'city' },
  { id: 'BO-ORURO-001', name: 'Oruro', adminLevel1Code: 'BO04', countryCode: 'BO', lat: -17.9583, lng: -67.3367, population: 271962, featureType: 'city' },
  { id: 'BO-POTOSI-001', name: 'Potosí', adminLevel1Code: 'BO06', countryCode: 'BO', lat: -19.5827, lng: -65.7592, population: 189105, featureType: 'city' },
  { id: 'BO-SUCRE-001', name: 'Sucre', adminLevel1Code: 'BO01', countryCode: 'BO', lat: -19.5435, lng: -65.7431, population: 270628, featureType: 'city' },
  { id: 'BO-TARIJA-001', name: 'Tarija', adminLevel1Code: 'BO08', countryCode: 'BO', lat: -20.4289, lng: -64.2122, population: 122903, featureType: 'city' },
  { id: 'BO-TRINIDAD-001', name: 'Trinidad', adminLevel1Code: 'BO09', countryCode: 'BO', lat: -14.8333, lng: -64.5000, population: 130334, featureType: 'city' },
  { id: 'BO-COBIJA-001', name: 'Cobija', adminLevel1Code: 'BO05', countryCode: 'BO', lat: -11.0327, lng: -69.0711, population: 118341, featureType: 'city' },
  { id: 'BO-LOAYZA-001', name: 'Viacha', adminLevel1Code: 'BO03', countryCode: 'BO', lat: -16.2992, lng: -68.1198, population: 10360, featureType: 'town' },
]

const BOLIVIA_DEPARTMENT_LABELS: Record<string, AdminLevel1Type> = {
  'CHUQUISACA': 'department',
  'COCHABAMBA': 'department',
  'LA PAZ': 'department',
  'ORURO': 'department',
  'PANDO': 'department',
  'POTOSÍ': 'department',
  'POTOSI': 'department',
  'SANTA CRUZ': 'department',
  'TARIJA': 'department',
  'BENI': 'department',
}

const BOLIVIA_CITY_TO_DEPARTMENT: Record<string, string> = {
  'LA PAZ': 'LA PAZ',
  'EL ALTO': 'LA PAZ',
  'VIACHA': 'LA PAZ',
  'COPEPAZ': 'LA PAZ',
  'COCHABAMBA': 'COCHABAMBA',
  'SANTA CRUZ': 'SANTA CRUZ',
  'SANTA CRUZ DE LA SIERRA': 'SANTA CRUZ',
  'ORURO': 'ORURO',
  'POTOSI': 'POTOSÍ',
  'POTOSÍ': 'POTOSÍ',
  'SUCRE': 'CHUQUISACA',
  'TARIJA': 'TARIJA',
  'TRINIDAD': 'BENI',
  'COBIJA': 'PANDO',
  'PANDO': 'PANDO',
}

function adminLevel1TypeForCountry(countryCode: string): AdminLevel1Type {
  const types: Record<string, AdminLevel1Type> = {
    BO: 'department',
    AR: 'province',
    BR: 'state',
    CL: 'region',
    PE: 'department',
    UY: 'department',
    PY: 'department',
    EC: 'province',
    CO: 'department',
    VE: 'state',
    MX: 'state',
    ES: 'region',
    US: 'state',
  }
  return types[countryCode.toUpperCase()] ?? 'region'
}

function featureTypeFromNominatimType(type: string): CityFeatureType {
  const mapping: Record<string, CityFeatureType> = {
    city: 'city',
    town: 'town',
    village: 'village',
    municipality: 'municipality',
  }
  return mapping[type.toLowerCase()] ?? 'city'
}

function normalizeCountryName(name: string): string {
  return name.trim().toUpperCase()
}

function normalizeDepartmentName(name: string): string {
  return name.trim().toUpperCase()
}

function normalizeCityName(name: string): string {
  return name.trim().toUpperCase()
}

export class GeoService {
  private readonly config: Required<Pick<GeoServiceConfig, 'nominatimBaseUrl' | 'rateLimitMs' | 'userAgent'>>
  private readonly cache: Map<string, CacheEntry<unknown>>
  private readonly ttl: Required<Required<GeoServiceConfig>['cacheTtlMs']>
  private readonly rateLimiter: Map<string, number>
  private readonly requesterEmail: string | undefined

  constructor(config?: GeoServiceConfig) {
    const env = getEnv()
    this.config = {
      nominatimBaseUrl: config?.nominatimBaseUrl ?? env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org',
      rateLimitMs: config?.rateLimitMs ?? env.NOMINATIM_RATE_LIMIT_MS ?? 1000,
      userAgent: config?.userAgent ?? DEFAULT_CONFIG.userAgent,
    }
    this.requesterEmail = env.NOMINATIM_EMAIL ?? undefined
    this.cache = new Map()
    this.ttl = {
      countries: config?.cacheTtlMs?.countries ?? 24 * 60 * 60 * 1000,
      adminLevel1: config?.cacheTtlMs?.adminLevel1 ?? 12 * 60 * 60 * 1000,
      cities: config?.cacheTtlMs?.cities ?? 6 * 60 * 60 * 1000,
      reverse: config?.cacheTtlMs?.reverse ?? 6 * 60 * 60 * 1000,
      countryLookup: config?.cacheTtlMs?.countryLookup ?? 24 * 60 * 60 * 1000,
    }
    this.rateLimiter = new Map()
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.value
  }

  private setCached<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  private async rateLimit(tenantId: string): Promise<void> {
    const key = tenantId
    const last = this.rateLimiter.get(key) ?? 0
    const now = Date.now()
    const wait = last + this.config.rateLimitMs - now
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
    this.rateLimiter.set(key, Date.now())
  }

  private async nominatimFetch(url: URL, tenantId = 'default'): Promise<any> {
    await this.rateLimit(tenantId)

    if (this.requesterEmail) {
      url.searchParams.set('email', this.requesterEmail)
    }

    const headers: Record<string, string> = {
      'User-Agent': this.config.userAgent,
      'Accept-Language': 'es',
    }

    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) })

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('RATE_LIMITED')
      }
      throw new Error(`Nominatim error: ${res.status} ${res.statusText}`)
    }

    return res.json()
  }

  async searchCountries(query: string, tenantId = 'default'): Promise<Country[]> {
    const cacheKey = `countries:${query}`
    const cached = this.getCached<Country[]>(cacheKey)
    if (cached) return cached

    const q = (query ?? '').trim()

    if (!q || q.length < 2) {
      const result = [...STATIC_COUNTRIES].sort((a, b) => a.name.localeCompare(b.name))
      this.setCached(cacheKey, result, this.ttl.countries)
      return result
    }

    try {
      const url = new URL(`${this.config.nominatimBaseUrl}/search`)
      url.searchParams.set('format', 'json')
      url.searchParams.set('q', q)
      url.searchParams.set('limit', '10')
      url.searchParams.set('featureclass', 'country')

      const data = await this.nominatimFetch(url, tenantId) as NominatimSearchResult[]

      const results: Country[] = []
      const seen = new Set<string>()

      for (const item of data) {
        const countryCode = (item.address?.country_code ?? '').toUpperCase()
        if (!countryCode) continue
        if (seen.has(countryCode)) continue
        seen.add(countryCode)

        const staticCountry = STATIC_COUNTRIES.find((c) => c.code === countryCode)
        if (staticCountry) {
          results.push(staticCountry)
        } else {
          results.push({
            code: countryCode,
            code3: this.countryCodeToAlpha3(countryCode),
            name: item.address?.country ?? item.display_name.split(',')[0] ?? countryCode,
            currency: '',
            phoneCode: '',
          })
        }
      }

      const merged = this.mergeWithStatic(results, q)
      this.setCached(cacheKey, merged, this.ttl.countries)
      return merged
    } catch {
      const filtered = STATIC_COUNTRIES.filter((c) =>
        c.name.toLowerCase().includes(q.toLowerCase()) || c.code.toLowerCase().includes(q.toLowerCase()),
      ).sort((a, b) => a.name.localeCompare(b.name))
      this.setCached(cacheKey, filtered, this.ttl.countries)
      return filtered
    }
  }

  private mergeWithStatic(results: Country[], query: string): Country[] {
    const q = query.toLowerCase()
    const staticMatches = STATIC_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    )

    const merged = [...results]
    for (const s of staticMatches) {
      if (!merged.some((r) => r.code === s.code)) {
        merged.push(s)
      }
    }

    return merged.sort((a, b) => a.name.localeCompare(b.name))
  }

  private countryCodeToAlpha3(code: string): string {
    const map: Record<string, string> = {
      AR: 'ARG', BO: 'BOL', BR: 'BRA', CL: 'CHL', CO: 'COL',
      EC: 'ECU', ES: 'ESP', MX: 'MEX', PE: 'PER', PY: 'PRY',
      UY: 'URY', US: 'USA', VE: 'VEN',
    }
    return map[code.toUpperCase()] ?? code.toUpperCase()
  }

  async getCountryByCode(code: string, tenantId = 'default'): Promise<Country | null> {
    const cacheKey = `country:${code.toUpperCase()}`
    const cached = this.getCached<Country | null>(cacheKey)
    if (cached !== null) return cached

    const staticCountry = STATIC_COUNTRIES.find((c) => c.code.toUpperCase() === code.toUpperCase())
    if (staticCountry) {
      this.setCached(cacheKey, staticCountry, this.ttl.countryLookup)
      return staticCountry
    }

    try {
      const url = new URL(`${this.config.nominatimBaseUrl}/search`)
      url.searchParams.set('format', 'json')
      url.searchParams.set('countrycodes', code.toUpperCase())
      url.searchParams.set('limit', '1')
      url.searchParams.set('featureclass', 'country')

      const data = await this.nominatimFetch(url, tenantId) as NominatimSearchResult[]

      if (data && data.length > 0) {
        const first = data[0]!
        const cc = code.toUpperCase()
        const country: Country = {
          code: cc,
          code3: this.countryCodeToAlpha3(cc),
          name: first.address?.country ?? first.display_name.split(',')[0] ?? cc,
          currency: '',
          phoneCode: '',
        }
        this.setCached(cacheKey, country, this.ttl.countryLookup)
        return country
      }

      this.setCached(cacheKey, null, this.ttl.countryLookup)
      return null
    } catch {
      this.setCached(cacheKey, null, this.ttl.countryLookup)
      return null
    }
  }

  async searchAdminLevel1(countryCode: string, query: string, tenantId = 'default'): Promise<AdminLevel1[]> {
    const cacheKey = `admin1:${countryCode}:${query}`
    const cached = this.getCached<AdminLevel1[]>(cacheKey)
    if (cached) return cached

    const cc = countryCode.toUpperCase()

    const staticFallback = BOLIVIA_ADMIN_LEVEL1.filter((a) => a.countryCode === cc)
    if (cc === 'BO') {
      let results = staticFallback
      if (query.trim()) {
        const q = normalizeDepartmentName(query)
        results = staticFallback.filter(
          (a) => a.name.toUpperCase().includes(q) || a.code.toUpperCase().includes(q),
        )
      }
      this.setCached(cacheKey, results, this.ttl.adminLevel1)
      return results
    }

    try {
      const url = new URL(`${this.config.nominatimBaseUrl}/search`)
      url.searchParams.set('format', 'json')
      url.searchParams.set('countrycodes', cc)
      url.searchParams.set('limit', '50')
      url.searchParams.set('featureclass', 'boundary')
      url.searchParams.set('type', 'administrative')
      if (query.trim()) {
        url.searchParams.set('q', query.trim())
      }

      const data = await this.nominatimFetch(url, tenantId) as NominatimSearchResult[]

      const results: AdminLevel1[] = data.map((item) => {
        const name = ((item.address?.state || item.address?.province || item.address?.region) ?? item.display_name.split(',')[0] ?? '').trim()
        return {
          code: item.osm_id ? `osm:${item.osm_id}` : name.toUpperCase(),
          name,
          countryCode: cc,
          type: adminLevel1TypeForCountry(cc),
        }
      }).filter((a) => a.name && a.name.length > 0)

      this.setCached(cacheKey, results, this.ttl.adminLevel1)
      return results
    } catch {
      this.setCached(cacheKey, [], this.ttl.adminLevel1)
      return []
    }
  }

  async searchCities(
    countryCode: string,
    query: string,
    adminLevel1Code?: string,
    tenantId = 'default',
  ): Promise<City[]> {
    const cacheKey = `cities:${countryCode}:${adminLevel1Code ?? 'all'}:${query}`
    const cached = this.getCached<City[]>(cacheKey)
    if (cached) return cached

    const cc = countryCode.toUpperCase()

    if (cc === 'BO') {
      let results = [...BOLIVIA_CITIES]

      if (adminLevel1Code) {
        const deptName = this.adminLevel1CodeToDepartmentName(adminLevel1Code)
        results = results.filter((c) => {
          const dept = BOLIVIA_CITY_TO_DEPARTMENT[c.name.toUpperCase()]
          return dept === deptName
        })
      }

      if (query.trim()) {
        const q = normalizeCityName(query)
        results = results.filter((c) => c.name.toUpperCase().includes(q) || c.name.toUpperCase().startsWith(q))
      }

      results.sort((a, b) => {
        if (b.population && a.population) return b.population - a.population
        if (b.population) return 1
        if (a.population) return -1
        return a.name.localeCompare(b.name)
      })

      this.setCached(cacheKey, results, this.ttl.cities)
      return results
    }

    try {
      const url = new URL(`${this.config.nominatimBaseUrl}/search`)
      url.searchParams.set('format', 'json')
      url.searchParams.set('countrycodes', cc)
      url.searchParams.set('limit', '50')
      url.searchParams.set('addressdetails', '1')
      if (query.trim()) {
        url.searchParams.set('q', query.trim())
      }

      const data = await this.nominatimFetch(url, tenantId) as NominatimSearchResult[]

      const results: City[] = data
        .filter((item) => {
          const placeType = item.type
          return ['city', 'town', 'village', 'municipality'].includes(placeType) || item.class === 'place'
        })
        .map((item) => {
          const cityName = ((item.address?.city || item.address?.town || item.address?.village) ?? item.display_name.split(',')[0] ?? '').trim()
          const adminName = item.address?.state || item.address?.province || item.address?.region || item.address?.county || ''
          const result: City = {
            id: item.osm_id ? `osm:${item.osm_id}` : `${cityName.toUpperCase()}`,
            name: cityName,
            adminLevel1Code: this.resolveAdminLevel1Code(cc, adminName ?? ''),
            countryCode: cc,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            featureType: featureTypeFromNominatimType(item.type),
          }
          if (item.importance) {
            result.population = Math.round(item.importance * 100000)
          }
          return result
        })
        .filter((c) => c.name && c.name.length > 0)

      this.setCached(cacheKey, results, this.ttl.cities)
      return results
    } catch {
      this.setCached(cacheKey, [], this.ttl.cities)
      return []
    }
  }

  private adminLevel1CodeToDepartmentName(code: string): string | undefined {
    if (code.startsWith('BO')) {
      const dept = BOLIVIA_ADMIN_LEVEL1.find((a) => a.code === code)
      return dept?.name.toUpperCase()
    }
    return code
  }

  private resolveAdminLevel1Code(countryCode: string, adminName: string): string {
    const cc = countryCode.toUpperCase()
    if (cc === 'BO') {
      const dept = BOLIVIA_ADMIN_LEVEL1.find(
        (a) => a.name.toUpperCase() === adminName.toUpperCase() || a.name.toUpperCase() === normalizeDepartmentName(adminName),
      )
      return dept?.code ?? adminName.toUpperCase()
    }
    return normalizeDepartmentName(adminName)
  }

  async reverseGeocode(lat: number, lng: number, tenantId = 'default'): Promise<Address | null> {
    const cacheKey = `reverse:${lat.toFixed(6)}:${lng.toFixed(6)}`
    const cached = this.getCached<Address | null>(cacheKey)
    if (cached !== null) return cached

    try {
      const url = new URL(`${this.config.nominatimBaseUrl}/reverse`)
      url.searchParams.set('format', 'json')
      url.searchParams.set('lat', String(lat))
      url.searchParams.set('lon', String(lng))
      url.searchParams.set('addressdetails', '1')
      url.searchParams.set('accept-language', 'es')

      const data = await this.nominatimFetch(url, tenantId) as NominatimReverseResult

      if (!data || !data.display_name) {
        this.setCached(cacheKey, null, this.ttl.reverse)
        return null
      }

      const addressObj = data.address ?? {}
      const countryCode = (addressObj.country_code ?? '').toUpperCase()
      const country = await this.getCountryByCode(countryCode, tenantId)

      const adminName = addressObj.state || addressObj.province || addressObj.region || addressObj.county || addressObj.municipality
      const adminLevel1: AdminLevel1 | undefined = adminName
        ? {
            code: this.resolveAdminLevel1Code(countryCode, adminName),
            name: adminName.trim(),
            countryCode,
            type: adminLevel1TypeForCountry(countryCode),
          }
        : undefined

      const cityName = addressObj.city || addressObj.town || addressObj.village || addressObj.municipality
      const city: City | undefined = cityName
        ? {
            id: `osm:reverse:${cityName.toUpperCase()}`,
            name: cityName.trim(),
            adminLevel1Code: adminLevel1?.code ?? '',
            countryCode,
            lat,
            lng,
            featureType: cityName.includes('town') ? 'town' : cityName.includes('vill') ? 'village' : 'city',
          }
        : undefined

      const result: Address = {
        formatted: data.display_name,
        country: country ?? { code: countryCode, code3: this.countryCodeToAlpha3(countryCode), name: countryCode, currency: '', phoneCode: '' },
        lat,
        lng,
        ...(adminLevel1 ? { adminLevel1 } : {}),
        ...(city ? { city } : {}),
      }

      this.setCached(cacheKey, result, this.ttl.reverse)
      return result
    } catch {
      this.setCached(cacheKey, null, this.ttl.reverse)
      return null
    }
  }

  async getCurrencyByCountry(countryCode: string): Promise<string> {
    const cacheKey = `currency:${countryCode.toUpperCase()}`
    const cached = this.getCached<string>(cacheKey)
    if (cached !== null) return cached

    const country = await this.getCountryByCode(countryCode)
    const currency = country?.currency || ''

    this.setCached(cacheKey, currency, this.ttl.countryLookup)
    return currency
  }

  async resolveDepartmentForCity(city: string, countryCode?: string): Promise<string | null> {
    const cacheKey = `dept:${countryCode ?? 'any'}:${normalizeCityName(city)}`
    const cached = this.getCached<string | null>(cacheKey)
    if (cached !== null) return cached

    if (!city) {
      this.setCached(cacheKey, null, this.ttl.adminLevel1)
      return null
    }

    const normalized = normalizeCityName(city)
    const upper = normalized.trim().toUpperCase()

    const boliviaDept = BOLIVIA_CITY_TO_DEPARTMENT[upper]
    if (boliviaDept) {
      this.setCached(cacheKey, boliviaDept, this.ttl.adminLevel1)
      return boliviaDept
    }

    if (countryCode && countryCode.toUpperCase() === 'BO') {
      this.setCached(cacheKey, null, this.ttl.adminLevel1)
      return null
    }

    try {
      const url = new URL(`${this.config.nominatimBaseUrl}/search`)
      url.searchParams.set('format', 'json')
      url.searchParams.set('q', city.trim())
      url.searchParams.set('limit', '1')
      url.searchParams.set('addressdetails', '1')
      if (countryCode) url.searchParams.set('countrycodes', countryCode)

      const data = await this.nominatimFetch(url, 'default') as NominatimSearchResult[]

      if (data && data.length > 0) {
        const item = data[0]!
        const dept = item.address?.state || item.address?.province || item.address?.region
        const result = dept ? normalizeDepartmentName(dept) : null
        this.setCached(cacheKey, result, this.ttl.adminLevel1)
        return result
      }

      this.setCached(cacheKey, null, this.ttl.adminLevel1)
      return null
    } catch {
      this.setCached(cacheKey, null, this.ttl.adminLevel1)
      return null
    }
  }

  resolveDepartmentFromStatic(city: string | null | undefined): string | null {
    if (!city) return null
    const normalized = city.trim().toUpperCase()
    return BOLIVIA_CITY_TO_DEPARTMENT[normalized] ?? null
  }

  isValidBoliviaDepartment(value: string | null | undefined): boolean {
    if (!value) return false
    const normalized = normalizeDepartmentName(value)
    return BOLIVIA_DEPARTMENT_LABELS[normalized] !== undefined
  }

  clearCache(): void {
    this.cache.clear()
    this.rateLimiter.clear()
  }
}

export const geoService = new GeoService()
