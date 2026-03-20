type ExportLegendItem = {
  label: string
  color: string
}

type ExportLegendProps = {
  items: ExportLegendItem[]
  className?: string
}

export function ExportLegend({ items, className }: ExportLegendProps) {
  return (
    <div className={className ?? 'mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-slate-700'}>
      {items.map((item) => (
        <div key={`${item.label}-${item.color}`} className="inline-flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}