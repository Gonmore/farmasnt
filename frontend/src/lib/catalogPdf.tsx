import { jsPDF } from 'jspdf'
import { apiFetch } from './api'
import { formatMoney } from './numberFormat'
import { formatPresentationLabel } from './productPresentation'
import { getProductDisplayName } from './productName'
import { sortProductsByDisplayName } from './productSorting'

type CatalogPresentation = {
  id: string
  name: string
  unitsPerPresentation: string
  priceOverride?: string | null
  isDefault: boolean
  sortOrder: number
}

export type CatalogProduct = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  baseUnitAbbreviation?: string | null
  photoUrl?: string | null
  price?: string | null
  description?: string | null
  isActive: boolean
  presentations?: CatalogPresentation[]
}

type ListResponse = { items: CatalogProduct[]; nextCursor: string | null }

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function presentationPriceFor(product: CatalogProduct, presentation?: CatalogPresentation | null): number | null {
  const unitsPer = toNumberOrNull(presentation?.unitsPerPresentation) ?? 1
  const override = toNumberOrNull(presentation?.priceOverride)
  if (override !== null) return override
  const unit = toNumberOrNull(product.price)
  if (unit === null) return null
  if (unitsPer <= 0) return unit
  return unit * unitsPer
}

async function fetchAllProducts(token: string): Promise<CatalogProduct[]> {
  const all: CatalogProduct[] = []
  let cursor: string | undefined
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({ take: '200', includePresentations: 'true' })
    if (cursor) params.append('cursor', cursor)
    const res = await apiFetch<ListResponse>(`/api/v1/products?${params}`, { token })
    all.push(...(res.items ?? []))
    if (!res.nextCursor) break
    cursor = res.nextCursor
  }
  return all
}

async function loadImageDataUrl(url: string): Promise<string | null> {
  // Same-origin (dev) or S3 con CORS de lectura: leer el blob y convertir a data URL.
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('fetch failed')
    const blob = await res.blob()
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
    if (dataUrl) return dataUrl
  } catch {
    // ignore
  }
  // Fallback: intenta vía Image + canvas si el recurso permite CORS anónimo.
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('img load failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG'
  return 'PNG'
}

function formatGeneratedDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

type LoadedImage = { canvas: HTMLCanvasElement; w: number; h: number }
type LoadedLogo = { dataUrl: string; w: number; h: number }

function getImageDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
    img.onerror = () => resolve({ w: 1, h: 1 })
    img.src = dataUrl
  })
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Recorta la imagen a un rectángulo con esquinas redondeadas (radio proporcional),
// sin recurrir a círculos blancos en las esquinas.
async function buildRoundedCanvas(dataUrl: string, w: number, h: number, radiusRatio = 0.06): Promise<HTMLCanvasElement> {
  const img = new Image()
  img.src = dataUrl
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('img load failed'))
  })
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no ctx')
  const r = Math.min(w, h) * radiusRatio
  roundRectPath(ctx, 0, 0, w, h, r)
  ctx.clip()
  ctx.drawImage(img, 0, 0, w, h)
  return canvas
}

async function loadImage(url: string): Promise<LoadedImage | null> {
  const dataUrl = await loadImageDataUrl(url)
  if (!dataUrl) return null
  const { w, h } = await getImageDims(dataUrl)
  try {
    const canvas = await buildRoundedCanvas(dataUrl, w, h, 0.06)
    return { canvas, w, h }
  } catch {
    return null
  }
}

async function loadLogo(url: string): Promise<LoadedLogo | null> {
  const dataUrl = await loadImageDataUrl(url)
  if (!dataUrl) return null
  const { w, h } = await getImageDims(dataUrl)
  return { dataUrl, w, h }
}

async function preloadPhotos(products: CatalogProduct[]): Promise<Map<string, LoadedImage | null>> {
  const map = new Map<string, LoadedImage | null>()
  const urls = Array.from(new Set(products.map((p) => p.photoUrl).filter(Boolean) as string[]))
  await Promise.all(
    urls.map(async (url) => {
      map.set(url, await loadImage(url))
    }),
  )
  return map
}

// El endpoint de listado no incluye `description`; se obtiene por producto.
async function fetchProductDetails(products: CatalogProduct[], token: string): Promise<void> {
  const limit = 10
  let cursor = 0
  const worker = async () => {
    while (cursor < products.length) {
      const idx = cursor++
      const p = products[idx]
      try {
        const full = (await apiFetch(`/api/v1/products/${p.id}`, { token })) as { description?: string | null }
        p.description = full?.description ?? null
      } catch {
        // ignore
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, products.length) }, worker))
}

