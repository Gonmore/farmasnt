import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

type PdfOptions = {
  title?: string
  subtitle?: string
  companyName?: string
  generatedDate?: string
  headerColor?: string
  logoUrl?: string
}

export async function pdfBlobFromElement(el: HTMLElement, opts?: PdfOptions): Promise<Blob> {
  // Capturar siempre en un “layout de escritorio / carta”, sin depender del tamaño actual
  // (ej: si el usuario está en móvil).
  const captureWidthPx = 1200
  const originalWidth = el.style.width
  const originalMaxWidth = el.style.maxWidth
  const originalMinWidth = el.style.minWidth

  el.classList.add('pdf-export')
  el.style.width = `${captureWidthPx}px`
  el.style.maxWidth = `${captureWidthPx}px`
  el.style.minWidth = `${captureWidthPx}px`

  // Forzar reflow + notificar a ResizeObserver (Recharts) antes de capturar.
  // Esto evita que algunos gráficos queden con el ancho “móvil” previo.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.offsetHeight
  window.dispatchEvent(new Event('resize'))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    allowTaint: true,
    logging: false,
    width: captureWidthPx,
    windowWidth: captureWidthPx,
    windowHeight: el.scrollHeight,
  })

  el.style.width = originalWidth
  el.style.maxWidth = originalMaxWidth
  el.style.minWidth = originalMinWidth
  el.classList.remove('pdf-export')

  // Usar tamaño carta (Letter: 215.9mm x 279.4mm)
  const pdf = new jsPDF('p', 'mm', 'letter')

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 20

  // Header profesional con gradiente
  const headerHeight = 40
  const headerColor = opts?.headerColor ?? '#3B82F6'
  
  // Crear header con gradiente visual
  pdf.setFillColor(hexToRgb(headerColor).r, hexToRgb(headerColor).g, hexToRgb(headerColor).b)
  pdf.rect(0, 0, pageWidth, headerHeight, 'F')
  
  // Agregar línea decorativa inferior
  pdf.setFillColor(hexToRgb(lightenColor(headerColor, 20)).r, hexToRgb(lightenColor(headerColor, 20)).g, hexToRgb(lightenColor(headerColor, 20)).b)
  pdf.rect(0, headerHeight - 3, pageWidth, 3, 'F')

  // Logo de la empresa (si existe)
  let logoWidth = 0
  if (opts?.logoUrl) {
    try {
      const logoSize = 30
      pdf.addImage(opts.logoUrl, 'PNG', margin, 5, logoSize, logoSize, undefined, 'FAST')
      logoWidth = logoSize + 10
    } catch (err) {
      console.warn('No se pudo cargar el logo:', err)
    }
  }

  // Título del reporte
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  const title = opts?.title ?? 'Reporte'
  pdf.text(title, margin + logoWidth, 15)

  // Subtítulo
  if (opts?.subtitle) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(11)
    pdf.text(opts.subtitle, margin + logoWidth, 22)
  }

  // Información de la empresa y fecha
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  const companyName = opts?.companyName ?? ''
  const generatedDate = opts?.generatedDate ?? new Date().toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  
  if (companyName) {
    pdf.text(companyName, margin + logoWidth, 29)
  }
  const dateText = `Generado: ${generatedDate}`
  pdf.text(dateText, pageWidth - margin - pdf.getTextWidth(dateText), 29)

  // Resetear color de texto
  pdf.setTextColor(0, 0, 0)

  // Calcular posición del contenido con márgenes y footer
  const contentY = headerHeight + 10
  const footerHeight = 18
  const availableHeight = pageHeight - contentY - footerHeight - (margin * 1.5)

  // Escalar imagen para usar TODO el ancho disponible
  const availableWidth = pageWidth - (2 * margin)
  const imgWidth = availableWidth
  const pxPerMm = canvas.width / imgWidth

  const addSlice = (sourceY: number, sliceHeightPx: number, destYmm: number) => {
    const sliceCanvas = document.createElement('canvas')
    sliceCanvas.width = canvas.width
    sliceCanvas.height = sliceHeightPx
    const ctx = sliceCanvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(canvas, 0, sourceY, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx)
    const sliceData = sliceCanvas.toDataURL('image/png')
    const sliceHeightMm = sliceHeightPx / pxPerMm
    pdf.addImage(sliceData, 'PNG', margin, destYmm, imgWidth, sliceHeightMm, undefined, 'FAST')
  }

  // Primera página (slice)
  let pageNumber = 1
  let sourceY = 0
  const firstSliceHeightPx = Math.min(canvas.height, Math.floor(availableHeight * pxPerMm))
  addSlice(sourceY, firstSliceHeightPx, contentY)
  sourceY += firstSliceHeightPx
  await addFooter(pdf, pageNumber, pageWidth, pageHeight)

  // Páginas siguientes (slice) con header pequeño y margen superior real
  while (sourceY < canvas.height) {
    pdf.addPage()
    pageNumber++

    const miniHeaderHeight = 20
    pdf.setFillColor(hexToRgb(headerColor).r, hexToRgb(headerColor).g, hexToRgb(headerColor).b)
    pdf.rect(0, 0, pageWidth, miniHeaderHeight, 'F')

    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text(title, margin, 12)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text(`Pág. ${pageNumber}`, pageWidth - margin - 20, 12)

    pdf.setTextColor(0, 0, 0)

    const miniContentY = miniHeaderHeight + margin
    const miniAvailableHeight = pageHeight - miniContentY - footerHeight - (margin * 1.5)
    const sliceHeightPx = Math.min(canvas.height - sourceY, Math.floor(miniAvailableHeight * pxPerMm))
    addSlice(sourceY, sliceHeightPx, miniContentY)
    sourceY += sliceHeightPx

    await addFooter(pdf, pageNumber, pageWidth, pageHeight)
  }

  return pdf.output('blob')
}

