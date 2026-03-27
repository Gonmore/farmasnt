import jsPDF from 'jspdf'
import { formatPresentationLabel } from './productPresentation'

export type QuotePdfItem = {
  sku: string
  name: string
  quantity: number
  quantityLabel?: string
  baseUnitAbbreviation?: string
  discountPct: number
  unitPrice: number
  lineTotal: number
}

export type QuotePdfData = {
  quoteNumber: string
  customerName: string
  quotedBy?: string
  validityDays: string
  paymentMode: string
  deliveryDays: string
  deliveryCity?: string
  deliveryZone?: string
  deliveryAddress?: string
  globalDiscountPct: string
  proposalValue: string
  items: QuotePdfItem[]
  subtotal: number
  globalDiscountAmount: number
  totalAfterGlobal: number
  currency: string
  tenant: any
  logoUrl?: string
}

export type DeliveryNotePdfItem = {
  productName: string
  batchNumber: string
  expiresAt: string
  quantity: number
  presentationName?: string
  presentationQuantity?: number
  unitsPerPresentation?: number
  baseUnitAbbreviation?: string
}

export type DeliveryNotePdfData = {
  orderNumber: string
  customerName: string
  deliveryDate: string
  deliveryCity?: string
  deliveryZone?: string
  deliveryAddress?: string
  items: DeliveryNotePdfItem[]
  tenant: any
  logoUrl?: string
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function sanitizePdfText(value: string): string {
  return (value ?? '').replace(/[^\x20-\x7E]/g, '').trim()
}

type TableAlign = 'left' | 'right' | 'center'

type TableColumn = {
  header: string
  width: number
  align?: TableAlign
}

type PreparedTableRow = {
  linesByColumn: string[][]
  height: number
}

function splitCellText(pdf: jsPDF, text: string, width: number): string[] {
  const sanitized = sanitizePdfText(text) || '—'
  const maxWidth = Math.max(8, width - 3)
  const lines = pdf.splitTextToSize(sanitized, maxWidth)
  return Array.isArray(lines) ? lines.map((line) => String(line)) : [String(lines)]
}

function prepareTableRow(pdf: jsPDF, columns: TableColumn[], values: string[]): PreparedTableRow {
  const linesByColumn = values.map((value, index) => splitCellText(pdf, value, columns[index]?.width ?? 20))
  const maxLines = Math.max(...linesByColumn.map((lines) => lines.length), 1)
  return {
    linesByColumn,
    height: maxLines * 4 + 3,
  }
}

function drawTableHeader(pdf: jsPDF, columns: TableColumn[], startX: number, y: number) {
  let x = startX
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  columns.forEach((column) => {
    const textX = column.align === 'right' ? x + column.width - 1.5 : x + 1.5
    pdf.text(column.header, textX, y, column.align === 'right' ? { align: 'right' } : undefined)
    x += column.width
  })
  pdf.line(startX, y + 2, startX + columns.reduce((sum, column) => sum + column.width, 0), y + 2)
}

function drawPreparedRow(pdf: jsPDF, columns: TableColumn[], row: PreparedTableRow, startX: number, y: number) {
  let x = startX
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)

  columns.forEach((column, columnIndex) => {
    const lines = row.linesByColumn[columnIndex] ?? ['—']
    lines.forEach((line, lineIndex) => {
      const textY = y + 1.5 + lineIndex * 4
      const textX =
        column.align === 'right'
          ? x + column.width - 1.5
          : column.align === 'center'
            ? x + column.width / 2
            : x + 1.5
      const options =
        column.align === 'right' ? { align: 'right' as const } : column.align === 'center' ? { align: 'center' as const } : undefined
      pdf.text(line, textX, textY, options)
    })
    x += column.width
  })

  pdf.line(startX, y + row.height - 0.5, startX + columns.reduce((sum, column) => sum + column.width, 0), y + row.height - 0.5)
}

