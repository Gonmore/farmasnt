import * as XLSX from 'xlsx'

export type ExportSheet = {
  name: string
  rows: Array<Record<string, any>>
}

export function exportToXlsx(filename: string, sheets: ExportSheet[]): void {
  const wb = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows)
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }

  XLSX.writeFile(wb, filename)
}
