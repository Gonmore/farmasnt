import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { getProductDisplayName } from '../../lib/productName'
import { useAuth, useCart, useTenant, useTheme } from '../../providers'
import {
  MainLayout,
  PageContainer,
  Button,
  Loading,
  ErrorState,
  EmptyState,
  CatalogSearch,
  ProductPhoto,
  Select,
  Input,
  Modal,
  Table,
  MapSelector,
  PaginationCursor,
} from '../../components'
import { useNavigation, useMediaQuery } from '../../hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exportQuoteToPDF } from '../../lib/quotePdf'

type Product = {
  id: string
  sku: string
  name: string
  genericName?: string | null
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
    deliveryCity?: string
    deliveryZone?: string
    deliveryAddress?: string
    deliveryMapsUrl?: string
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
    deliveryCity?: string
    deliveryZone?: string
    deliveryAddress?: string
    deliveryMapsUrl?: string
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

type CustomerDetail = {
  id: string
  name: string
  address: string | null
  city: string | null
  zone: string | null
  mapsUrl: string | null
}

async function fetchCustomerDetail(token: string, customerId: string): Promise<CustomerDetail> {
  return apiFetch(`/api/v1/customers/${customerId}`, { token })
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
  const theme = useTheme()
  const currency = tenant.branding?.currency || 'BOB'

  // Media query for compact button: screens < 480px or >= 1024px
  const isCompactButton = useMediaQuery('(max-width: 480px) or (min-width: 1024px)')

  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
  const take = 20

  const [customerId, setCustomerId] = useState('')

  const [quoteOpen, setQuoteOpen] = useState(false)

  const [validityDays, setValidityDays] = useState('7')
  const [paymentMode, setPaymentMode] = useState('CASH')
  const [globalDiscountPct, setGlobalDiscountPct] = useState('0')
  const [deliveryDays, setDeliveryDays] = useState('1')
  const [proposalValue, setProposalValue] = useState('')

  const [deliveryCity, setDeliveryCity] = useState('')
  const [deliveryZone, setDeliveryZone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryMapsUrl, setDeliveryMapsUrl] = useState('')

  type DeliveryMode = 'customer' | 'custom'
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('customer')

  const deliveryTouchedRef = useRef(false)

  const [showSaveSuccess, setShowSaveSuccess] = useState(false)
  const [quoteActionError, setQuoteActionError] = useState('')

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
    setDeliveryCity('')
    setDeliveryZone('')
    setDeliveryAddress('')
    setDeliveryMapsUrl('')
    deliveryTouchedRef.current = false
    setDeliveryMode('customer')
    setQuoteActionError('')
    setShowSaveSuccess(false)
  }, [isEditing])

  useEffect(() => {
    if (!quoteOpen) return
    setQuoteActionError('')
    setShowSaveSuccess(false)
    deliveryTouchedRef.current = false
    setDeliveryMode('customer')
  }, [quoteOpen])

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
      name: getProductDisplayName(product),
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

  const customerDetailQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomerDetail(auth.accessToken!, customerId),
    enabled: !!auth.accessToken && !!customerId,
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

  const handleGoBack = () => {
    if (cursorHistory.length > 0) {
      const previousCursor = cursorHistory[cursorHistory.length - 1]
      setCursorHistory(prev => prev.slice(0, -1))
      setCursor(previousCursor || undefined)
    }
  }

  const handleGoToStart = () => {
    setCursor(undefined)
    setCursorHistory([])
  }

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

    setDeliveryCity(q.deliveryCity ?? '')
    setDeliveryZone(q.deliveryZone ?? '')
    setDeliveryAddress(q.deliveryAddress ?? '')
    setDeliveryMapsUrl(q.deliveryMapsUrl ?? '')
    deliveryTouchedRef.current = true

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

  useEffect(() => {
    if (!quoteOpen) return
    if (!customerDetailQuery.data) return
    if (deliveryTouchedRef.current) return

    setDeliveryCity(customerDetailQuery.data.city ?? '')
    setDeliveryZone(customerDetailQuery.data.zone ?? '')
    setDeliveryAddress(customerDetailQuery.data.address ?? '')
    setDeliveryMapsUrl(customerDetailQuery.data.mapsUrl ?? '')
  }, [quoteOpen, customerDetailQuery.data?.id])

  const effectiveDelivery = useMemo(() => {
    if (deliveryMode === 'customer') {
      return {
        city: customerDetailQuery.data?.city ?? deliveryCity,
        zone: customerDetailQuery.data?.zone ?? deliveryZone,
        address: customerDetailQuery.data?.address ?? deliveryAddress,
        mapsUrl: customerDetailQuery.data?.mapsUrl ?? deliveryMapsUrl,
      }
    }

    return {
      city: deliveryCity,
      zone: deliveryZone,
      address: deliveryAddress,
      mapsUrl: deliveryMapsUrl,
    }
  }, [
    deliveryMode,
    customerDetailQuery.data?.id,
    deliveryCity,
    deliveryZone,
    deliveryAddress,
    deliveryMapsUrl,
  ])

  const saveQuoteMutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('Seleccioná un cliente')
      if (cart.items.length === 0) throw new Error('Seleccioná al menos un producto')

      const invalidQty = cart.items.find((i) => !Number.isFinite(i.quantity) || i.quantity <= 0)
      if (invalidQty) throw new Error('Hay productos con cantidad 0. Eliminá el producto o ingresá una cantidad mayor a 0.')

      const quoteInEdit = quoteForEditQuery.data
      if (quoteInEdit?.status === 'PROCESSED') throw new Error('La cotización ya fue procesada y no se puede editar')

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
        deliveryCity: deliveryMode === 'custom' ? (deliveryCity.trim() || undefined) : undefined,
        deliveryZone: deliveryMode === 'custom' ? (deliveryZone.trim() || undefined) : undefined,
        deliveryAddress: deliveryMode === 'custom' ? (deliveryAddress.trim() || undefined) : undefined,
        deliveryMapsUrl: deliveryMode === 'custom' ? (deliveryMapsUrl.trim() || undefined) : undefined,
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

      setShowSaveSuccess(true)

      const paymentLabel = paymentOptions.find((o) => o.value === paymentMode)?.label ?? paymentMode
      await exportQuoteToPDF({
        quoteNumber: created.number,
        customerName: created.customerName,
        quotedBy: created.quotedBy ?? undefined,
        validityDays: String(created.validityDays),
        paymentMode: paymentLabel,
        deliveryDays: String(created.deliveryDays),
        deliveryCity: created.deliveryCity ?? undefined,
        deliveryZone: created.deliveryZone ?? undefined,
        deliveryAddress: created.deliveryAddress ?? undefined,
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
      })

      cart.clearCart()
      setQuoteOpen(false)
      navigate(`/sales/quotes?highlight=${encodeURIComponent(created.id)}`)
    },
    onError: (err: any) => {
      setQuoteActionError(err instanceof Error ? err.message : 'Error al guardar cotización')
    },
  })

  const activeProducts = searchResults || productsQuery.data?.items.filter((p) => p.isActive) || []

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

  const quoteInEdit = quoteForEditQuery.data
  const isProcessedQuote = !!(isEditing && quoteInEdit?.status === 'PROCESSED')
  const modalReadOnly = isProcessedQuote || showSaveSuccess

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
        <CatalogSearch className="mb-4" onSearchResults={setSearchResults} />

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
          </div>
        </div>

        <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_360px]">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            {productsQuery.isLoading && !searchResults && <Loading />}
            {productsQuery.error && !searchResults && (
              <ErrorState
                message={productsQuery.error instanceof Error ? productsQuery.error.message : 'Error al cargar productos'}
                retry={productsQuery.refetch}
              />
            )}

            {activeProducts.length === 0 && !productsQuery.isLoading && <EmptyState message={searchResults ? "No se encontraron productos" : "No hay productos"} />}

            {activeProducts.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
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
                        <ProductPhoto
                          url={p.photoUrl}
                          alt={getProductDisplayName(p)}
                          className="w-full h-full object-cover"
                          placeholder={<div className="text-4xl text-slate-400">📦</div>}
                        />
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-2">{getProductDisplayName(p)}</div>
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
                            className="w-20 flex-shrink-0"
                          />
                          <Button
                            size="sm"
                            onClick={() => addProductToCart(p)}
                            disabled={currentQuantity <= 0}
                            className="px-3"
                          >
                            {isCompactButton ? '+' : '+Agregar'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {!searchResults && (
              <PaginationCursor
                hasMore={!!productsQuery.data?.nextCursor}
                onLoadMore={() => {
                  setCursorHistory(prev => [...prev, cursor || ''])
                  setCursor(productsQuery.data!.nextCursor!)
                }}
                loading={productsQuery.isFetching}
                currentCount={productsQuery.data?.items.length || 0}
                onGoToStart={cursorHistory.length > 0 ? handleGoToStart : undefined}
                canGoBack={cursorHistory.length > 0}
                onGoBack={cursorHistory.length > 0 ? handleGoBack : undefined}
              />
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
                        onChange={(e) => {
                          const next = Number(e.target.value)
                          if (!Number.isFinite(next) || next <= 0) {
                            cart.removeItem(i.id)
                          } else {
                            cart.updateQuantity(i.id, next)
                          }
                        }}
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
          <div className="relative space-y-4 max-h-[80vh] overflow-y-auto">
            {showSaveSuccess && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 dark:bg-slate-900/70">
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-900/20">
                  <img
                    src={theme.mode === 'dark' ? '/dark_check.gif' : '/check.gif'}
                    alt="Guardado"
                    className="h-14 w-14"
                  />
                  <div className="text-sm text-emerald-900 dark:text-emerald-100">
                    Cotización guardada. Exportando PDF...
                  </div>
                </div>
              </div>
            )}

            {isProcessedQuote && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
                Esta cotización ya fue procesada y es solo lectura.
              </div>
            )}

            {quoteActionError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {quoteActionError}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Tiempo de validez (días)"
                type="number"
                value={validityDays}
                onChange={(e) => setValidityDays(e.target.value)}
                min={1}
                disabled={modalReadOnly}
              />
              <Select
                label="Modalidad de pago"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                options={paymentOptions}
                disabled={modalReadOnly}
              />
              <Input
                label="Tiempo de entrega (días)"
                type="number"
                value={deliveryDays}
                onChange={(e) => setDeliveryDays(e.target.value)}
                min={0}
                disabled={modalReadOnly}
              />
              <Input
                label="Descuento global (%)"
                type="number"
                value={globalDiscountPct}
                onChange={(e) => setGlobalDiscountPct(e.target.value)}
                min={0}
                max={100}
                disabled={modalReadOnly}
              />
            </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Lugar de entrega</div>

              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="deliveryMode"
                    checked={deliveryMode === 'customer'}
                    onChange={() => setDeliveryMode('customer')}
                    disabled={modalReadOnly}
                  />
                  <span>Usar ubicación del cliente</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="deliveryMode"
                    checked={deliveryMode === 'custom'}
                    onChange={() => setDeliveryMode('custom')}
                    disabled={modalReadOnly}
                  />
                  <span>Elegir otra ubicación</span>
                </label>
              </div>
            </div>

            {deliveryMode === 'customer' ? (
              <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                <div>
                  {[effectiveDelivery.address, effectiveDelivery.zone, effectiveDelivery.city]
                    .map((p) => (p ?? '').trim())
                    .filter(Boolean)
                    .join(', ') || '—'}
                </div>
                {!!effectiveDelivery.mapsUrl?.trim() && (
                  <div className="mt-1">
                    <a
                      href={effectiveDelivery.mapsUrl.trim()}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--pf-primary)] underline"
                    >
                      Ver en mapa
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Input
                    label="Ciudad"
                    value={deliveryCity}
                    onChange={(e) => {
                      deliveryTouchedRef.current = true
                      setDeliveryCity(e.target.value)
                    }}
                    disabled={modalReadOnly}
                  />
                  <Input
                    label="Zona"
                    value={deliveryZone}
                    onChange={(e) => {
                      deliveryTouchedRef.current = true
                      setDeliveryZone(e.target.value)
                    }}
                    disabled={modalReadOnly}
                  />
                </div>
                <div className="mt-3">
                  <Input
                    label="Dirección"
                    value={deliveryAddress}
                    onChange={(e) => {
                      deliveryTouchedRef.current = true
                      setDeliveryAddress(e.target.value)
                    }}
                    placeholder="(opcional)"
                    disabled={modalReadOnly}
                  />
                </div>
                <div className="mt-3">
                  <Input
                    label="URL de mapa (Google Maps)"
                    value={deliveryMapsUrl}
                    onChange={(e) => {
                      deliveryTouchedRef.current = true
                      setDeliveryMapsUrl(e.target.value)
                    }}
                    placeholder="https://www.google.com/maps/@..."
                    disabled={modalReadOnly}
                  />
                </div>
                <div className="mt-3">
                  <MapSelector
                    city={deliveryCity}
                    zone={deliveryZone}
                    address={deliveryAddress}
                    mapsUrl={deliveryMapsUrl}
                    onLocationSelect={(mapsUrl, geocodedAddress) => {
                      deliveryTouchedRef.current = true
                      setDeliveryMapsUrl(mapsUrl)
                      if (geocodedAddress) setDeliveryAddress(geocodedAddress)
                    }}
                  />
                </div>
              </>
            )}
          </div>

            <Input
              label="Valor de propuesta (opcional)"
              value={proposalValue}
              onChange={(e) => setProposalValue(e.target.value)}
              placeholder="opcional"
              disabled={modalReadOnly}
            />

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
              <div className="border border-slate-300 dark:border-slate-600 rounded overflow-x-auto">
                <div className="min-w-[600px]">
                  <Table
                  columns={[
                    { header: 'Producto', accessor: (r: any) => r.name },
                    {
                      header: 'Cantidad',
                      accessor: (r: any) => (
                        <Input
                          type="number"
                          value={String(r.quantity)}
                          onChange={(e) => {
                            const next = Number(e.target.value)
                            if (!Number.isFinite(next) || next <= 0) {
                              cart.removeItem(r.productId)
                            } else {
                              cart.updateQuantity(r.productId, next)
                            }
                          }}
                          min={0}
                          className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
                          disabled={modalReadOnly}
                        />
                      ),
                      className: 'w-12'
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
                          className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
                          disabled={modalReadOnly}
                        />
                      ),
                      className: 'w-16'
                    },
                    {
                      header: `P. Unit (${currency})`,
                      accessor: (r: any) => (
                        <Input
                          type="number"
                          value={String(r.unitPrice)}
                          onChange={(e) => cart.updatePrice(r.productId, Number(e.target.value))}
                          min={0}
                          className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
                          disabled={modalReadOnly}
                        />
                      ),
                      className: 'w-32'
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
                {([effectiveDelivery.address, effectiveDelivery.zone, effectiveDelivery.city]
                  .map((p) => (p ?? '').trim())
                  .filter(Boolean).length > 0) && (
                  <div>
                    <strong>Lugar de entrega:</strong>{' '}
                    {[effectiveDelivery.address, effectiveDelivery.zone, effectiveDelivery.city]
                      .map((p) => (p ?? '').trim())
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                )}
                {!!effectiveDelivery.mapsUrl?.trim() && (
                  <div>
                    <strong>Mapa:</strong>{' '}
                    <a
                      href={effectiveDelivery.mapsUrl.trim()}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--pf-primary)] underline"
                    >
                      Ver ubicación
                    </a>
                  </div>
                )}
                {proposalValue.trim() && (<div><strong>Valor de propuesta:</strong> {proposalValue}</div>)}
              </div>
            </div>
          </div>

            <div className="sticky bottom-0 z-[1] bg-white/95 dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 pt-3 pb-2">
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    setQuoteActionError('')
                    setShowSaveSuccess(false)
                    saveQuoteMutation.mutate()
                  }}
                  loading={saveQuoteMutation.isPending}
                  disabled={modalReadOnly}
                >
                  {isEditing ? '💾 Guardar cambios y exportar a PDF' : '💾 Guardar y exportar a PDF'}
                </Button>
                <Button variant="secondary" onClick={() => setQuoteOpen(false)} disabled={showSaveSuccess}>
                  Cerrar
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </MainLayout>
  )
}