export async function exportQuoteToPDF(quoteData: QuotePdfData): Promise<void> {
  const pdf = new jsPDF('p', 'mm', 'letter')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 20
  let yPosition = margin

  // Add watermark first (background)
  pdf.saveGraphicsState()
  pdf.setFontSize(70)
  pdf.setFont('helvetica', 'bold')
  const centerX = pageWidth / 2 + 15 // Move to the right to respect margins
  const centerY = pageHeight / 2 + 20 // Move down a bit
  pdf.setTextColor(200, 220, 235) // Very light sky blue for watermark
  pdf.text(quoteData.quoteNumber, centerX, centerY, { 
    angle: 45,
    align: 'center'
  })
  pdf.restoreGraphicsState()

  // Title
  pdf.setFontSize(18)
  pdf.setFont('helvetica', 'bold')
  pdf.text('COTIZACIÓN', pageWidth / 2, yPosition, { align: 'center' })
  yPosition += 15

  // Save starting position for details section
  const detailsStartY = yPosition

  // Left column: Company name and details
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'bold')
  pdf.text(sanitizePdfText(quoteData.tenant.branding?.tenantName ?? 'Empresa'), margin, yPosition)
  yPosition += 8

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Cotización: ${sanitizePdfText(quoteData.quoteNumber)}`, margin, yPosition)
  yPosition += 6
  pdf.text(`Fecha: ${new Date().toLocaleDateString()}`, margin, yPosition)
  yPosition += 6
  pdf.text(`Cliente: ${sanitizePdfText(quoteData.customerName)}`, margin, yPosition)
  yPosition += 6
  if ((quoteData.quotedBy ?? '').trim()) {
    pdf.text(`Cotizado por: ${sanitizePdfText(quoteData.quotedBy ?? '')}`, margin, yPosition)
    yPosition += 6
  }
  pdf.text(`Validez: ${sanitizePdfText(quoteData.validityDays)} día(s)`, margin, yPosition)

  // Right side: Logo (if available) - positioned at the same level as company name
  if (quoteData.logoUrl) {
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = quoteData.logoUrl!
      })
      
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
      const imgData = canvas.toDataURL('image/png')
      
      // Logo dimensions: 35mm height, maintain aspect ratio
      const logoHeight = 35
      const aspectRatio = img.naturalWidth / img.naturalHeight
      const logoWidth = logoHeight * aspectRatio
      
      // Position logo on the right side, aligned with company name
      const logoX = pageWidth - margin - logoWidth
      pdf.addImage(imgData, 'PNG', logoX, detailsStartY, logoWidth, logoHeight)
    } catch (error) {
      console.warn('Failed to load logo for PDF:', error)
      // Fallback: draw a text placeholder for the logo
      pdf.setFontSize(12)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(150, 150, 150) // Gray color
      const logoX = pageWidth - margin - 40 // Approximate space for logo
      pdf.text('[LOGO]', logoX, detailsStartY + 10)
      pdf.setTextColor(0, 0, 0) // Reset to black
    }
  }

  yPosition += 18 // More space between header and body

  const tableWidth = pageWidth - margin * 2
  const quoteColumns: TableColumn[] = [
    { header: 'SKU', width: tableWidth * 0.16 },
    { header: 'Producto', width: tableWidth * 0.3 },
    { header: 'Cant.', width: tableWidth * 0.18 },
    { header: 'Desc.%', width: tableWidth * 0.09, align: 'right' },
    { header: 'Precio Unit.', width: tableWidth * 0.13, align: 'right' },
    { header: 'Total', width: tableWidth * 0.14, align: 'right' },
  ]

  drawTableHeader(pdf, quoteColumns, margin, yPosition)
  yPosition += 6

  quoteData.items.forEach((item: QuotePdfItem) => {
    const row = prepareTableRow(pdf, quoteColumns, [
      item.sku,
      item.name,
      item.quantityLabel ? String(item.quantityLabel) : String(item.quantity),
      String(item.discountPct),
      `${money(item.unitPrice)} ${sanitizePdfText(quoteData.currency)}`,
      `${money(item.lineTotal)} ${sanitizePdfText(quoteData.currency)}`,
    ])

    if (yPosition + row.height > pageHeight - margin - 20) {
      pdf.addPage()
      yPosition = margin
      drawTableHeader(pdf, quoteColumns, margin, yPosition)
      yPosition += 6
    }

    drawPreparedRow(pdf, quoteColumns, row, margin, yPosition)
    yPosition += row.height
  })

  yPosition += 5

  if (yPosition > pageHeight - margin - 30) {
    pdf.addPage()
    yPosition = margin
  }

  pdf.setFont('helvetica', 'bold')
  pdf.text(`Subtotal: ${money(quoteData.subtotal)} ${sanitizePdfText(quoteData.currency)}`, pageWidth - margin, yPosition, { align: 'right' })
  yPosition += 6

  if (quoteData.globalDiscountAmount > 0) {
    pdf.text(
      `Desc. global (${sanitizePdfText(quoteData.globalDiscountPct)}%): -${money(quoteData.globalDiscountAmount)} ${sanitizePdfText(quoteData.currency)}`,
      pageWidth - margin,
      yPosition,
      { align: 'right' },
    )
    yPosition += 6
  }

  pdf.setFontSize(11)
  pdf.text(`TOTAL FINAL: ${money(quoteData.totalAfterGlobal)} ${sanitizePdfText(quoteData.currency)}`, pageWidth - margin, yPosition, { align: 'right' })
  yPosition += 10

  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Forma de pago: ${sanitizePdfText(quoteData.paymentMode)}`, margin, yPosition)
  yPosition += 5
  pdf.text(`Tiempo de entrega: ${sanitizePdfText(quoteData.deliveryDays)} día(s)`, margin, yPosition)
  yPosition += 5

  const deliveryParts = [quoteData.deliveryAddress, quoteData.deliveryZone, quoteData.deliveryCity]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
  if (deliveryParts.length > 0) {
    pdf.text(`Lugar de entrega: ${sanitizePdfText(deliveryParts.join(', '))}`, margin, yPosition)
    yPosition += 5
  }

  if (quoteData.proposalValue.trim()) {
    pdf.text(`Valor de propuesta: ${sanitizePdfText(quoteData.proposalValue)}`, margin, yPosition)
  }

  pdf.save(`cotizacion-${sanitizePdfText(quoteData.quoteNumber)}.pdf`)

  return
}

