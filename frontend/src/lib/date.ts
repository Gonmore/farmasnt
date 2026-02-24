export function formatDateOnlyUtc(
  iso: string,
  locales?: string | string[],
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return date.toLocaleDateString(locales, { timeZone: 'UTC' })
}
