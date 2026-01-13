import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth, useCart, useTenant } from '../../providers'
import {
  MainLayout,
  PageContainer,
  Button,
  Loading,
  ErrorState,
  EmptyState,
  CatalogSearch,
  Select,
  Input,
  Modal,
  Table,
} from '../../components'
import { useNavigation } from '../../hooks'
import jsPDF from 'jspdf'
import { useNavigate, useSearchParams } from 'react-router-dom'

type Product = {
  id: string
  sku: string
  name: string
  photoUrl?: string | null
  price?: string | null
  isActive: boolean
}

type ListResponse = { items: Product[]; nextCursor: string | null }

type CustomerListItem = {
  id: string
  name: string
  isActive: boolean
  creditDays7Enabled?: boolean
  creditDays14Enabled?: boolean
}

type CustomerListResponse = { items: CustomerListItem[]; nextCursor: string | null }

type BalanceExpandedItem = {
  id: string
  quantity: string
  reservedQuantity?: string
  productId: string
  product: { sku: string; name: string }
  batchId: string | null
  batch: { batchNumber: string; expiresAt: string | null; status: string; version: number } | null
  location: { code: string; warehouse: { id: string; name: string; code: string } }
}


async function fetchProducts(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/products?${params}`, { token })
}

async function fetchCustomers(token: string): Promise<CustomerListResponse> {
  const params = new URLSearchParams({ take: '50' })
  return apiFetch(`/api/v1/customers?${params}`, { token })
}

async function fetchBalancesExpanded(token: string): Promise<{ items: BalanceExpandedItem[] }> {
  const params = new URLSearchParams({ take: '200' })
  return apiFetch(`/api/v1/reports/stock/balances-expanded?${params}`, { token })
}

type QuoteCreateResponse = {
  id: string
  number: string
  customerId: string
  customerName: string
  validityDays: number
  paymentMode: string
  deliveryDays: number
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
    quantity: number
    unitPrice: number
    discountPct: number
  }>
  createdAt: string
}

type QuoteDetailForEdit = {
  id: string
  number: string
  customerId: string
  customerName: string
  validityDays: number
  paymentMode: string
  deliveryDays: number
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
    quantity: number
    unitPrice: number
    discountPct: number
    total: number
  }>
  createdAt: string
  updatedAt: string
}

async function createQuote(
  token: string,
  data: {
    customerId: string
    validityDays: number
    paymentMode: string
    deliveryDays: number
    globalDiscountPct: number
    proposalValue?: string
    note?: string
    lines: Array<{ productId: string; quantity: number; unitPrice: number; discountPct: number }>
  },
): Promise<QuoteCreateResponse> {
  return apiFetch(`/api/v1/sales/quotes`, { token, method: 'POST', body: JSON.stringify(data) })
}

async function updateQuote(
  token: string,
  quoteId: string,
  data: {
    customerId: string
    validityDays: number
    paymentMode: string
    deliveryDays: number
    globalDiscountPct: number
    proposalValue?: string
    note?: string
    lines: Array<{ productId: string; quantity: number; unitPrice: number; discountPct: number }>
  },
): Promise<QuoteCreateResponse> {
  return apiFetch(`/api/v1/sales/quotes/${quoteId}`, { token, method: 'PUT', body: JSON.stringify(data) })
}

async function fetchQuoteForEdit(token: string, quoteId: string): Promise<QuoteDetailForEdit> {
  return apiFetch(`/api/v1/sales/quotes/${quoteId}`, { token })
}

async function createSalesOrder(
  token: string,
  data: {
    customerId: string
    note?: string
    lines: Array<{ productId: string; quantity: number; unitPrice: number }>
  },
): Promise<{ id: string; number: string; status: string; version: number; createdAt: string }> {
  return apiFetch(`/api/v1/sales/orders`, { token, method: 'POST', body: JSON.stringify(data) })
}

type WarehouseStock = { warehouseName: string; qty: number }

type StockSummary = {
  total: number
  warehouses: WarehouseStock[]
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

async function exportQuoteToPDF(
  quoteData: {
    quoteNumber: string
    customerName: string
    validityDays: string
    paymentMode: string
    deliveryDays: string
    globalDiscountPct: string
    proposalValue: string
    items: any[]
    subtotal: number
    globalDiscountAmount: number
    totalAfterGlobal: number
    currency: string
    tenant: any
  }
): Promise<void> {
  const pdf = new jsPDF('p', 'mm', 'letter') // Tamaño carta
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

  // Encabezados de tabla
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'bold')
  headers.forEach((header, i) => {
    let x = margin
    for (let j = 0; j < i; j++) x += colWidths[j]
    pdf.text(header, x, yPosition)
  })
  yPosition += 6

  // Línea separadora
  pdf.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 4

  // Filas de productos
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
      `${money(item.lineTotal)} ${quoteData.currency}`
    ]

    rowData.forEach((data, i) => {
      let x = margin
      for (let j = 0; j < i; j++) x += colWidths[j]
      pdf.text(data, x, yPosition)
    })
    yPosition += 5
  })

  yPosition += 5

  // Totales
  if (yPosition > pageHeight - margin - 30) {
    pdf.addPage()
    yPosition = margin
  }

  pdf.setFont('helvetica', 'bold')
  pdf.text(`Total: ${money(quoteData.subtotal)} ${quoteData.currency}`, pageWidth - margin - 60, yPosition, { align: 'right' })
  yPosition += 6

  if (quoteData.globalDiscountAmount > 0) {
    pdf.text(`Desc. global (${quoteData.globalDiscountPct}%): -${money(quoteData.globalDiscountAmount)} ${quoteData.currency}`, pageWidth - margin - 60, yPosition, { align: 'right' })
    yPosition += 6
  }

  pdf.setFontSize(11)
  pdf.text(`TOTAL FINAL: ${money(quoteData.totalAfterGlobal)} ${quoteData.currency}`, pageWidth - margin, yPosition, { align: 'right' })
  yPosition += 10

  // Información adicional
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Forma de pago: ${quoteData.paymentMode}`, margin, yPosition)
  yPosition += 5
  pdf.text(`Tiempo de entrega: ${quoteData.deliveryDays} día(s)`, margin, yPosition)
  yPosition += 5
  if (quoteData.proposalValue.trim()) {
    pdf.text(`Valor de propuesta: ${quoteData.proposalValue}`, margin, yPosition)
  }

  // Descargar el PDF
  pdf.save(`cotizacion-${quoteData.quoteNumber}.pdf`)
}

