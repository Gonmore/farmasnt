import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch, getApiBaseUrl } from '../../lib/api'
import { getProductDisplayName } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Input, Select, Loading, ErrorState, ImageUpload, Table } from '../../components'
import { useNavigation } from '../../hooks'
import { PlusIcon, CheckIcon, ArrowLeftIcon, TrashIcon, PowerIcon } from '@heroicons/react/24/outline'

type Product = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  description: string | null
  presentationWrapper?: string | null
  presentationQuantity?: string | null
  presentationFormat?: string | null
  photoUrl?: string | null
  cost?: string | null
  price?: string | null
  isActive: boolean
  version: number
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
  version: number
  updatedAt: string
  isActive?: boolean
}

type PresentationDraft = {
  localId: string
  name: string
  unitsPerPresentation: string
  isDefault: boolean
  priceOverride: string
  discountPct: string
}

type Batch = {
  id: string
  batchNumber: string
  expiresAt: string | null
  manufacturingDate: string | null
  status: string
  createdAt: string
}

type ProductBatchListItem = {
  id: string
  batchNumber: string
  manufacturingDate: string | null
  expiresAt: string | null
  status: string
  version: number
  createdAt: string
  updatedAt: string
  totalQuantity: string | null
  totalReservedQuantity?: string | null
  totalAvailableQuantity?: string | null
  locations: {
    warehouseId: string
    warehouseCode: string
    warehouseName: string
    locationId: string
    locationCode: string
    quantity: string
    reservedQuantity?: string
    availableQuantity?: string
  }[]
}

type ProductBatchesResponse = { items: ProductBatchListItem[]; hasStockRead: boolean }

type BatchMovementItem = {
  id: string
  number: string
  numberYear: number
  createdAt: string
  type: string
  quantity: string
  presentationId?: string | null
  presentationQuantity?: string | null
  presentation?: { id: string; name: string; unitsPerPresentation: string } | null
  referenceType: string | null
  referenceId: string | null
  note: string | null
  from: { id: string; code: string; warehouse: { id: string; code: string; name: string } } | null
  to: { id: string; code: string; warehouse: { id: string; code: string; name: string } } | null
}

type BatchMovementsResponse = { batch: { id: string; batchNumber: string }; items: BatchMovementItem[] }

type WarehouseListItem = {
  id: string
  code: string
  name: string
  isActive: boolean
}

type PresignResponse = {
  uploadUrl: string
  publicUrl: string
  key: string
  expiresInSeconds: number
  method: string
}

type RecipeItem = {
  id: string
  ingredientProductId: string | null
  ingredientName: string | null
  quantity: string
  unit: string
  sortOrder: number
  note: string | null
}

type Recipe = {
  id: string
  productId: string
  name: string
  outputQuantity: string | null
  outputUnit: string | null
  version: number
  updatedAt: string
  items: RecipeItem[]
}

type RecipeItemDraft = {
  localId: string
  ingredientName: string
  quantity: string
  unit: string
  note: string
}

function dateOnlyToUtcIso(dateOnly: string): string {
  // dateOnly: YYYY-MM-DD
  const [y, m, d] = dateOnly.split('-').map((v) => Number(v))
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)).toISOString()
}

async function fetchProduct(token: string, id: string): Promise<Product> {
  return apiFetch(`/api/v1/products/${id}`, { token })
}

