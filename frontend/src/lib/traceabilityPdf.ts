import jsPDF from 'jspdf'

export type TraceabilityPdfItem = {
  productLabel: string
  presentationName?: string | null
  requested: number
  remaining: number
}

export type TraceabilityPdfShipment = {
  productLabel: string
  batchNumber?: string | null
  movementNumber?: string | null
  createdAt: string
  createdByName?: string | null
  sentQuantity: string
  stateLabel: string
}

export type TraceabilityPdfData = {
  code: string
  route: string
  statusLabel: string
  createdAt: string
  requestedByName?: string | null
  fulfilledAt?: string | null
  fulfilledByName?: string | null
  confirmedAt?: string | null
  confirmedByName?: string | null
  note?: string | null
  items: TraceabilityPdfItem[]
  timeline: string[]
  shipments: TraceabilityPdfShipment[]
  tenantName: string
  logoUrl?: string | null
}

function sanitizePdfText(value: string): string {
  return (value ?? '').replace(/[^\x20-\x7E]/g, '').trim()
}

function loadLogoImage(logoUrl?: string | null): Promise<string | null> {
  if (!logoUrl) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          if (!ctx) return resolve(null)
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          ctx.drawImage(img, 0, 0)
          resolve(canvas.toDataURL('image/png'))
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      img.src = logoUrl
    } catch {
      resolve(null)
    }
  })
}

type TableColumn = { header: string; width: number; align?: 'left' | 'right' | 'center' }

type PreparedRow = { linesByColumn: string[][]; height: number }

function splitCellText(pdf: jsPDF, text: string, width: number): string[] {
  const sanitized = sanitizePdfText(text) || '—'
  const maxWidth = Math.max(8, width - 3)
  const lines = pdf.splitTextToSize(sanitized, maxWidth)
  return Array.isArray(lines) ? lines.map((l) => String(l)) : [String(lines)]
}

function prepareRow(pdf: jsPDF, columns: TableColumn[], values: string[]): PreparedRow {
  const linesByColumn = values.map((value, i) => splitCellText(pdf, value, columns[i]?.width ?? 20))
  const maxLines = Math.max(...linesByColumn.map((lines) => lines.length), 1)
  return { linesByColumn, height: maxLines * 4 + 3 }
}

function drawTableHeader(pdf: jsPDF, columns: TableColumn[], startX: number, y: number) {
  let x = startX
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  columns.forEach((col) => {
    const textX = col.align === 'right' ? x + col.width - 1.5 : x + 1.5
    pdf.text(col.header, textX, y, col.align === 'right' ? { align: 'right' } : undefined)
    x += col.width
  })
  pdf.line(startX, y + 2, startX + columns.reduce((s, c) => s + c.width, 0), y + 2)
}

function drawPreparedRow(pdf: jsPDF, columns: TableColumn[], row: PreparedRow, startX: number, y: number) {
  let x = startX
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  columns.forEach((col, ci) => {
    const lines = row.linesByColumn[ci] ?? ['—']
    lines.forEach((line, li) => {
      const textY = y + 1.5 + li * 4
      const textX = col.align === 'right' ? x + col.width - 1.5 : x + 1.5
      pdf.text(line, textX, textY, col.align === 'right' ? { align: 'right' } : undefined)
    })
    x += col.width
  })
}