export function SellerCatalogPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const quoteId = searchParams.get('quoteId')
  const isEditing = !!quoteId
  const queryClient = useQueryClient()
  const navGroups = useNavigation()
  const cart = useCart()
  const tenant = useTenant()
  const currency = tenant.branding?.currency || 'BOB'

  const [cursor, setCursor] = useState<string | undefined>()
  const take = 20

  const [customerId, setCustomerId] = useState('')

  const [quoteOpen, setQuoteOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)

  const [validityDays, setValidityDays] = useState('7')
  const [paymentMode, setPaymentMode] = useState('CASH')
  const [globalDiscountPct, setGlobalDiscountPct] = useState('0')
  const [deliveryDays, setDeliveryDays] = useState('1')
  const [proposalValue, setProposalValue] = useState('')

  const loadedQuoteIdRef = useRef<string | null>(null)
  const autoOpenedQuoteIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isEditing || !quoteId) return
    if (autoOpenedQuoteIdRef.current === quoteId) return
    autoOpenedQuoteIdRef.current = quoteId
    setQuoteOpen(true)
  }, [isEditing, quoteId])

  // Estado para cantidades temporales de productos antes de agregar al carrito
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({})

  // Requirement: entering Seller view must start with empty selection (except edit mode).
  useEffect(() => {
    if (isEditing) return
    cart.clearCart()
    setCustomerId('')
    setValidityDays('7')
    setPaymentMode('CASH')
    setGlobalDiscountPct('0')
    setDeliveryDays('1')
    setProposalValue('')
  }, [isEditing])

  // Funciones para manejar cantidades temporales
  const updateProductQuantity = (productId: string, quantity: number) => {
    setProductQuantities(prev => ({
      ...prev,
      [productId]: Math.max(0, quantity)
    }))
  }

  const addProductToCart = (product: Product) => {
    const quantity = productQuantities[product.id] || 0
    if (quantity <= 0) return

    cart.addItem({
      id: product.id,
      sku: product.sku,
      name: product.name,
      price: parseFloat(product.price || '0'),
      quantity: quantity,
      photoUrl: product.photoUrl || null,
    })

    // Limpiar la cantidad después de agregar
    setProductQuantities(prev => ({
      ...prev,
      [product.id]: 0
    }))
  }

  const productsQuery = useQuery({
    queryKey: ['seller-products', take, cursor],
    queryFn: () => fetchProducts(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const customersQuery = useQuery({
    queryKey: ['customers', 'forSellerCatalog'],
    queryFn: () => fetchCustomers(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const balancesQuery = useQuery({
    queryKey: ['balancesExpanded', 'forSellerCatalog'],
    queryFn: () => fetchBalancesExpanded(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const quoteForEditQuery = useQuery({
    queryKey: ['quote', 'edit', quoteId],
    queryFn: () => fetchQuoteForEdit(auth.accessToken!, quoteId!),
    enabled: !!auth.accessToken && !!quoteId,
  })

  useEffect(() => {
    if (!isEditing) return
    if (!quoteForEditQuery.data) return
    if (loadedQuoteIdRef.current === quoteForEditQuery.data.id) return

    loadedQuoteIdRef.current = quoteForEditQuery.data.id

    const q = quoteForEditQuery.data
    setCustomerId(q.customerId)
    setValidityDays(String(q.validityDays ?? 7))
    setPaymentMode(q.paymentMode ?? 'CASH')
    setDeliveryDays(String(q.deliveryDays ?? 1))
    setGlobalDiscountPct(String(q.globalDiscountPct ?? 0))
    setProposalValue(q.proposalValue ?? '')

    cart.clearCart()
    for (const line of q.lines) {
      cart.addItem({
        id: line.productId,
        sku: line.productSku,
        name: line.productName,
        price: line.unitPrice,
        quantity: line.quantity,
        discountPct: line.discountPct,
        photoUrl: null,
      })
    }
  }, [isEditing, quoteForEditQuery.data])

  const saveQuoteMutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('Seleccioná un cliente')
      if (cart.items.length === 0) throw new Error('Seleccioná al menos un producto')

      const lines = cart.items.map((i) => ({
        productId: i.id,
        quantity: i.quantity,
        unitPrice: i.price,
        discountPct: clampPct(i.discountPct ?? 0),
      }))

      const payload = {
        customerId,
        validityDays: Number(validityDays) || 7,
        paymentMode,
        deliveryDays: Number(deliveryDays) || 1,
        globalDiscountPct: clampPct(Number(globalDiscountPct)),
        proposalValue: proposalValue.trim() || undefined,
        note: undefined,
        lines,
      }

      if (isEditing && quoteId) {
        return updateQuote(auth.accessToken!, quoteId, payload)
      }

      return createQuote(auth.accessToken!, payload)
    },
    onSuccess: async (created) => {
      // Refrescar lista de cotizaciones
      await queryClient.invalidateQueries({ queryKey: ['quotes'] })
      await queryClient.invalidateQueries({ queryKey: ['quote'] })

      // Exportar PDF usando el correlativo generado al guardar
      const paymentLabel = paymentOptions.find((o) => o.value === paymentMode)?.label ?? paymentMode
      const quoteData = {
        quoteNumber: created.number,
        customerName: created.customerName,
        validityDays: String(created.validityDays),
        paymentMode: paymentLabel.replace(/[^\x20-\x7E]/g, '').trim(),
        deliveryDays: String(created.deliveryDays),
        globalDiscountPct: String(created.globalDiscountPct),
        proposalValue: created.proposalValue ?? '',
        items: created.lines.map((l) => {
          const disc = clampPct(l.discountPct) / 100
          const line = l.unitPrice * l.quantity * (1 - disc)
          return {
            sku: l.productSku,
            name: l.productName,
            quantity: l.quantity,
            discountPct: clampPct(l.discountPct),
            unitPrice: l.unitPrice,
            lineTotal: line,
          }
        }),
        subtotal: created.subtotal,
        globalDiscountAmount: created.globalDiscountAmount,
        totalAfterGlobal: created.total,
        currency,
        tenant,
      }
      await exportQuoteToPDF(quoteData)

      alert(isEditing ? `✅ Cotización actualizada: ${created.number}` : `✅ Cotización guardada: ${created.number}`)
      setQuoteOpen(false)

      if (!isEditing) {
        cart.clearCart()
      } else {
        navigate(`/sales/quotes/${created.id}`)
      }
    },
    onError: (err: any) => {
      alert(err instanceof Error ? err.message : 'Error al guardar cotización')
    },
  })

  const createOrderMutation = useMutation({
    mutationFn: () => {
      if (!customerId) throw new Error('Seleccioná un cliente')
      if (cart.items.length === 0) throw new Error('Seleccioná al menos un producto')

      const gd = clampPct(Number(globalDiscountPct)) / 100

      const lines = cart.items.map((i) => {
        const itemDiscount = clampPct(i.discountPct ?? 0) / 100
        const finalUnit = i.price * (1 - itemDiscount) * (1 - gd)
        return {
          productId: i.id,
          quantity: i.quantity,
          unitPrice: Number.isFinite(finalUnit) ? finalUnit : 0,
        }
      })

      const noteParts = [`Entrega: ${deliveryDays || '1'} día(s)`, `Descuento global: ${clampPct(Number(globalDiscountPct))}%`]
      return createSalesOrder(auth.accessToken!, {
        customerId,
        note: noteParts.join(' | '),
        lines,
      })
    },
    onSuccess: (created) => {
      alert(`✅ Pedido creado: ${created.number}`)
      cart.clearCart()
      setOrderOpen(false)
    },
    onError: (err: any) => {
      alert(err instanceof Error ? err.message : 'Error al procesar pedido')
    },
  })

  const activeProducts = productsQuery.data?.items.filter((p) => p.isActive) ?? []

  const stockByProduct = useMemo(() => {
    const map = new Map<string, StockSummary>()

    for (const item of balancesQuery.data?.items ?? []) {
      const qty = Math.max(0, Number(item.quantity) - Number(item.reservedQuantity ?? '0'))
      if (!Number.isFinite(qty) || qty <= 0) continue

      const current = map.get(item.productId) ?? { total: 0, warehouses: [] }
      current.total += qty

      const whName = item.location.warehouse.name
      const whIndex = current.warehouses.findIndex((w) => w.warehouseName === whName)
      if (whIndex >= 0) {
        current.warehouses[whIndex] = { ...current.warehouses[whIndex], qty: current.warehouses[whIndex]!.qty + qty }
      } else {
        current.warehouses.push({ warehouseName: whName, qty })
      }

      map.set(item.productId, current)
    }

    for (const v of map.values()) {
      v.warehouses.sort((a, b) => b.qty - a.qty)
    }

    return map
  }, [balancesQuery.data?.items])

  const selectedCustomer = (customersQuery.data?.items ?? []).find((c) => c.id === customerId) ?? null

  const paymentOptions = useMemo(() => {
    const options = [{ value: 'CASH', label: '💵 Pago al contado' }]

    if (selectedCustomer?.creditDays7Enabled) options.push({ value: 'CREDIT_7', label: '🗓️ Crédito 7 días' })
    if (selectedCustomer?.creditDays14Enabled) options.push({ value: 'CREDIT_14', label: '🗓️ Crédito 14 días' })

    if (paymentMode && !options.some((o) => o.value === paymentMode)) {
      options.push({ value: paymentMode, label: paymentMode })
    }

    return options
  }, [selectedCustomer?.creditDays7Enabled, selectedCustomer?.creditDays14Enabled, paymentMode])

  const canGenerate = !!customerId && cart.items.length > 0

  const subtotal = useMemo(() => {
    return cart.items.reduce((sum, i) => {
      const disc = clampPct(i.discountPct ?? 0) / 100
      return sum + i.price * i.quantity * (1 - disc)
    }, 0)
  }, [cart.items])

  const globalDiscountAmount = useMemo(() => {
    const gd = clampPct(Number(globalDiscountPct)) / 100
    return subtotal * gd
  }, [subtotal, globalDiscountPct])

  const totalAfterGlobal = Math.max(0, subtotal - globalDiscountAmount)

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title={isEditing ? '🧑‍💼 Editar cotización' : '🧑‍💼 Catálogo Vendedor'}>
        {isEditing && quoteForEditQuery.isLoading && <Loading />}
        {isEditing && quoteForEditQuery.error && (
          <ErrorState
            message="Error al cargar la cotización para editar"
            retry={quoteForEditQuery.refetch}
          />
        )}
        <CatalogSearch className="mb-4" />

        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <Select
            label="👥 Cliente final"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            options={[
              { value: '', label: 'Seleccioná...' },
              ...(customersQuery.data?.items ?? [])
                .filter((c) => c.isActive)
                .map((c) => ({ value: c.id, label: c.name })),
            ]}
            disabled={customersQuery.isLoading}
          />

          <div className="flex items-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setQuoteOpen(true)
              }}
              disabled={!canGenerate}
            >
              📄 Generar cotización
            </Button>
            <Button onClick={() => setOrderOpen(true)} disabled={!canGenerate}>
              🧾 Procesar pedido
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            {productsQuery.isLoading && <Loading />}
            {productsQuery.error && (
              <ErrorState
                message={productsQuery.error instanceof Error ? productsQuery.error.message : 'Error al cargar productos'}
                retry={productsQuery.refetch}
              />
            )}

            {activeProducts.length === 0 && !productsQuery.isLoading && <EmptyState message="No hay productos" />}

            {activeProducts.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {activeProducts.map((p) => {
                  const stock = stockByProduct.get(p.id)
                  const totalStock = stock?.total ?? 0
                  const topWarehouses = (stock?.warehouses ?? []).slice(0, 2)
                  const cartItem = cart.items.find(item => item.id === p.id)
                  const currentQuantity = productQuantities[p.id] || 0

                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-800/80 overflow-hidden relative"
                    >
                      {/* Círculo con cantidad si está en el carrito */}
                      {cartItem && (
                        <div className="absolute top-2 right-2 z-10 flex flex-col items-center gap-1">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg"
                            style={{ backgroundColor: tenant.branding?.brandPrimary || '#3B82F6' }}
                            title="Cantidad seleccionada"
                          >
                            {cartItem.quantity}
                          </div>
                          <button
                            type="button"
                            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 shadow"
                            title="🗑️ Quitar selección"
                            onClick={() => cart.removeItem(p.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      )}

                      <div className="aspect-square bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                        {p.photoUrl ? (
                          <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-5xl text-slate-400">📦</div>
                        )}
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-2">{p.name}</div>
                        <div className="text-xs text-slate-500">SKU: {p.sku}</div>

                        <div className="flex items-center justify-between">
                          <div className="text-base font-bold text-slate-900 dark:text-white">
                            {money(parseFloat(p.price || '0'))} {currency}
                          </div>
                          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            Stock: {totalStock}
                          </div>
                        </div>

                        {topWarehouses.length > 0 && (
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            {topWarehouses.map((w) => (
                              <div key={w.warehouseName} className="flex justify-between">
                                <span className="truncate">{w.warehouseName}</span>
                                <span className="font-medium">{w.qty}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Input de cantidad + Botón agregar */}
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            placeholder="Cantidad"
                            value={currentQuantity || ''}
                            onChange={(e) => updateProductQuantity(p.id, Number(e.target.value))}
                            min={0}
                            className="flex-1"
                          />
                          <Button
                            size="sm"
                            onClick={() => addProductToCart(p)}
                            disabled={currentQuantity <= 0}
                            className="px-3"
                          >
                            +Agregar
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {productsQuery.data?.nextCursor && (
              <div className="mt-6 flex justify-center">
                <Button variant="secondary" onClick={() => setCursor(productsQuery.data!.nextCursor!)} loading={productsQuery.isFetching}>
                  Cargar más
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900 dark:text-slate-100">🧺 Selección</div>
              <Button size="sm" variant="secondary" onClick={() => cart.clearCart()} disabled={cart.items.length === 0}>
                Vaciar
              </Button>
            </div>

            {cart.items.length === 0 ? (
              <div className="mt-4 text-sm text-slate-600 dark:text-slate-400">Aún no seleccionaste productos.</div>
            ) : (
              <div className="mt-3 space-y-3">
                {cart.items.map((i) => (
                  <div key={i.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{i.name}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Input
                        label="Cantidad"
                        type="number"
                        value={String(i.quantity)}
                        onChange={(e) => cart.updateQuantity(i.id, Number(e.target.value))}
                        min={0}
                      />
                      <Input
                        label="Desc. % (producto)"
                        type="number"
                        value={String(i.discountPct ?? 0)}
                        onChange={(e) => cart.updateDiscountPct(i.id, clampPct(Number(e.target.value)))}
                        min={0}
                        max={100}
                      />
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>Unitario:</span>
                      <span>
                        {money(i.price)} {currency}
                      </span>
                    </div>
                  </div>
                ))}

                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <Input
                    label="Descuento global (%)"
                    type="number"
                    value={globalDiscountPct}
                    onChange={(e) => setGlobalDiscountPct(e.target.value)}
                    min={0}
                    max={100}
                  />
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {money(subtotal)} {currency}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Desc. global</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        -{money(globalDiscountAmount)} {currency}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2">
                      <span className="text-slate-600 dark:text-slate-400">Total</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {money(totalAfterGlobal)} {currency}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </PageContainer>

      <Modal isOpen={quoteOpen} onClose={() => setQuoteOpen(false)} title={isEditing ? '📄 Editar cotización' : '📄 Generar cotización'} maxWidth="xl">
        {isEditing && quoteForEditQuery.isLoading ? (
          <div className="py-8">
            <Loading />
          </div>
        ) : isEditing && quoteForEditQuery.error ? (
          <div className="py-4">
            <ErrorState message="Error al cargar la cotización para editar" retry={quoteForEditQuery.refetch} />
          </div>
        ) : (
        <div className="space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="grid gap-3 md:grid-cols-2">
            <Input label="Tiempo de validez (días)" type="number" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} min={1} />
            <Select label="Modalidad de pago" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} options={paymentOptions} />
            <Input label="Tiempo de entrega (días)" type="number" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} min={0} />
            <Input label="Descuento global (%)" type="number" value={globalDiscountPct} onChange={(e) => setGlobalDiscountPct(e.target.value)} min={0} max={100} />
          </div>

          <Input label="Valor de propuesta (opcional)" value={proposalValue} onChange={(e) => setProposalValue(e.target.value)} placeholder="opcional" />

          {/* Cotización con diseño de hoja */}
          <div className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 shadow-lg rounded-sm overflow-hidden">
            <div className="p-8 space-y-6">
              {/* Encabezado */}
              <div className="text-center border-b-2 border-slate-300 dark:border-slate-600 pb-4">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">COTIZACIÓN</h1>
              </div>

              {/* Información de empresa y cotización */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  {tenant.branding?.logoUrl ? (
                    <img src={tenant.branding.logoUrl} className="h-12 w-auto" />
                  ) : (
                    <div className="h-12 w-12 rounded bg-slate-200 dark:bg-slate-700" />
                  )}
                  <div>
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{tenant.branding?.tenantName ?? 'Empresa'}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                      Cotización: {isEditing && quoteForEditQuery.data ? quoteForEditQuery.data.number : '(se asigna al guardar)'}
                    </div>
                  </div>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400 text-right">
                  <div className="font-medium">Dirigido a: {selectedCustomer?.name ?? '-'}</div>
                  <div>
                    Fecha:{' '}
                    {isEditing && quoteForEditQuery.data
                      ? new Date(quoteForEditQuery.data.createdAt).toLocaleDateString()
                      : new Date().toLocaleDateString()}
                  </div>
                  <div>Validez: {validityDays} día(s)</div>
                </div>
              </div>

              {/* Tabla de productos */}
              <div className="border border-slate-300 dark:border-slate-600 rounded">
                <Table
                  columns={[
                    { header: 'SKU', accessor: (r: any) => r.sku },
                    { header: 'Producto', accessor: (r: any) => r.name },
                    {
                      header: 'Cantidad',
                      accessor: (r: any) => (
                        <Input
                          type="number"
                          value={String(r.quantity)}
                          onChange={(e) => cart.updateQuantity(r.productId, Number(e.target.value))}
                          min={0}
                          className="w-24"
                        />
                      ),
                    },
                    {
                      header: 'Desc. %',
                      accessor: (r: any) => (
                        <Input
                          type="number"
                          value={String(r.discountPct)}
                          onChange={(e) => cart.updateDiscountPct(r.productId, clampPct(Number(e.target.value)))}
                          min={0}
                          max={100}
                          className="w-24"
                        />
                      ),
                    },
                    {
                      header: 'Precio unit.',
                      accessor: (r: any) => (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={String(r.unitPrice)}
                            onChange={(e) => cart.updatePrice(r.productId, Number(e.target.value))}
                            min={0}
                            className="w-28"
                          />
                          <span className="text-xs text-slate-600 dark:text-slate-400">{currency}</span>
                        </div>
                      ),
                    },
                    {
                      header: 'Total',
                      accessor: (r: any) => `${money(r.lineTotal)} ${currency}`,
                    },
                  ]}
                  data={cart.items.map((i) => {
                    const disc = clampPct(i.discountPct ?? 0) / 100
                    const unit = i.price
                    const line = unit * i.quantity * (1 - disc)
                    return {
                      productId: i.id,
                      sku: i.sku,
                      name: i.name,
                      quantity: i.quantity,
                      discountPct: clampPct(i.discountPct ?? 0),
                      unitPrice: unit,
                      lineTotal: line,
                    }
                  })}
                  keyExtractor={(r: any) => r.productId}
                />
              </div>

              {/* Totales */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-end gap-6">
                  <span className="text-slate-600 dark:text-slate-400">Total</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{money(subtotal)} {currency}</span>
                </div>
                {clampPct(Number(globalDiscountPct)) > 0 && (
                  <div className="flex justify-end gap-6">
                    <span className="text-slate-600 dark:text-slate-400">Desc. global ({clampPct(Number(globalDiscountPct))}%)</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">-{money(globalDiscountAmount)} {currency}</span>
                  </div>
                )}
                <div className="flex justify-end gap-6 border-t-2 border-slate-300 dark:border-slate-600 pt-2">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Total final</span>
                  <span className="font-bold text-lg text-slate-900 dark:text-slate-100">{money(totalAfterGlobal)} {currency}</span>
                </div>
              </div>

              {/* Información adicional */}
              <div className="grid gap-2 text-sm text-slate-700 dark:text-slate-300 border-t border-slate-300 dark:border-slate-600 pt-4">
                <div><strong>Forma de pago:</strong> {paymentOptions.find((o) => o.value === paymentMode)?.label ?? paymentMode}</div>
                <div><strong>Tiempo de entrega:</strong> {deliveryDays} día(s)</div>
                {proposalValue.trim() && (<div><strong>Valor de propuesta:</strong> {proposalValue}</div>)}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button onClick={() => saveQuoteMutation.mutate()} loading={saveQuoteMutation.isPending}>
              {isEditing ? '💾 Guardar cambios y exportar a PDF' : '💾 Guardar y exportar a PDF'}
            </Button>
            <Button variant="secondary" onClick={() => setQuoteOpen(false)}>Cerrar</Button>
          </div>
        </div>
        )}
      </Modal>

      <Modal isOpen={orderOpen} onClose={() => setOrderOpen(false)} title="🧾 Procesar pedido" maxWidth="lg">
        <div className="space-y-4">
          <Input label="Tiempo de entrega (días)" type="number" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} min={0} />
          <Input label="Descuento global (%)" type="number" value={globalDiscountPct} onChange={(e) => setGlobalDiscountPct(e.target.value)} min={0} max={100} />

          <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 text-sm">
            <div><strong>Cliente:</strong> {selectedCustomer?.name ?? '-'}</div>
            <div><strong>Ítems:</strong> {cart.itemCount}</div>
            <div><strong>Total estimado:</strong> {money(totalAfterGlobal)} {currency}</div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOrderOpen(false)} disabled={createOrderMutation.isPending}>
              Cancelar
            </Button>
            <Button onClick={() => createOrderMutation.mutate()} loading={createOrderMutation.isPending}>
              Confirmar
            </Button>
          </div>
        </div>
      </Modal>
    </MainLayout>
  )
}
