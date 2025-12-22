import type { ReactNode } from 'react'

export interface PageContainerProps {
  children: ReactNode
  title?: string
  actions?: ReactNode
}

export function PageContainer({ children, title, actions }: PageContainerProps) {
  return (
    <div className="flex-1 overflow-auto p-6">
      {(title || actions) && (
        <div className="mb-6 flex items-center justify-between">
          {title && <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
