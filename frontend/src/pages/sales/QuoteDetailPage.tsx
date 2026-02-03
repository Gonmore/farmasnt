import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { exportQuoteToPDF } from '../../lib/quotePdf'
import { MainLayout, PageContainer, Button, Loading, ErrorState, Table, Input, Select, CustomerSelector, ProductSelector } from '../../components'
import { useNavigation } from '../../hooks'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'

type QuoteDetail = {
  id: string
  number: string
  customerId: string
  customerName: string
  status: 'CREATED' | 'PROCESSED'
  quotedBy: string | null
  validityDays: number
  paymentMode: string
  deliveryDays: number
  deliveryCity: string | null
  deliveryZone: string | null
  deliveryAddress: string | null
  deliveryMapsUrl: string | null
  globalDiscountPct: number
  proposalValue: string | null
  note: string | null
  subtotal: number
  globalDiscountAmount: number
  total: number
  lines: Array<{
    id: string
    productId: string
    productName: string
    productSku: string
    presentationId?: string | null
    presentationName?: string | null
    unitsPerPresentation?: number | null
    presentationQuantity?: number | null
    quantity: number
    unitPrice: number
    discountPct: number
    total: number
  }>
  createdAt: string
  updatedAt: string
}

type ProductPresentation = {
  id: string
  name: string
  unitsPerPresentation: string
  priceOverride?: string | null
  isDefault: boolean
  sortOrder: number
}

type DraftLine = {
  key: string
  productId: string | null
  productSku: string
  productName: string
  presentations: ProductPresentation[]
  presentationId: string | null
  presentationQuantity: number
  unitPriceBase: number
  discountPct: number
}

type QuoteDraft = {
  customerId: string
  validityDays: number
  deliveryDays: number
  deliveryCity: string
  deliveryZone: string
  deliveryAddress: string
  deliveryMapsUrl: string
  globalDiscountPct: number
  proposalValue: string
  paymentMode: string
  lines: DraftLine[]
}

