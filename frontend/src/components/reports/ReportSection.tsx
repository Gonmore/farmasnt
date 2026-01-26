import type { ReactNode } from 'react'

type ReportSectionProps = {
  title: string
  subtitle?: string
  icon?: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
}

export function ReportSection({ title, subtitle, icon, children, actions, className = '' }: ReportSectionProps) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}>
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-200 bg-gradient-to-r from-slate-50 to-transparent px-6 py-4 dark:border-slate-700 dark:from-slate-800/50">
        <div className="flex items-start gap-3">
          {icon && <div className="mt-1 text-2xl">{icon}</div>}
          <div>
            <h3 className="report-section-title text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
            {subtitle && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Content */}
      <div className="p-6">{children}</div>
    </div>
  )
}
