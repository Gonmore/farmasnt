import jsPDF from 'jspdf'
import { formatDateOnlyUtc } from './date'

export type PickingPdfRequestedLine = {
  productLabel: string
  quantityUnits: number
  presentationLabel: string
}

export type PickingPdfSentLine = {
  locationCode: string
  productLabel: string
  batchNumber: string | null
  expiresAt: string | null
  quantityUnits: number
  presentationLabel: string
}

export type PickingPdfMeta = {
  requestId: string
  generatedAtIso: string
  fromWarehouseLabel: string
  fromLocationCode: string
  toWarehouseLabel: string
  toLocationCode: string
  requestedByName?: string | null
}

export type LabelPdfData = {
  requestId: string
  generatedAtIso: string
  fromWarehouseLabel: string
  fromLocationCode: string
  toWarehouseLabel: string
  toLocationCode: string
  requestedByName?: string | null
  bultos: string
  responsable: string
  observaciones: string
}

function sanitizePdfText(value: string): string {
  return (value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()
}

function savePdf(pdf: jsPDF, filename: string): void {
  pdf.save(filename)
}

export function exportPickingToPdf(
  meta: PickingPdfMeta,
  requested: PickingPdfRequestedLine[],
  sent: PickingPdfSentLine[],
): void {
  const pdf = new jsPDF('p', 'mm', 'letter')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  const margin = 20
  const marginBottom = 18
  const tableFontSize = 8

  const title = 'PICKING'

  const header = () => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    pdf.text(title, pageWidth / 2, margin, { align: 'center' })

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)

    const dateStr = new Date(meta.generatedAtIso).toLocaleString()
    const infoLines = [
      `Fecha: ${sanitizePdfText(dateStr)}`,
      `Solicitante: ${sanitizePdfText(meta.requestedByName ?? '—')}`,
      `Origen: ${sanitizePdfText(meta.fromWarehouseLabel)} · ${sanitizePdfText(meta.fromLocationCode)}`,
      `Destino: ${sanitizePdfText(meta.toWarehouseLabel)} · ${sanitizePdfText(meta.toLocationCode)}`,
    ]

    let y = margin + 10
    for (const l of infoLines) {
      pdf.text(l, margin, y)
      y += 5
    }

    return y + 4
  }

  const ensureSpace = (y: number, needed: number) => {
    const maxY = pageHeight - marginBottom
    if (y + needed <= maxY) return y
    pdf.addPage()
    return header()
  }

  const drawSectionTitle = (label: string, y: number) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.text(label, margin, y)
    pdf.setFont('helvetica', 'normal')
    return y + 6
  }

  let y = header()

  // SOLICITADO
  if ((requested ?? []).length > 0) {
    y = ensureSpace(y, 18)
    y = drawSectionTitle('SOLICITADO', y)

    const colW = [90, 25, pageWidth - margin * 2 - 90 - 25]
    const headers = ['Producto', 'Cant', 'Presentación']

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(tableFontSize)
    headers.forEach((h, i) => {
      const x = margin + (i === 0 ? 0 : colW.slice(0, i).reduce((a, b) => a + b, 0))
      pdf.text(h, x, y)
    })
    y += 5
    pdf.line(margin, y, pageWidth - margin, y)
    y += 4
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(tableFontSize)

    for (const it of requested) {
      y = ensureSpace(y, 10)
      const productText = sanitizePdfText(it.productLabel)
      const productLines = pdf.splitTextToSize(productText, colW[0] - 2)
      const rowH = Math.max(5, productLines.length * 4)

      pdf.text(productLines, margin, y)
      pdf.text(String(Math.ceil(Number(it.quantityUnits ?? 0))), margin + colW[0], y)
      pdf.text(sanitizePdfText(it.presentationLabel ?? '—'), margin + colW[0] + colW[1], y)

      y += rowH
    }

    y += 6
  }

  // ENVIADO
  y = ensureSpace(y, 18)
  y = drawSectionTitle('ENVIADO', y)

  const col = {
    ubic: { w: 18 },
    lote: { w: 34 },
    vence: { w: 28 },
    cant: { w: 14 },
    pres: { w: 30 },
  }
  const productW = pageWidth - margin * 2 - col.ubic.w - col.lote.w - col.vence.w - col.cant.w - col.pres.w

  const x = {
    ubic: margin,
    lote: margin + col.ubic.w,
    vence: margin + col.ubic.w + col.lote.w,
    cant: margin + col.ubic.w + col.lote.w + col.vence.w,
    pres: margin + col.ubic.w + col.lote.w + col.vence.w + col.cant.w,
    prod: margin + col.ubic.w + col.lote.w + col.vence.w + col.cant.w + col.pres.w,
  }

  const sorted = [...(sent ?? [])].sort((a, b) => {
    const c1 = String(a.locationCode ?? '').localeCompare(String(b.locationCode ?? ''))
    if (c1 !== 0) return c1
    const e1 = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER
    const e2 = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER
    if (e1 !== e2) return e1 - e2
    const c2 = String(a.batchNumber ?? '').localeCompare(String(b.batchNumber ?? ''))
    if (c2 !== 0) return c2
    return String(a.productLabel ?? '').localeCompare(String(b.productLabel ?? ''))
  })

  const drawSentTableHeader = (yy: number) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(tableFontSize)
    pdf.text('Ubic', x.ubic, yy)
    pdf.text('Lote', x.lote, yy)
    pdf.text('Vence', x.vence, yy)
    pdf.text('Cant', x.cant, yy)
    pdf.text('Pres', x.pres, yy)
    pdf.text('Producto', x.prod, yy)
    yy += 5
    pdf.line(margin, yy, pageWidth - margin, yy)
    return yy + 4
  }

  y = drawSentTableHeader(y)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(tableFontSize)

  for (const line of sorted) {
    const loc = sanitizePdfText(line.locationCode ?? '—')
    const lote = sanitizePdfText(line.batchNumber ?? '—')
    const vence = line.expiresAt ? sanitizePdfText(formatDateOnlyUtc(line.expiresAt)) : '—'
    const qty = String(Math.ceil(Number(line.quantityUnits ?? 0)))
    const pres = sanitizePdfText(line.presentationLabel ?? '—')
    const productText = sanitizePdfText(line.productLabel ?? '—')
    const productLines = pdf.splitTextToSize(productText, productW - 2)
    const rowH = Math.max(5, productLines.length * 4)

    y = ensureSpace(y, rowH + 8)

    pdf.text(loc, x.ubic, y)
    pdf.text(lote, x.lote, y)
    pdf.text(vence, x.vence, y)
    pdf.text(qty, x.cant, y)
    pdf.text(pres, x.pres, y)
    pdf.text(productLines, x.prod, y)

    y += rowH
  }

  savePdf(pdf, `picking-${sanitizePdfText(meta.requestId)}.pdf`)
}