export async function exportTraceabilityToPDF(data: TraceabilityPdfData): Promise<void> {
  const pdf = new jsPDF('p', 'mm', 'letter')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 20
  const logoData = await loadLogoImage(data.logoUrl)

  // Watermark with request code
  pdf.saveGraphicsState()
  pdf.setFontSize(70)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(200, 220, 235)
  pdf.text(sanitizePdfText(data.code), pageWidth / 2 + 15, pageHeight / 2 + 20, { angle: 45, align: 'center' })
  pdf.restoreGraphicsState()

  let y = margin

  // Logo top-left
  if (logoData) {
    try {
      const logoHeight = 22
      const aspectRatio = 1 // addImage can infer; keep simple
      pdf.addImage(logoData, 'PNG', margin, y, logoHeight * aspectRatio, logoHeight)
    } catch {
      /* ignore */
    }
  }

  // Title (centered, next to logo row)
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  pdf.text('TRAZABILIDAD DE SOLICITUD', pageWidth / 2, y + 8, { align: 'center' })
  y += logoData ? 30 : 16

  // Header info block
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'bold')
  pdf.text(sanitizePdfText(data.tenantName), margin, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Código: ${sanitizePdfText(data.code)}`, margin, y)
  y += 5
  pdf.text(`Ruta: ${sanitizePdfText(data.route)}`, margin, y)
  y += 5
  pdf.text(`Estado: ${sanitizePdfText(data.statusLabel)}`, margin, y)
  y += 5
  pdf.text(`Creada: ${sanitizePdfText(data.createdAt)}${data.requestedByName ? ` • ${sanitizePdfText(data.requestedByName)}` : ''}`, margin, y)
  y += 5

  if (data.fulfilledAt) {
    pdf.text(`Atendida: ${sanitizePdfText(data.fulfilledAt)}${data.fulfilledByName ? ` • ${sanitizePdfText(data.fulfilledByName)}` : ''}`, margin, y)
    y += 5
  }
  if (data.confirmedAt) {
    pdf.text(`Recepción/confirmación: ${sanitizePdfText(data.confirmedAt)}${data.confirmedByName ? ` • ${sanitizePdfText(data.confirmedByName)}` : ''}`, margin, y)
    y += 5
  }

  if (data.note) {
    pdf.text(`Nota: ${sanitizePdfText(data.note)}`, margin, y)
    y += 5
  }

  y += 4

  // Items table
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('Ítems solicitados', margin, y)
  y += 6

  const tableWidth = pageWidth - margin * 2
  const itemColumns: TableColumn[] = [
    { header: 'Producto', width: tableWidth * 0.5 },
    { header: 'Presentación', width: tableWidth * 0.2 },
    { header: 'Solicitado', width: tableWidth * 0.15, align: 'right' },
    { header: 'Pendiente', width: tableWidth * 0.15, align: 'right' },
  ]
  drawTableHeader(pdf, itemColumns, margin, y)
  y += 6

  if (data.items.length === 0) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text('Sin ítems.', margin, y)
    y += 6
  }

  data.items.forEach((it) => {
    const row = prepareRow(pdf, itemColumns, [
      it.productLabel,
      it.presentationName ?? '—',
      formatNumber(it.requested),
      formatNumber(it.remaining),
    ])
    if (y + row.height > pageHeight - margin - 40) {
      pdf.addPage()
      y = margin
      drawTableHeader(pdf, itemColumns, margin, y)
      y += 6
    }
    drawPreparedRow(pdf, itemColumns, row, margin, y)
    y += row.height
  })

  y += 6

  // Timeline
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('Timeline', margin, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  data.timeline.forEach((step) => {
    const row = prepareRow(pdf, [{ header: '', width: tableWidth }], [step])
    if (y + row.height > pageHeight - margin - 40) {
      pdf.addPage()
      y = margin
    }
    drawPreparedRow(pdf, [{ header: '', width: tableWidth }], row, margin, y)
    y += row.height
  })

  y += 4

  // Shipments
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('Envíos', margin, y)
  y += 6

  const shipColumns: TableColumn[] = [
    { header: 'Producto', width: tableWidth * 0.24 },
    { header: 'Lote', width: tableWidth * 0.12 },
    { header: 'Movimiento', width: tableWidth * 0.16 },
    { header: 'Enviado', width: tableWidth * 0.14, align: 'right' },
    { header: 'Estado', width: tableWidth * 0.14 },
    { header: 'Fecha', width: tableWidth * 0.1 },
    { header: 'Por', width: tableWidth * 0.1 },
  ]
  drawTableHeader(pdf, shipColumns, margin, y)
  y += 6

  if (data.shipments.length === 0) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text('Sin envíos.', margin, y)
    y += 6
  }

  data.shipments.forEach((s) => {
    const row = prepareRow(pdf, shipColumns, [
      s.productLabel,
      s.batchNumber ?? '—',
      s.movementNumber ?? '—',
      s.sentQuantity,
      s.stateLabel,
      s.createdAt,
      s.createdByName ?? '—',
    ])
    if (y + row.height > pageHeight - margin - 40) {
      pdf.addPage()
      y = margin
      drawTableHeader(pdf, shipColumns, margin, y)
      y += 6
    }
    drawPreparedRow(pdf, shipColumns, row, margin, y)
    y += row.height
  })

  // Ensure signature block fits on the last page; else add a page
  if (y > pageHeight - margin - 40) {
    pdf.addPage()
    y = margin
  }

  y = Math.max(y, pageHeight - margin - 34)

  // Signature boxes
  const sigWidth = (pageWidth - margin * 2) / 2
  pdf.rect(margin, y, sigWidth, 30)
  pdf.rect(margin + sigWidth, y, sigWidth, 30)

  pdf.line(margin + 5, y + 16, margin + sigWidth - 5, y + 16)
  pdf.line(margin + sigWidth + 5, y + 16, margin + sigWidth + sigWidth - 5, y + 16)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  const requesterName = sanitizePdfText(data.requestedByName ?? '')
  const attenderName = sanitizePdfText(data.fulfilledByName ?? '')

  pdf.text('Solicita / Recibe', margin + 5, y + 12)
  pdf.text(`Nombre: ${requesterName || '—'}`, margin + 5, y + 22)
  pdf.text('Fecha: __________________', margin, y + 27)

  pdf.text('Atiende / Envía', margin + sigWidth + 5, y + 12)
  pdf.text(`Nombre: ${attenderName || '—'}`, margin + sigWidth + 5, y + 22)
  pdf.text('Fecha: __________________', margin + sigWidth + 5, y + 27)

  pdf.save(`trazabilidad-${sanitizePdfText(data.code)}.pdf`)
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value)
  return Math.abs(value - rounded) < 1e-9 ? String(rounded) : value.toFixed(2)
}
