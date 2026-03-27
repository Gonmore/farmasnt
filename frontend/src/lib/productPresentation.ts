export const DEFAULT_BASE_UNIT_ABBREVIATION = 'u'

export function normalizeBaseUnitAbbreviation(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized || DEFAULT_BASE_UNIT_ABBREVIATION
}

export function formatPresentationLabel(
  presentation:
    | {
        name?: string | null
        unitsPerPresentation?: number | string | null
        baseUnitAbbreviation?: string | null
      }
    | null
    | undefined,
): string {
  if (!presentation) return 'Unidad'

  const name = String(presentation.name ?? '').trim()
  const units = Number(presentation.unitsPerPresentation ?? 1)
  const baseUnitAbbreviation = normalizeBaseUnitAbbreviation(presentation.baseUnitAbbreviation)

  if (!name || name.toLowerCase() === 'unidad' || !Number.isFinite(units) || units <= 1) {
    return name || 'Unidad'
  }

  return `${name} (${Math.trunc(units)}${baseUnitAbbreviation})`
}

export function formatPresentationSummaryLabel(
  presentation:
    | {
        name?: string | null
        unitsPerPresentation?: number | string | null
        baseUnitAbbreviation?: string | null
      }
    | null
    | undefined,
  options?: { includeDefaultBadge?: boolean; isDefault?: boolean },
): string {
  if (!presentation) return '—'

  const name = String(presentation.name ?? '').trim() || 'Unidad'
  const units = Number(presentation.unitsPerPresentation ?? 1)
  const baseUnitAbbreviation = normalizeBaseUnitAbbreviation(presentation.baseUnitAbbreviation)
  const badge = options?.includeDefaultBadge && options.isDefault ? ' (default)' : ''

  if (!Number.isFinite(units) || units <= 1 || name.toLowerCase() === 'unidad') {
    return `${name}${badge}`
  }

  return `${name}${badge} · ${Math.trunc(units)} ${baseUnitAbbreviation}.`
}

export function formatPresentationQuantityLabel(args: {
  quantity?: number | string | null
  presentationName?: string | null
  presentationQuantity?: number | string | null
  unitsPerPresentation?: number | string | null
  baseUnitAbbreviation?: string | null
}): string {
  const presentationName = String(args.presentationName ?? '').trim()
  const presentationQuantity = Number(args.presentationQuantity ?? NaN)
  const unitsPerPresentation = Number(args.unitsPerPresentation ?? 1)
  const baseUnitAbbreviation = normalizeBaseUnitAbbreviation(args.baseUnitAbbreviation)

  if (!presentationName || !Number.isFinite(presentationQuantity)) {
    return String(args.quantity ?? '')
  }

  if (presentationName.toLowerCase() === 'unidad' || !Number.isFinite(unitsPerPresentation) || unitsPerPresentation <= 1) {
    return `${presentationQuantity} ${presentationName}`
  }

  return `${presentationQuantity} ${presentationName} (${Math.trunc(unitsPerPresentation)}${baseUnitAbbreviation})`
}