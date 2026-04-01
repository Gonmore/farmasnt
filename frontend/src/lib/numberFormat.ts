export const THOUSAND_SEPARATOR_OPTIONS = ['.', ',', ' '] as const

export type ThousandSeparator = (typeof THOUSAND_SEPARATOR_OPTIONS)[number]

type FormatNumberOptions = {
  decimals?: number
  thousandSeparator?: string | null
  trimTrailingZeros?: boolean
  decimalSeparator?: string
}

export const DEFAULT_THOUSAND_SEPARATOR: ThousandSeparator = '.'

export function normalizeThousandSeparator(value?: string | null): ThousandSeparator {
  return THOUSAND_SEPARATOR_OPTIONS.includes(value as ThousandSeparator)
    ? (value as ThousandSeparator)
    : DEFAULT_THOUSAND_SEPARATOR
}

function getDefaultDecimalSeparator(thousandSeparator: ThousandSeparator): string {
  return thousandSeparator === ',' ? '.' : ','
}

export function getCurrentThousandSeparator(): ThousandSeparator {
  if (typeof document === 'undefined') return DEFAULT_THOUSAND_SEPARATOR
  return normalizeThousandSeparator(document.documentElement.dataset.pfThousandsSeparator)
}

export function formatNumber(value: number, options: FormatNumberOptions = {}): string {
  const decimals = Math.max(0, options.decimals ?? 0)
  const thousandSeparator = normalizeThousandSeparator(options.thousandSeparator ?? getCurrentThousandSeparator())
  const decimalSeparator = options.decimalSeparator ?? getDefaultDecimalSeparator(thousandSeparator)
  const numericValue = Number.isFinite(value) ? value : 0
  const isNegative = numericValue < 0
  const fixed = Math.abs(numericValue).toFixed(decimals)
  let [integerPart, fractionPart = ''] = fixed.split('.')

  integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator)

  if (options.trimTrailingZeros && fractionPart) {
    fractionPart = fractionPart.replace(/0+$/, '')
  }

  const fraction = fractionPart ? `${decimalSeparator}${fractionPart}` : ''
  return `${isNegative ? '-' : ''}${integerPart}${fraction}`
}

export function formatMoney(value: number, options: Omit<FormatNumberOptions, 'decimals'> = {}): string {
  return formatNumber(value, { ...options, decimals: 2 })
}

export function formatInteger(value: number, options: Omit<FormatNumberOptions, 'decimals'> = {}): string {
  return formatNumber(value, { ...options, decimals: 0 })
}
