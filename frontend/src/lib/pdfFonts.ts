import { jsPDF } from 'jspdf'

export const PDF_FONT_FAMILY = 'DejaVuSans'

let fontDataCache: { normal: string; bold: string } | null = null

function arrayBufferToBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return binary
}

async function getFontData(): Promise<{ normal: string; bold: string }> {
  if (fontDataCache) return fontDataCache

  const [normalRes, boldRes] = await Promise.all([
    fetch('/fonts/DejaVuSans.ttf').then((r) => r.arrayBuffer()),
    fetch('/fonts/DejaVuSans-Bold.ttf').then((r) => r.arrayBuffer()),
  ])

  fontDataCache = {
    normal: arrayBufferToBinaryString(normalRes),
    bold: arrayBufferToBinaryString(boldRes),
  }
  return fontDataCache
}

export async function registerPdfFonts(pdf: jsPDF): Promise<void> {
  const fonts = await getFontData()

  if (!pdf.existsFileInVFS('DejaVuSans-normal.ttf')) {
    pdf.addFileToVFS('DejaVuSans-normal.ttf', fonts.normal)
    pdf.addFileToVFS('DejaVuSans-bold.ttf', fonts.bold)
  }

  pdf.addFont('DejaVuSans-normal.ttf', PDF_FONT_FAMILY, 'normal')
  pdf.addFont('DejaVuSans-bold.ttf', PDF_FONT_FAMILY, 'bold')
}