export function exportLabelToPdf(data: LabelPdfData): void {
  // Hoja carta horizontal
  const pdf = new jsPDF('l', 'mm', 'letter')
  const w = pdf.internal.pageSize.getWidth()
  const h = pdf.internal.pageSize.getHeight()
  const frameMargin = 20 // Más pequeño
  const innerPad = 8
  const frameX = frameMargin
  const frameY = frameMargin
  const frameW = w - frameMargin * 2
  const frameH = h - frameMargin * 2
  const leftX = frameX + innerPad
  const rightX = frameX + frameW - innerPad

  const recipient = (data.requestedByName ?? '').trim()
  const sender = (data.responsable ?? '').trim()
  const destino = sanitizePdfText(data.toWarehouseLabel ?? '—')
  const origen = sanitizePdfText(data.fromWarehouseLabel ?? '—')

  // Marco (recuadro) negro
  pdf.setDrawColor(0, 0, 0)
  pdf.setLineWidth(0.8)
  pdf.rect(frameX, frameY, frameW, frameH)

  // DESTINO (arriba izquierda, fuente más grande)
  let y = frameY + 16
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('Para:', leftX, y)

  const paraX = leftX + 22
  const paraW = frameX + frameW - innerPad - paraX
  pdf.line(paraX, y + 2, paraX + paraW, y + 2)
  if (recipient) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    const recipientText = sanitizePdfText(recipient)
    const recipientLines = pdf.splitTextToSize(recipientText, paraW - 4)
    pdf.text(recipientLines, paraX + 2, y)
  }

  y += 20
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('C.I.:', leftX, y)
  const ciX = leftX + 22
  pdf.line(ciX, y + 2, ciX + 90, y + 2)

  y += 20
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('Destino:', leftX, y)
  pdf.setFontSize(18)
  const destinoX = leftX + 32
  const destinoW = frameX + frameW - innerPad - destinoX
  const destinoLines = pdf.splitTextToSize(destino || '—', destinoW)
  pdf.text(destinoLines, destinoX, y)

  // ORIGEN (un poco más abajo, a la derecha)
  const originBlockW = 125
  const originX = Math.max(leftX, rightX - originBlockW)
  let oy = frameY + frameH - 48

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text('De:', originX, oy)
  const deX = originX + 12
  pdf.line(deX, oy + 1.6, originX + originBlockW, oy + 1.6)
  if (sender) {
    pdf.setFont('helvetica', 'bold')
    const senderText = sanitizePdfText(sender)
    const senderLines = pdf.splitTextToSize(senderText, originBlockW - 14)
    pdf.text(senderLines, deX + 2, oy)
  }

  oy += 10
  pdf.setFont('helvetica', 'bold')
  pdf.text(origen || '—', originX + 12, oy)

  savePdf(pdf, `rotulo-${sanitizePdfText(data.requestId)}.pdf`)
}
