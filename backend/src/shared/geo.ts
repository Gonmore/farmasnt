/**
 * @deprecated Use GeoService from `application/geo/geoService.js` for dynamic georeferencing.
 * This module is retained for backward compatibility — `cityToDepartment` and `isValidDepartment`
 * still work synchronously using static Bolivia data, but delegates to GeoService where possible.
 */

import { geoService } from '../application/geo/geoService.js'

export const BOLIVIAN_DEPARTMENTS = [
  'LA PAZ',
  'COCHABAMBA',
  'SANTA CRUZ',
  'ORURO',
  'POTOSÍ',
  'CHUQUISACA',
  'TARIJA',
  'PANDO',
  'BENI',
] as const

export type BolivianDepartment = (typeof BOLIVIAN_DEPARTMENTS)[number]

export function cityToDepartment(city: string | null | undefined): string | null {
  return geoService.resolveDepartmentFromStatic(city)
}

export async function resolveDepartmentForCity(city: string, countryCode?: string): Promise<string | null> {
  return geoService.resolveDepartmentForCity(city, countryCode)
}

export function isValidDepartment(value: string | null | undefined): boolean {
  return geoService.isValidBoliviaDepartment(value)
}

export { geoService, GeoService } from '../application/geo/geoService.js'
export type { Country, AdminLevel1, City, Address } from '../application/geo/types.js'
