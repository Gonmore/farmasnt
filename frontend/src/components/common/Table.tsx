import type { ReactNode } from 'react'

export interface Column<T> {
  header: string
  accessor: (item: T) => ReactNode
  className?: string
}

export interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (item: T) => string
  rowClassName?: (item: T) => string
}

export function Table<T>({ columns, data, keyExtractor, rowClassName }: TableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            {columns.map((col, idx) => (
              <th
                key={idx}
                className={`px-4 py-4 text-left font-medium text-slate-700 dark:text-slate-300 ${col.className ?? ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr
              key={keyExtractor(item)}
              className={`border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900 py-2 ${rowClassName ? rowClassName(item) : ''}`}
            >
              {columns.map((col, idx) => (
                <td key={idx} className={`px-4 py-4 text-slate-900 dark:text-slate-100 ${col.className ?? ''}`}>
                  {col.accessor(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
