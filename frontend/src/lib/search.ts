export function normalizeForSearch(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function splitSearchTokens(query: string): string[] {
  const normalized = normalizeForSearch(query)
  if (!normalized) return []
  return normalized.split(/\s+/).filter(Boolean)
}

export function makeSearchHaystack(values: unknown[]): string {
  const raw = values
    .map((v) => {
      if (v instanceof Date) return v.toISOString()
      return String(v ?? '')
    })
    .join(' ')

  return normalizeForSearch(raw)
}

export function matchesSearchQuery(query: string, values: unknown[]): boolean {
  const tokens = splitSearchTokens(query)
  if (tokens.length === 0) return true

  const haystack = makeSearchHaystack(values)
  if (!haystack) return false

  return tokens.every((t) => haystack.includes(t))
}
