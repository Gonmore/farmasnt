export function Loading({ message = 'Cargando...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[var(--pf-primary)] dark:border-slate-700 dark:border-t-[var(--pf-primary)]" />
      <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{message}</p>
    </div>
  )
}