const HEADER_COLOR: [number, number, number] = [15, 118, 110] // teal
const TEXT_DARK: [number, number, number] = [15, 23, 42]
const TEXT_MUTED: [number, number, number] = [71, 85, 105]
const PRICE_GREEN: [number, number, number] = [5, 120, 90]
const BORDER: [number, number, number] = [203, 213, 225]
const PLACEHOLDER_BG: [number, number, number] = [241, 245, 249]
const PLACEHOLDER_TEXT: [number, number, number] = [148, 163, 184]

function drawImageContain(
  pdf: jsPDF,
  photo: LoadedImage,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
) {
  const ar = photo.w / photo.h
  const boxAR = boxW / boxH
  let dw: number
  let dh: number
  if (ar > boxAR) {
    dw = boxW
    dh = boxW / ar
  } else {
    dh = boxH
    dw = boxH * ar
  }
  const dx = x + (boxW - dw) / 2
  const dy = y + (boxH - dh) / 2
  // La imagen ya viene recortada con esquinas redondeadas (ver buildRoundedCanvas).
  pdf.addImage(photo.canvas, 'PNG', dx, dy, dw, dh, undefined, 'FAST')
}

function drawCard(
  pdf: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  product: CatalogProduct,
  photo: LoadedImage | null,
  currency: string,
  extended: boolean,
) {
  const name = getProductDisplayName(product)
  const presList = (product.presentations ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, extended ? 5 : 3)

  // Card background + border
  pdf.setFillColor(255, 255, 255)
  pdf.setDrawColor(BORDER[0], BORDER[1], BORDER[2])
  pdf.roundedRect(x, y, w, h, 2, 2, 'FD')

  const pad = 2
  let cy = y + pad + 1

  // Photo box
  const photoH = Math.min(w * 0.62, h - (extended ? 52 : 40))
  if (photo) {
    drawImageContain(pdf, photo, x + pad, cy, w - pad * 2, photoH)
  } else {
    pdf.setFillColor(PLACEHOLDER_BG[0], PLACEHOLDER_BG[1], PLACEHOLDER_BG[2])
    pdf.roundedRect(x + pad, cy, w - pad * 2, photoH, 2, 2, 'F')
    pdf.setTextColor(PLACEHOLDER_TEXT[0], PLACEHOLDER_TEXT[1], PLACEHOLDER_TEXT[2])
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('Sin imagen', x + w / 2, cy + photoH / 2 + 2, { align: 'center' })
  }
  cy += photoH + 5

  // Name (centrado, 11pt)
  pdf.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2])
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  const nameLines = pdf.splitTextToSize(name, w - pad * 2).slice(0, 2)
  pdf.text(nameLines, x + w / 2, cy, { align: 'center' })
  cy += nameLines.length * 4.8 + 1.5

  // Description (extended only): hasta 5 líneas, con "..." si se corta.
  if (extended && product.description) {
    pdf.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2])
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    const maxDesc = 5
    const allDescLines = pdf.splitTextToSize(product.description, w - pad * 2)
    let descLines = allDescLines.slice(0, maxDesc)
    if (allDescLines.length > maxDesc) {
      descLines[maxDesc - 1] = descLines[maxDesc - 1].replace(/\s+$/, '') + '...'
    }
    pdf.text(descLines, x + pad, cy)
    cy += descLines.length * 3.4 + 2
  }

  // Presentaciones: cada línea muestra la presentación (izq.) y su precio (der.)
  const priceW = 34
  const labelW = w - pad * 2 - priceW - 2
  if (presList.length === 0) {
    // Sin presentaciones: se muestra el precio de la unidad base.
    pdf.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2])
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.text('Unidad', x + pad, cy)
    const basePrice = toNumberOrNull(product.price)
    pdf.setTextColor(PRICE_GREEN[0], PRICE_GREEN[1], PRICE_GREEN[2])
    pdf.setFont('helvetica', 'normal')
    const priceStr = basePrice !== null ? `${formatMoney(basePrice)} ${currency}` : '—'
    pdf.text(priceStr, x + w - pad, cy, { align: 'right' })
    cy += 4.2
  } else {
    for (const pr of presList) {
      const label = formatPresentationLabel({
        name: pr.name,
        unitsPerPresentation: pr.unitsPerPresentation,
        baseUnitAbbreviation: product.baseUnitAbbreviation,
      })
      const presPrice = presentationPriceFor(product, pr)
      const labelText = pdf.splitTextToSize(label, labelW)[0]

      pdf.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2])
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8)
      pdf.text(labelText, x + pad, cy)

      pdf.setTextColor(PRICE_GREEN[0], PRICE_GREEN[1], PRICE_GREEN[2])
      pdf.setFont('helvetica', 'normal')
      const priceStr = presPrice !== null ? `${formatMoney(presPrice)} ${currency}` : '—'
      pdf.text(priceStr, x + w - pad, cy, { align: 'right' })
      cy += 4.2
    }
  }
}

