import jsPDF from 'jspdf'

export type QuotePdfItem = {
  sku: string
  name: string
  quantity: number
  quantityLabel?: string
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

  // Products table
  const colWidths = [35, 50, 20, 20, 30, 30]
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
  quoteData.items.forEach((item: QuotePdfItem) => {
    if (yPosition > pageHeight - margin - 20) {
      pdf.addPage()
      yPosition = margin
    }

    const skuText = sanitizePdfText(item.sku)
    const skuLines = []
    if (skuText.length > 10) {
      // Split SKU into two lines if longer than 10 chars
      const mid = Math.ceil(skuText.length / 2)
      skuLines.push(skuText.substring(0, mid), skuText.substring(mid))
    } else {
      skuLines.push(skuText)
    }
    const nameText = sanitizePdfText(item.name)
    const nameLines = []
    if (nameText.length > 30) {
      // Split into two lines
      const words = nameText.split(' ')
      let line1 = ''
      let line2 = ''
      for (const word of words) {
        if ((line1 + ' ' + word).length <= 30) {
          line1 += (line1 ? ' ' : '') + word
        } else if ((line2 + ' ' + word).length <= 30) {
          line2 += (line2 ? ' ' : '') + word
        } else {
          // If still too long, truncate
          line2 = line2.substring(0, 27) + '...'
          break
        }
      }
      nameLines.push(line1, line2)
    } else {
      nameLines.push(nameText)
    }

    const rowData = [
      '', // SKU handled separately
      '', // Name handled separately
      sanitizePdfText(item.quantityLabel ? String(item.quantityLabel) : String(item.quantity)),
      String(item.discountPct),
      `${money(item.unitPrice)} ${sanitizePdfText(quoteData.currency)}`,
      `${money(item.lineTotal)} ${sanitizePdfText(quoteData.currency)}`,
    ]

    const maxLines = Math.max(skuLines.length, nameLines.length)

    // Draw SKU lines
    skuLines.forEach((line, idx) => {
      pdf.text(line, margin, yPosition + idx * 4)
    })
    // Draw product name lines
    nameLines.forEach((line, idx) => {
      pdf.text(line, margin + colWidths[0], yPosition + idx * 4)
    })
    // Draw other columns at the first line position
    for (let i = 2; i < rowData.length; i++) {
      let x = margin
      for (let j = 0; j < i; j++) x += colWidths[j]
      pdf.text(rowData[i], x, yPosition)
    }

    yPosition += maxLines * 5
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

  // Products table
  const colWidths = [50, 35, 35, 25, 35]
  const headers = ['Producto', 'Lote', 'Vencimiento', 'Cantidad', 'Presentación']

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
  deliveryData.items.forEach((item) => {
    if (yPosition > pageHeight - margin - 40) { // More space for signature table
      pdf.addPage()
      yPosition = margin
    }

    const productText = sanitizePdfText(item.productName)
    const productLines = []
    if (productText.length > 35) {
      // Split into two lines
      const words = productText.split(' ')
      let line1 = ''
      let line2 = ''
      for (const word of words) {
        if ((line1 + ' ' + word).length <= 35) {
          line1 += (line1 ? ' ' : '') + word
        } else if ((line2 + ' ' + word).length <= 35) {
          line2 += (line2 ? ' ' : '') + word
        } else {
          // If still too long, truncate
          line2 = line2.substring(0, 32) + '...'
          break
        }
      }
      productLines.push(line1, line2)
    } else {
      productLines.push(productText)
    }

    const rowData = [
      '', // Product handled separately
      sanitizePdfText(item.batchNumber),
      sanitizePdfText(item.expiresAt),
      String(item.quantity),
      item.presentationName && item.presentationQuantity && item.unitsPerPresentation
        ? item.unitsPerPresentation > 1
          ? `${item.presentationName.toLowerCase()} de ${item.unitsPerPresentation}u`
          : `Unidades`
        : '—',
    ]

    const maxLines = productLines.length

    // Draw product name lines
    productLines.forEach((line, idx) => {
      pdf.text(line, margin, yPosition + idx * 4)
    })
    // Draw other columns at the first line position
    for (let i = 1; i < rowData.length; i++) {
      let x = margin
      for (let j = 0; j < i; j++) x += colWidths[j]
      pdf.text(rowData[i], x, yPosition)
    }

    yPosition += maxLines * 5
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
