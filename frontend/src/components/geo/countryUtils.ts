const COUNTRY_DISPLAY: Record<string, { name: string; currency: string; phoneCode: string }> = {
  BO: { name: 'Bolivia', currency: 'BOB', phoneCode: '+591' },
  AR: { name: 'Argentina', currency: 'ARS', phoneCode: '+54' },
  BR: { name: 'Brasil', currency: 'BRL', phoneCode: '+55' },
  CL: { name: 'Chile', currency: 'CLP', phoneCode: '+56' },
  PY: { name: 'Paraguay', currency: 'PYG', phoneCode: '+595' },
  PE: { name: 'Perú', currency: 'PEN', phoneCode: '+51' },
  UY: { name: 'Uruguay', currency: 'UYU', phoneCode: '+598' },
  CO: { name: 'Colombia', currency: 'COP', phoneCode: '+57' },
  EC: { name: 'Ecuador', currency: 'USD', phoneCode: '+593' },
  VE: { name: 'Venezuela', currency: 'VEF', phoneCode: '+58' },
  US: { name: 'Estados Unidos', currency: 'USD', phoneCode: '+1' },
  ES: { name: 'España', currency: 'EUR', phoneCode: '+34' },
  MX: { name: 'México', currency: 'MXN', phoneCode: '+52' },
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {}
for (const [code, info] of Object.entries(COUNTRY_DISPLAY)) {
  COUNTRY_NAME_TO_CODE[info.name.toUpperCase()] = code
  COUNTRY_NAME_TO_CODE[code] = code
}

export function countryCodeToName(code: string): string {
  const info = COUNTRY_DISPLAY[code.toUpperCase()]
  return info ? info.name : code
}

export function countryNameToCode(name: string): string | null {
  return COUNTRY_NAME_TO_CODE[name.trim().toUpperCase()] ?? null
}

export function countryCodeToCurrency(code: string): string {
  return COUNTRY_DISPLAY[code.toUpperCase()]?.currency ?? 'BOB'
}

export function normalizeCountryCode(country: string | null | undefined): string {
  if (!country) return 'BO'
  const trimmed = country.trim().toUpperCase()
  return COUNTRY_NAME_TO_CODE[trimmed] ?? trimmed
}

export function normalizeCountryForDisplay(country: string | null | undefined): string {
  const code = normalizeCountryCode(country)
  return countryCodeToName(code)
}
