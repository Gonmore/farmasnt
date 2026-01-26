export type ProductNameFields = {
  sku?: string | null
  // Backwards compatible: many endpoints still return `name`.
  name?: string | null
  // Forward compatible: preferred explicit naming.
  commercialName?: string | null
  genericName?: string | null
}

export function getCommercialName(p: ProductNameFields): string {
  return (p.commercialName ?? p.name ?? '').trim()
}

export function getProductDisplayName(p: ProductNameFields): string {
  const commercial = getCommercialName(p)
  const generic = (p.genericName ?? '').trim()
  if (!generic) return commercial
  if (commercial && generic.toLowerCase() === commercial.toLowerCase()) return commercial
  return commercial ? `${commercial} (${generic})` : generic
}

export function getProductLabel(p: ProductNameFields): string {
  const sku = (p.sku ?? '').trim()
  const display = getProductDisplayName(p)
  return sku ? `${sku} - ${display}` : display
}
