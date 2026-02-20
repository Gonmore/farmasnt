import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import React, { useEffect, useState } from 'react'
import { PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline'
import { apiFetch } from '../../lib/api'
import { getProductLabel } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Select, Input, Button, Table, Loading, ErrorState, Modal } from '../../components'
import { useNavigation, usePermissions } from '../../hooks'
import { MovementQuickActions } from '../../components/MovementQuickActions'

type MovementRequestItem = {
  id: string
  productId: string
  productSku: string | null
  productName: string | null
  genericName: string | null
  requestedQuantity: number
  remainingQuantity: number
  presentationId: string | null
  presentationName: string | null
  presentationQuantity: number | null
  unitsPerPresentation: number | null
  presentation?: { id: string; name: string; unitsPerPresentation: number } | null
}

type MovementRequest = {
  id: string
  status: 'OPEN' | 'SENT' | 'FULFILLED' | 'CANCELLED'
  requestedCity: string
  warehouseId?: string | null
  note?: string | null
  requestedByName: string | null
  createdAt: string
  fulfilledAt: string | null
  items: MovementRequestItem[]
}

type ProductListItem = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  isActive: boolean
}

type WarehouseListItem = {
  id: string
  code: string
  name: string
  isActive: boolean
}

type LocationListItem = {
  id: string
  code: string
  isActive: boolean
}

