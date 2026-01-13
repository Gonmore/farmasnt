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
  validityDays: string
  paymentMode: string
  deliveryDays: string
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

export async function exportQuoteToPDF(quoteData: QuotePdfData): Promise<void> {
  const pdf = new jsPDF('p', 'mm', 'letter')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 20
  let yPosition = margin

  // Encabezado
  pdf.setFontSize(18)
  pdf.setFont('helvetica', 'bold')
  pdf.text('COTIZACIÓN', pageWidth / 2, yPosition, { align: 'center' })
  yPosition += 15

  // Información de la empresa
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'bold')
  pdf.text(quoteData.tenant.branding?.tenantName ?? 'Empresa', margin, yPosition)
  yPosition += 8

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Cotización: ${quoteData.quoteNumber}`, margin, yPosition)
  yPosition += 6
  pdf.text(`Fecha: ${new Date().toLocaleDateString()}`, margin, yPosition)
  yPosition += 6
  pdf.text(`Cliente: ${quoteData.customerName}`, margin, yPosition)
  yPosition += 6
  pdf.text(`Validez: ${quoteData.validityDays} día(s)`, margin, yPosition)
  yPosition += 10

  // Tabla de productos
  const colWidths = [25, 60, 20, 20, 30, 30] // SKU, Producto, Cant, Desc, Unit, Total
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
      item.sku,
      item.name.length > 25 ? item.name.substring(0, 22) + '...' : item.name,
      item.quantity.toString(),
      item.discountPct.toString(),
      `${money(item.unitPrice)} ${quoteData.currency}`,
      `${money(item.lineTotal)} ${quoteData.currency}`,
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
  pdf.text(`Total: ${money(quoteData.subtotal)} ${quoteData.currency}`, pageWidth - margin - 60, yPosition, { align: 'right' })
  yPosition += 6

  if (quoteData.globalDiscountAmount > 0) {
    pdf.text(
      `Desc. global (${quoteData.globalDiscountPct}%): -${money(quoteData.globalDiscountAmount)} ${quoteData.currency}`,
      pageWidth - margin - 60,
      yPosition,
      { align: 'right' },
    )
    yPosition += 6
  }

  pdf.setFontSize(11)
  pdf.text(`TOTAL FINAL: ${money(quoteData.totalAfterGlobal)} ${quoteData.currency}`, pageWidth - margin, yPosition, { align: 'right' })
  yPosition += 10

  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Forma de pago: ${quoteData.paymentMode}`, margin, yPosition)
  yPosition += 5
  pdf.text(`Tiempo de entrega: ${quoteData.deliveryDays} día(s)`, margin, yPosition)
  yPosition += 5
  if (quoteData.proposalValue.trim()) {
    pdf.text(`Valor de propuesta: ${quoteData.proposalValue}`, margin, yPosition)
  }

  pdf.save(`cotizacion-${quoteData.quoteNumber}.pdf`)
}
