import type { ReactNode } from 'react'

export interface Column<T> {
  header: ReactNode
  accessor: (item: T, index: number) => ReactNode
  className?: string
  width?: string
}

export interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (item: T) => string
  rowClassName?: (item: T) => string
  onRowClick?: (item: T) => void
}

export function Table<T>({ columns, data, keyExtractor, rowClassName, onRowClick }: TableProps<T>) {
  const hasExplicitWidths = columns.some((c) => typeof c.width === 'string' && c.width.trim().length > 0)

  return (
    <div className="w-full">
      <div className="overflow-x-auto scrollbar scrollbar-thumb-slate-400 scrollbar-track-slate-200 dark:scrollbar-thumb-slate-500 dark:scrollbar-track-slate-700">
        <table className="w-full min-w-max" style={{ tableLayout: hasExplicitWidths ? 'fixed' : 'auto' }}>
        <thead className="bg-slate-50 dark:bg-slate-800">
          <tr className="border-b-2 border-slate-200 dark:border-slate-700">
            {columns.map((col, idx) => (
              <th
                key={idx}
                className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ${col.className ?? ''}`}
                style={{ width: col.width }}
              >
                <div className="whitespace-nowrap">{col.header}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-slate-900">
          {data.map((item, rowIndex) => (
            <tr
              key={keyExtractor(item)}
              className={`border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(item) : ''}`}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
            >
              {columns.map((col, idx) => (
                <td 
                  key={idx} 
                  className={`px-4 py-3 text-sm text-slate-900 dark:text-slate-100 ${col.className ?? ''}`}
                  style={{ width: col.width }}
                >
                  <div className={`whitespace-nowrap ${col.className?.includes('wrap') ? 'whitespace-normal' : ''}`}>{col.accessor(item, rowIndex)}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
