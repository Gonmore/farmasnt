import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

export async function pdfBlobFromElement(el: HTMLElement, opts?: { title?: string }): Promise<Blob> {
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  })

  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF('p', 'mm', 'a4')

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  const imgWidth = pageWidth
  const imgHeight = (canvas.height * imgWidth) / canvas.width

  let heightLeft = imgHeight
  let position = 0

  // Optional title (small header on first page)
  if ((opts?.title ?? '').trim()) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12)
    pdf.text(String(opts?.title ?? ''), 10, 10)
    position = 14
  }

  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
  heightLeft -= pageHeight

  while (heightLeft > 0) {
    pdf.addPage()
    const y = heightLeft - imgHeight
    pdf.addImage(imgData, 'PNG', 0, y, imgWidth, imgHeight)
    heightLeft -= pageHeight
  }

  return pdf.output('blob')
}

export async function exportElementToPdf(
  el: HTMLElement,
  opts?: { filename?: string; title?: string },
): Promise<void> {
  const blob = await pdfBlobFromElement(el, { title: opts?.title })
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