export type ExportCatalogOptions = {
  token: string
  currency: string
  companyName: string
  logoUrl?: string | null
  extended: boolean
  generatedByName?: string
  generatedByEmail?: string
}

export async function exportCommercialCatalogPdf(opts: ExportCatalogOptions): Promise<void> {
  const rawProducts = await fetchAllProducts(opts.token)
  const products = sortProductsByDisplayName(rawProducts.filter((p) => p.isActive))
  // La descripción solo se usa en el catálogo extendido.
  if (opts.extended) await fetchProductDetails(products, opts.token)
  const photoMap = await preloadPhotos(products)
  const logoImage = opts.logoUrl ? await loadLogo(opts.logoUrl) : null
  const generatedAt = formatGeneratedDate(new Date())

  const pdf = new jsPDF('p', 'mm', 'letter')
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 16
  const contentW = pageW - margin * 2
  const cols = opts.extended ? 2 : 3
  const gap = 4
  const cardW = (contentW - (cols - 1) * gap) / cols
  const photoH = Math.min(cardW * 0.62, opts.extended ? 64 : 44)
  const cardH = photoH + (opts.extended ? 56 : 40)

  const headerHFirst = 26
  const headerHOther = 18
  const footerTop = pageH - 15
  const footerY = pageH - 9
  const contentBottom = footerTop - 1

  const drawPageBg = () => {
    // Fondo claro para que las tarjetas blancas resalten (evita página totalmente blanca).
    pdf.setFillColor(228, 233, 239)
    pdf.rect(0, 0, pageW, pageH, 'F')
    // Marco decorativo tipo brochure.
    pdf.setDrawColor(HEADER_COLOR[0], HEADER_COLOR[1], HEADER_COLOR[2])
    pdf.setLineWidth(0.6)
    pdf.rect(6, 6, pageW - 12, pageH - 12)
    pdf.setLineWidth(0.2)
  }

  const drawHeader = (isFirst: boolean) => {
    const hH = isFirst ? headerHFirst : headerHOther
    pdf.setFillColor(HEADER_COLOR[0], HEADER_COLOR[1], HEADER_COLOR[2])
    pdf.rect(0, 0, pageW, hH, 'F')
    const logoX = margin
    const logoSize = isFirst ? 16 : 13
    if (logoImage) {
      // El logo NO se redondea (se dibuja tal cual).
      pdf.addImage(logoImage.dataUrl, imageFormat(logoImage.dataUrl), logoX, isFirst ? 5 : 3, logoSize, logoSize, undefined, 'FAST')
    }
    const textX = logoImage ? logoX + logoSize + 4 : logoX
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text('Catálogo Comercial', textX, isFirst ? 12 : 10)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    const sub = opts.extended
      ? 'Ficha completa de productos con descripción'
      : 'Brochure de productos y precios'
    pdf.text(sub, textX, isFirst ? 18.5 : 15.5)
    // Fecha de generación (derecha del header)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text(generatedAt, pageW - margin, isFirst ? 12 : 10, { align: 'right' })
  }

  const drawFooter = (pageNum: number, totalPages: number) => {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(HEADER_COLOR[0], HEADER_COLOR[1], HEADER_COLOR[2])
    const baseY = footerY
    pdf.text(opts.companyName || 'Empresa', margin, baseY - 6)
    pdf.text(opts.generatedByName || '—', margin, baseY - 3)
    pdf.text(opts.generatedByEmail || '—', margin, baseY)
    pdf.text(`Página ${pageNum} de ${totalPages}`, pageW - margin, baseY, { align: 'right' })
  }

  drawPageBg()
  drawHeader(true)
  let y = headerHFirst + 6
  let col = 0
  let totalPages = 1

  for (const product of products) {
    if (col === 0 && y + cardH > contentBottom) {
      pdf.addPage()
      totalPages++
      drawPageBg()
      drawHeader(false)
      y = headerHOther + 6
    }
    const x = margin + col * (cardW + gap)
    const photo = product.photoUrl ? (photoMap.get(product.photoUrl) ?? null) : null
    drawCard(pdf, x, y, cardW, cardH, product, photo, opts.currency, opts.extended)
    col++
    if (col >= cols) {
      col = 0
      y += cardH + gap
    }
  }

  // Pie de página en dos pasadas: ya conocemos el total de páginas.
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p)
    drawFooter(p, totalPages)
  }

  const filename = opts.extended ? 'catalogo-comercial-extendido.pdf' : 'catalogo-comercial-resumido.pdf'
  pdf.save(filename)
}
