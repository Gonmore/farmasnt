import jsPDF from 'jspdf'

export type PickingPdfLine = {
  locationCode: string
  productLabel: string
  batchNumber: string | null
  expiresAt: string | null
  quantityUnits: number
  requestItemLabel?: string
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

export function exportPickingToPdf(meta: PickingPdfMeta, lines: PickingPdfLine[]): void {
  const pdf = new jsPDF('p', 'mm', 'letter')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  const marginX = 14
  const marginTop = 14
  const marginBottom = 14

  const title = `PICKING · Solicitud ${sanitizePdfText(meta.requestId)}`

  const header = () => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text(title, marginX, marginTop)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)

    const dateStr = new Date(meta.generatedAtIso).toLocaleString()

    const infoLines = [
      `Generado: ${sanitizePdfText(dateStr)}`,
      `Solicitante: ${sanitizePdfText(meta.requestedByName ?? '—')}`,
      `Origen: ${sanitizePdfText(meta.fromWarehouseLabel)} · ${sanitizePdfText(meta.fromLocationCode)}`,
      `Destino: ${sanitizePdfText(meta.toWarehouseLabel)} · ${sanitizePdfText(meta.toLocationCode)}`,
    ]

    let y = marginTop + 7
    for (const l of infoLines) {
      pdf.text(l, marginX, y)
      y += 4.2
    }

    return y + 2
  }

  const col = {
    ubic: { x: marginX, w: 20 },
    lote: { x: marginX + 22, w: 26 },
    vence: { x: marginX + 50, w: 20 },
    cant: { x: marginX + 72, w: 16 },
    prod: { x: marginX + 90, w: pageWidth - (marginX + 90) - marginX },
  }

  const drawTableHeader = (y: number) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.text('Ubic', col.ubic.x, y)
    pdf.text('Lote', col.lote.x, y)
    pdf.text('Vence', col.vence.x, y)
    pdf.text('Cant', col.cant.x, y)
    pdf.text('Producto', col.prod.x, y)

    pdf.setDrawColor(150)
    pdf.line(marginX, y + 1.5, pageWidth - marginX, y + 1.5)
    return y + 5
  }

  const sorted = [...lines].sort((a, b) => {
    const c1 = String(a.locationCode ?? '').localeCompare(String(b.locationCode ?? ''))
    if (c1 !== 0) return c1

    const e1 = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER
    const e2 = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER
    if (e1 !== e2) return e1 - e2

    const c2 = String(a.batchNumber ?? '').localeCompare(String(b.batchNumber ?? ''))
    if (c2 !== 0) return c2

    return String(a.productLabel ?? '').localeCompare(String(b.productLabel ?? ''))
  })

  let y = header()
  y = drawTableHeader(y)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)

  const maxY = pageHeight - marginBottom

  for (const line of sorted) {
    const loc = sanitizePdfText(line.locationCode ?? '—')
    const lote = sanitizePdfText(line.batchNumber ?? '—')
    const vence = line.expiresAt ? sanitizePdfText(new Date(line.expiresAt).toLocaleDateString()) : '—'
    const qty = String(Math.ceil(Number(line.quantityUnits ?? 0)))

    const productText = sanitizePdfText(
      line.requestItemLabel ? `${line.productLabel} · ${line.requestItemLabel}` : line.productLabel,
    )

    const productLines = pdf.splitTextToSize(productText, col.prod.w)
    const rowHeight = Math.max(5, productLines.length * 4.2)

    if (y + rowHeight > maxY) {
      pdf.addPage()
      y = header()
      y = drawTableHeader(y)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
    }

    pdf.text(loc, col.ubic.x, y)
    pdf.text(lote, col.lote.x, y)
    pdf.text(vence, col.vence.x, y)
    pdf.text(qty, col.cant.x, y)

    pdf.text(productLines, col.prod.x, y)

    y += rowHeight
  }

  savePdf(pdf, `picking-solicitud-${meta.requestId}.pdf`)
}

export function exportLabelToPdf(data: LabelPdfData): void {
  // 100mm x 150mm (tipo etiqueta)
  const pdf = new jsPDF('p', 'mm', [100, 150])
  const w = pdf.internal.pageSize.getWidth()
  const h = pdf.internal.pageSize.getHeight()

  const pad = 6

  pdf.setDrawColor(60)
  pdf.rect(pad, pad, w - pad * 2, h - pad * 2)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text('RÓTULO', w / 2, 16, { align: 'center' })

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text(`Solicitud: ${sanitizePdfText(data.requestId)}`, pad + 2, 26)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)

  const dateStr = new Date(data.generatedAtIso).toLocaleString()
  const lines = [
    `Generado: ${sanitizePdfText(dateStr)}`,
    `Solicitante: ${sanitizePdfText(data.requestedByName ?? '—')}`,
    `Origen: ${sanitizePdfText(data.fromWarehouseLabel)} · ${sanitizePdfText(data.fromLocationCode)}`,
    `Destino: ${sanitizePdfText(data.toWarehouseLabel)} · ${sanitizePdfText(data.toLocationCode)}`,
    `Bultos: ${sanitizePdfText(data.bultos || '—')}`,
    `Responsable: ${sanitizePdfText(data.responsable || '—')}`,
  ]

  let y = 34
  for (const l of lines) {
    pdf.text(l, pad + 2, y)
    y += 5
  }

  pdf.setFont('helvetica', 'bold')
  pdf.text('Observaciones:', pad + 2, y + 3)
  pdf.setFont('helvetica', 'normal')

  const obs = sanitizePdfText(data.observaciones || '')
  const obsLines = pdf.splitTextToSize(obs || '—', w - pad * 2 - 4)
  pdf.text(obsLines, pad + 2, y + 9)

  savePdf(pdf, `rotulo-solicitud-${data.requestId}.pdf`)
}