export async function exportDeliveryNoteToPDF(deliveryData: DeliveryNotePdfData): Promise<void> {
  const pdf = new jsPDF('p', 'mm', 'letter')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 20
  let yPosition = margin

  // Add watermark first (background)
  pdf.saveGraphicsState()
  pdf.setFontSize(70)
  pdf.setFont('helvetica', 'bold')
  const centerX = pageWidth / 2 + 15 // Move to the right to respect margins
  const centerY = pageHeight / 2 + 20 // Move down a bit
  pdf.setTextColor(200, 220, 235) // Very light sky blue for watermark
  pdf.text(deliveryData.orderNumber, centerX, centerY, { 
    angle: 45,
    align: 'center'
  })
  pdf.restoreGraphicsState()

  // Title
  pdf.setFontSize(18)
  pdf.setFont('helvetica', 'bold')
  pdf.text('NOTA DE ENTREGA', pageWidth / 2, yPosition, { align: 'center' })
  yPosition += 15

  // Save starting position for details section
  const detailsStartY = yPosition

  // Left column: Company name and details
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'bold')
  pdf.text(sanitizePdfText(deliveryData.tenant.branding?.tenantName ?? 'Empresa'), margin, yPosition)
  yPosition += 8

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Orden: ${sanitizePdfText(deliveryData.orderNumber)}`, margin, yPosition)
  yPosition += 6
  pdf.text(`Fecha de entrega: ${sanitizePdfText(deliveryData.deliveryDate)}`, margin, yPosition)
  yPosition += 6
  pdf.text(`Cliente: ${sanitizePdfText(deliveryData.customerName)}`, margin, yPosition)

  // Right side: Logo (if available) - positioned at the same level as company name
  if (deliveryData.logoUrl) {
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = deliveryData.logoUrl!
      })
      
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
      const imgData = canvas.toDataURL('image/png')
      
      // Logo dimensions: 35mm height, maintain aspect ratio
      const logoHeight = 35
      const aspectRatio = img.naturalWidth / img.naturalHeight
      const logoWidth = logoHeight * aspectRatio
      
      // Position logo on the right side, aligned with company name
      const logoX = pageWidth - margin - logoWidth
      pdf.addImage(imgData, 'PNG', logoX, detailsStartY, logoWidth, logoHeight)
    } catch (error) {
      console.warn('Failed to load logo for PDF:', error)
      // Fallback: draw a text placeholder for the logo
      pdf.setFontSize(12)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(150, 150, 150) // Gray color
      const logoX = pageWidth - margin - 40 // Approximate space for logo
      pdf.text('[LOGO]', logoX, detailsStartY + 10)
      pdf.setTextColor(0, 0, 0) // Reset to black
    }
  }

  yPosition += 18 // More space between header and body

  const deliveryTableWidth = pageWidth - margin * 2
  const deliveryColumns: TableColumn[] = [
    { header: 'Producto', width: deliveryTableWidth * 0.28 },
    { header: 'Lote', width: deliveryTableWidth * 0.16 },
    { header: 'Vencimiento', width: deliveryTableWidth * 0.17 },
    { header: 'Cantidad', width: deliveryTableWidth * 0.12, align: 'right' },
    { header: 'Presentación', width: deliveryTableWidth * 0.27 },
  ]

  drawTableHeader(pdf, deliveryColumns, margin, yPosition)
  yPosition += 6

  deliveryData.items.forEach((item) => {
    const row = prepareTableRow(pdf, deliveryColumns, [
      item.productName,
      item.batchNumber,
      item.expiresAt,
      String(item.quantity),
      formatPresentationLabel({
        name: item.presentationName ?? null,
        unitsPerPresentation: item.unitsPerPresentation ?? null,
        baseUnitAbbreviation: item.baseUnitAbbreviation ?? 'u',
      }),
    ])

    if (yPosition + row.height > pageHeight - margin - 40) {
      pdf.addPage()
      yPosition = margin
      drawTableHeader(pdf, deliveryColumns, margin, yPosition)
      yPosition += 6
    }

    drawPreparedRow(pdf, deliveryColumns, row, margin, yPosition)
    yPosition += row.height
  })

  yPosition += 10

  if (yPosition > pageHeight - margin - 50) {
    pdf.addPage()
    yPosition = margin
  }

  // Delivery location
  const deliveryParts = [deliveryData.deliveryAddress, deliveryData.deliveryZone, deliveryData.deliveryCity]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
  if (deliveryParts.length > 0) {
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`Lugar de entrega: ${sanitizePdfText(deliveryParts.join(', '))}`, margin, yPosition)
    yPosition += 15
  }

  // Signature table
  const tableWidth = pageWidth - 2 * margin
  const col1Width = tableWidth / 2
  const col2Width = tableWidth / 2

  // Draw table borders
  pdf.rect(margin, yPosition, col1Width, 30)
  pdf.rect(margin + col1Width, yPosition, col2Width, 30)

  // Signature line in left column
  pdf.line(margin + 5, yPosition + 15, margin + col1Width - 5, yPosition + 15)
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Recibido por:', margin + 5, yPosition + 20)
  pdf.text('Fecha:', margin + 5, yPosition + 25)

  // Company seal in right column
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'bold')
  const rightColumnCenter = margin + col1Width + (col2Width / 2)
  pdf.text('Sello de la empresa', rightColumnCenter, yPosition + 15, { align: 'center' })

  pdf.save(`nota-entrega-${sanitizePdfText(deliveryData.orderNumber)}.pdf`)

  return
}