// Agregar footer con "powered by" + logo de Supernovatel en todas las páginas
async function addFooter(pdf: jsPDF, pageNumber: number, pageWidth: number, pageHeight: number): Promise<void> {
  const footerY = pageHeight - 15  // Más arriba para respetar margen
  
  // Texto "Powered by"
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(100, 100, 100)
  
  const text = 'Powered by'
  const textWidth = pdf.getTextWidth(text)
  const centerX = pageWidth / 2
  const textX = centerX - textWidth - 13 // Ajustado para logo más grande
  
  pdf.text(text, textX, footerY)
  
  // Logo de Supernovatel (usar logo azul público)
  try {
    const logoWidth = 24  // Aumentado para mejor visibilidad
    const logoHeight = 4.8
    const logoX = centerX - 10
    const logoY = footerY - 4
    
    // Usar logo público de Supernovatel desde /public
    pdf.addImage('/Logo_Azul.png', 'PNG', logoX, logoY, logoWidth, logoHeight, undefined, 'FAST')
  } catch (err) {
    console.warn('No se pudo agregar logo en footer:', err)
    // Fallback: solo texto
    pdf.text('Supernovatel', centerX - 10, footerY)
  }
  
  // Número de página en el footer (lado derecho)
  pdf.setFontSize(7)
  pdf.text(`${pageNumber}`, pageWidth - 20, footerY, { align: 'right' })
}

// Utilidades de color
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 59, g: 130, b: 246 } // default blue
}

function lightenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex)
  const factor = 1 + percent / 100
  const r = Math.min(255, Math.round(rgb.r * factor))
  const g = Math.min(255, Math.round(rgb.g * factor))
  const b = Math.min(255, Math.round(rgb.b * factor))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export async function exportElementToPdf(
  el: HTMLElement,
  opts?: { 
    filename?: string
    title?: string
    subtitle?: string
    companyName?: string
    headerColor?: string
    logoUrl?: string
  },
): Promise<void> {
  const blob = await pdfBlobFromElement(el, opts)
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = opts?.filename ?? 'reporte.pdf'
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(blob)
  })
}
