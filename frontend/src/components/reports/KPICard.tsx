import type { ReactNode } from 'react'

type KPICardProps = {
  icon: ReactNode
  label: string
  value: string | number
  change?: {
    value: number
    isPositive: boolean
  }
  color?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  subtitle?: string
}

const colorClasses = {
  primary: {
    bg: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20',
    icon: 'bg-blue-500 text-white',
    text: 'text-blue-900 dark:text-blue-100',
    accent: 'text-blue-600 dark:text-blue-400',
  },
  success: {
    bg: 'bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20',
    icon: 'bg-green-500 text-white',
    text: 'text-green-900 dark:text-green-100',
    accent: 'text-green-600 dark:text-green-400',
  },
  warning: {
    bg: 'bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-900/20 dark:to-yellow-800/20',
    icon: 'bg-yellow-500 text-white',
    text: 'text-yellow-900 dark:text-yellow-100',
    accent: 'text-yellow-600 dark:text-yellow-400',
  },
  danger: {
    bg: 'bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20',
    icon: 'bg-red-500 text-white',
    text: 'text-red-900 dark:text-red-100',
    accent: 'text-red-600 dark:text-red-400',
  },
  info: {
    bg: 'bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-900/20 dark:to-cyan-800/20',
    icon: 'bg-cyan-500 text-white',
    text: 'text-cyan-900 dark:text-cyan-100',
    accent: 'text-cyan-600 dark:text-cyan-400',
  },
}

export function KPICard({ icon, label, value, change, color = 'primary', subtitle }: KPICardProps) {
  const colors = colorClasses[color]

  return (
    <div className={`group relative overflow-hidden rounded-xl border border-slate-200 p-6 transition-all hover:shadow-lg dark:border-slate-700 ${colors.bg}`}>
      {/* Icon badge */}
      <div className="mb-4 flex items-start justify-between">
        <div className={`rounded-lg p-3 shadow-md ${colors.icon}`}>
          <div className="text-xl">{icon}</div>
        </div>
        {change && (
          <div className={`rounded-full px-2 py-1 text-xs font-semibold ${change.isPositive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
            {change.isPositive ? '↗' : '↘'} {Math.abs(change.value)}%
          </div>
        )}
      </div>

      {/* Label */}
      <div className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-400">{label}</div>

      {/* Value */}
      <div className={`text-3xl font-bold ${colors.text}`}>{value}</div>

      {/* Subtitle */}
      {subtitle && <div className={`mt-2 text-xs ${colors.accent}`}>{subtitle}</div>}

      {/* Decorative gradient overlay */}
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br from-white/30 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  )
}