type ProductBatchListItem = {
  id: string
  batchNumber: string
  expiresAt: string | null
  manufacturingDate: string | null
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

type ProductPresentation = {
  id: string
  name: string
  unitsPerPresentation: string
  isDefault?: boolean
  isActive?: boolean
}

type ClientListItem = {
  id: string
  name: string
  isActive: boolean
}

async function fetchProducts(token: string): Promise<{ items: ProductListItem[] }> {
  const params = new URLSearchParams({ take: '50' })
  return apiFetch(`/api/v1/products?${params}`, { token })
}

async function listProductBatches(token: string, productId: string): Promise<{ items: ProductBatchListItem[]; hasStockRead: boolean }> {
  return apiFetch(`/api/v1/products/${productId}/batches?take=100`, { token })
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch(`/api/v1/warehouses?take=50`, { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  return apiFetch(`/api/v1/warehouses/${warehouseId}/locations?take=100`, { token })
}

async function listClients(token: string): Promise<{ items: ClientListItem[] }> {
  return apiFetch(`/api/v1/customers?take=50`, { token })
}

async function fetchProductPresentations(token: string, productId: string): Promise<{ items: ProductPresentation[] }> {
  return apiFetch(`/api/v1/products/${productId}/presentations`, { token })
}

async function createBatch(
  token: string,
  productId: string,
  data: {
    batchNumber: string
    expiresAt?: string
    manufacturingDate?: string
    status: string
    initialStock?: { warehouseId: string; quantity: number; note?: string }
  },
): Promise<any> {
  return apiFetch(`/api/v1/products/${productId}/batches`, {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

async function createTransferMovement(
  token: string,
  data: {
    productId: string
    batchId: string
    fromLocationId: string
    toLocationId: string
    quantity: string
    note?: string
  },
): Promise<any> {
  return apiFetch(`/api/v1/stock/movements`, {
    token,
    method: 'POST',
    body: JSON.stringify({ type: 'TRANSFER', ...data }),
  })
}

async function listMovementRequests(token: string): Promise<{ items: MovementRequest[] }> {
  const response = await apiFetch<{ items: any[] }>('/api/v1/stock/movement-requests?take=50', { token })
  return {
    items: response.items.map((req: any) => ({
      ...req,
      items: req.items.map((item: any) => ({
        ...item,
        // Backend puede enviar presentación como campos planos o anidada (item.presentation)
        // No pisar valores válidos con null.
        requestedQuantity: Number(item.requestedQuantity ?? 0),
        remainingQuantity: Number(item.remainingQuantity ?? 0),
        presentationId: item.presentationId ?? item.presentation?.id ?? null,
        presentationName: item.presentationName ?? item.presentation?.name ?? null,
        presentationQuantity:
          item.presentationQuantity === null || item.presentationQuantity === undefined ? null : Number(item.presentationQuantity),
        unitsPerPresentation:
          item.unitsPerPresentation === null || item.unitsPerPresentation === undefined
            ? item.presentation?.unitsPerPresentation === null || item.presentation?.unitsPerPresentation === undefined
              ? null
              : Number(item.presentation.unitsPerPresentation)
            : Number(item.unitsPerPresentation),
        presentation: item.presentation
          ? {
              id: String(item.presentation.id),
              name: String(item.presentation.name),
              unitsPerPresentation: Number(item.presentation.unitsPerPresentation ?? 0),
            }
          : null,
      })),
    })),
  }
}

async function createMovementRequest(
  token: string,
  data: {
    warehouseId: string
    items: { productId: string; presentationId: string; quantity: number }[]
    note?: string
  },
): Promise<MovementRequest> {
  return apiFetch('/api/v1/stock/movement-requests', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

async function updateMovementRequest(
  token: string,
  requestId: string,
  data: {
    warehouseId: string
    items: { productId: string; presentationId: string; quantity: number }[]
    note?: string
  },
): Promise<any> {
  return apiFetch(`/api/v1/stock/movement-requests/${encodeURIComponent(requestId)}`, {
    method: 'PUT',
    token,
    body: JSON.stringify(data),
  })
}

async function cancelMovementRequest(token: string, requestId: string): Promise<any> {
  return apiFetch(`/api/v1/stock/movement-requests/${encodeURIComponent(requestId)}/cancel`, {
    method: 'PATCH',
    token,
  })
}

function dateOnlyToUtcIso(dateString: string): string {
  const [year, month, day] = dateString.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day)).toISOString().split('T')[0]
}

export function MovementsPage() {
  const auth = useAuth()
  const permissions = usePermissions()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()

  const [type, setType] = useState('')
  const [productId, setProductId] = useState('')
  const [selectedStockKey, setSelectedStockKey] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [quantity, setQuantity] = useState('')
  const [manufacturingDate, setManufacturingDate] = useState('')
  const [expirationDate, setExpirationDate] = useState('')
  const [moveAllStock, setMoveAllStock] = useState(true)
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [createBatchError, setCreateBatchError] = useState('')

  // Estados para SALIDA (OUT)
  const [outReasonType, setOutReasonType] = useState<'SALE' | 'DISCARD' | ''>('')
  const [clientId, setClientId] = useState('')
  const [discardReason, setDiscardReason] = useState('')
  const [outError, setOutError] = useState('')
  const [outOccurredDate, setOutOccurredDate] = useState<string>(() => new Date().toISOString().slice(0, 10))

  // Estados para AJUSTE (ADJUSTMENT)
  const [adjustedQuantity, setAdjustedQuantity] = useState('')
  const [adjustedManufacturingDate, setAdjustedManufacturingDate] = useState('')
  const [adjustedExpirationDate, setAdjustedExpirationDate] = useState('')
  const [adjustmentError, setAdjustmentError] = useState('')

  // Estados para REEMPAQUE (REPACK)
  const [repackSourcePresentationId, setRepackSourcePresentationId] = useState('')
  const [repackSourceQty, setRepackSourceQty] = useState('')
  const [repackTargetPresentationId, setRepackTargetPresentationId] = useState('')
  const [repackTargetQty, setRepackTargetQty] = useState('')
  const [repackError, setRepackError] = useState('')

  // Estados para CREAR SOLICITUD
  const [showCreateRequestModal, setShowCreateRequestModal] = useState(false)
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null)
  const [requestWarehouseId, setRequestWarehouseId] = useState('')
  const [requestProductId, setRequestProductId] = useState('')
  const [requestItem, setRequestItem] = useState<{ presentationId: string; quantity: number } | null>(null)
  const [requestItems, setRequestItems] = useState<
    Array<{
      productId: string
      productLabel: string
      presentationId: string
      presentationLabel: string
      unitsPerPresentation: number
      quantity: number
    }>
  >([])
  const [requestPresentationId, setRequestPresentationId] = useState('')
  const [requestQuantity, setRequestQuantity] = useState('1')
  const [requestNote, setRequestNote] = useState('')
  const [createRequestError, setCreateRequestError] = useState('')

  // Estados para el selector de producto con búsqueda
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [showProductOptions, setShowProductOptions] = useState(false)

  const productsQuery = useQuery({
    queryKey: ['products', 'forMovements'],
    queryFn: () => fetchProducts(auth.accessToken!),
    enabled: !!auth.accessToken && (!!type || showCreateRequestModal),
  })

  const productBatchesQuery = useQuery({
    queryKey: ['productBatches', 'forMovements', productId],
    queryFn: () => listProductBatches(auth.accessToken!, productId),
    enabled: !!auth.accessToken && !!productId,
  })

  const presentationsQuery = useQuery({
    queryKey: ['productPresentations', 'forMovements', productId],
    queryFn: () => fetchProductPresentations(auth.accessToken!, productId),
    enabled: !!auth.accessToken && !!productId && type === 'REPACK',
  })

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'forMovements'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken && (type === 'TRANSFER' || type === 'IN'),
  })

  const locationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'forMovements', toWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, toWarehouseId),
    enabled: !!auth.accessToken && !!toWarehouseId,
  })

  const clientsQuery = useQuery({
    queryKey: ['clients', 'forMovements'],
    queryFn: () => listClients(auth.accessToken!),
    enabled: !!auth.accessToken && (type === 'OUT' && outReasonType === 'SALE'),
  })

  const movementRequestsQuery = useQuery({
    queryKey: ['movementRequests'],
    queryFn: () => listMovementRequests(auth.accessToken!),
    enabled: !!auth.accessToken,
    refetchInterval: 10_000,
  })

  const requestProductPresentationsQuery = useQuery({
    queryKey: ['productPresentations', requestProductId],
    queryFn: () => fetchProductPresentations(auth.accessToken!, requestProductId),
    enabled: !!auth.accessToken && !!requestProductId,
  })

  const requestWarehousesQuery = useQuery({
    queryKey: ['warehouses', 'forRequests'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  // Preseleccionar sucursal para administradores de sucursal
  useEffect(() => {
    if (!showCreateRequestModal || editingRequestId) return
    const isBranchScoped = permissions.hasPermission('scope:branch') && !permissions.isTenantAdmin
    if (!isBranchScoped) return
    const wid = permissions.user?.warehouseId ?? ''
    if (!wid) return
    if (requestWarehouseId) return
    if (!requestWarehousesQuery.data?.items.some((w) => w.id === wid)) return
    setRequestWarehouseId(wid)
  }, [showCreateRequestModal, editingRequestId, permissions, requestWarehousesQuery.data, requestWarehouseId])

  const outMutation = useMutation({
    mutationFn: async () => {
      setOutError('')
      const selectedRow = stockRows.find((r) => r.id === selectedStockKey)
      if (!selectedRow) throw new Error('Seleccioná un lote/ubicación')

      const qtyNum = moveAllStock ? Number(selectedRow.availableQuantity || '0') : Number(quantity)
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) throw new Error('Ingresá una cantidad válida (mayor a 0)')

      const available = Number(selectedRow.availableQuantity || '0')
      if (qtyNum > available + 1e-9) throw new Error(`No podés sacar más de lo disponible (${available}).`)

      if (!outReasonType) throw new Error('Seleccioná el tipo de salida')
      if (outReasonType === 'SALE' && !clientId) throw new Error('Seleccioná un cliente')
      if (outReasonType === 'DISCARD' && !discardReason.trim()) throw new Error('Ingresá el motivo de la baja')

      const baseNote = outReasonType === 'DISCARD' ? `Baja: ${discardReason.trim()}` : undefined
      const referenceType = outReasonType === 'SALE' ? 'MANUAL_SALE' : 'MANUAL_DISCARD'
      const referenceId = outReasonType === 'SALE' ? clientId : undefined

      const payload: any = {
        type: 'OUT',
        productId,
        batchId: selectedRow.batchId,
        fromLocationId: selectedRow.locationId,
        quantity: qtyNum,
        referenceType,
        referenceId,
        note: baseNote,
      }

      if (permissions.isTenantAdmin && outOccurredDate) {
        payload.createdAt = new Date(`${outOccurredDate}T12:00:00.000Z`).toISOString()
      }

      return apiFetch(`/api/v1/stock/movements`, {
        token: auth.accessToken,
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['productBatches', 'forMovements', productId] })
      await queryClient.invalidateQueries({ queryKey: ['balances'] })
      setSelectedStockKey('')
      setQuantity('')
      setMoveAllStock(true)
      setOutReasonType('')
      setClientId('')
      setDiscardReason('')
      setOutError('')
      alert('Salida registrada exitosamente')
    },
    onError: (err: any) => {
      const msg = err instanceof Error ? err.message : 'Error registrando salida'
      setOutError(msg)
    },
  })

  // Filtrar productos para el selector con búsqueda
  const filteredProducts = React.useMemo(() => {
    if (!productsQuery.data?.items) return []
    if (!productSearchQuery.trim()) return productsQuery.data.items.filter(p => p.isActive)
    const query = productSearchQuery.toLowerCase()
    return productsQuery.data.items
      .filter(p => p.isActive)
      .filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.genericName?.toLowerCase().includes(query) ||
        p.sku.toLowerCase().includes(query)
      )
      .slice(0, 10) // Limitar a 10 resultados
  }, [productsQuery.data, productSearchQuery])

  // Auto-select default presentation when presentations load
  React.useEffect(() => {
    if (!requestProductPresentationsQuery.data?.items || requestPresentationId) return

    const defaultPresentation = requestProductPresentationsQuery.data.items.find(p => p.isDefault && p.isActive !== false)
    if (defaultPresentation) {
      setRequestPresentationId(defaultPresentation.id)
      setRequestItem({ presentationId: defaultPresentation.id, quantity: Number(requestQuantity) })
    }
  }, [requestProductPresentationsQuery.data, requestPresentationId, requestQuantity])

  const batchMutation = useMutation({
    mutationFn: (data: {
      batchNumber: string
      expiresAt?: string
      manufacturingDate?: string
      status: string
      initialStock?: { warehouseId: string; quantity: number; note?: string }
    }) => createBatch(auth.accessToken!, productId, data),
    onSuccess: () => {
      setBatchNumber('')
      setQuantity('')
      setManufacturingDate('')
      setExpirationDate('')
      setCreateBatchError('')
      queryClient.invalidateQueries({ queryKey: ['productBatches', 'forMovements', productId] })
      alert('Lote creado exitosamente')
    },
    onError: (error: any) => {
      setCreateBatchError(error instanceof Error ? error.message : 'Error al crear lote')
    },
  })

  const transferMutation = useMutation({
    mutationFn: async () => {
      const selectedRow = stockRows.find((r) => r.id === selectedStockKey)
      if (!selectedRow) throw new Error('Seleccioná una existencia para transferir')

      const qtyNum = moveAllStock ? Number(selectedRow.availableQuantity || '0') : Number(quantity)
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) throw new Error('Ingresá una cantidad válida (mayor a 0)')

      const available = Number(selectedRow.availableQuantity || '0')
      if (qtyNum > available) throw new Error(`No podés transferir más de lo disponible (${available}).`)
      if (!toWarehouseId) throw new Error('Seleccioná el almacén destino')
      if (!toLocationId) throw new Error('Seleccioná la ubicación destino')

      return createTransferMovement(auth.accessToken!, {
        productId,
        batchId: selectedRow.batchId,
        fromLocationId: selectedRow.locationId,
        toLocationId: toLocationId,
        quantity: String(qtyNum),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['productBatches', 'forMovements', productId] })
      await queryClient.invalidateQueries({ queryKey: ['balances'] })
      setSelectedStockKey('')
      setQuantity('')
      setMoveAllStock(true)
      setToWarehouseId('')
      setToLocationId('')
      alert('Transferencia realizada exitosamente')
    },
    onError: (err: any) => {
      const msg = err instanceof Error ? err.message : 'Error al transferir'
      window.alert(msg)
    },
  })

  const handleTypeChange = (nextType: string) => {
    setType(nextType)
    setProductId('')
    setSelectedStockKey('')
    setBatchNumber('')
    setQuantity('')
    setManufacturingDate('')
    setExpirationDate('')
    setToWarehouseId('')
    setToLocationId('')
    setCreateBatchError('')
    setOutReasonType('')
    setClientId('')
    setDiscardReason('')
    setOutError('')
    setAdjustedQuantity('')
    setAdjustedManufacturingDate('')
    setAdjustedExpirationDate('')
    setAdjustmentError('')

    setRepackSourcePresentationId('')
    setRepackSourceQty('')
    setRepackTargetPresentationId('')
    setRepackTargetQty('')
    setRepackError('')
  }

  const handleProductChange = (nextProductId: string) => {
    setProductId(nextProductId)
    setSelectedStockKey('')
    setBatchNumber('')
    setQuantity('')

    setRepackSourcePresentationId('')
    setRepackSourceQty('')
    setRepackTargetPresentationId('')
    setRepackTargetQty('')
    setRepackError('')
  }

  const handleRequestProductChange = (nextProductId: string) => {
    setRequestProductId(nextProductId)
    setRequestItem(null)
    setRequestPresentationId('')
    setRequestQuantity('1')
  }



  // Obtener existencias por lote/ubicación para mostrar en tabla
  const stockRows = (() => {
    const data = productBatchesQuery.data
    if (!data?.hasStockRead) return []

    const rows: any[] = []
    for (const batch of data.items) {
      for (const loc of batch.locations ?? []) {
        const total = Number(loc.quantity || '0')
        const reserved = Number(loc.reservedQuantity ?? '0')
        const available = Number(loc.availableQuantity ?? String(Math.max(0, total - reserved)))
        rows.push({
          id: `${batch.id}::${loc.locationId}`,
          batchNumber: batch.batchNumber,
          manufacturingDate: batch.manufacturingDate ? new Date(batch.manufacturingDate).toLocaleDateString() : '-',
          expiresAt: batch.expiresAt ? new Date(batch.expiresAt).toLocaleDateString() : '-',
          totalQuantity: String(total),
          reservedQuantity: String(Math.max(0, reserved)),
          availableQuantity: String(Math.max(0, available)),
          warehouse: `${loc.warehouseCode} - ${loc.warehouseName}`,
          location: loc.locationCode,
          batchId: batch.id,
          locationId: loc.locationId,
        })
      }
    }
    return rows.filter((r) => Number(r.totalQuantity || '0') > 0)
  })()

  const selectableStockRows = stockRows.filter((r) => Number(r.availableQuantity || '0') > 0)

  const activePresentations = (presentationsQuery.data?.items ?? []).filter((p) => p.isActive !== false)
  const sourcePresentation = activePresentations.find((p) => p.id === repackSourcePresentationId) ?? null
  const targetPresentation = activePresentations.find((p) => p.id === repackTargetPresentationId) ?? null

  const repackDerived = (() => {
    const row = stockRows.find((r) => r.id === selectedStockKey)
    const availableUnits = row ? Number(row.availableQuantity || '0') : null

    const srcQty = Number(repackSourceQty)
    const tgtQty = Number(repackTargetQty)

    const srcFactor = sourcePresentation ? Number(sourcePresentation.unitsPerPresentation) : null
    const tgtFactor = targetPresentation ? Number(targetPresentation.unitsPerPresentation) : null

    const srcOk = Number.isFinite(srcQty) && srcQty > 0
    const tgtOk = Number.isFinite(tgtQty) && tgtQty > 0
    const srcFactorOk = srcFactor !== null && Number.isFinite(srcFactor) && srcFactor > 0
    const tgtFactorOk = tgtFactor !== null && Number.isFinite(tgtFactor) && tgtFactor > 0

    const baseSource = srcOk && srcFactorOk ? srcQty * srcFactor : null
    const maxTarget = baseSource !== null && tgtFactorOk ? Math.floor(baseSource / (tgtFactor as number)) : null
    const baseTarget = tgtOk && tgtFactorOk ? tgtQty * (tgtFactor as number) : null
    const remainder = baseSource !== null && baseTarget !== null ? baseSource - baseTarget : null

    const exceedsAvailable =
      baseSource !== null && typeof availableUnits === 'number' && Number.isFinite(availableUnits)
        ? baseSource > availableUnits + 1e-9
        : false

    const targetExceedsSource = baseSource !== null && baseTarget !== null ? baseTarget > baseSource + 1e-9 : false

    return {
      availableUnits: typeof availableUnits === 'number' && Number.isFinite(availableUnits) ? availableUnits : null,
      baseSource,
      baseTarget,
      remainder,
      maxTarget,
      exceedsAvailable,
      targetExceedsSource,
    }
  })()

  const repackMutation = useMutation({
    mutationFn: async () => {
      setRepackError('')
      const selectedRow = stockRows.find((r) => r.id === selectedStockKey)
      if (!selectedRow) throw new Error('Seleccioná un lote/ubicación')

      if (!sourcePresentation) throw new Error('Seleccioná la presentación de origen')
      if (!targetPresentation) throw new Error('Seleccioná la presentación destino')

      const srcQty = Number(repackSourceQty)
      const tgtQty = Number(repackTargetQty)
      if (!Number.isFinite(srcQty) || srcQty <= 0) throw new Error('Ingresá una cantidad válida de origen')
      if (!Number.isFinite(tgtQty) || tgtQty <= 0) throw new Error('Ingresá una cantidad válida a armar')

      if (repackDerived.baseSource === null) throw new Error('No se pudo calcular la cantidad base de origen')
      if (repackDerived.baseTarget === null) throw new Error('No se pudo calcular la cantidad base a armar')
      if (repackDerived.exceedsAvailable) throw new Error('La cantidad de origen supera lo disponible')
      if (repackDerived.targetExceedsSource) throw new Error('La cantidad a armar supera la cantidad de origen')
      if (repackDerived.remainder !== null && repackDerived.remainder < -1e-9) throw new Error('Remanente inválido')

      const ok = confirm(
        `Confirmar reempaque\n\n` +
          `Lote: ${selectedRow.batchNumber}\n` +
          `Ubicación: ${selectedRow.warehouse} / ${selectedRow.location}\n\n` +
          `Sacar: ${repackSourceQty} ${sourcePresentation.name} (${repackDerived.baseSource} u.)\n` +
          `Armar: ${repackTargetQty} ${targetPresentation.name} (${repackDerived.baseTarget} u.)\n` +
          `Resto: ${repackDerived.remainder ?? '-'} Unidad\n\n` +
          `Se registrarán movimientos OUT/IN.`,
      )
      if (!ok) return

      return apiFetch(`/api/v1/stock/repack`, {
        token: auth.accessToken,
        method: 'POST',
        body: JSON.stringify({
          productId,
          batchId: selectedRow.batchId,
          locationId: selectedRow.locationId,
          sourcePresentationId: sourcePresentation.id,
          sourceQuantity: srcQty,
          targetPresentationId: targetPresentation.id,
          targetQuantity: tgtQty,
          note: `Reempaque: ${repackSourceQty} ${sourcePresentation.name} -> ${repackTargetQty} ${targetPresentation.name}`,
        }),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['productBatches', 'forMovements', productId] })
      setSelectedStockKey('')
      setRepackSourceQty('')
      setRepackTargetQty('')
      setRepackError('')
      alert('Reempaque realizado exitosamente')
    },
    onError: (err: any) => {
      const msg = err instanceof Error ? err.message : 'Error al reempaquetar'
      setRepackError(msg)
    },
  })

  const createRequestMutation = useMutation({
    mutationFn: () => {
      if (!requestWarehouseId) throw new Error('Seleccioná la sucursal que solicita')

      const combined = new Map<string, { productId: string; presentationId: string; quantity: number }>()
      for (const it of requestItems) {
        const key = `${it.productId}::${it.presentationId}`
        const prev = combined.get(key)
        combined.set(key, prev ? { ...prev, quantity: prev.quantity + it.quantity } : { productId: it.productId, presentationId: it.presentationId, quantity: it.quantity })
      }
      if (requestProductId && requestItem?.presentationId) {
        const key = `${requestProductId}::${requestItem.presentationId}`
        const prev = combined.get(key)
        combined.set(key, prev ? { ...prev, quantity: prev.quantity + requestItem.quantity } : { productId: requestProductId, presentationId: requestItem.presentationId, quantity: requestItem.quantity })
      }

      const items = [...combined.values()].filter((x) => Number.isFinite(x.quantity) && x.quantity > 0)
      if (items.length === 0) throw new Error('Agregá al menos un ítem a la solicitud')

      const payload = {
        warehouseId: requestWarehouseId,
        items,
        note: requestNote.trim() || undefined,
      }

      if (editingRequestId) {
        return updateMovementRequest(auth.accessToken!, editingRequestId, payload)
      }

      return createMovementRequest(auth.accessToken!, payload)
    },
    onSuccess: async () => {
      const wasEditing = !!editingRequestId
      await queryClient.invalidateQueries({ queryKey: ['movementRequests'] })
      setShowCreateRequestModal(false)
      // Only reset warehouse for non-branch-admin users
      if (!permissions.roles.some(r => r.code === 'BRANCH_ADMIN')) {
        setRequestWarehouseId('')
      }
      setEditingRequestId(null)
      setRequestProductId('')
      setRequestItem(null)
      setRequestItems([])
      setRequestPresentationId('')
      setRequestNote('')
      setCreateRequestError('')
      setProductSearchQuery('')
      setShowProductOptions(false)
      alert(wasEditing ? 'Solicitud actualizada exitosamente' : 'Solicitud creada exitosamente')
    },
    onError: (err: any) => {
      const msg = err instanceof Error ? err.message : 'Error al guardar solicitud'
      setCreateRequestError(msg)
    },
  })

  const cancelRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      return cancelMovementRequest(auth.accessToken!, requestId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movementRequests'] })
      alert('Solicitud cancelada')
    },
    onError: (err: any) => {
      const msg = err instanceof Error ? err.message : 'Error al cancelar solicitud'
      alert(msg)
    },
  })

  const openEditRequestModal = (req: MovementRequest) => {
    setEditingRequestId(req.id)
    setCreateRequestError('')

    setRequestWarehouseId(String(req.warehouseId ?? ''))
    setRequestNote(String(req.note ?? ''))

    const nextItems = (req.items ?? [])
      .filter((it) => typeof it.presentationId === 'string' && it.presentationId.length > 0)
      .map((it) => {
        const productLabel = getProductLabel({ sku: it.productSku ?? '', name: it.productName ?? '', genericName: it.genericName })
        const unitsPer = Number(it.presentation?.unitsPerPresentation ?? it.unitsPerPresentation ?? 1)
        const presName = it.presentation?.name ?? it.presentationName
        const presentationLabel = presName
          ? `${presName}${Number.isFinite(unitsPer) && unitsPer > 0 ? ` (${unitsPer}u)` : ''}`
          : String(it.presentationId)

        const qtyFromBackend = it.presentationQuantity === null || it.presentationQuantity === undefined ? null : Number(it.presentationQuantity)
        const derivedQty = Number.isFinite(unitsPer) && unitsPer > 0 ? Math.round(Number(it.requestedQuantity ?? 0) / unitsPer) : Math.round(Number(it.requestedQuantity ?? 0))
        const quantity = Number.isFinite(qtyFromBackend as any) && (qtyFromBackend as number) > 0 ? (qtyFromBackend as number) : derivedQty

        return {
          productId: it.productId,
          productLabel,
          presentationId: it.presentationId as string,
          presentationLabel,
          unitsPerPresentation: Number.isFinite(unitsPer) && unitsPer > 0 ? unitsPer : 1,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        }
      })

    setRequestItems(nextItems)

    setRequestProductId('')
    setRequestItem(null)
    setRequestPresentationId('')
    setRequestQuantity('1')
    setProductSearchQuery('')
    setShowProductOptions(false)

    setShowCreateRequestModal(true)
  }

  const repackCanApply = (() => {
    if (type !== 'REPACK') return false
    if (!productId) return false
    if (!selectedStockKey) return false
    if (presentationsQuery.isLoading) return false

    if (!repackSourcePresentationId || !repackTargetPresentationId) return false
    if (!sourcePresentation || !targetPresentation) return false

    const srcQty = Number(repackSourceQty)
    const tgtQty = Number(repackTargetQty)
    if (!Number.isFinite(srcQty) || srcQty <= 0) return false
    if (!Number.isFinite(tgtQty) || tgtQty <= 0) return false

    if (repackDerived.baseSource === null) return false
    if (repackDerived.baseTarget === null) return false
    if (repackDerived.remainder === null) return false
    if (repackDerived.exceedsAvailable) return false
    if (repackDerived.targetExceedsSource) return false
    if (repackDerived.remainder < -1e-9) return false

    return true
  })()

  const handleCreateBatch = (e: React.FormEvent) => {
    e.preventDefault()
    setCreateBatchError('')

    const trimmedBatchNumber = batchNumber.trim()
    if (!trimmedBatchNumber) {
      setCreateBatchError('Ingresá el código de lote.')
      return
    }

    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setCreateBatchError('Ingresá una cantidad válida (mayor a 0).')
      return
    }

    if (!manufacturingDate) {
      setCreateBatchError('Ingresá la fecha de elaboración.')
      return
    }

    if (!expirationDate) {
      setCreateBatchError('Ingresá la fecha de vencimiento.')
      return
    }

    if (!toWarehouseId) {
      setCreateBatchError('Seleccioná el almacén destino.')
      return
    }

    if (!toLocationId) {
      setCreateBatchError('Seleccioná la ubicación destino.')
      return
    }

    const payload: any = {
      batchNumber: trimmedBatchNumber,
      status: 'RELEASED',
      expiresAt: dateOnlyToUtcIso(expirationDate),
      manufacturingDate: dateOnlyToUtcIso(manufacturingDate),
      initialStock: {
        warehouseId: toWarehouseId,
        quantity: qty,
      },
    }

    batchMutation.mutate(payload)
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="🏢 Movimientos">
        <MovementQuickActions currentPath="/stock/movements" />

        {/* Selector de tipo de movimiento */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <Select
            label="Tipo de Movimiento"
            value={type}
            onChange={(e) => handleTypeChange(e.target.value)}
            options={[
              { value: '', label: 'Selecciona tipo de movimiento' },
              { value: 'IN', label: '📥 Entrada (creación de nuevo lote)' },
              { value: 'TRANSFER', label: '🔄 Transferencia (cambiar ubicación de existencias)' },
              { value: 'REPACK', label: '📦 Reempaque (armar/desarmar presentación)' },
              { value: 'OUT', label: '📤 Salida (venta o baja de existencias)' },
              { value: 'ADJUSTMENT', label: '⚖️ Ajuste (modificar lote)' },
            ]}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <form className="space-y-6">
            {/* ENTRADA */}
            {type === 'IN' && (
              <div className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Crear Nuevo Lote</h3>

                {/* Selector de producto */}
                <Select
                  label="Producto"
                  value={productId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  options={[
                    { value: '', label: 'Selecciona un producto' },
                    ...(productsQuery.data?.items ?? [])
                      .filter((p) => p.isActive)
                      .map((p) => ({ value: p.id, label: getProductLabel(p) })),
                  ]}
                  disabled={productsQuery.isLoading}
                />

                {/* Mostrar existencias actuales si hay producto seleccionado */}
                {productId && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                    <h4 className="mb-3 font-medium text-slate-900 dark:text-slate-100">Existencias Actuales</h4>
                    {productBatchesQuery.isLoading && <Loading />}
                    {productBatchesQuery.error && (
                      <ErrorState
                        message="Error cargando existencias"
                        retry={productBatchesQuery.refetch}
                      />
                    )}
                    {productBatchesQuery.data?.hasStockRead && stockRows.length > 0 && (
                      <Table
                        columns={[
                          { header: 'Lote', accessor: (r) => r.batchNumber },
                          { header: 'Elaboración', accessor: (r) => r.manufacturingDate },
                          { header: 'Vence', accessor: (r) => r.expiresAt },
                          { header: 'Total', accessor: (r) => r.totalQuantity },
                          { header: 'Reservado', accessor: (r) => r.reservedQuantity },
                          { header: 'Disponible', accessor: (r) => r.availableQuantity },
                          { header: 'Ubicación', accessor: (r) => `${r.warehouse} / ${r.location}` },
                        ]}
                        data={stockRows}
                        keyExtractor={(r) => r.id}
                      />
                    )}
                    {productBatchesQuery.data?.hasStockRead && stockRows.length === 0 && (
                      <div className="text-sm text-slate-600 dark:text-slate-400">Sin existencias</div>
                    )}
                  </div>
                )}

                {/* Campos de entrada para nuevo lote */}
                {productId && (
                  <form onSubmit={handleCreateBatch} className="space-y-4">
                    <Input
                      label="Código de lote"
                      value={batchNumber}
                      onChange={(e) => setBatchNumber(e.target.value)}
                      placeholder="Ej: LOT-2026-001"
                      required
                      disabled={batchMutation.isPending}
                    />

                    <Input
                      label="Cantidad"
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="Cantidad a ingresar"
                      required
                      disabled={batchMutation.isPending}
                    />

                    <Input
                      label="Fecha de Elaboración"
                      type="date"
                      value={manufacturingDate}
                      onChange={(e) => setManufacturingDate(e.target.value)}
                      required
                      disabled={batchMutation.isPending}
                    />

                    <Input
                      label="Fecha de Vencimiento"
                      type="date"
                      value={expirationDate}
                      onChange={(e) => setExpirationDate(e.target.value)}
                      required
                      disabled={batchMutation.isPending}
                    />

                    <Select
                      label="Almacén Destino"
                      value={toWarehouseId}
                      onChange={(e) => {
                        setToWarehouseId(e.target.value)
                        setToLocationId('')
                      }}
                      options={[
                        { value: '', label: 'Selecciona almacén' },
                        ...(warehousesQuery.data?.items ?? [])
                          .filter((w) => w.isActive)
                          .map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
                      ]}
                      disabled={warehousesQuery.isLoading || batchMutation.isPending}
                    />

                    {toWarehouseId && (
                      <Select
                        label="Ubicación Destino"
                        value={toLocationId}
                        onChange={(e) => setToLocationId(e.target.value)}
                        options={[
                          { value: '', label: 'Selecciona ubicación' },
                          ...(locationsQuery.data?.items ?? [])
                            .filter((l) => l.isActive)
                            .map((l) => ({ value: l.id, label: l.code })),
                        ]}
                        disabled={locationsQuery.isLoading || batchMutation.isPending}
                      />
                    )}

                    {createBatchError && (
                      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                        {createBatchError}
                      </div>
                    )}

                    <Button type="submit" className="w-full" loading={batchMutation.isPending}>
                      Crear Lote
                    </Button>
                  </form>
                )}
              </div>
            )}

            {/* REEMPAQUE */}
            {type === 'REPACK' && (
              <div className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Reempaque (armar/desarmar)</h3>

                <Select
                  label="Producto"
                  value={productId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  options={[
                    { value: '', label: 'Selecciona un producto' },
                    ...(productsQuery.data?.items ?? [])
                      .filter((p) => p.isActive)
                      .map((p) => ({ value: p.id, label: getProductLabel(p) })),
                  ]}
                  disabled={productsQuery.isLoading}
                />

                {productId && (
                  <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                    <h4 className="mb-3 font-medium text-slate-900 dark:text-slate-100">Seleccionar Lote/Ubicación</h4>

                    {productBatchesQuery.isLoading && <Loading />}
                    {productBatchesQuery.error && (
                      <ErrorState message="Error cargando existencias" retry={productBatchesQuery.refetch} />
                    )}

                    {productBatchesQuery.data?.hasStockRead && selectableStockRows.length > 0 && (
                      <Table
                        columns={[
                          {
                            header: 'Seleccionar',
                            accessor: (r) => (
                              <input
                                type="radio"
                                name="stockSelectionRepack"
                                value={r.id}
                                checked={selectedStockKey === r.id}
                                onChange={(e) => setSelectedStockKey(e.target.value)}
                              />
                            ),
                            className: 'w-16',
                          },
                          { header: 'Lote', accessor: (r) => r.batchNumber },
                          { header: 'Elaboración', accessor: (r) => r.manufacturingDate },
                          { header: 'Vence', accessor: (r) => r.expiresAt },
                          { header: 'Disponible', accessor: (r) => r.availableQuantity },
                          { header: 'Ubicación', accessor: (r) => `${r.warehouse} / ${r.location}` },
                        ]}
                        data={selectableStockRows}
                        keyExtractor={(r) => r.id}
                      />
                    )}

                    {productBatchesQuery.data?.hasStockRead && selectableStockRows.length === 0 && (
                      <div className="text-sm text-slate-600 dark:text-slate-400">Sin existencias disponibles</div>
                    )}
                  </div>
                )}

                {selectedStockKey && (
                  <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    {presentationsQuery.isLoading && <Loading />}
                    {presentationsQuery.error && (
                      <ErrorState message="Error cargando presentaciones" retry={presentationsQuery.refetch} />
                    )}

                    {activePresentations.length > 0 && (
                      <>
                        <div className="grid gap-3 md:grid-cols-4">
                          <Select
                            label="Desde"
                            value={repackSourcePresentationId}
                            onChange={(e) => setRepackSourcePresentationId(e.target.value)}
                            options={[
                              { value: '', label: 'Selecciona presentación' },
                              ...activePresentations.map((p) => ({
                                value: p.id,
                                label: `${p.name} · ${p.unitsPerPresentation} u.`,
                              })),
                            ]}
                            disabled={presentationsQuery.isLoading}
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
                            options={[
                              { value: '', label: 'Selecciona presentación' },
                              ...activePresentations.map((p) => ({
                                value: p.id,
                                label: `${p.name} · ${p.unitsPerPresentation} u.`,
                              })),
                            ]}
                            disabled={presentationsQuery.isLoading}
                          />
                          <Input
                            label="Cantidad a armar"
                            type="number"
                            value={repackTargetQty}
                            onChange={(e) => setRepackTargetQty(e.target.value)}
                            placeholder={repackDerived.maxTarget !== null ? `Máx: ${repackDerived.maxTarget}` : '—'}
                          />
                        </div>

                        <div className="text-xs text-slate-700 dark:text-slate-300">
                          {repackDerived.baseSource !== null ? (
                            <div>
                              Equivale a <span className="font-semibold">{repackDerived.baseSource}</span> unidades base.
                              {repackDerived.availableUnits !== null ? ` Disponibles: ${repackDerived.availableUnits}.` : ''}
                              {repackDerived.exceedsAvailable ? <span className="ml-2 text-red-600">Supera lo disponible.</span> : null}
                            </div>
                          ) : (
                            <div>Ingresá cantidad y presentación de origen para ver conversión.</div>
                          )}

                          {repackDerived.maxTarget !== null && targetPresentation ? (
                            <div>
                              Podés armar hasta <span className="font-semibold">{repackDerived.maxTarget}</span> {targetPresentation.name}.
                            </div>
                          ) : null}

                          {repackDerived.remainder !== null && targetPresentation ? (
                            <div>
                              Remanente: {repackDerived.remainder} Unidad.
                              {repackDerived.targetExceedsSource ? <span className="ml-2 text-red-600">Supera el origen.</span> : null}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              if (repackDerived.maxTarget === null) return
                              setRepackTargetQty(String(Math.max(0, repackDerived.maxTarget)))
                            }}
                            disabled={repackDerived.maxTarget === null}
                          >
                            Usar máximo
                          </Button>

                          <Button
                            type="button"
                            className="w-full"
                            onClick={() => repackMutation.mutate()}
                            loading={repackMutation.isPending}
                            disabled={repackMutation.isPending || !repackCanApply}
                          >
                            Aplicar reempaque
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setRepackSourceQty('')
                              setRepackTargetQty('')
                              setRepackError('')
                            }}
                          >
                            Limpiar
                          </Button>
                        </div>

                        {repackError && (
                          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                            {repackError}
                          </div>
                        )}
                      </>
                    )}

                    {presentationsQuery.data && activePresentations.length === 0 && (
                      <div className="text-sm text-slate-600 dark:text-slate-400">
                        Este producto no tiene presentaciones activas.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TRANSFERENCIA */}
            {type === 'TRANSFER' && (
              <div className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Transferir Existencias</h3>

                {/* Selector de producto */}
                <Select
                  label="Producto"
                  value={productId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  options={[
                    { value: '', label: 'Selecciona un producto' },
                    ...(productsQuery.data?.items ?? [])
                      .filter((p) => p.isActive)
                      .map((p) => ({ value: p.id, label: getProductLabel(p) })),
                  ]}
                  disabled={productsQuery.isLoading}
                />

                {/* Tabla de existencias con radio button */}
                {productId && (
                  <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                    <h4 className="mb-3 font-medium text-slate-900 dark:text-slate-100">Seleccionar Lote/Ubicación</h4>

                    {productBatchesQuery.isLoading && <Loading />}
                    {productBatchesQuery.error && (
                      <ErrorState
                        message="Error cargando existencias"
                        retry={productBatchesQuery.refetch}
                      />
                    )}

                    {productBatchesQuery.data?.hasStockRead && selectableStockRows.length > 0 && (
                      <Table
                        columns={[
                          {
                            header: 'Seleccionar',
                            accessor: (r) => (
                              <input
                                type="radio"
                                name="stockSelection"
                                value={r.id}
                                checked={selectedStockKey === r.id}
                                onChange={(e) => setSelectedStockKey(e.target.value)}
                              />
                            ),
                            className: 'w-16',
                          },
                          { header: 'Lote', accessor: (r) => r.batchNumber },
                          { header: 'Elaboración', accessor: (r) => r.manufacturingDate },
                          { header: 'Vence', accessor: (r) => r.expiresAt },
                          { header: 'Total', accessor: (r) => r.totalQuantity },
                          { header: 'Reservado', accessor: (r) => r.reservedQuantity },
                          { header: 'Disponible', accessor: (r) => r.availableQuantity },
                          { header: 'Ubicación', accessor: (r) => `${r.warehouse} / ${r.location}` },
                        ]}
                        data={selectableStockRows}
                        keyExtractor={(r) => r.id}
                      />
                    )}

                    {productBatchesQuery.data?.hasStockRead && selectableStockRows.length === 0 && (
                      <div className="text-sm text-slate-600 dark:text-slate-400">Sin existencias disponibles</div>
                    )}
                  </div>
                )}

                {/* Opciones de transferencia */}
                {selectedStockKey && (
                  <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-900 dark:text-slate-100">
                        ¿Mover todo el lote?
                      </label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={moveAllStock}
                            onChange={() => setMoveAllStock(true)}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Sí, todo el lote</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={!moveAllStock}
                            onChange={() => setMoveAllStock(false)}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">No, cantidad específica</span>
                        </label>
                      </div>
                    </div>

                    {!moveAllStock && (
                      <Input
                        label="Cantidad a Transferir"
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="Cantidad"
                        required
                      />
                    )}

                    <Select
                      label="Almacén Destino"
                      value={toWarehouseId}
                      onChange={(e) => {
                        setToWarehouseId(e.target.value)
                        setToLocationId('')
                      }}
                      options={[
                        { value: '', label: 'Selecciona almacén' },
                        ...(warehousesQuery.data?.items ?? [])
                          .filter((w) => w.isActive)
                          .map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
                      ]}
                      disabled={warehousesQuery.isLoading}
                    />

                    {toWarehouseId && (
                      <Select
                        label="Ubicación Destino"
                        value={toLocationId}
                        onChange={(e) => setToLocationId(e.target.value)}
                        options={[
                          { value: '', label: 'Selecciona ubicación' },
                          ...(locationsQuery.data?.items ?? [])
                            .filter((l) => l.isActive)
                            .map((l) => ({ value: l.id, label: l.code })),
                        ]}
                        disabled={locationsQuery.isLoading}
                      />
                    )}

                    {toLocationId && (
                      <Button 
                        type="button" 
                        className="w-full"
                        onClick={() => transferMutation.mutate()}
                        loading={transferMutation.isPending}
                        disabled={transferMutation.isPending}
                      >
                        Realizar Transferencia
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SALIDA */}
            {type === 'OUT' && (
              <div className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Registrar Salida de Stock</h3>

                {/* Selector de producto */}
                <Select
                  label="Producto"
                  value={productId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  options={[
                    { value: '', label: 'Selecciona un producto' },
                    ...(productsQuery.data?.items ?? [])
                      .filter((p) => p.isActive)
                      .map((p) => ({ value: p.id, label: getProductLabel(p) })),
                  ]}
                  disabled={productsQuery.isLoading}
                />

                {/* Tabla de lotes con radio button */}
                {productId && (
                  <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                    <h4 className="mb-3 font-medium text-slate-900 dark:text-slate-100">Seleccionar Lote/Ubicación</h4>

                    {productBatchesQuery.isLoading && <Loading />}
                    {productBatchesQuery.error && (
                      <ErrorState
                        message="Error cargando existencias"
                        retry={productBatchesQuery.refetch}
                      />
                    )}

                    {productBatchesQuery.data?.hasStockRead && selectableStockRows.length > 0 && (
                      <Table
                        columns={[
                          {
                            header: 'Seleccionar',
                            accessor: (r) => (
                              <input
                                type="radio"
                                name="stockSelectionOut"
                                value={r.id}
                                checked={selectedStockKey === r.id}
                                onChange={(e) => setSelectedStockKey(e.target.value)}
                              />
                            ),
                            className: 'w-16',
                          },
                          { header: 'Lote', accessor: (r) => r.batchNumber },
                          { header: 'Elaboración', accessor: (r) => r.manufacturingDate },
                          { header: 'Vence', accessor: (r) => r.expiresAt },
                          { header: 'Total', accessor: (r) => r.totalQuantity },
                          { header: 'Reservado', accessor: (r) => r.reservedQuantity },
                          { header: 'Disponible', accessor: (r) => r.availableQuantity },
                          { header: 'Ubicación', accessor: (r) => `${r.warehouse} / ${r.location}` },
                        ]}
                        data={selectableStockRows}
                        keyExtractor={(r) => r.id}
                      />
                    )}

                    {productBatchesQuery.data?.hasStockRead && selectableStockRows.length === 0 && (
                      <div className="text-sm text-slate-600 dark:text-slate-400">Sin existencias disponibles</div>
                    )}
                  </div>
                )}

                {/* Opciones de salida */}
                {selectedStockKey && (
                  <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-900 dark:text-slate-100">
                        ¿Sacar todo el lote?
                      </label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={moveAllStock}
                            onChange={() => setMoveAllStock(true)}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Sí, todo el lote</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={!moveAllStock}
                            onChange={() => setMoveAllStock(false)}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">No, cantidad específica</span>
                        </label>
                      </div>
                    </div>

                    {!moveAllStock && (
                      <Input
                        label="Cantidad a Sacar"
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="Cantidad"
                        required
                      />
                    )}

                    {permissions.isTenantAdmin && (
                      <Input
                        label="Fecha del movimiento"
                        type="date"
                        value={outOccurredDate}
                        onChange={(e) => setOutOccurredDate(e.target.value)}
                        max={new Date().toISOString().slice(0, 10)}
                      />
                    )}

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-900 dark:text-slate-100">
                        Tipo de Salida
                      </label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            value="SALE"
                            checked={outReasonType === 'SALE'}
                            onChange={(e) => {
                              setOutReasonType(e.target.value as 'SALE' | 'DISCARD')
                              setDiscardReason('')
                            }}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Venta</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            value="DISCARD"
                            checked={outReasonType === 'DISCARD'}
                            onChange={(e) => {
                              setOutReasonType(e.target.value as 'SALE' | 'DISCARD')
                              setClientId('')
                            }}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Baja</span>
                        </label>
                      </div>
                    </div>

                    {outReasonType === 'SALE' && (
                      <Select
                        label="Cliente"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        options={[
                          { value: '', label: 'Selecciona cliente' },
                          ...(clientsQuery.data?.items ?? [])
                            .filter((c) => c.isActive)
                            .map((c) => ({ value: c.id, label: c.name })),
                        ]}
                        disabled={clientsQuery.isLoading}
                      />
                    )}

                    {outReasonType === 'DISCARD' && (
                      <Input
                        label="Motivo de la Baja"
                        type="text"
                        value={discardReason}
                        onChange={(e) => setDiscardReason(e.target.value)}
                        placeholder="Ej: Producto dañado, expirado, etc."
                        required
                      />
                    )}

                    {outError && (
                      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                        {outError}
                      </div>
                    )}

                    {((outReasonType === 'SALE' && clientId) || (outReasonType === 'DISCARD' && discardReason)) && (
                      <Button
                        type="button"
                        className="w-full"
                        onClick={() => outMutation.mutate()}
                        loading={outMutation.isPending}
                        disabled={outMutation.isPending}
                      >
                        Registrar Salida
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* AJUSTE */}
            {type === 'ADJUSTMENT' && (
              <div className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Ajustar Lote</h3>

                {/* Selector de producto */}
                <Select
                  label="Producto"
                  value={productId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  options={[
                    { value: '', label: 'Selecciona un producto' },
                    ...(productsQuery.data?.items ?? [])
                      .filter((p) => p.isActive)
                      .map((p) => ({ value: p.id, label: getProductLabel(p) })),
                  ]}
                  disabled={productsQuery.isLoading}
                />

                {/* Tabla de lotes con radio button */}
                {productId && (
                  <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                    <h4 className="mb-3 font-medium text-slate-900 dark:text-slate-100">Seleccionar Lote</h4>

                    {productBatchesQuery.isLoading && <Loading />}
                    {productBatchesQuery.error && (
                      <ErrorState
                        message="Error cargando lotes"
                        retry={productBatchesQuery.refetch}
                      />
                    )}

                    {productBatchesQuery.data?.hasStockRead && stockRows.length > 0 && (
                      <Table
                        columns={[
                          {
                            header: 'Seleccionar',
                            accessor: (r) => (
                              <input
                                type="radio"
                                name="stockSelectionAdj"
                                value={r.id}
                                checked={selectedStockKey === r.id}
                                onChange={(e) => {
                                  setSelectedStockKey(e.target.value)
                                  setAdjustedQuantity(r.totalQuantity)
                                  const mfgDate = r.manufacturingDate ? new Date(r.manufacturingDate).toISOString().split('T')[0] : ''
                                  const expDate = r.expiresAt ? new Date(r.expiresAt).toISOString().split('T')[0] : ''
                                  setAdjustedManufacturingDate(mfgDate)
                                  setAdjustedExpirationDate(expDate)
                                }}
                              />
                            ),
                            className: 'w-16',
                          },
                          { header: 'Lote', accessor: (r) => r.batchNumber },
                          { header: 'Elaboración', accessor: (r) => r.manufacturingDate },
                          { header: 'Vence', accessor: (r) => r.expiresAt },
                          { header: 'Total', accessor: (r) => r.totalQuantity },
                          { header: 'Reservado', accessor: (r) => r.reservedQuantity },
                          { header: 'Disponible', accessor: (r) => r.availableQuantity },
                          { header: 'Ubicación', accessor: (r) => `${r.warehouse} / ${r.location}` },
                        ]}
                        data={stockRows}
                        keyExtractor={(r) => r.id}
                      />
                    )}

                    {productBatchesQuery.data?.hasStockRead && stockRows.length === 0 && (
                      <div className="text-sm text-slate-600 dark:text-slate-400">Sin lotes disponibles</div>
                    )}
                  </div>
                )}

                {/* Formulario de ajuste */}
                {selectedStockKey && (
                  <form className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <Input
                      label="Existencias"
                      type="number"
                      value={adjustedQuantity}
                      onChange={(e) => setAdjustedQuantity(e.target.value)}
                      placeholder="Nueva cantidad"
                      required
                    />

                    <Input
                      label="Fecha de Elaboración"
                      type="date"
                      value={adjustedManufacturingDate}
                      onChange={(e) => setAdjustedManufacturingDate(e.target.value)}
                    />

                    <Input
                      label="Fecha de Vencimiento"
                      type="date"
                      value={adjustedExpirationDate}
                      onChange={(e) => setAdjustedExpirationDate(e.target.value)}
                    />

                    {adjustmentError && (
                      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                        {adjustmentError}
                      </div>
                    )}

                    <Button type="button" className="w-full">
                      Guardar Ajuste
                    </Button>
                  </form>
                )}
              </div>
            )}
          </form>
        </div>

        {/* Solicitudes de movimiento */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">📨 Solicitudes de movimientos</h3>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => setShowCreateRequestModal(true)}>
                Crear solicitud
              </Button>
              <Button variant="secondary" size="sm" onClick={() => movementRequestsQuery.refetch()} loading={movementRequestsQuery.isFetching}>
                Actualizar
              </Button>
            </div>
          </div>

          {movementRequestsQuery.isLoading && <Loading />}
          {movementRequestsQuery.error && <ErrorState message="Error cargando solicitudes" retry={movementRequestsQuery.refetch} />}

          {movementRequestsQuery.data?.items && movementRequestsQuery.data.items.length > 0 && (
            <Table<MovementRequest>
              columns={[
                {
                  header: 'Estado',
                  className: 'wrap text-[13px]',
                  accessor: (r) => {
                    if (r.status === 'OPEN') {
                      const isPartial = (r.items ?? []).some((it) => {
                        const rq = Number(it.requestedQuantity ?? 0)
                        const rem = Number(it.remainingQuantity ?? 0)
                        return Number.isFinite(rq) && Number.isFinite(rem) ? rem < rq - 1e-9 : false
                      })

                      return (
                        <div className="leading-tight">
                          <div>🟡 Pendiente</div>
                          {isPartial && <div className="text-[11px] text-slate-500 dark:text-slate-400">(parcial)</div>}
                        </div>
                      )
                    }

                    if (r.status === 'SENT') return '📤 Enviada'
                    if (r.status === 'FULFILLED') return '✅ Atendida'
                    return '⛔ Cancelada'
                  },
                },
                { header: 'Destino', className: 'text-[13px]', accessor: (r) => r.requestedCity },
                { header: 'Solicitado por', className: 'text-[13px]', accessor: (r) => r.requestedByName ?? '-' },
                { header: 'Fecha', className: 'text-[13px]', accessor: (r) => new Date(r.createdAt).toLocaleString() },
                {
                  header: 'Detalle',
                  className: 'wrap text-[13px]',
                  accessor: (r) => {
                    const lines = (r.items ?? [])
                      .filter((it) => it.remainingQuantity > 0 || r.status !== 'OPEN')
                      .slice(0, 4)
                      .map((it) => {
                        const name = it.productName ?? it.productSku ?? it.productId
                        const remaining = Number(it.remainingQuantity)
                        const requested = Number(it.requestedQuantity)
                        let display = ''
                        const presName = it.presentation?.name ?? it.presentationName
                        if (it.presentationQuantity && presName) {
                          const presQty = Number(it.presentationQuantity)
                          const unitsPer = Number(it.presentation?.unitsPerPresentation ?? it.unitsPerPresentation ?? 1)
                          display = `${presQty.toFixed(0)} ${presName}${Number.isFinite(unitsPer) && unitsPer > 0 ? ` (${unitsPer.toFixed(0)}u)` : ''} de ${name}`
                        } else {
                          const suffix = r.status === 'OPEN' ? `Pendiente: ${remaining} / ${requested}` : `Solicitado: ${requested}`
                          display = `${name} — ${suffix} unidades`
                        }
                        return display
                      })

                    return lines.length ? (
                      <div className="text-sm text-slate-700 dark:text-slate-200">
                        {lines.map((l) => (
                          <div key={l}>{l}</div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-slate-500">-</span>
                    )
                  },
                },
                {
                  header: 'Acciones',
                  className: 'text-right text-[13px]',
                  accessor: (r) => {
                    const isPending = r.status === 'OPEN'
                    const isUnfulfilled = (r.items ?? []).every((it) => {
                      const rq = Number(it.requestedQuantity ?? 0)
                      const rem = Number(it.remainingQuantity ?? 0)
                      return Number.isFinite(rq) && Number.isFinite(rem) ? Math.abs(rem - rq) <= 1e-9 : true
                    })

                    if (!isPending || !isUnfulfilled) return null

                    return (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Editar"
                          icon={<PencilSquareIcon className="w-4 h-4" />}
                          onClick={() => openEditRequestModal(r)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Cancelar"
                          icon={<TrashIcon className="w-4 h-4 text-red-500" />}
                          onClick={() => {
                            const ok = confirm('¿Cancelar esta solicitud?')
                            if (!ok) return
                            cancelRequestMutation.mutate(r.id)
                          }}
                          loading={cancelRequestMutation.isPending}
                        />
                      </div>
                    )
                  },
                },
              ]}
              data={[...movementRequestsQuery.data.items].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
              )}
              keyExtractor={(r) => r.id}
            />
          )}

          {movementRequestsQuery.data?.items && movementRequestsQuery.data.items.length === 0 && (
            <div className="text-sm text-slate-600 dark:text-slate-400">No hay solicitudes.</div>
          )}
        </div>

      </PageContainer>

      <Modal
        isOpen={showCreateRequestModal}
        onClose={() => {
          if (createRequestMutation.isPending) return
          setShowCreateRequestModal(false)
          setEditingRequestId(null)
          setCreateRequestError('')
        }}
        title={editingRequestId ? 'Editar solicitud de movimiento' : 'Crear solicitud de movimiento'}
        maxWidth="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createRequestMutation.mutate()
          }}
          className="space-y-4 max-h-96 overflow-y-auto"
        >
          <Select
            label="Sucursal que solicita"
            value={requestWarehouseId}
            onChange={(e) => setRequestWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'Selecciona una sucursal' },
              ...(requestWarehousesQuery.data?.items ?? [])
                .filter((w) => w.isActive)
                .map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
            ]}
            disabled={requestWarehousesQuery.isLoading || (permissions.hasPermission('scope:branch') && !permissions.isTenantAdmin)}
            required
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Solicitado por
            </label>
            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100">
              {permissions.user?.fullName || permissions.user?.email || 'Usuario desconocido'}
            </div>
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Producto{requestItems.length === 0 ? ' *' : ''}
            </label>
            <input
              type="text"
              value={productSearchQuery}
              onChange={(e) => {
                setProductSearchQuery(e.target.value)
                setShowProductOptions(true)
                if (!e.target.value.trim()) {
                  handleRequestProductChange('')
                }
              }}
              onFocus={() => setShowProductOptions(true)}
              onBlur={() => setTimeout(() => setShowProductOptions(false), 200)}
              placeholder="Buscar producto por nombre, genérico o SKU..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
              disabled={productsQuery.isLoading}
              required={requestItems.length === 0}
            />
            {showProductOptions && filteredProducts.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-900">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="cursor-pointer px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => {
                      setProductSearchQuery(getProductLabel(product))
                      setRequestProductId(product.id)
                      setRequestItem(null)
                      setRequestPresentationId('')
                      setShowProductOptions(false)
                    }}
                  >
                    {getProductLabel(product)}
                  </div>
                ))}
              </div>
            )}
            {productsQuery.isLoading && (
              <div className="mt-1 text-sm text-slate-500">Cargando productos...</div>
            )}
          </div>

          {requestProductId && (
            <div className="space-y-3">
              <h4 className="font-medium text-slate-900 dark:text-slate-100">Presentación solicitada</h4>

              <div className="flex gap-2">
                <Select
                  value={requestPresentationId}
                  onChange={(e) => {
                    const presentationId = e.target.value
                    setRequestPresentationId(presentationId)
                    if (presentationId) {
                      setRequestItem({ presentationId, quantity: Number(requestQuantity) })
                    } else {
                      setRequestItem(null)
                    }
                  }}
                  options={[
                    { value: '', label: 'Selecciona presentación' },
                    ...(requestProductPresentationsQuery.data?.items ?? [])
                      .filter((p) => p.isActive !== false)
                      .map((p) => ({ value: p.id, label: `${p.name} (${p.unitsPerPresentation}u)` })),
                  ]}
                  disabled={requestProductPresentationsQuery.isLoading}
                />
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={requestQuantity}
                  onChange={(e) => {
                    setRequestQuantity(e.target.value)
                    if (requestItem) {
                      setRequestItem({ ...requestItem, quantity: Number(e.target.value) })
                    }
                  }}
                  placeholder="Cant."
                  className="w-20"
                  disabled={requestProductPresentationsQuery.isLoading}
                />
              </div>

              {requestProductPresentationsQuery.isLoading && (
                <p className="text-sm text-slate-600 dark:text-slate-400">Cargando presentaciones...</p>
              )}

              {requestProductPresentationsQuery.error && (
                <p className="text-sm text-red-600">
                  Error cargando presentaciones: {requestProductPresentationsQuery.error instanceof Error ? requestProductPresentationsQuery.error.message : 'Error desconocido'}
                </p>
              )}

              {requestProductPresentationsQuery.data && requestProductPresentationsQuery.data.items.filter(p => p.isActive !== false).length === 0 && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Este producto no tiene presentaciones activas configuradas.
                </p>
              )}

              {requestItem && (
                <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                  {(() => {
                    const presentation = requestProductPresentationsQuery.data?.items.find(p => p.id === requestItem.presentationId)
                    return (
                      <span className="text-sm">
                        {presentation ? `${presentation.name} (${presentation.unitsPerPresentation}u)` : 'Presentación'} - Cantidad: {requestItem.quantity}
                      </span>
                    )
                  })()}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!requestProductId || !requestItem?.presentationId || !(requestItem.quantity > 0)}
                  onClick={() => {
                    const product = productsQuery.data?.items?.find((p) => p.id === requestProductId)
                    const productLabel = product ? getProductLabel(product as any) : requestProductId
                    const pres = requestProductPresentationsQuery.data?.items?.find((p) => p.id === requestItem?.presentationId)
                    const presLabel = pres ? `${pres.name} (${pres.unitsPerPresentation}u)` : requestItem!.presentationId
                    const unitsPer = pres ? Number(pres.unitsPerPresentation ?? 1) : 1

                    setRequestItems((prev) => {
                      const key = `${requestProductId}::${requestItem!.presentationId}`
                      const next = [...prev]
                      const idx = next.findIndex((x) => `${x.productId}::${x.presentationId}` === key)
                      if (idx >= 0) {
                        next[idx] = { ...next[idx], quantity: next[idx].quantity + requestItem!.quantity }
                        return next
                      }
                      next.push({
                        productId: requestProductId,
                        productLabel,
                        presentationId: requestItem!.presentationId,
                        presentationLabel: presLabel,
                        unitsPerPresentation: unitsPer,
                        quantity: requestItem!.quantity,
                      })
                      return next
                    })

                    // Reset draft to allow adding more items quickly
                    setRequestProductId('')
                    setRequestPresentationId('')
                    setRequestQuantity('1')
                    setRequestItem(null)
                    setProductSearchQuery('')
                  }}
                >
                  Agregar ítem
                </Button>
              </div>
            </div>
          )}

          {requestItems.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-2 font-medium text-slate-900 dark:text-slate-100">Ítems agregados</div>
              <div className="space-y-2">
                {requestItems.map((it) => (
                  <div key={`${it.productId}::${it.presentationId}`} className="flex items-center justify-between gap-2">
                    <div className="text-slate-700 dark:text-slate-200">
                      <div className="font-medium">{it.productLabel}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {it.presentationLabel} × {it.quantity}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setRequestItems((prev) => prev.filter((x) => !(x.productId === it.productId && x.presentationId === it.presentationId)))}
                    >
                      Quitar
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Nota (opcional)
            </label>
            <textarea
              value={requestNote}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRequestNote(e.target.value)}
              placeholder="Detalles adicionales de la solicitud"
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
            />
          </div>

          {createRequestError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {createRequestError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (createRequestMutation.isPending) return
                setShowCreateRequestModal(false)
                setEditingRequestId(null)
                setCreateRequestError('')
              }}
              disabled={createRequestMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={createRequestMutation.isPending}
              disabled={!requestWarehouseId || requestItems.length === 0}
            >
              {editingRequestId ? 'Guardar cambios' : 'Crear solicitud'}
            </Button>
          </div>
        </form>
      </Modal>
    </MainLayout>
  )
}
