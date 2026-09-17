export interface Country {
  code: string
  code3: string
  name: string
  currency: string
  phoneCode: string
}

export type AdminLevel1Type = 'department' | 'state' | 'province' | 'region'

export interface AdminLevel1 {
  code: string
  name: string
  countryCode: string
  type: AdminLevel1Type
}

export type CityFeatureType = 'city' | 'town' | 'village' | 'municipality'

export interface City {
  id: string
  name: string
  adminLevel1Code: string
  countryCode: string
  lat: number
  lng: number
  population?: number
  featureType: CityFeatureType
}

export interface Address {
  formatted: string
  country: Country
  adminLevel1?: AdminLevel1
  city?: City
  lat: number
  lng: number
}

export interface GeoServiceConfig {
  nominatimBaseUrl?: string
  requesterEmail?: string
  cacheTtlMs?: {
    countries: number
    adminLevel1: number
    cities: number
    reverse: number
    countryLookup: number
  }
  rateLimitMs?: number
  userAgent?: string
}
