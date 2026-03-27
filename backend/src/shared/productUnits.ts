export const DEFAULT_BASE_UNIT_ABBREVIATION = 'u'

export function normalizeBaseUnitAbbreviation(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized || DEFAULT_BASE_UNIT_ABBREVIATION
}

export function formatPresentationLabel(args: {
  name?: string | null
  unitsPerPresentation?: number | string | null
  baseUnitAbbreviation?: string | null
}): string {
  const name = String(args.name ?? '').trim()
  const units = Number(args.unitsPerPresentation ?? 1)
  const baseUnitAbbreviation = normalizeBaseUnitAbbreviation(args.baseUnitAbbreviation)

  if (!name) return '—'
  if (name.toLowerCase() === 'unidad' || !Number.isFinite(units) || units <= 1) return name
  return `${name} (${Math.trunc(units)}${baseUnitAbbreviation})`
}