async function createProduct(
  token: string,
  data: {
    sku: string
    name: string
    genericName?: string
    description?: string
    presentationFormat?: string
    cost?: number
    price?: number
    presentations?: { name: string; unitsPerPresentation: number; isDefault?: boolean; sortOrder?: number; priceOverride?: number | null }[]
  },
): Promise<Product> {
  return apiFetch(`/api/v1/products`, {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

async function updateProduct(
  token: string,
  id: string,
  data: {
    version: number
    name?: string
    genericName?: string | null
    description?: string | null
    presentationWrapper?: string | null
    presentationQuantity?: number | null
    presentationFormat?: string | null
    isActive?: boolean
    photoUrl?: string | null
    photoKey?: string | null
  },
): Promise<Product> {
  return apiFetch(`/api/v1/products/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  })
}

async function fetchProductPresentations(token: string, productId: string): Promise<{ items: ProductPresentation[] }> {
  return apiFetch(`/api/v1/products/${productId}/presentations`, { token })
}

async function createProductPresentation(
  token: string,
  productId: string,
  data: { name: string; unitsPerPresentation: number; isDefault?: boolean; sortOrder?: number; priceOverride?: number | null },
): Promise<ProductPresentation> {
  return apiFetch(`/api/v1/products/${productId}/presentations`, {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

async function updateProductPresentation(
  token: string,
  presentationId: string,
  data: {
    version: number
    name?: string
    unitsPerPresentation?: number
    isDefault?: boolean
    sortOrder?: number
    isActive?: boolean
    priceOverride?: number | null
  },
): Promise<ProductPresentation> {
  return apiFetch(`/api/v1/products/presentations/${presentationId}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  })
}

async function deactivateProductPresentation(token: string, presentationId: string): Promise<void> {
  const url = `/api/v1/products/presentations/${presentationId}`
  const resp = await fetch(`${getApiBaseUrl()}${url}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (resp.status === 404) return
  if (!resp.ok) {
    const contentType = resp.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const data = (await resp.json().catch(() => null)) as any
      if (data && typeof data.message === 'string') throw new Error(data.message)
    }
    const text = await resp.text().catch(() => '')
    throw new Error(text || `Request failed: ${resp.status}`)
  }
}

async function createBatch(
  token: string,
  productId: string,
  data: {
    batchNumber?: string
    expiresAt?: string
    manufacturingDate?: string
    status: string
    initialStock?: {
      warehouseId: string
      quantity?: number
      presentationId?: string
      presentationQuantity?: number
      note?: string
    }
  },
): Promise<Batch> {
  return apiFetch(`/api/v1/products/${productId}/batches`, {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

async function presignProductPhotoUpload(token: string, productId: string, file: File): Promise<PresignResponse> {
  return apiFetch(`/api/v1/products/${productId}/photo-upload`, {
    method: 'POST',
    token,
    body: JSON.stringify({ fileName: file.name, contentType: file.type || 'application/octet-stream' }),
  })
}

async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  let resp: Response
  try {
    resp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
  } catch (err) {
    let origin = ''
    try {
      origin = new URL(uploadUrl).origin
    } catch {
      origin = ''
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Error de red subiendo la imagen${origin ? ` a ${origin}` : ''}. ` +
        `Verifica que el storage (MinIO/S3) esté levantado y permita CORS. Detalle: ${msg}`,
    )
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(text || `Upload failed: ${resp.status}`)
  }
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch(`/api/v1/warehouses?take=50`, { token })
}

async function listProductBatches(token: string, productId: string): Promise<ProductBatchesResponse> {
  return apiFetch(`/api/v1/products/${productId}/batches?take=50`, { token })
}

async function listBatchMovements(token: string, productId: string, batchId: string): Promise<BatchMovementsResponse> {
  return apiFetch(`/api/v1/products/${productId}/batches/${batchId}/movements`, { token })
}

async function fetchRecipe(token: string, productId: string): Promise<Recipe | null> {
  const url = `/api/v1/products/${productId}/recipe`
  const resp = await fetch(`${getApiBaseUrl()}${url}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (resp.status === 404) return null
  if (!resp.ok) {
    const contentType = resp.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const data = (await resp.json().catch(() => null)) as any
      if (data && typeof data.message === 'string') throw new Error(data.message)
    }
    const text = await resp.text().catch(() => '')
    throw new Error(text || `Request failed: ${resp.status}`)
  }

  return (await resp.json()) as Recipe
}

async function upsertRecipe(
  token: string,
  productId: string,
  data: {
    version?: number
    name: string
    outputQuantity?: number | null
    outputUnit?: string | null
    items?: { ingredientName: string; quantity: number; unit: string; sortOrder?: number; note?: string | null }[]
  },
): Promise<Recipe> {
  return apiFetch(`/api/v1/products/${productId}/recipe`, {
    method: 'PUT',
    token,
    body: JSON.stringify(data),
  })
}

async function deleteRecipe(token: string, productId: string): Promise<void> {
  const url = `/api/v1/products/${productId}/recipe`
  const resp = await fetch(`${getApiBaseUrl()}${url}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (resp.status === 404) return
  if (!resp.ok) {
    const contentType = resp.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const data = (await resp.json().catch(() => null)) as any
      if (data && typeof data.message === 'string') throw new Error(data.message)
    }
    const text = await resp.text().catch(() => '')
    throw new Error(text || `Request failed: ${resp.status}`)
  }
}

export function ProductDetailPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const params = useParams<{ id: string }>()
  const { id } = params
  const queryClient = useQueryClient()
  const isNew = id === 'new'

  // Form state
  const [sku, setSku] = useState('')
  const [skuAuto, setSkuAuto] = useState(true)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')
  const [presentationFormat, setPresentationFormat] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Generate SKU automatically when name or presentation changes
  useEffect(() => {
    if (isNew && skuAuto && name.trim()) {
      const generatedSku = generateSku(name)
      setSku(generatedSku)
    }
  }, [name, isNew, skuAuto])

  function generateSku(productName: string): string {
    // Clean name: remove special chars, take first 4 letters, uppercase
    const cleanName = productName
      .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars
      .split(' ')
      .filter(word => word.length > 0)
      .slice(0, 2) // Take first 2 words
      .map(word => word.substring(0, 4).toUpperCase()) // First 4 chars uppercase
      .join('-')

    return cleanName || 'PROD'
  }

  // Batch form state
  const [expiresAt, setExpiresAt] = useState('')
  const [manufacturingDate, setManufacturingDate] = useState('')
  const [batchStatus, setBatchStatus] = useState('RELEASED')
  const [quarantineDays, setQuarantineDays] = useState<string>('')
  const [showBatchForm, setShowBatchForm] = useState(false)
  const [batchFormError, setBatchFormError] = useState<string>('')

  const [selectedBatchId, setSelectedBatchId] = useState<string>('')

  // Reempaque (calculadora por lote)
  const [repackLocationId, setRepackLocationId] = useState<string>('')
  const [repackSourcePresentationId, setRepackSourcePresentationId] = useState<string>('')
  const [repackSourceQty, setRepackSourceQty] = useState<string>('')
  const [repackTargetPresentationId, setRepackTargetPresentationId] = useState<string>('')
  const [repackTargetQty, setRepackTargetQty] = useState<string>('')
  const [repackApplyError, setRepackApplyError] = useState<string>('')

  // Product naming
  const [genericName, setGenericName] = useState('')

  // Product photo state
  // - Existing products: ImageUpload uploads via presign
  // - New product: ImageUpload stores a pending file; uploaded right after create
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null)

  // Initial stock on batch creation (optional)
  const [warehouseIdForInitialStock, setWarehouseIdForInitialStock] = useState<string>('')
  const [initialStockQty, setInitialStockQty] = useState<string>('')
  const [initialStockPresentationId, setInitialStockPresentationId] = useState<string>('')
  const [initialStockNote, setInitialStockNote] = useState<string>('')

  // Recipe state (existing products only)
  const [showRecipeForm, setShowRecipeForm] = useState(false)
  const [recipeVersion, setRecipeVersion] = useState<number | null>(null)
  const [recipeName, setRecipeName] = useState('')
  const [recipeOutputQuantity, setRecipeOutputQuantity] = useState('')
  const [recipeOutputUnit, setRecipeOutputUnit] = useState('')
  const [recipeItems, setRecipeItems] = useState<RecipeItemDraft[]>([])

  // Presentations state (existing products only)
  const [newPresentationName, setNewPresentationName] = useState('')
  const [newPresentationUnits, setNewPresentationUnits] = useState('')
  const [newPresentationDiscountPct, setNewPresentationDiscountPct] = useState('')
  const [newPresentationIsDefault, setNewPresentationIsDefault] = useState(false)

  // Presentations draft state (product creation)
  const [draftPresentations, setDraftPresentations] = useState<PresentationDraft[]>(() => {
    if (!isNew) return []
    const localId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())
    return [
      {
        localId,
        name: '',
        unitsPerPresentation: '',
        isDefault: true,
        priceOverride: '',
        discountPct: '',
      },
    ]
  })

  const baseUnitPrice = (() => {
    const p = Number(String(price ?? '').trim())
    return Number.isFinite(p) && p >= 0 ? p : null
  })()

  const productFormatOptions = [
    { value: '', label: 'Elegir formato' },
    { value: 'capsula', label: 'Cápsula' },
    { value: 'comprimido', label: 'Comprimido' },
    { value: 'vial', label: 'Vial' },
    { value: 'tableta', label: 'Tableta' },
    { value: 'otro', label: 'Otro' },
  ]

  const presentationFormatOptions = [
    { value: 'Caja', label: 'Caja' },
    { value: 'Frasco', label: 'Frasco' },
    { value: 'Blister', label: 'Blister' },
    { value: 'Otro', label: 'Otro' },
  ]

  const knownPresentationFormats = new Set(['Caja', 'Frasco', 'Blister'])

  const toNumberOrNull = (value: string): number | null => {
    const v = String(value ?? '').trim().replace(',', '.')
    if (!v) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const computePresentationPrice = (args: { unitsPerPresentation: number | null; discountPct: number | null }): number | null => {
    if (baseUnitPrice === null) return null
    if (args.unitsPerPresentation === null || args.unitsPerPresentation <= 0) return null
    const base = baseUnitPrice * args.unitsPerPresentation
    const disc = args.discountPct !== null && args.discountPct > 0 ? args.discountPct : 0
    const final = Math.max(0, base * (1 - disc / 100))
    return Number(final.toFixed(2))
  }

  const upsertDraftPresentation = (localId: string, patch: Partial<PresentationDraft>) => {
    setDraftPresentations((prev) => prev.map((p) => (p.localId === localId ? { ...p, ...patch } : p)))
  }

  const removeDraftPresentation = (localId: string) => {
    setDraftPresentations((prev) => prev.filter((p) => p.localId !== localId))
  }

  const addDraftPresentation = () => {
    const localId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())
    setDraftPresentations((prev) => [
      ...prev,
      { localId, name: '', unitsPerPresentation: '', isDefault: false, priceOverride: '', discountPct: '' },
    ])
  }

  const setDraftDefault = (localId: string) => {
    setDraftPresentations((prev) => prev.map((p) => ({ ...p, isDefault: p.localId === localId })))
  }

  const productQuery = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProduct(auth.accessToken!, id!),
    enabled: !!auth.accessToken && !isNew && !!id,
  })

  const recipeQuery = useQuery({
    queryKey: ['productRecipe', id],
    queryFn: () => fetchRecipe(auth.accessToken!, id!),
    enabled: !!auth.accessToken && !isNew && !!id,
  })

  const presentationsQuery = useQuery({
    queryKey: ['productPresentations', id],
    queryFn: () => fetchProductPresentations(auth.accessToken!, id!),
    enabled: !!auth.accessToken && !isNew && !!id,
  })

  const activePresentations = (presentationsQuery.data?.items ?? []).filter((p) => p.isActive !== false)
  const unitPresentation = activePresentations.find((p) => p.name.trim().toLowerCase() === 'unidad')
  const repackTargetOptions = activePresentations.filter((p) => p.name.trim().toLowerCase() !== 'unidad')

  const getBatchAvailableUnits = (b: ProductBatchListItem): number | null => {
    if (b.totalAvailableQuantity !== null && b.totalAvailableQuantity !== undefined) {
      const n = Number(b.totalAvailableQuantity)
      return Number.isFinite(n) ? n : null
    }
    const total = Number(b.totalQuantity ?? '0')
    const reserved = Number(b.totalReservedQuantity ?? '0')
    const available = total - reserved
    return Number.isFinite(available) ? Math.max(0, available) : null
  }

  // Check SKU uniqueness for new products
  const skuCheckQuery = useQuery({
    queryKey: ['product-sku-check', sku, params.id],
    queryFn: async () => {
      if (!sku || sku.trim() === '') return { exists: false }
      const response = await apiFetch(`/api/v1/catalog/products/check-sku?sku=${encodeURIComponent(sku)}${params.id !== 'new' ? `&excludeId=${params.id}` : ''}`, { token: auth.accessToken })
      return response as { exists: boolean }
    },
    enabled: sku.length > 0 && isNew,
    staleTime: 0
  })

  const skuExists = skuCheckQuery.data?.exists || false

  // Initialize form when data loads
  useEffect(() => {
    if (productQuery.data) {
      setSku(productQuery.data.sku)
      setSkuAuto(false)
      setName(productQuery.data.name)
      setGenericName(productQuery.data.genericName ?? '')
      setDescription(productQuery.data.description || '')
      setCost(productQuery.data.cost || '')
      setPrice(productQuery.data.price || '')
      setPresentationFormat(productQuery.data.presentationFormat ?? '')
      setIsActive(productQuery.data.isActive)
    }
  }, [productQuery.data])

  useEffect(() => {
    if (!recipeQuery.data) {
      setRecipeVersion(null)
      setRecipeName('')
      setRecipeOutputQuantity('')
      setRecipeOutputUnit('')
      setRecipeItems([])
      return
    }

    setRecipeVersion(recipeQuery.data.version)
    setRecipeName(recipeQuery.data.name)
    setRecipeOutputQuantity(recipeQuery.data.outputQuantity ? String(recipeQuery.data.outputQuantity) : '')
    setRecipeOutputUnit(recipeQuery.data.outputUnit ?? '')
    setRecipeItems(
      (recipeQuery.data.items ?? []).map((it) => ({
        localId: it.id,
        ingredientName: it.ingredientName ?? '',
        quantity: String(it.quantity ?? ''),
        unit: it.unit ?? '',
        note: it.note ?? '',
      })),
    )
  }, [recipeQuery.data])

  const createMutation = useMutation({
    mutationFn: (data: {
      sku: string
      name: string
      genericName?: string
      description?: string
      presentationFormat?: string
      cost?: number
      price?: number
      presentations?: { name: string; unitsPerPresentation: number; isDefault?: boolean; sortOrder?: number; priceOverride?: number | null }[]
    }) => createProduct(auth.accessToken!, data),
  })

  const updateMutation = useMutation({
    mutationFn: (data: {
      version: number
      name?: string
      genericName?: string | null
      description?: string | null
      presentationWrapper?: string | null
      presentationQuantity?: number | null
      presentationFormat?: string | null
      cost?: number | null
      price?: number | null
      isActive?: boolean
    }) =>
      updateProduct(auth.accessToken!, id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const createPresentationMutation = useMutation({
    mutationFn: (data: { name: string; unitsPerPresentation: number; isDefault?: boolean; sortOrder?: number; priceOverride?: number | null }) =>
      createProductPresentation(auth.accessToken!, id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productPresentations', id] })
      setNewPresentationName('')
      setNewPresentationUnits('')
      setNewPresentationIsDefault(false)
      setNewPresentationDiscountPct('')
    },
  })

  const updatePresentationMutation = useMutation({
    mutationFn: (args: {
      presentationId: string
      data: { version: number; name?: string; unitsPerPresentation?: number; isDefault?: boolean; sortOrder?: number; isActive?: boolean; priceOverride?: number | null }
    }) =>
      updateProductPresentation(auth.accessToken!, args.presentationId, args.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productPresentations', id] })
    },
  })

  const deactivatePresentationMutation = useMutation({
    mutationFn: (presentationId: string) => deactivateProductPresentation(auth.accessToken!, presentationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productPresentations', id] })
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async (nextIsActive: boolean) => {
      if (!id) throw new Error('Missing product id')
      if (!productQuery.data) throw new Error('Product not loaded')
      return updateProduct(auth.accessToken!, id, {
        version: productQuery.data.version,
        isActive: nextIsActive,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const batchMutation = useMutation({
    mutationFn: (data: {
      expiresAt?: string
      manufacturingDate?: string
      status: string
      initialStock?: {
        warehouseId: string
        quantity?: number
        presentationId?: string
        presentationQuantity?: number
        note?: string
      }
    }) =>
      createBatch(auth.accessToken!, id!, data),
    onSuccess: () => {
      setExpiresAt('')
      setManufacturingDate('')
      setBatchStatus('RELEASED')
      setQuarantineDays('')
      setShowBatchForm(false)
      setBatchFormError('')
      setWarehouseIdForInitialStock('')
      setInitialStockQty('')
      setInitialStockPresentationId('')
      setInitialStockNote('')
      queryClient.invalidateQueries({ queryKey: ['productBatches', id] })
      alert('Lote creado exitosamente')
    },
  })

  const productBatchesQuery = useQuery({
    queryKey: ['productBatches', id],
    queryFn: () => listProductBatches(auth.accessToken!, id!),
    enabled: !!auth.accessToken && !isNew && !!id,
  })

  const batchMovementsQuery = useQuery({
    queryKey: ['batchMovements', id, selectedBatchId],
    queryFn: () => listBatchMovements(auth.accessToken!, id!, selectedBatchId),
    enabled: !!auth.accessToken && !isNew && !!id && !!selectedBatchId,
  })

  const repackMutation = useMutation({
    mutationFn: async (args: {
      productId: string
      batchId: string
      locationId: string
      sourcePresentationId: string
      sourceQuantity: number
      targetPresentationId: string
      targetQuantity: number
      note?: string
    }) => {
      return apiFetch(`/api/v1/stock/repack`, {
        token: auth.accessToken,
        method: 'POST',
        body: JSON.stringify(args),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBatches', id] })
      queryClient.invalidateQueries({ queryKey: ['batchMovements', id, selectedBatchId] })
      setRepackApplyError('')
    },
  })

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'forInitialStock'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken && !!showBatchForm && !isNew,
  })

  // If there is only one active warehouse, auto-select it.
  useEffect(() => {
    if (!showBatchForm) return
    if (warehouseIdForInitialStock) return

    const activeWarehouses = (warehousesQuery.data?.items ?? []).filter((w) => w.isActive)
    if (activeWarehouses.length === 1) {
      setWarehouseIdForInitialStock(activeWarehouses[0]!.id)
    }
  }, [showBatchForm, warehouseIdForInitialStock, warehousesQuery.data])

  // Default repack selector values when a batch is opened.
  useEffect(() => {
    if (!selectedBatchId) return
    if (!presentationsQuery.data) return

    const selectedBatch = (productBatchesQuery.data?.items ?? []).find((x) => x.id === selectedBatchId)
    if (selectedBatch && !repackLocationId) {
      const pickAvailable = (l: any) => {
        const avail = l.availableQuantity ?? String(Math.max(0, Number(l.quantity || '0') - Number(l.reservedQuantity ?? '0')))
        const n = Number(avail)
        return Number.isFinite(n) ? n : 0
      }
      const loc = selectedBatch.locations.find((l) => pickAvailable(l) > 0) ?? selectedBatch.locations[0]
      if (loc) setRepackLocationId(loc.locationId)
    }

    if (!repackSourcePresentationId) {
      if (unitPresentation) setRepackSourcePresentationId(unitPresentation.id)
      else if (activePresentations[0]) setRepackSourcePresentationId(activePresentations[0]!.id)
    }
    if (!repackTargetPresentationId) {
      if (repackTargetOptions[0]) setRepackTargetPresentationId(repackTargetOptions[0]!.id)
    }
  }, [
    selectedBatchId,
    presentationsQuery.data,
    productBatchesQuery.data,
    repackLocationId,
    repackSourcePresentationId,
    repackTargetPresentationId,
    unitPresentation,
    activePresentations,
    repackTargetOptions,
  ])

  // When opening the batch form, default the initial stock presentation to the product default.
  useEffect(() => {
    if (!showBatchForm) return
    if (initialStockPresentationId) return

    const items = presentationsQuery.data?.items ?? []
    const active = items.filter((p) => p.isActive !== false)
    const def = active.find((p) => p.isDefault) ?? active[0]
    if (def) setInitialStockPresentationId(def.id)
  }, [showBatchForm, initialStockPresentationId, presentationsQuery.data])

  // No destination location selection for lot creation; resolved by backend from the warehouse.

  const uploadPhotoMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!id) throw new Error('Missing product id')
      if (!productQuery.data) throw new Error('Product not loaded')

      const presign = await presignProductPhotoUpload(auth.accessToken!, id, file)
      await uploadToPresignedUrl(presign.uploadUrl, file)
      await updateProduct(auth.accessToken!, id, {
        version: productQuery.data.version,
        photoUrl: presign.publicUrl,
        photoKey: presign.key,
      })
      return presign
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const removePhotoMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Missing product id')
      if (!productQuery.data) throw new Error('Product not loaded')
      await updateProduct(auth.accessToken!, id, {
        version: productQuery.data.version,
        photoUrl: null,
        photoKey: null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const saveRecipeMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Missing product id')
      if (!productQuery.data) throw new Error('Product not loaded')

      const nameVal = recipeName.trim() || `Receta de ${productQuery.data.name}`
      const outputQtyStr = recipeOutputQuantity.trim()
      let outputQty: number | null = null
      if (outputQtyStr) {
        const n = Number(outputQtyStr)
        if (!Number.isFinite(n) || n <= 0) throw new Error('Cantidad de salida inválida')
        outputQty = n
      }
      const outputUnit = recipeOutputUnit.trim() ? recipeOutputUnit.trim() : null

      const items = recipeItems
        .map((it, idx) => ({
          ingredientName: it.ingredientName.trim(),
          quantity: Number(it.quantity),
          unit: it.unit.trim(),
          sortOrder: idx,
          note: it.note.trim() ? it.note.trim() : null,
        }))
        .filter((it) => it.ingredientName && Number.isFinite(it.quantity) && it.quantity > 0 && it.unit)

      const payload: any = {
        name: nameVal,
        outputQuantity: outputQty,
        outputUnit,
        items,
      }
      if (recipeVersion) payload.version = recipeVersion

      return upsertRecipe(auth.accessToken!, id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productRecipe', id] })
      setShowRecipeForm(false)
      alert('Recetario guardado')
    },
  })

  const deleteRecipeMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Missing product id')
      await deleteRecipe(auth.accessToken!, id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productRecipe', id] })
      setShowRecipeForm(false)
      alert('Recetario eliminado')
    },
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    
    if (isNew) {
      const payload: any = { sku, name, description: description || undefined }
      if (genericName.trim()) payload.genericName = genericName.trim()
      if (presentationFormat.trim()) payload.presentationFormat = presentationFormat.trim()
      if (cost) payload.cost = parseFloat(cost)
      if (price) payload.price = parseFloat(price)

      // Build presentations[]
      const presPayload = draftPresentations
        .map((p, idx) => {
          const nm = p.name.trim()
          const units = Number(String(p.unitsPerPresentation ?? '').trim())
          if (!nm) return null
          if (!Number.isFinite(units) || units <= 0) return null

          const discNum = toNumberOrNull(p.discountPct)
          const computed = computePresentationPrice({
            unitsPerPresentation: Math.trunc(units),
            discountPct: discNum,
          })
          const shouldSendOverride = discNum !== null && discNum > 0

          return {
            name: nm,
            unitsPerPresentation: Math.trunc(units),
            isDefault: !!p.isDefault,
            sortOrder: idx,
            priceOverride: shouldSendOverride ? computed : null,
          }
        })
        .filter(Boolean)

      if ((presPayload as any[]).length > 0) {
        payload.presentations = presPayload
      }

      try {
        const created = await createMutation.mutateAsync(payload)

        if (pendingPhotoFile) {
          try {
            const presign = await presignProductPhotoUpload(auth.accessToken!, created.id, pendingPhotoFile)
            await uploadToPresignedUrl(presign.uploadUrl, pendingPhotoFile)
            await updateProduct(auth.accessToken!, created.id, {
              version: created.version,
              photoUrl: presign.publicUrl,
              photoKey: presign.key,
            })
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error subiendo la foto'
            alert(`Producto creado, pero la foto no se pudo subir: ${msg}`)
          }
        }

        setPendingPhotoFile(null)
        queryClient.invalidateQueries({ queryKey: ['products'] })
        navigate(`/catalog/products/${created.id}`)
      } catch {
        // errors are shown by createMutation.error
      }
    } else if (productQuery.data) {
      const payload: any = {
        version: productQuery.data.version,
        name,
        genericName: genericName.trim() ? genericName.trim() : null,
        description: description || null,
        presentationFormat: presentationFormat.trim() ? presentationFormat.trim() : null,
        isActive,
      }
      if (cost) payload.cost = parseFloat(cost)
      if (price) payload.price = parseFloat(price)
      updateMutation.mutate(payload)
    }
  }

  const handleBatchSubmit = (e: FormEvent) => {
    e.preventDefault()
    setBatchFormError('')

    const payload: any = { status: batchStatus }

    if (expiresAt) payload.expiresAt = dateOnlyToUtcIso(expiresAt)
    if (manufacturingDate) payload.manufacturingDate = dateOnlyToUtcIso(manufacturingDate)

    if (!warehouseIdForInitialStock) {
      setBatchFormError('Seleccioná la sucursal/almacén para el ingreso inicial.')
      return
    }

    const presQty = Number(initialStockQty)
    if (!Number.isFinite(presQty) || presQty <= 0) {
      setBatchFormError('Ingresá una cantidad inicial válida (mayor a 0).')
      return
    }

    if (!initialStockPresentationId) {
      setBatchFormError('Seleccioná una presentación para el ingreso inicial.')
      return
    }

    payload.initialStock = {
      warehouseId: warehouseIdForInitialStock,
      presentationId: initialStockPresentationId,
      presentationQuantity: presQty,
      ...(initialStockNote.trim() ? { note: initialStockNote.trim() } : {}),
    }

    batchMutation.mutate({
      ...payload,
    })
  }

  const addRecipeItem = () => {
    const localId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())
    setRecipeItems((prev) => [...prev, { localId, ingredientName: '', quantity: '', unit: '', note: '' }])
  }

  const updateRecipeItem = (localId: string, patch: Partial<RecipeItemDraft>) => {
    setRecipeItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)))
  }

  const removeRecipeItem = (localId: string) => {
    setRecipeItems((prev) => prev.filter((it) => it.localId !== localId))
  }

  if (!isNew && productQuery.isLoading) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="Cargando...">
          <Loading />
        </PageContainer>
      </MainLayout>
    )
  }

  if (!isNew && productQuery.error) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="Error">
          <ErrorState
            message={productQuery.error instanceof Error ? productQuery.error.message : 'Error al cargar producto'}
            retry={productQuery.refetch}
          />
        </PageContainer>
      </MainLayout>
    )
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title={isNew ? 'Crear Producto' : `Producto: ${getProductDisplayName({ sku, name, genericName })}`}
        actions={
          <Button variant="outline" icon={<ArrowLeftIcon />} onClick={() => navigate('/catalog/products')}>
            Volver
          </Button>
        }
      >
        <div className="grid gap-6 md:grid-cols-2">
          {/* Product Form */}
          <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-800/50 p-6 dark:border-slate-700">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {isNew ? 'Datos del Producto' : 'Editar Producto'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="group">
                <Input
                  label="Nombre comercial"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Abasor 150 mg"
                  required
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="group">
                <Input
                  label="Nombre genérico"
                  value={genericName}
                  onChange={(e) => setGenericName(e.target.value)}
                  placeholder="Ej: Pregabalina 150 mg"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div className="group">
                <Input
                  label="SKU"
                  value={sku}
                  onChange={(e) => {
                    setSku(e.target.value)
                    setSkuAuto(false)
                  }}
                  placeholder="Se genera automáticamente"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className={`transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${skuExists ? 'border-red-500 focus:ring-red-500' : ''}`}
                  required
                />
                {skuExists && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    ⚠️ Este SKU ya existe. Por favor usa uno diferente.
                  </p>
                )}
              </div>
              
              <div className="group">
                <Input
                  label="Descripción"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div className="grid gap-4 md:grid-cols-3 items-start">
                <div className="group">
                  <Input
                    label="Costo (opcional)"
                    type="number"
                    step="0.01"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    placeholder="0.00"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="group">
                  <Input
                    label="Precio unitario"
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="group">
                  <Select
                    label="Formato"
                    value={presentationFormat}
                    onChange={(e) => setPresentationFormat(e.target.value)}
                    options={productFormatOptions}
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              
              {!isNew && (
                <div className="group">
                  <Select
                    label="Estado"
                    value={isActive ? 'true' : 'false'}
                    onChange={(e) => setIsActive(e.target.value === 'true')}
                    options={[
                      { value: 'true', label: 'Activo' },
                      { value: 'false', label: 'Inactivo' },
                    ]}
                    disabled={updateMutation.isPending}
                    className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              )}

              <div>
                <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">📸 Foto del Producto</div>
                <ImageUpload
                  mode="select"
                  currentImageUrl={isNew ? null : productQuery.data?.photoUrl}
                  onImageSelect={(file) => {
                    if (isNew) setPendingPhotoFile(file)
                    else uploadPhotoMutation.mutate(file)
                  }}
                  onImageRemove={() => {
                    if (isNew) setPendingPhotoFile(null)
                    else removePhotoMutation.mutate()
                  }}
                  loading={
                    (isNew ? createMutation.isPending : uploadPhotoMutation.isPending || removePhotoMutation.isPending)
                  }
                  disabled={isNew ? createMutation.isPending : updateMutation.isPending}
                />
                {isNew && pendingPhotoFile && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    Imagen lista: {pendingPhotoFile.name}
                  </p>
                )}
                {!isNew && (uploadPhotoMutation.error || removePhotoMutation.error) && (
                  <p className="mt-2 text-sm text-red-600">
                    {uploadPhotoMutation.error instanceof Error
                      ? uploadPhotoMutation.error.message
                      : removePhotoMutation.error instanceof Error
                        ? removePhotoMutation.error.message
                        : 'Error'}
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  icon={isNew ? <PlusIcon /> : <CheckIcon />}
                  loading={createMutation.isPending || updateMutation.isPending}
                  disabled={createMutation.isPending || updateMutation.isPending || skuExists}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 py-3 text-lg font-semibold shadow-lg hover:from-blue-600 hover:to-purple-700 hover:shadow-xl"
                >
                  {isNew ? 'Crear Producto' : 'Guardar Cambios'}
                </Button>

                {!isNew && productQuery.data && (
                  <Button
                    type="button"
                    variant={productQuery.data.isActive ? 'danger' : 'success'}
                    icon={productQuery.data.isActive ? <TrashIcon /> : <PowerIcon />}
                    disabled={updateMutation.isPending}
                    loading={toggleActiveMutation.isPending}
                    className="whitespace-nowrap"
                    onClick={() => {
                      if (!productQuery.data) return
                      if (productQuery.data.isActive) {
                        const ok = confirm(
                          '¿Eliminar producto?\n\nEsto NO lo borra de la base de datos: lo desactivará (soft delete).\nEl producto dejará de aparecer como activo.',
                        )
                        if (!ok) return
                        toggleActiveMutation.mutate(false)
                      } else {
                        const ok = confirm('¿Reactivar producto?')
                        if (!ok) return
                        toggleActiveMutation.mutate(true)
                      }
                    }}
                  >
                    {productQuery.data.isActive ? 'Eliminar' : 'Reactivar'}
                  </Button>
                )}

                {(createMutation.error || updateMutation.error) && (
                  <span className="text-sm text-red-600">
                    {createMutation.error instanceof Error
                      ? createMutation.error.message
                      : updateMutation.error instanceof Error
                        ? updateMutation.error.message
                        : 'Error'}
                  </span>
                )}

                {!isNew && toggleActiveMutation.error && (
                  <span className="text-sm text-red-600">
                    {toggleActiveMutation.error instanceof Error ? toggleActiveMutation.error.message : 'Error'}
                  </span>
                )}
              </div>
            </form>
          </div>

          {/* Right column */}
          {isNew ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Presentaciones y precios</h3>
                  <Button size="sm" variant="primary" icon={<PlusIcon />} onClick={addDraftPresentation}>
                    Agregar presentación
                  </Button>
                </div>

                <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                  Lógica: el <span className="font-medium">precio unitario</span> vive en el producto (Unidad). Cada presentación define
                  cuántas unidades contiene y puede tener un <span className="font-medium">descuento</span>. El precio por presentación se calcula automáticamente.
                </p>

                <div className="space-y-3">
                  {draftPresentations.map((p) => {
                    const units = Number(String(p.unitsPerPresentation ?? '').trim())
                    const factor = Number.isFinite(units) && units > 0 ? units : null
                    const discNum = toNumberOrNull(p.discountPct)
                    const derived = baseUnitPrice !== null && factor !== null ? baseUnitPrice * factor : null
                    const effective = computePresentationPrice({ unitsPerPresentation: factor, discountPct: discNum })

                    const formatValue = knownPresentationFormats.has(p.name.trim()) ? p.name.trim() : 'Otro'

                    return (
                      <div key={p.localId} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                        <div className="grid gap-3 md:grid-cols-5 items-start">
                          <div>
                            <>
                              <Select
                                label="Formato"
                                value={formatValue}
                                onChange={(e) => {
                                  const v = e.target.value
                                  if (v === 'Otro') {
                                    upsertDraftPresentation(p.localId, { name: knownPresentationFormats.has(p.name.trim()) ? '' : p.name })
                                  } else {
                                    upsertDraftPresentation(p.localId, { name: v })
                                  }
                                }}
                                options={presentationFormatOptions}
                                disabled={createMutation.isPending}
                              />
                              {formatValue === 'Otro' && (
                                <Input
                                  label="Otro formato"
                                  value={p.name}
                                  onChange={(e) => upsertDraftPresentation(p.localId, { name: e.target.value })}
                                  placeholder="Ej: Sachet"
                                  disabled={createMutation.isPending}
                                />
                              )}
                            </>
                          </div>
                          <Input
                            label="Unidades"
                            type="number"
                            value={p.unitsPerPresentation}
                            onChange={(e) => upsertDraftPresentation(p.localId, { unitsPerPresentation: e.target.value })}
                            placeholder="Ej: 100"
                            disabled={createMutation.isPending}
                          />
                          <Input
                            label="Descuento %"
                            type="number"
                            value={p.discountPct}
                            onChange={(e) => upsertDraftPresentation(p.localId, { discountPct: e.target.value })}
                            placeholder="Ej: 5"
                            disabled={createMutation.isPending}
                          />
                          <Input
                            label="Precio pres."
                            type="number"
                            step="0.01"
                            value={effective !== null ? String(effective.toFixed(2)) : ''}
                            placeholder={derived !== null ? `Derivado: ${derived.toFixed(2)}` : '—'}
                            disabled
                          />
                          <div>
                            <Select
                              label="Predeterminado"
                              value={p.isDefault ? 'true' : 'false'}
                              onChange={() => setDraftDefault(p.localId)}
                              options={[
                                { value: 'false', label: 'No' },
                                { value: 'true', label: 'Sí' },
                              ]}
                              disabled={createMutation.isPending}
                            />
                            <div className="mt-2 flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={createMutation.isPending || draftPresentations.length <= 1}
                                onClick={() => removeDraftPresentation(p.localId)}
                              >
                                Quitar
                              </Button>
                            </div>
                          </div>
                        </div>

                        {derived !== null && (
                          <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                            Precio sin descuento: {derived.toFixed(2)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {createMutation.error && (
                  <p className="mt-3 text-sm text-red-600">
                    {createMutation.error instanceof Error ? createMutation.error.message : 'Error creando producto'}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Presentaciones</h3>
                </div>

                <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                  Define cómo se vende el producto (p.ej. <span className="font-medium">Caja</span> = 100 unidades).
                  La <span className="font-medium">Unidad</span> es la base (stock y totales).
                </p>

                {presentationsQuery.isLoading && <p className="text-sm text-slate-600 dark:text-slate-400">Cargando…</p>}
                {presentationsQuery.error && (
                  <p className="text-sm text-red-600">
                    {presentationsQuery.error instanceof Error
                      ? presentationsQuery.error.message
                      : 'Error cargando presentaciones'}
                  </p>
                )}

                {presentationsQuery.data && (
                  <div className="space-y-4">
                    <Table
                      columns={[
                        { header: 'Nombre', accessor: (p: ProductPresentation) => p.name },
                        {
                          header: 'Unidades',
                          accessor: (p: ProductPresentation) => p.unitsPerPresentation,
                          className: 'w-28',
                        },
                        {
                          header: 'Precio pres.',
                          accessor: (p: ProductPresentation) => (p.priceOverride ? String(p.priceOverride) : '-'),
                          className: 'w-28',
                        },
                        {
                          header: 'Default',
                          accessor: (p: ProductPresentation) => (p.isDefault ? 'Sí' : 'No'),
                          className: 'w-20',
                        },
                        {
                          header: 'Actualizado',
                          accessor: (p: ProductPresentation) => new Date(p.updatedAt).toLocaleString(),
                          className: 'w-44',
                        },
                        {
                          header: 'Acciones',
                          className: 'text-center w-44',
                          accessor: (p: ProductPresentation) => (
                            <div className="flex items-center justify-center gap-1">
                              {!p.isDefault && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={updatePresentationMutation.isPending}
                                  onClick={() =>
                                    updatePresentationMutation.mutate({
                                      presentationId: p.id,
                                      data: { version: p.version, isDefault: true },
                                    })
                                  }
                                >
                                  Hacer default
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={deactivatePresentationMutation.isPending || p.isDefault}
                                onClick={() => {
                                  if (p.isDefault) return
                                  const ok = confirm(`¿Desactivar presentación "${p.name}"?`)
                                  if (!ok) return
                                  deactivatePresentationMutation.mutate(p.id)
                                }}
                              >
                                Desactivar
                              </Button>
                            </div>
                          ),
                        },
                      ]}
                      data={presentationsQuery.data.items}
                      keyExtractor={(p: ProductPresentation) => p.id}
                    />

                    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <Select
                            label="Formato"
                            value={knownPresentationFormats.has(newPresentationName.trim()) ? newPresentationName.trim() : 'Otro'}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v === 'Otro') {
                                setNewPresentationName(knownPresentationFormats.has(newPresentationName.trim()) ? '' : newPresentationName)
                              } else {
                                setNewPresentationName(v)
                              }
                            }}
                            options={presentationFormatOptions}
                            disabled={createPresentationMutation.isPending}
                          />
                          {!knownPresentationFormats.has(newPresentationName.trim()) && (
                            <Input
                              label="Otro formato"
                              value={newPresentationName}
                              onChange={(e) => setNewPresentationName(e.target.value)}
                              placeholder="Ej: Sachet"
                              disabled={createPresentationMutation.isPending}
                            />
                          )}
                        </div>
                        <Input
                          label="Unidades por presentación"
                          type="number"
                          value={newPresentationUnits}
                          onChange={(e) => setNewPresentationUnits(e.target.value)}
                          placeholder="Ej: 100"
                          disabled={createPresentationMutation.isPending}
                        />
                        <Input
                          label="Descuento % (opcional)"
                          type="number"
                          value={newPresentationDiscountPct}
                          onChange={(e) => setNewPresentationDiscountPct(e.target.value)}
                          placeholder="Ej: 5"
                          disabled={createPresentationMutation.isPending}
                        />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <Input
                          label="Precio pres."
                          type="number"
                          step="0.01"
                          value={(() => {
                            const units = toNumberOrNull(newPresentationUnits)
                            const disc = toNumberOrNull(newPresentationDiscountPct)
                            const val = computePresentationPrice({
                              unitsPerPresentation: units !== null ? Math.trunc(units) : null,
                              discountPct: disc,
                            })
                            return val !== null ? String(val.toFixed(2)) : ''
                          })()}
                          placeholder={(() => {
                            const units = toNumberOrNull(newPresentationUnits)
                            if (baseUnitPrice === null || units === null || units <= 0) return '—'
                            const derived = baseUnitPrice * Math.trunc(units)
                            return `Sin descuento: ${derived.toFixed(2)}`
                          })()}
                          disabled
                        />
                        <Select
                          label="¿Default?"
                          value={newPresentationIsDefault ? 'true' : 'false'}
                          onChange={(e) => setNewPresentationIsDefault(e.target.value === 'true')}
                          options={[
                            { value: 'false', label: 'No' },
                            { value: 'true', label: 'Sí' },
                          ]}
                          disabled={createPresentationMutation.isPending}
                        />
                        <div className="md:col-span-2 text-xs text-slate-500 dark:text-slate-400">
                          El precio por presentación se calcula desde el precio unitario + unidades + descuento.
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          size="sm"
                          loading={createPresentationMutation.isPending}
                          onClick={() => {
                            const name = newPresentationName.trim()
                            const units = Number(newPresentationUnits)
                            if (!name) {
                              alert('Nombre requerido')
                              return
                            }
                            if (!Number.isFinite(units) || units <= 0) {
                              alert('Unidades por presentación debe ser > 0')
                              return
                            }

                            const existingNames = (presentationsQuery.data?.items ?? []).map((p) => p.name.trim().toLowerCase())
                            if (existingNames.includes(name.toLowerCase())) {
                              alert('Ya existe una presentación con ese nombre')
                              return
                            }
                            const discNum = toNumberOrNull(newPresentationDiscountPct)
                            const computed = computePresentationPrice({
                              unitsPerPresentation: Math.trunc(units),
                              discountPct: discNum,
                            })
                            const shouldSendOverride = discNum !== null && discNum > 0
                            if (shouldSendOverride && computed === null) {
                              alert('Para calcular descuento necesitás definir el precio unitario del producto.')
                              return
                            }
                            createPresentationMutation.mutate({
                              name,
                              unitsPerPresentation: Math.trunc(units),
                              isDefault: newPresentationIsDefault,
                              priceOverride: shouldSendOverride ? computed : null,
                            })
                          }}
                        >
                          Agregar
                        </Button>

                        {createPresentationMutation.error && (
                          <span className="text-sm text-red-600">
                            {createPresentationMutation.error instanceof Error
                              ? createPresentationMutation.error.message
                              : 'Error creando presentación'}
                          </span>
                        )}
                      </div>
                    </div>

                    {(updatePresentationMutation.error || deactivatePresentationMutation.error) && (
                      <p className="text-sm text-red-600">
                        {updatePresentationMutation.error instanceof Error
                          ? updatePresentationMutation.error.message
                          : deactivatePresentationMutation.error instanceof Error
                            ? deactivatePresentationMutation.error.message
                            : 'Error'}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Lotes</h3>
                  {!showBatchForm && (
                    <Button size="sm" onClick={() => setShowBatchForm(true)}>
                      Crear Lote
                    </Button>
                  )}
                </div>

              {!showBatchForm && (
                <div className="space-y-3">
                  {productBatchesQuery.isLoading && (
                    <p className="text-sm text-slate-600 dark:text-slate-400">Cargando lotes…</p>
                  )}
                  {productBatchesQuery.error && (
                    <p className="text-sm text-red-600">
                      {productBatchesQuery.error instanceof Error
                        ? productBatchesQuery.error.message
                        : 'Error cargando lotes'}
                    </p>
                  )}

                  {productBatchesQuery.data && productBatchesQuery.data.items.length === 0 && (
                    <p className="text-sm text-slate-600 dark:text-slate-400">Aún no hay lotes para este producto.</p>
                  )}

                  {productBatchesQuery.data && productBatchesQuery.data.items.length > 0 && (
                    <div className="space-y-2">
                      {!productBatchesQuery.data.hasStockRead && (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          No tenés permiso `stock:read`, por eso no se muestran existencias por lote.
                        </p>
                      )}

                      {productBatchesQuery.data.items.map((b) => (
                        <div key={b.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              className="text-left"
                              onClick={() => setSelectedBatchId((prev) => (prev === b.id ? '' : b.id))}
                            >
                              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {b.batchNumber}
                              </div>
                              <div className="text-xs text-slate-600 dark:text-slate-400">
                                Estado: {b.status}
                                {b.expiresAt ? ` · Vence: ${new Date(b.expiresAt).toLocaleDateString()}` : ''}
                              </div>
                            </button>

                            <div className="text-right">
                                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                  {b.totalAvailableQuantity ?? b.totalQuantity ?? '-'}
                                </div>
                                <div className="text-xs text-slate-600 dark:text-slate-400">
                                  disp. · {b.totalReservedQuantity ?? '0'} res. · {b.totalQuantity ?? '-'} total
                                </div>
                            </div>
                          </div>

                          {b.locations.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {b.locations.map((l) => (
                                <div key={l.locationId} className="flex justify-between text-xs text-slate-700 dark:text-slate-300">
                                  <span>
                                    {l.warehouseCode} · {l.locationCode}
                                  </span>
                                  <span className="font-medium">
                                    {l.availableQuantity ?? String(Math.max(0, Number(l.quantity || '0') - Number(l.reservedQuantity ?? '0')))}
                                    <span className="ml-2 text-slate-500 dark:text-slate-400">
                                      ({l.reservedQuantity ?? '0'} res. · {l.quantity} total)
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {selectedBatchId === b.id && (
                            <div className="mt-3 rounded-md bg-slate-50 p-3 dark:bg-slate-800">
                              {batchMovementsQuery.isLoading && (
                                <p className="text-sm text-slate-600 dark:text-slate-400">Cargando movimientos…</p>
                              )}
                              {batchMovementsQuery.error && (
                                <p className="text-sm text-red-600">
                                  {batchMovementsQuery.error instanceof Error
                                    ? batchMovementsQuery.error.message
                                    : 'Error cargando movimientos'}
                                </p>
                              )}
                              {batchMovementsQuery.data && batchMovementsQuery.data.items.length === 0 && (
                                <p className="text-sm text-slate-600 dark:text-slate-400">Sin movimientos registrados.</p>
                              )}
                              {batchMovementsQuery.data && batchMovementsQuery.data.items.length > 0 && (
                                <div className="space-y-2">
                                  {batchMovementsQuery.data.items.map((m) => (
                                    <div key={m.id} className="text-xs text-slate-700 dark:text-slate-300">
                                      <div className="flex justify-between">
                                        <span className="font-medium">{m.number}</span>
                                        <span>{new Date(m.createdAt).toLocaleString()}</span>
                                      </div>
                                      <div>
                                        {m.type} · Qty {m.quantity}
                                        {m.presentation && m.presentationQuantity
                                          ? ` · ${m.presentationQuantity} ${m.presentation.name}`
                                          : ''}
                                        {m.from ? ` · Desde ${m.from.warehouse.code}/${m.from.code}` : ''}
                                        {m.to ? ` · Hacia ${m.to.warehouse.code}/${m.to.code}` : ''}
                                      </div>
                                      {(m.referenceType || m.referenceId) && (
                                        <div className="text-slate-500 dark:text-slate-400">
                                          Ref: {m.referenceType ?? '-'} · {m.referenceId ?? '-'}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {productBatchesQuery.data?.hasStockRead && presentationsQuery.data && (
                                <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                                  <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    Reempaque (armar/desarmar) — mantiene el mismo lote
                                  </div>
                                  <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
                                    Calculadora: convertís desde una presentación a unidades base y luego armás otra presentación.
                                  </p>

                                  {(() => {
                                    const locAvailUnits = (() => {
                                      if (!repackLocationId) return null
                                      const l = b.locations.find((x) => x.locationId === repackLocationId)
                                      if (!l) return null
                                      const avail = l.availableQuantity ?? String(Math.max(0, Number(l.quantity || '0') - Number(l.reservedQuantity ?? '0')))
                                      const n = Number(avail)
                                      return Number.isFinite(n) ? Math.max(0, n) : null
                                    })()

                                    const availUnits = locAvailUnits ?? getBatchAvailableUnits(b)
                                    const sourcePres = activePresentations.find((p) => p.id === repackSourcePresentationId) ?? null
                                    const targetPres = activePresentations.find((p) => p.id === repackTargetPresentationId) ?? null

                                    const sourceFactor = sourcePres ? Number(sourcePres.unitsPerPresentation) : null
                                    const targetFactor = targetPres ? Number(targetPres.unitsPerPresentation) : null

                                    const srcQty = Number(repackSourceQty)
                                    const srcQtyOk = Number.isFinite(srcQty) && srcQty > 0
                                    const srcFactorOk = sourceFactor !== null && Number.isFinite(sourceFactor) && sourceFactor > 0
                                    const baseUnits = srcQtyOk && srcFactorOk ? srcQty * sourceFactor : null

                                    const maxTargetQty =
                                      baseUnits !== null && targetFactor !== null && Number.isFinite(targetFactor) && targetFactor > 0
                                        ? Math.floor(baseUnits / targetFactor)
                                        : null

                                    const desiredTargetQty = Number(repackTargetQty)
                                    const desiredOk = Number.isFinite(desiredTargetQty) && desiredTargetQty > 0
                                    const usedUnits =
                                      desiredOk && targetFactor !== null && Number.isFinite(targetFactor) && targetFactor > 0
                                        ? desiredTargetQty * targetFactor
                                        : null
                                    const remainderUnits = baseUnits !== null && usedUnits !== null ? baseUnits - usedUnits : null

                                    const overAvailable =
                                      availUnits !== null && baseUnits !== null ? baseUnits > availUnits + 1e-9 : false

                                    return (
                                      <div className="space-y-3">
                                        <div className="grid gap-3 md:grid-cols-4">
                                          <Select
                                            label="Ubicación"
                                            value={repackLocationId}
                                            onChange={(e) => {
                                              setRepackLocationId(e.target.value)
                                              setRepackApplyError('')
                                            }}
                                            options={b.locations.map((l) => {
                                              const avail = l.availableQuantity ?? String(Math.max(0, Number(l.quantity || '0') - Number(l.reservedQuantity ?? '0')))
                                              return {
                                                value: l.locationId,
                                                label: `${l.warehouseCode} · ${l.locationCode} (disp: ${avail})`,
                                              }
                                            })}
                                          />
                                          <Select
                                            label="Desde"
                                            value={repackSourcePresentationId}
                                            onChange={(e) => setRepackSourcePresentationId(e.target.value)}
                                            options={activePresentations.map((p) => ({
                                              value: p.id,
                                              label: `${p.name} · ${p.unitsPerPresentation} u.`,
                                            }))}
                                          />
                                          <Input
                                            label="Cantidad"
                                            type="number"
                                            value={repackSourceQty}
                                            onChange={(e) => setRepackSourceQty(e.target.value)}
                                            placeholder="Ej: 1"
                                          />
                                          <Select
                                            label="A"
                                            value={repackTargetPresentationId}
                                            onChange={(e) => setRepackTargetPresentationId(e.target.value)}
                                            options={repackTargetOptions.map((p) => ({
                                              value: p.id,
                                              label: `${p.name} · ${p.unitsPerPresentation} u.`,
                                            }))}
                                          />
                                          <Input
                                            label="Cantidad a armar"
                                            type="number"
                                            value={repackTargetQty}
                                            onChange={(e) => setRepackTargetQty(e.target.value)}
                                            placeholder={maxTargetQty !== null ? `Máx: ${maxTargetQty}` : '—'}
                                          />
                                        </div>

                                        <div className="text-xs text-slate-700 dark:text-slate-300">
                                          {baseUnits !== null ? (
                                            <div>
                                              Equivale a <span className="font-semibold">{baseUnits}</span> unidades base.
                                              {availUnits !== null ? ` Disponibles en lote: ${availUnits}.` : ''}
                                              {overAvailable ? (
                                                <span className="ml-2 text-red-600">Supera lo disponible.</span>
                                              ) : null}
                                            </div>
                                          ) : (
                                            <div>Ingresá una cantidad válida para ver la conversión.</div>
                                          )}

                                          {maxTargetQty !== null && targetPres ? (
                                            <div>
                                              Podés armar hasta <span className="font-semibold">{maxTargetQty}</span> {targetPres.name}.
                                            </div>
                                          ) : null}

                                          {remainderUnits !== null && targetPres ? (
                                            <div>
                                              Si armás {desiredTargetQty} {targetPres.name}, usás {usedUnits} unidades y te quedan {remainderUnits} unidades.
                                            </div>
                                          ) : null}
                                        </div>

                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              if (maxTargetQty === null) return
                                              setRepackTargetQty(String(Math.max(0, maxTargetQty)))
                                            }}
                                            disabled={maxTargetQty === null}
                                          >
                                            Usar máximo
                                          </Button>
                                          <Button
                                            size="sm"
                                            loading={repackMutation.isPending}
                                            disabled={
                                              repackMutation.isPending ||
                                              !repackLocationId ||
                                              !sourcePres ||
                                              !targetPres ||
                                              baseUnits === null ||
                                              usedUnits === null ||
                                              remainderUnits === null ||
                                              usedUnits < 0 ||
                                              remainderUnits < -1e-9 ||
                                              overAvailable ||
                                              !unitPresentation
                                            }
                                            onClick={() => {
                                              setRepackApplyError('')
                                              if (!sourcePres || !targetPres) return
                                              if (!unitPresentation) {
                                                setRepackApplyError('No se encontró la presentación Unidad')
                                                return
                                              }
                                              if (!repackLocationId) {
                                                setRepackApplyError('Elegí una ubicación')
                                                return
                                              }
                                              if (baseUnits === null || usedUnits === null || remainderUnits === null) {
                                                setRepackApplyError('Completá los datos')
                                                return
                                              }
                                              if (usedUnits > baseUnits + 1e-9) {
                                                setRepackApplyError('La cantidad a armar supera la cantidad fuente')
                                                return
                                              }
                                              if (overAvailable) {
                                                setRepackApplyError('La cantidad fuente supera lo disponible en esa ubicación')
                                                return
                                              }

                                              const ok = confirm(
                                                `Confirmar reempaque en lote ${b.batchNumber}\n\n` +
                                                  `Sacar: ${repackSourceQty} ${sourcePres.name} (${baseUnits} u.)\n` +
                                                  `Armar: ${repackTargetQty} ${targetPres.name} (${usedUnits} u.)\n` +
                                                  `Resto: ${remainderUnits} Unidad\n\n` +
                                                  `Se registrarán movimientos OUT/IN.`,
                                              )
                                              if (!ok) return

                                              repackMutation.mutate(
                                                {
                                                  productId: id!,
                                                  batchId: b.id,
                                                  locationId: repackLocationId,
                                                  sourcePresentationId: sourcePres.id,
                                                  sourceQuantity: Number(repackSourceQty),
                                                  targetPresentationId: targetPres.id,
                                                  targetQuantity: Number(repackTargetQty),
                                                  note: `Reempaque: ${repackSourceQty} ${sourcePres.name} -> ${repackTargetQty} ${targetPres.name}`,
                                                },
                                                {
                                                  onError: (e: any) => {
                                                    setRepackApplyError(e instanceof Error ? e.message : 'Error aplicando reempaque')
                                                  },
                                                },
                                              )
                                            }}
                                          >
                                            Aplicar reempaque
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                              setRepackSourceQty('')
                                              setRepackTargetQty('')
                                              setRepackApplyError('')
                                            }}
                                          >
                                            Limpiar
                                          </Button>
                                        </div>

                                        {(repackApplyError || repackMutation.error) && (
                                          <div className="text-xs text-red-600">
                                            {repackApplyError || (repackMutation.error instanceof Error ? repackMutation.error.message : 'Error')}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })()}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {showBatchForm && (
                <form onSubmit={handleBatchSubmit} className="space-y-4">
                  <Input
                    label="Fecha de Vencimiento"
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    disabled={batchMutation.isPending}
                  />
                  <Input
                    label="Fecha de Fabricación"
                    type="date"
                    value={manufacturingDate}
                    onChange={(e) => setManufacturingDate(e.target.value)}
                    disabled={batchMutation.isPending}
                  />
                  <Select
                    label="Estado"
                    value={batchStatus}
                    onChange={(e) => setBatchStatus(e.target.value)}
                    options={[
                      { value: 'RELEASED', label: 'Liberado' },
                      { value: 'QUARANTINE', label: 'Cuarentena' },
                      { value: 'REJECTED', label: 'Rechazado' },
                    ]}
                    disabled={batchMutation.isPending}
                  />
                  {batchStatus === 'QUARANTINE' && (
                    <Input
                      label="Días de cuarentena"
                      type="number"
                      value={quarantineDays}
                      onChange={(e) => setQuarantineDays(e.target.value)}
                      disabled={batchMutation.isPending}
                      placeholder="30"
                      min={1}
                      max={365}
                    />
                  )}

                  <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <div className="grid gap-3">
                      <Select
                        label="Sucursal/Almacén (ingreso inicial)"
                        value={warehouseIdForInitialStock}
                        onChange={(e) => {
                          setWarehouseIdForInitialStock(e.target.value)
                          if (batchFormError) setBatchFormError('')
                        }}
                        options={(warehousesQuery.data?.items ?? [])
                          .filter((w) => w.isActive)
                          .map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))}
                        disabled={batchMutation.isPending || warehousesQuery.isLoading}
                      />
                      <Select
                        label="Presentación (ingreso inicial)"
                        value={initialStockPresentationId}
                        onChange={(e) => {
                          setInitialStockPresentationId(e.target.value)
                          if (batchFormError) setBatchFormError('')
                        }}
                        options={(presentationsQuery.data?.items ?? [])
                          .filter((p) => p.isActive !== false)
                          .map((p) => ({ value: p.id, label: `${p.name}${p.isDefault ? ' (default)' : ''} · ${p.unitsPerPresentation} u.` }))}
                        disabled={batchMutation.isPending || presentationsQuery.isLoading}
                      />
                      <Input
                        label="Cantidad inicial (en presentación)"
                        type="number"
                        value={initialStockQty}
                        onChange={(e) => {
                          setInitialStockQty(e.target.value)
                          if (batchFormError) setBatchFormError('')
                        }}
                        disabled={batchMutation.isPending}
                        placeholder="0"
                      />
                      {(() => {
                        const pres = (presentationsQuery.data?.items ?? []).find((p) => p.id === initialStockPresentationId)
                        const qty = Number(initialStockQty)
                        const factor = pres ? Number(pres.unitsPerPresentation) : null
                        if (!pres || !Number.isFinite(qty) || qty <= 0) return null
                        if (factor === null || !Number.isFinite(factor) || factor <= 0) return null
                        const baseQty = qty * factor
                        return (
                          <div className="text-xs text-slate-600 dark:text-slate-400">
                            Se registrará como {baseQty} unidades base (Unidad) en stock.
                          </div>
                        )
                      })()}
                      <Input
                        label="Nota (opcional)"
                        value={initialStockNote}
                        onChange={(e) => setInitialStockNote(e.target.value)}
                        disabled={batchMutation.isPending}
                      />
                    </div>
                    {warehousesQuery.error && (
                      <p className="mt-2 text-sm text-red-600">
                        {warehousesQuery.error instanceof Error ? warehousesQuery.error.message : 'Error cargando almacenes'}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" size="sm" loading={batchMutation.isPending}>
                      Crear
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowBatchForm(false)}
                      disabled={batchMutation.isPending}
                    >
                      Cancelar
                    </Button>
                  </div>
                  {batchMutation.error && (
                    <p className="text-sm text-red-600">
                      {batchMutation.error instanceof Error ? batchMutation.error.message : 'Error al crear lote'}
                    </p>
                  )}
                  {batchFormError && !batchMutation.isPending && (
                    <p className="text-sm text-red-600">{batchFormError}</p>
                  )}
                </form>
              )}
              {!showBatchForm && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Usa el botón "Crear Lote" para registrar una nueva existencia con fecha de vencimiento.
                </p>
              )}
              </div>
            </div>
          )}

          {/* Recipe (only for existing products) */}
          {!isNew && (
            <div className="rounded-lg border border-slate-200 bg-white p-6 md:col-span-2 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Recetario de elaboración</h3>
                {!showRecipeForm && (
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!recipeQuery.data && productQuery.data && !recipeName.trim()) {
                        setRecipeName(`Receta de ${productQuery.data.name}`)
                      }
                      setShowRecipeForm(true)
                    }}
                    disabled={recipeQuery.isLoading}
                  >
                    {recipeQuery.data ? 'Editar' : 'Generar recetario'}
                  </Button>
                )}
              </div>

              {recipeQuery.isLoading && <p className="text-sm text-slate-600 dark:text-slate-400">Cargando recetario…</p>}
              {recipeQuery.error && (
                <p className="text-sm text-red-600">
                  {recipeQuery.error instanceof Error ? recipeQuery.error.message : 'Error cargando recetario'}
                </p>
              )}

              {!recipeQuery.isLoading && !recipeQuery.data && !showRecipeForm && (
                <p className="text-sm text-slate-600 dark:text-slate-400">Aún no hay recetario para este producto.</p>
              )}

              {!showRecipeForm && recipeQuery.data && (
                <div className="space-y-2">
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    <span className="font-medium">Nombre:</span> {recipeQuery.data.name}
                  </div>
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    <span className="font-medium">Items:</span> {recipeQuery.data.items?.length ?? 0}
                  </div>
                </div>
              )}

              {showRecipeForm && (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Input
                      label="Nombre del recetario"
                      value={recipeName}
                      onChange={(e) => setRecipeName(e.target.value)}
                      disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                    />
                    <Input
                      label="Cantidad de salida (opcional)"
                      value={recipeOutputQuantity}
                      onChange={(e) => setRecipeOutputQuantity(e.target.value)}
                      disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                    />
                    <Input
                      label="Unidad de salida (opcional)"
                      value={recipeOutputUnit}
                      onChange={(e) => setRecipeOutputUnit(e.target.value)}
                      disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                    />
                  </div>

                  <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Insumos</div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={addRecipeItem}
                        disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                      >
                        Agregar
                      </Button>
                    </div>

                    {recipeItems.length === 0 ? (
                      <p className="text-sm text-slate-600 dark:text-slate-400">Agrega uno o más insumos.</p>
                    ) : (
                      <div className="space-y-3">
                        {recipeItems.map((it) => (
                          <div key={it.localId} className="grid gap-2 md:grid-cols-12">
                            <div className="md:col-span-5">
                              <Input
                                label="Insumo"
                                value={it.ingredientName}
                                onChange={(e) => updateRecipeItem(it.localId, { ingredientName: e.target.value })}
                                disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                              />
                            </div>
                            <div className="md:col-span-2">
                              <Input
                                label="Cantidad"
                                value={it.quantity}
                                onChange={(e) => updateRecipeItem(it.localId, { quantity: e.target.value })}
                                disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                              />
                            </div>
                            <div className="md:col-span-2">
                              <Input
                                label="Unidad"
                                value={it.unit}
                                onChange={(e) => updateRecipeItem(it.localId, { unit: e.target.value })}
                                disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                              />
                            </div>
                            <div className="md:col-span-2">
                              <Input
                                label="Nota"
                                value={it.note}
                                onChange={(e) => updateRecipeItem(it.localId, { note: e.target.value })}
                                disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                              />
                            </div>
                            <div className="flex items-end md:col-span-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => removeRecipeItem(it.localId)}
                                disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                              >
                                Quitar
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      loading={saveRecipeMutation.isPending}
                      disabled={deleteRecipeMutation.isPending}
                      onClick={() => saveRecipeMutation.mutate()}
                    >
                      Guardar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={saveRecipeMutation.isPending || deleteRecipeMutation.isPending}
                      onClick={() => setShowRecipeForm(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      loading={deleteRecipeMutation.isPending}
                      disabled={!recipeQuery.data || saveRecipeMutation.isPending}
                      onClick={() => {
                        if (confirm('¿Eliminar recetario?')) deleteRecipeMutation.mutate()
                      }}
                    >
                      Eliminar
                    </Button>
                  </div>

                  {(saveRecipeMutation.error || deleteRecipeMutation.error) && (
                    <p className="text-sm text-red-600">
                      {saveRecipeMutation.error instanceof Error
                        ? saveRecipeMutation.error.message
                        : deleteRecipeMutation.error instanceof Error
                          ? deleteRecipeMutation.error.message
                          : 'Error'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