function buildDraftFromQuote(q: QuoteDetail, presentationsByProduct?: Map<string, ProductPresentation[]>): QuoteDraft {
  return {
    customerId: q.customerId,
    validityDays: toNumberSafe(q.validityDays, 7),
    deliveryDays: toNumberSafe(q.deliveryDays, 1),
    deliveryCity: String(q.deliveryCity ?? ''),
    deliveryZone: String(q.deliveryZone ?? ''),
    deliveryAddress: String(q.deliveryAddress ?? ''),
    deliveryMapsUrl: String(q.deliveryMapsUrl ?? ''),
    globalDiscountPct: toNumberSafe(q.globalDiscountPct, 0),
    proposalValue: String(q.proposalValue ?? ''),
    paymentMode: String(q.paymentMode ?? 'CASH'),
    lines: (q.lines ?? []).map((l) => {
      const pres = presentationsByProduct?.get(l.productId) ?? []
      return {
        key: l.id,
        productId: l.productId,
        productSku: l.productSku,
        productName: l.productName,
        presentations: pres,
        presentationId: l.presentationId ?? null,
        presentationQuantity: toNumberSafe(l.presentationQuantity ?? l.quantity, 1),
        unitPriceBase: toNumberSafe(l.unitPrice, 0),
        discountPct: toNumberSafe(l.discountPct, 0),
      }
    }),
  }
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function isNonUnitPresentation(name: string | null | undefined, unitsPerPresentation: number | null | undefined): boolean {
  const n = String(name ?? '').trim().toLowerCase()
  const u = Number(unitsPerPresentation ?? 1)
  return !!n && n !== 'unidad' && Number.isFinite(u) && u > 1
}

function lineLabel(sku: string, name: string): string {
  const a = String(sku ?? '').trim()
  const b = String(name ?? '').trim()
  return a && b ? `${a} — ${b}` : b || a
}

function toNumberSafe(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

async function fetchPresentations(token: string, productId: string): Promise<ProductPresentation[]> {
  const res = await apiFetch<{ items: ProductPresentation[] }>(`/api/v1/products/${productId}/presentations`, { token })
  return (res?.items ?? []) as ProductPresentation[]
}

function pickDefaultPresentationId(presentations: ProductPresentation[]): string | null {
  if (!Array.isArray(presentations) || presentations.length === 0) return null
  const sorted = [...presentations].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const def = sorted.find((p) => !!p.isDefault)
  return (def ?? sorted[0] ?? null)?.id ?? null
}

function presentationLabel(name: string | null | undefined, unitsPerPresentation: number | null | undefined): string {
  const n = String(name ?? '').trim()
  const units = Number(unitsPerPresentation ?? 1)
  if (!n || n.toLowerCase() === 'unidad' || !Number.isFinite(units) || units <= 1) return 'Unidad'
  return `${n} (${Math.trunc(units)}u)`
}

function unitsPerFor(presentations: ProductPresentation[], presentationId: string | null): number {
  if (!presentationId) return 1
  const p = presentations.find((x) => x.id === presentationId)
  const u = Number(p?.unitsPerPresentation ?? 1)
  return Number.isFinite(u) && u > 0 ? u : 1
}

function nameFor(presentations: ProductPresentation[], presentationId: string | null): string {
  if (!presentationId) return 'Unidad'
  return String(presentations.find((x) => x.id === presentationId)?.name ?? 'Unidad')
}

function isNonUnitByRef(presentations: ProductPresentation[], presentationId: string | null): boolean {
  const name = nameFor(presentations, presentationId)
  const units = unitsPerFor(presentations, presentationId)
  return name.trim().toLowerCase() !== 'unidad' && units > 1
}

function displayUnitPrice(baseUnitPrice: number, presentations: ProductPresentation[], presentationId: string | null): number {
  const base = toNumberSafe(baseUnitPrice, 0)
  if (!isNonUnitByRef(presentations, presentationId)) return base
  const units = unitsPerFor(presentations, presentationId)
  return base * units
}

function baseUnitPriceFromDisplay(display: number, presentations: ProductPresentation[], presentationId: string | null): number {
  const d = toNumberSafe(display, 0)
  if (!isNonUnitByRef(presentations, presentationId)) return d
  const units = unitsPerFor(presentations, presentationId)
  return units > 0 ? d / units : d
}

function paymentLabel(code: string): string {
  if (code === 'CASH') return 'Pago al contado'
  if (code === 'CREDIT_7') return 'Crédito 7 días'
  if (code === 'CREDIT_14') return 'Crédito 14 días'
  return code
}

async function fetchQuote(token: string, id: string): Promise<QuoteDetail> {
  return apiFetch(`/api/v1/sales/quotes/${id}`, { token })
}

async function updateQuote(
  token: string,
  quoteId: string,
  payload: {
    customerId: string
    validityDays: number
    paymentMode: string
    deliveryDays: number
    deliveryCity?: string
    deliveryZone?: string
    deliveryAddress?: string
    deliveryMapsUrl?: string
    globalDiscountPct: number
    proposalValue?: string
    note?: string
    lines: Array<{
      productId: string
      quantity?: number
      presentationId?: string
      presentationQuantity?: number
      unitPrice: number
      discountPct: number
    }>
  },
): Promise<QuoteDetail> {
  return apiFetch(`/api/v1/sales/quotes/${quoteId}`, { token, method: 'PUT', body: JSON.stringify(payload) })
}

export function QuoteDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const auth = useAuth()
  const tenant = useTenant()
  const currency = tenant.branding?.currency || 'BOB'

  const queryClient = useQueryClient()

  const [isExporting, setIsExporting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const [editError, setEditError] = useState('')

  const quoteQuery = useQuery({
    queryKey: ['quote', id],
    queryFn: () => fetchQuote(auth.accessToken!, id!),
    enabled: !!auth.accessToken && !!id,
  })

  const presentationsQuery = useQuery({
    queryKey: ['quote-line-presentations', id, quoteQuery.data?.lines?.map((l) => l.productId).sort().join('|')],
    queryFn: async () => {
      const token = auth.accessToken!
      const productIds = Array.from(new Set((quoteQuery.data?.lines ?? []).map((l) => l.productId).filter(Boolean)))
      const entries = await Promise.all(productIds.map(async (pid) => [pid, await fetchPresentations(token, pid)] as const))
      return new Map<string, ProductPresentation[]>(entries)
    },
    enabled: !!auth.accessToken && !!id && !!quoteQuery.data,
  })

  useEffect(() => {
    if (!isEditing) return
    if (!quoteQuery.data) return
    setDraft(buildDraftFromQuote(quoteQuery.data, presentationsQuery.data))
  }, [isEditing, quoteQuery.data, presentationsQuery.data])

  const saveMutation = useMutation({
    mutationFn: async (payload: QuoteDraft) => {
      const token = auth.accessToken!
      const linesPayload = payload.lines.map((l) => {
        if (!l.productId) throw new Error('Cada fila debe tener un producto')
        const presId = l.presentationId

        const discountPct = Math.min(100, Math.max(0, toNumberSafe(l.discountPct, 0)))
        const unitPrice = Math.max(0, toNumberSafe(l.unitPriceBase, 0))

        if (presId) {
          const pq = Math.max(0, toNumberSafe(l.presentationQuantity, 0))
          if (pq <= 0) throw new Error('La cantidad debe ser mayor a 0')
          return {
            productId: l.productId,
            presentationId: presId,
            presentationQuantity: pq,
            unitPrice,
            discountPct,
          }
        }

        const q = Math.max(0, toNumberSafe(l.presentationQuantity, 0))
        if (q <= 0) throw new Error('La cantidad debe ser mayor a 0')
        return {
          productId: l.productId,
          quantity: q,
          unitPrice,
          discountPct,
        }
      })

      return updateQuote(token, id!, {
        customerId: payload.customerId,
        validityDays: Math.max(1, Math.trunc(payload.validityDays || 7)),
        paymentMode: payload.paymentMode || 'CASH',
        deliveryDays: Math.max(0, Math.trunc(payload.deliveryDays || 0)),
        deliveryCity: payload.deliveryCity?.trim() || undefined,
        deliveryZone: payload.deliveryZone?.trim() || undefined,
        deliveryAddress: payload.deliveryAddress?.trim() || undefined,
        deliveryMapsUrl: payload.deliveryMapsUrl?.trim() || undefined,
        globalDiscountPct: Math.min(100, Math.max(0, toNumberSafe(payload.globalDiscountPct, 0))),
        proposalValue: payload.proposalValue?.trim() || undefined,
        note: undefined,
        lines: linesPayload,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['quote', id] })
      await queryClient.invalidateQueries({ queryKey: ['quotes'] })
      setIsEditing(false)
      setEditError('')
    },
    onError: (e: any) => {
      const msg = e?.message ? String(e.message) : 'Error al guardar'
      setEditError(msg)
    },
  })

  const canEdit = quoteQuery.data?.status !== 'PROCESSED'

  const editColumns = useMemo(() => {
    return [
      {
        header: 'Producto',
        accessor: (row: DraftLine) => (
          <ProductSelector
            value={row.productId ? { id: row.productId, label: lineLabel(row.productSku, row.productName) } : null}
            onChange={(p) => {
              const presentations = (p.presentations ?? []) as ProductPresentation[]
              const presId = pickDefaultPresentationId(presentations)
              setDraft((prev) => {
                if (!prev) return prev
                return {
                  ...prev,
                  lines: prev.lines.map((l) =>
                    l.key === row.key
                      ? {
                          ...l,
                          productId: p.id,
                          productSku: p.sku,
                          productName: p.name,
                          presentations,
                          presentationId: presId,
                          presentationQuantity: 1,
                        }
                      : l,
                  ),
                }
              })
            }}
            disabled={saveMutation.isPending}
            placeholder="Buscar por SKU o nombre..."
          />
        ),
      },
      {
        header: 'Presentación',
        accessor: (row: DraftLine) => {
          const options = [
            { value: '', label: 'Unidad' },
            ...row.presentations.map((p) => ({ value: p.id, label: presentationLabel(p.name, Number(p.unitsPerPresentation)) })),
          ]
          return (
            <Select
              options={options}
              value={row.presentationId ?? ''}
              onChange={(e) => {
                const nextId = e.target.value || null
                setDraft((prev) => {
                  if (!prev) return prev
                  return {
                    ...prev,
                    lines: prev.lines.map((l) => (l.key === row.key ? { ...l, presentationId: nextId, presentationQuantity: 1 } : l)),
                  }
                })
              }}
              disabled={saveMutation.isPending || !row.productId}
            />
          )
        },
      },
      {
        header: 'Cant.',
        accessor: (row: DraftLine) => (
          <Input
            type="number"
            min={0}
            step={1}
            value={String(row.presentationQuantity ?? '')}
            onChange={(e) => {
              const v = Math.max(0, toNumberSafe(e.target.value, 0))
              setDraft((prev) => {
                if (!prev) return prev
                return {
                  ...prev,
                  lines: prev.lines.map((l) => (l.key === row.key ? { ...l, presentationQuantity: v } : l)),
                }
              })
            }}
            disabled={saveMutation.isPending || !row.productId}
            className="w-24"
          />
        ),
      },
      {
        header: 'Desc.%',
        accessor: (row: DraftLine) => (
          <Input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={String(row.discountPct ?? 0)}
            onChange={(e) => {
              const v = Math.min(100, Math.max(0, toNumberSafe(e.target.value, 0)))
              setDraft((prev) => {
                if (!prev) return prev
                return {
                  ...prev,
                  lines: prev.lines.map((l) => (l.key === row.key ? { ...l, discountPct: v } : l)),
                }
              })
            }}
            disabled={saveMutation.isPending || !row.productId}
            className="w-24"
          />
        ),
      },
      {
        header: 'P. unit.',
        accessor: (row: DraftLine) => {
          const display = displayUnitPrice(row.unitPriceBase, row.presentations, row.presentationId)
          return (
            <Input
              type="number"
              min={0}
              step={0.01}
              value={String(Number.isFinite(display) ? display : 0)}
              onChange={(e) => {
                const d = Math.max(0, toNumberSafe(e.target.value, 0))
                const base = baseUnitPriceFromDisplay(d, row.presentations, row.presentationId)
                setDraft((prev) => {
                  if (!prev) return prev
                  return {
                    ...prev,
                    lines: prev.lines.map((l) => (l.key === row.key ? { ...l, unitPriceBase: base } : l)),
                  }
                })
              }}
              disabled={saveMutation.isPending || !row.productId}
              className="w-28"
            />
          )
        },
      },
      {
        header: 'Total',
        accessor: (row: DraftLine) => {
          const qty = Math.max(0, toNumberSafe(row.presentationQuantity, 0))
          const disc = Math.min(100, Math.max(0, toNumberSafe(row.discountPct, 0))) / 100
          const unitDisp = displayUnitPrice(row.unitPriceBase, row.presentations, row.presentationId)
          const total = unitDisp * qty * (1 - disc)
          return `${money(total)} ${currency}`
        },
      },
      {
        header: '',
        accessor: (row: DraftLine) => (
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={() => {
              setDraft((prev) => {
                if (!prev) return prev
                const nextLines = prev.lines.filter((l) => l.key !== row.key)
                return { ...prev, lines: nextLines.length ? nextLines : prev.lines }
              })
            }}
            disabled={saveMutation.isPending}
            title="Quitar fila"
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        ),
      },
    ]
  }, [currency, saveMutation.isPending, queryClient])

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="Cotización"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/sales/quotes')}>Volver</Button>
            {quoteQuery.data && (
              <>
                {quoteQuery.data.status !== 'PROCESSED' && !isEditing && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditError('')
                      setIsEditing(true)
                      // Build draft immediately so delivery fields are preloaded and never appear blank.
                      setDraft(buildDraftFromQuote(quoteQuery.data!, presentationsQuery.data))
                    }}
                  >
                    Editar
                  </Button>
                )}
                <Button
                  variant="primary"
                  loading={isExporting}
                  onClick={async () => {
                    const q = quoteQuery.data!
                    setIsExporting(true)
                    try {
                      await exportQuoteToPDF({
                      quoteNumber: q.number,
                      customerName: q.customerName,
                      quotedBy: q.quotedBy ?? undefined,
                      validityDays: String(q.validityDays),
                      paymentMode: paymentLabel(q.paymentMode),
                      deliveryDays: String(q.deliveryDays),
                      deliveryCity: q.deliveryCity ?? undefined,
                      deliveryZone: q.deliveryZone ?? undefined,
                      deliveryAddress: q.deliveryAddress ?? undefined,
                      globalDiscountPct: String(q.globalDiscountPct),
                      proposalValue: q.proposalValue ?? '',
                      items: q.lines.map((l) => {
                        const disc = Number.isFinite(l.discountPct) ? Math.min(100, Math.max(0, l.discountPct)) / 100 : 0
                        const pName = l.presentationName ?? null
                        const pQty = l.presentationQuantity ?? null
                        const unitsPer = Number(l.unitsPerPresentation ?? 1) || 1

                        const hasPres = !!pName && pQty !== null && pQty !== undefined
                        const isNonUnitPres = hasPres && String(pName).toLowerCase() !== 'unidad' && unitsPer > 1

                        const qtyForPricing = hasPres ? Number(pQty) : Number(l.quantity)
                        const unitPriceForDisplay = isNonUnitPres ? l.unitPrice * unitsPer : l.unitPrice
                        const lineTotal = unitPriceForDisplay * qtyForPricing * (1 - disc)

                        const qtyLabel = hasPres
                          ? isNonUnitPres
                            ? `${pQty} ${pName} (${Math.trunc(unitsPer)}u)`
                            : `${pQty} ${pName}`
                          : String(l.quantity)

                        return {
                          sku: l.productSku,
                          name: l.productName,
                          quantity: l.quantity,
                          quantityLabel: qtyLabel,
                          discountPct: l.discountPct,
                          unitPrice: unitPriceForDisplay,
                          lineTotal,
                        }
                      }),
                      subtotal: q.subtotal,
                      globalDiscountAmount: q.globalDiscountAmount,
                      totalAfterGlobal: q.total,
                      currency,
                      tenant,
                      logoUrl: tenant.branding?.logoUrl || undefined,
                      })
                    } catch (error) {
                      console.error('Error exporting PDF:', error)
                      alert('Error al exportar PDF')
                    } finally {
                      setIsExporting(false)
                    }
                  }}
                >
                  {isExporting ? 'Exportando...' : 'Exportar PDF'}
                </Button>
                <Button
                  variant="success"
                  onClick={async () => {
                    const q = quoteQuery.data!
                    setIsExporting(true)
                    try {
                      await exportQuoteToPDF({
                        quoteNumber: q.number,
                        customerName: q.customerName,
                        quotedBy: q.quotedBy ?? undefined,
                        validityDays: String(q.validityDays),
                        paymentMode: paymentLabel(q.paymentMode),
                        deliveryDays: String(q.deliveryDays),
                        deliveryCity: q.deliveryCity ?? undefined,
                        deliveryZone: q.deliveryZone ?? undefined,
                        deliveryAddress: q.deliveryAddress ?? undefined,
                        globalDiscountPct: String(q.globalDiscountPct),
                        proposalValue: q.proposalValue ?? '',
                        items: q.lines.map((l) => {
                          const disc = Number.isFinite(l.discountPct) ? Math.min(100, Math.max(0, l.discountPct)) / 100 : 0
                          const pName = l.presentationName ?? null
                          const pQty = l.presentationQuantity ?? null
                          const unitsPer = Number(l.unitsPerPresentation ?? 1) || 1

                          const hasPres = !!pName && pQty !== null && pQty !== undefined
                          const isNonUnitPres = hasPres && String(pName).toLowerCase() !== 'unidad' && unitsPer > 1

                          const qtyForPricing = hasPres ? Number(pQty) : Number(l.quantity)
                          const unitPriceForDisplay = isNonUnitPres ? l.unitPrice * unitsPer : l.unitPrice
                          const lineTotal = unitPriceForDisplay * qtyForPricing * (1 - disc)

                          const qtyLabel = hasPres
                            ? isNonUnitPres
                              ? `${pQty} ${pName} (${Math.trunc(unitsPer)}u)`
                              : `${pQty} ${pName}`
                            : String(l.quantity)

                          return {
                            sku: l.productSku,
                            name: l.productName,
                            quantity: l.quantity,
                            quantityLabel: qtyLabel,
                            discountPct: l.discountPct,
                            unitPrice: unitPriceForDisplay,
                            lineTotal,
                          }
                        }),
                        subtotal: q.subtotal,
                        globalDiscountAmount: q.globalDiscountAmount,
                        totalAfterGlobal: q.total,
                        currency,
                        tenant,
                        logoUrl: tenant.branding?.logoUrl || undefined,
                      })
                      // Note: PDF is downloaded. For WhatsApp, user needs to manually share the downloaded PDF.
                      const msg = `Cotización ${q.number} generada. Por favor comparta el archivo PDF descargado.`
                      alert(msg)
                    } catch (error) {
                      console.error('Error exporting PDF:', error)
                      alert('Error al generar PDF para WhatsApp')
                    } finally {
                      setIsExporting(false)
                    }
                  }}
                >
                  WhatsApp PDF
                </Button>
              </>
            )}
          </div>
        }
      >
        {quoteQuery.isLoading && <Loading />}
        {quoteQuery.error && <ErrorState message="Error al cargar la cotización" retry={quoteQuery.refetch} />}

        {quoteQuery.data && !isEditing && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="grid gap-2 md:grid-cols-2 text-sm">
                <div><strong>Número:</strong> {quoteQuery.data.number}</div>
                <div><strong>Cliente:</strong> {quoteQuery.data.customerName}</div>
                <div><strong>Estado:</strong> {quoteQuery.data.status === 'PROCESSED' ? 'PROCESADA' : 'CREADA'}</div>
                <div><strong>Cotizado por:</strong> {quoteQuery.data.quotedBy ?? '-'}</div>
                <div><strong>Validez:</strong> {quoteQuery.data.validityDays} día(s)</div>
                <div><strong>Forma de pago:</strong> {paymentLabel(quoteQuery.data.paymentMode)}</div>
                <div><strong>Entrega:</strong> {quoteQuery.data.deliveryDays} día(s)</div>
                <div><strong>Desc. global:</strong> {quoteQuery.data.globalDiscountPct}%</div>
                {(quoteQuery.data.deliveryAddress || quoteQuery.data.deliveryZone || quoteQuery.data.deliveryCity) && (
                  <div className="md:col-span-2">
                    <strong>Lugar de entrega:</strong>{' '}
                    {[quoteQuery.data.deliveryAddress, quoteQuery.data.deliveryZone, quoteQuery.data.deliveryCity]
                      .map((p) => (p ?? '').trim())
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                )}
                {quoteQuery.data.deliveryMapsUrl && (
                  <div className="md:col-span-2">
                    <strong>Mapa:</strong>{' '}
                    <a
                      href={quoteQuery.data.deliveryMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--pf-primary)] underline"
                    >
                      Ver ubicación
                    </a>
                  </div>
                )}
                {quoteQuery.data.proposalValue && <div className="md:col-span-2"><strong>Valor de propuesta:</strong> {quoteQuery.data.proposalValue}</div>}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <Table
                columns={[
                  { header: 'SKU', accessor: (r: any) => r.productSku },
                  { header: 'Producto', accessor: (r: any) => r.productName },
                  {
                    header: 'Presentación',
                    accessor: (r: any) =>
                      isNonUnitPresentation(r.presentationName, r.unitsPerPresentation)
                        ? `${r.presentationName} (${Math.trunc(Number(r.unitsPerPresentation))}u)`
                        : (r.presentationName ?? 'Unidad'),
                  },
                  { header: 'Cant.', accessor: (r: any) => (r.presentationQuantity ? `${r.presentationQuantity}` : `${r.quantity}`) },
                  { header: 'Desc.%', accessor: (r: any) => r.discountPct },
                  {
                    header: 'P. unit.',
                    accessor: (r: any) => {
                      const unitsPer = Number(r.unitsPerPresentation ?? 1) || 1
                      const unit = Number(r.unitPrice)
                      const displayUnit = isNonUnitPresentation(r.presentationName, r.unitsPerPresentation) ? unit * unitsPer : unit
                      return `${money(displayUnit)} ${currency}`
                    },
                  },
                  { header: 'Total', accessor: (r: any) => `${money(r.total)} ${currency}` },
                ]}
                data={quoteQuery.data.lines}
                keyExtractor={(r: any) => r.id}
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex justify-end gap-6">
                <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
                <span className="font-medium">{money(quoteQuery.data.subtotal)} {currency}</span>
              </div>
              <div className="flex justify-end gap-6">
                <span className="text-slate-600 dark:text-slate-400">Desc. global</span>
                <span className="font-medium">-{money(quoteQuery.data.globalDiscountAmount)} {currency}</span>
              </div>
              <div className="mt-2 flex justify-end gap-6 border-t border-slate-200 pt-2 dark:border-slate-700">
                <span className="font-semibold">Total</span>
                <span className="font-semibold">{money(quoteQuery.data.total)} {currency}</span>
              </div>
            </div>
          </div>
        )}

        {quoteQuery.data && isEditing && draft && (
          <div className="space-y-4">
            {!canEdit && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200">
                Esta cotización ya fue procesada y no se puede editar.
              </div>
            )}

            {editError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-200">
                {editError}
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-sm font-medium">Cliente</div>
                  <CustomerSelector
                    value={draft.customerId}
                    onChange={(cid) => setDraft((p) => (p ? { ...p, customerId: cid } : p))}
                    disabled={!canEdit || saveMutation.isPending}
                  />
                </div>
                <div>
                  <div className="mb-1 text-sm font-medium">Validez (días)</div>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={String(draft.validityDays)}
                    onChange={(e) => setDraft((p) => (p ? { ...p, validityDays: Math.max(1, Math.trunc(toNumberSafe(e.target.value, 7))) } : p))}
                    disabled={!canEdit || saveMutation.isPending}
                  />
                </div>

                <div>
                  <div className="mb-1 text-sm font-medium">Entrega (días)</div>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={String(draft.deliveryDays)}
                    onChange={(e) => setDraft((p) => (p ? { ...p, deliveryDays: Math.max(0, Math.trunc(toNumberSafe(e.target.value, 1))) } : p))}
                    disabled={!canEdit || saveMutation.isPending}
                  />
                </div>
                <div>
                  <div className="mb-1 text-sm font-medium">Desc. global (%)</div>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={String(draft.globalDiscountPct)}
                    onChange={(e) => setDraft((p) => (p ? { ...p, globalDiscountPct: Math.min(100, Math.max(0, toNumberSafe(e.target.value, 0))) } : p))}
                    disabled={!canEdit || saveMutation.isPending}
                  />
                </div>

                <div>
                  <div className="mb-1 text-sm font-medium">Ciudad de entrega</div>
                  <Input
                    value={draft.deliveryCity}
                    onChange={(e) => setDraft((p) => (p ? { ...p, deliveryCity: e.target.value } : p))}
                    disabled={!canEdit || saveMutation.isPending}
                  />
                </div>
                <div>
                  <div className="mb-1 text-sm font-medium">Zona</div>
                  <Input
                    value={draft.deliveryZone}
                    onChange={(e) => setDraft((p) => (p ? { ...p, deliveryZone: e.target.value } : p))}
                    disabled={!canEdit || saveMutation.isPending}
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1 text-sm font-medium">Dirección</div>
                  <Input
                    value={draft.deliveryAddress}
                    onChange={(e) => setDraft((p) => (p ? { ...p, deliveryAddress: e.target.value } : p))}
                    disabled={!canEdit || saveMutation.isPending}
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1 text-sm font-medium">Link de mapa (opcional)</div>
                  <Input
                    value={draft.deliveryMapsUrl}
                    onChange={(e) => setDraft((p) => (p ? { ...p, deliveryMapsUrl: e.target.value } : p))}
                    disabled={!canEdit || saveMutation.isPending}
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1 text-sm font-medium">Valor de propuesta (opcional)</div>
                  <Input
                    value={draft.proposalValue}
                    onChange={(e) => setDraft((p) => (p ? { ...p, proposalValue: e.target.value } : p))}
                    disabled={!canEdit || saveMutation.isPending}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <Table
                columns={editColumns as any}
                data={draft.lines}
                keyExtractor={(r: any) => r.key}
              />

              <div className="flex items-center justify-between border-t border-slate-200 p-3 dark:border-slate-700">
                <Button
                  variant="outline"
                  icon={<PlusIcon className="h-5 w-5" />}
                  onClick={() => {
                    setDraft((prev) => {
                      if (!prev) return prev
                      const key = `new-${Date.now()}-${Math.random().toString(16).slice(2)}`
                      const nextLine: DraftLine = {
                        key,
                        productId: null,
                        productSku: '',
                        productName: '',
                        presentations: [],
                        presentationId: null,
                        presentationQuantity: 1,
                        unitPriceBase: 0,
                        discountPct: 0,
                      }
                      return { ...prev, lines: [...prev.lines, nextLine] }
                    })
                  }}
                  disabled={!canEdit || saveMutation.isPending}
                >
                  Agregar fila
                </Button>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => { setIsEditing(false); setEditError('') }}
                    disabled={saveMutation.isPending}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    loading={saveMutation.isPending}
                    onClick={async () => {
                      setEditError('')
                      try {
                        if (!draft.customerId) throw new Error('Seleccione un cliente')
                        if (!draft.lines.length) throw new Error('Agregue al menos una fila')
                        await saveMutation.mutateAsync(draft)
                      } catch (e: any) {
                        setEditError(e?.message ? String(e.message) : 'Error al guardar')
                      }
                    }}
                    disabled={!canEdit}
                  >
                    Guardar cambios
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </PageContainer>
    </MainLayout>
  )
}
