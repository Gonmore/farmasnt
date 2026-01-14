import jsPDF from 'jspdf'

export type QuotePdfItem = {
  sku: string
  name: string
  quantity: number
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
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function sanitizePdfText(value: string): string {
  return (value ?? '').replace(/[^\x20-\x7E]/g, '').trim()
}

export async function exportQuoteToPDF(quoteData: QuotePdfData): Promise<void> {
  const pdf = new jsPDF('p', 'mm', 'letter')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 20
  let yPosition = margin

  pdf.setFontSize(18)
  pdf.setFont('helvetica', 'bold')
  pdf.text('COTIZACIÓN', pageWidth / 2, yPosition, { align: 'center' })
  yPosition += 15

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
  yPosition += 10

  const colWidths = [25, 60, 20, 20, 30, 30]
  const headers = ['SKU', 'Producto', 'Cant.', 'Desc.%', 'Precio Unit.', 'Total']

  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'bold')
  headers.forEach((header, i) => {
    let x = margin
    for (let j = 0; j < i; j++) x += colWidths[j]
    pdf.text(header, x, yPosition)
  })
  yPosition += 6

  pdf.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 4

  pdf.setFont('helvetica', 'normal')
  quoteData.items.forEach((item) => {
    if (yPosition > pageHeight - margin - 20) {
      pdf.addPage()
      yPosition = margin
    }

    const rowData = [
      sanitizePdfText(item.sku),
      sanitizePdfText(item.name.length > 25 ? item.name.substring(0, 22) + '...' : item.name),
      String(item.quantity),
      String(item.discountPct),
      `${money(item.unitPrice)} ${sanitizePdfText(quoteData.currency)}`,
      `${money(item.lineTotal)} ${sanitizePdfText(quoteData.currency)}`,
    ]

    rowData.forEach((data, i) => {
      let x = margin
      for (let j = 0; j < i; j++) x += colWidths[j]
      pdf.text(data, x, yPosition)
    })
    yPosition += 5
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
