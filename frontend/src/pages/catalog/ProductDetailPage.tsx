import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch, getApiBaseUrl } from '../../lib/api'
import { getProductDisplayName } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Input, Select, Loading, ErrorState, ImageUpload } from '../../components'
import { useNavigation } from '../../hooks'

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
    presentationWrapper?: string
    presentationQuantity?: number
    presentationFormat?: string
    cost?: number
    price?: number
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

async function createBatch(
  token: string,
  productId: string,
  data: {
    batchNumber?: string
    expiresAt?: string
    manufacturingDate?: string
    status: string
    initialStock?: { warehouseId: string; quantity: number; note?: string }
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
  const [presentationWrapper, setPresentationWrapper] = useState(isNew ? 'caja' : '')
  const [presentationQuantity, setPresentationQuantity] = useState(isNew ? '1' : '')
  const [presentationFormat, setPresentationFormat] = useState(isNew ? 'comprimidos' : '')
  const [customWrapper, setCustomWrapper] = useState('')
  const [customFormat, setCustomFormat] = useState('')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')
  const [isActive, setIsActive] = useState(true)

  const wrapperOptions = ['caja', 'frasco', 'blister', 'botella', 'sobre', 'tubo']
  const formatOptions = ['comprimidos', 'capsulas', 'vial', 'ampolla', 'ml', 'gotas', 'sobres']

  const finalWrapper =
    (presentationWrapper === 'otro' ? customWrapper.trim() : presentationWrapper.trim())
      .toLowerCase()
      .trim() || ''
  const finalFormat =
    (presentationFormat === 'otro' ? customFormat.trim() : presentationFormat.trim())
      .toLowerCase()
      .trim() || ''
  const finalQuantityText = presentationQuantity.trim()

  function capitalizeFirst(s: string): string {
    if (!s) return s
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  const presentationText =
    finalWrapper && finalFormat && finalQuantityText ? `${capitalizeFirst(finalWrapper)} de ${finalQuantityText} ${finalFormat}` : ''

  // Generate SKU automatically when name or presentation changes
  useEffect(() => {
    if (isNew && skuAuto && name.trim() && finalWrapper && finalFormat && finalQuantityText) {
      const generatedSku = generateSku(name, finalWrapper, finalQuantityText, finalFormat)
      setSku(generatedSku)
    }
  }, [name, finalWrapper, finalQuantityText, finalFormat, isNew, skuAuto])

  function generateSku(productName: string, wrapper: string, quantityText: string, format: string): string {
    // Clean name: remove special chars, take first 4 letters, uppercase
    const cleanName = productName
      .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars
      .split(' ')
      .filter(word => word.length > 0)
      .slice(0, 2) // Take first 2 words
      .map(word => word.substring(0, 4).toUpperCase()) // First 4 chars uppercase
      .join('-')

    const wrapCode = getWrapperCode(wrapper)
    const fmtCode = getFormatCode(format)
    const qtyCode = normalizeQtyCode(quantityText)
    return `${cleanName}-${wrapCode}${qtyCode}${fmtCode}`
  }

  function normalizeQtyCode(qty: string): string {
    const t = qty.trim()
    if (!t) return ''
    // Allow decimals: 2.5 -> 2P5
    const normalized = t.replace(',', '.').replace(/[^0-9.]/g, '')
    if (!normalized) return ''
    return normalized.replace('.', 'P')
  }

  function getWrapperCode(wrap: string): string {
    const codes: Record<string, string> = {
      caja: 'CAJ',
      frasco: 'FRS',
      blister: 'BLS',
      botella: 'BOT',
      sobre: 'SOB',
      tubo: 'TUB',
    }
    const key = (wrap || '').toLowerCase().trim()
    return codes[key] || key.substring(0, 3).toUpperCase()
  }

  function getFormatCode(fmt: string): string {
    const codes: Record<string, string> = {
      comprimidos: 'COMP',
      capsulas: 'CAPS',
      vial: 'VIAL',
      ampolla: 'AMP',
      ml: 'ML',
      gotas: 'GOT',
      sobres: 'SBR',
    }
    const key = (fmt || '').toLowerCase().trim()
    return codes[key] || key.substring(0, 4).toUpperCase()
  }

  // Batch form state
  const [expiresAt, setExpiresAt] = useState('')
  const [manufacturingDate, setManufacturingDate] = useState('')
  const [batchStatus, setBatchStatus] = useState('RELEASED')
  const [quarantineDays, setQuarantineDays] = useState<string>('')
  const [showBatchForm, setShowBatchForm] = useState(false)
  const [batchFormError, setBatchFormError] = useState<string>('')

  const [selectedBatchId, setSelectedBatchId] = useState<string>('')

  // Product naming
  const [genericName, setGenericName] = useState('')

  // Product photo state
  // - Existing products: ImageUpload uploads via presign
  // - New product: ImageUpload stores a pending file; uploaded right after create
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null)

  // Initial stock on batch creation (optional)
  const [warehouseIdForInitialStock, setWarehouseIdForInitialStock] = useState<string>('')
  const [initialStockQty, setInitialStockQty] = useState<string>('')
  const [initialStockNote, setInitialStockNote] = useState<string>('')

  // Recipe state (existing products only)
  const [showRecipeForm, setShowRecipeForm] = useState(false)
  const [recipeVersion, setRecipeVersion] = useState<number | null>(null)
  const [recipeName, setRecipeName] = useState('')
  const [recipeOutputQuantity, setRecipeOutputQuantity] = useState('')
  const [recipeOutputUnit, setRecipeOutputUnit] = useState('')
  const [recipeItems, setRecipeItems] = useState<RecipeItemDraft[]>([])

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
      setIsActive(productQuery.data.isActive)

      const savedWrap = (productQuery.data.presentationWrapper ?? '').trim().toLowerCase()
      if (!savedWrap) {
        setPresentationWrapper('')
        setCustomWrapper('')
      } else if (wrapperOptions.includes(savedWrap)) {
        setPresentationWrapper(savedWrap)
        setCustomWrapper('')
      } else {
        setPresentationWrapper('otro')
        setCustomWrapper(savedWrap)
      }

      const savedFmt = (productQuery.data.presentationFormat ?? '').trim().toLowerCase()
      if (!savedFmt) {
        setPresentationFormat('')
        setCustomFormat('')
      } else if (formatOptions.includes(savedFmt)) {
        setPresentationFormat(savedFmt)
        setCustomFormat('')
      } else {
        setPresentationFormat('otro')
        setCustomFormat(savedFmt)
      }

      setPresentationQuantity(productQuery.data.presentationQuantity ? String(productQuery.data.presentationQuantity) : '')
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
      presentationWrapper?: string
      presentationQuantity?: number
      presentationFormat?: string
      cost?: number
      price?: number
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
      initialStock?: { warehouseId: string; quantity: number; note?: string }
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

    const qty = finalQuantityText ? Number(finalQuantityText.replace(',', '.')) : NaN
    const hasPresentation = finalWrapper && finalFormat && Number.isFinite(qty) && qty > 0
    
    if (isNew) {
      const payload: any = { sku, name, description: description || undefined }
      if (genericName.trim()) payload.genericName = genericName.trim()
      if (hasPresentation) {
        payload.presentationWrapper = finalWrapper
        payload.presentationQuantity = qty
        payload.presentationFormat = finalFormat
      }
      if (cost) payload.cost = parseFloat(cost)
      if (price) payload.price = parseFloat(price)
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
        isActive,
      }
      if (hasPresentation) {
        payload.presentationWrapper = finalWrapper
        payload.presentationQuantity = qty
        payload.presentationFormat = finalFormat
      } else {
        // allow clearing
        payload.presentationWrapper = null
        payload.presentationQuantity = null
        payload.presentationFormat = null
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

    const qty = Number(initialStockQty)
    if (!warehouseIdForInitialStock) {
      setBatchFormError('Seleccioná la sucursal/almacén para el ingreso inicial.')
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setBatchFormError('Ingresá una cantidad inicial válida (mayor a 0).')
      return
    }
    payload.initialStock = {
      warehouseId: warehouseIdForInitialStock,
      quantity: qty,
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
          <Button variant="secondary" onClick={() => navigate('/catalog/products')}>
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
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Presentación (envoltorio + cantidad + formato)
                </label>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <Select
                      value={presentationWrapper}
                      onChange={(e) => {
                        const value = e.target.value
                        setPresentationWrapper(value)
                        if (value !== 'otro') setCustomWrapper('')
                      }}
                      options={[
                        ...wrapperOptions.map((w) => ({ value: w, label: capitalizeFirst(w) })),
                        { value: 'otro', label: 'Otro' },
                      ]}
                      disabled={createMutation.isPending || updateMutation.isPending}
                      required={isNew}
                      className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {presentationWrapper === 'otro' && (
                      <Input
                        value={customWrapper}
                        onChange={(e) => setCustomWrapper(e.target.value)}
                        placeholder="Ej: caja, frasco..."
                        className="mt-2 transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={createMutation.isPending || updateMutation.isPending}
                        required
                      />
                    )}
                  </div>

                  <div>
                    <Input
                      value={presentationQuantity}
                      onChange={(e) => setPresentationQuantity(e.target.value)}
                      placeholder="Ej: 250"
                      disabled={createMutation.isPending || updateMutation.isPending}
                      required={isNew}
                      className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <Select
                      value={presentationFormat}
                      onChange={(e) => {
                        const value = e.target.value
                        setPresentationFormat(value)
                        if (value !== 'otro') setCustomFormat('')
                      }}
                      options={[
                        ...formatOptions.map((f) => ({ value: f, label: capitalizeFirst(f) })),
                        { value: 'otro', label: 'Otro' },
                      ]}
                      disabled={createMutation.isPending || updateMutation.isPending}
                      required={isNew}
                      className="transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {presentationFormat === 'otro' && (
                      <Input
                        value={customFormat}
                        onChange={(e) => setCustomFormat(e.target.value)}
                        placeholder="Ej: comprimidos, vial..."
                        className="mt-2 transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={createMutation.isPending || updateMutation.isPending}
                        required
                      />
                    )}
                  </div>
                </div>

                {presentationText ? (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Vista previa: {presentationText}</div>
                ) : (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Ej: Caja de 250 comprimidos</div>
                )}
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
              
              <div className="grid grid-cols-2 gap-4">
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
                    label="Precio (opcional)"
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
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
                  loading={createMutation.isPending || updateMutation.isPending}
                  disabled={createMutation.isPending || updateMutation.isPending || skuExists}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 py-3 text-lg font-semibold shadow-lg hover:from-blue-600 hover:to-purple-700 hover:shadow-xl"
                >
                  {isNew ? '✨ Crear Producto' : '💾 Guardar Cambios'}
                </Button>

                {!isNew && productQuery.data && (
                  <Button
                    type="button"
                    variant={productQuery.data.isActive ? 'danger' : 'secondary'}
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
                    {productQuery.data.isActive ? '🗑️ Eliminar' : '✅ Reactivar'}
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

          {/* Batch Form (only for existing products) */}
          {!isNew && (
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
                      <Input
                        label="Cantidad inicial"
                        type="number"
                        value={initialStockQty}
                        onChange={(e) => {
                          setInitialStockQty(e.target.value)
                          if (batchFormError) setBatchFormError('')
                        }}
                        disabled={batchMutation.isPending}
                        placeholder="0"
                      />
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
