import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getProductLabel } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Select, Input, Button, Table, Loading, ErrorState, Modal } from '../../components'
import { useNavigation } from '../../hooks'

function QuickActionCard(props: { to: string; title: string; subtitle: string; icon: string }) {
  return (
    <Link
      to={props.to}
      className="group rounded-lg border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-600 dark:hover:bg-slate-800"
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl">{props.icon}</div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 group-hover:text-blue-900 dark:text-slate-100 dark:group-hover:text-blue-200">
            {props.title}
          </div>
          <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{props.subtitle}</div>
        </div>
      </div>
    </Link>
  )
}

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
}

type MovementRequest = {
  id: string
  status: 'OPEN' | 'FULFILLED' | 'CANCELLED'
  requestedCity: string
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
  commercialName: string
  fiscalName: string
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
  return apiFetch(`/api/v1/clients?take=100`, { token })
}

async function fetchProductPresentations(token: string, productId: string): Promise<{ items: ProductPresentation[] }> {
  return apiFetch(`/api/v1/products/${productId}/presentations`, { token })
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
        presentationId: item.presentationId ?? item.presentation?.id ?? null,
        presentationName: item.presentationName ?? item.presentation?.name ?? null,
        unitsPerPresentation: item.unitsPerPresentation ?? item.presentation?.unitsPerPresentation ?? null,
      })),
    })),
  }
}

async function createMovementRequest(
  token: string,
  data: {
    warehouseId: string
    requestedByName: string
    productId: string
    items: { presentationId: string; quantity: number }[]
    note?: string
  },
): Promise<MovementRequest> {
  return apiFetch('/api/v1/stock/movement-requests', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

function dateOnlyToUtcIso(dateString: string): string {
  const [year, month, day] = dateString.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day)).toISOString().split('T')[0]
}

export function MovementsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()

  const [type, setType] = useState('')
  const [productId, setProductId] = useState('')
  const [selectedStockKey, setSelectedStockKey] = useState('')
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
  const [requestWarehouseId, setRequestWarehouseId] = useState('')
  const [requestRequestedByName, setRequestRequestedByName] = useState('')
  const [requestProductId, setRequestProductId] = useState('')
  const [requestItems, setRequestItems] = useState<{ presentationId: string; quantity: number }[]>([])
  const [requestNote, setRequestNote] = useState('')
  const [createRequestError, setCreateRequestError] = useState('')

  const productsQuery = useQuery({
    queryKey: ['products', 'forMovements'],
    queryFn: () => fetchProducts(auth.accessToken!),
    enabled: !!auth.accessToken && !!type,
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

  const batchMutation = useMutation({
    mutationFn: (data: {
      batchNumber?: string
      expiresAt?: string
      manufacturingDate?: string
      status: string
      initialStock?: { warehouseId: string; quantity: number; note?: string }
    }) => createBatch(auth.accessToken!, productId, data),
    onSuccess: () => {
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
    setQuantity('')

    setRepackSourcePresentationId('')
    setRepackSourceQty('')
    setRepackTargetPresentationId('')
    setRepackTargetQty('')
    setRepackError('')
  }

  const handleRequestProductChange = (nextProductId: string) => {
    setRequestProductId(nextProductId)
    setRequestItems([])
  }

  const handleAddRequestItem = (presentationId: string, quantity: number) => {
    if (!presentationId || quantity <= 0) return
    setRequestItems(prev => {
      const existing = prev.find(item => item.presentationId === presentationId)
      if (existing) {
        return prev.map(item =>
          item.presentationId === presentationId
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      } else {
        return [...prev, { presentationId, quantity }]
      }
    })
  }

  const handleRemoveRequestItem = (presentationId: string) => {
    setRequestItems(prev => prev.filter(item => item.presentationId !== presentationId))
  }

  const handleUpdateRequestItemQuantity = (presentationId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveRequestItem(presentationId)
    } else {
      setRequestItems(prev => prev.map(item =>
        item.presentationId === presentationId
          ? { ...item, quantity }
          : item
      ))
    }
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
      if (!requestRequestedByName.trim()) throw new Error('Ingresá el nombre de quien solicita')
      if (!requestProductId) throw new Error('Seleccioná un producto')
      if (requestItems.length === 0) throw new Error('Agregá al menos una presentación solicitada')

      return createMovementRequest(auth.accessToken!, {
        warehouseId: requestWarehouseId,
        requestedByName: requestRequestedByName.trim(),
        productId: requestProductId,
        items: requestItems,
        note: requestNote.trim() || undefined,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movementRequests'] })
      setShowCreateRequestModal(false)
      setRequestWarehouseId('')
      setRequestRequestedByName('')
      setRequestProductId('')
      setRequestItems([])
      setRequestNote('')
      setCreateRequestError('')
      alert('Solicitud creada exitosamente')
    },
    onError: (err: any) => {
      const msg = err instanceof Error ? err.message : 'Error al crear solicitud'
      setCreateRequestError(msg)
    },
  })

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

  // Calcular el próximo número de lote
  const nextBatchNumber = (() => {
    if (!productBatchesQuery.data?.items) return '001'
    const batches = productBatchesQuery.data.items
    if (batches.length === 0) return '001'
    const numbers = batches
      .map((b) => {
        const match = b.batchNumber.match(/(\d+)$/)
        return match ? parseInt(match[1], 10) : 0
      })
      .filter((n) => n > 0)
    const maxNumber = Math.max(...numbers, 0)
    return String(maxNumber + 1).padStart(3, '0')
  })()

  const handleCreateBatch = (e: React.FormEvent) => {
    e.preventDefault()
    setCreateBatchError('')

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
        <div className="mb-6">
          <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Accesos rápidos</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickActionCard
              to="/stock/movements"
              icon="🚚"
              title="Movimientos"
              subtitle="Entradas, transferencias, bajas, ajustes"
            />
            <QuickActionCard
              to="/stock/bulk-transfer"
              icon="📦"
              title="Transferencia masiva"
              subtitle="Mover múltiples líneas en una operación"
            />
            <QuickActionCard
              to="/stock/fulfill-requests"
              icon="✅"
              title="Atender solicitudes"
              subtitle="Enviar stock a solicitudes OPEN"
            />
            <QuickActionCard
              to="/stock/returns"
              icon="↩️"
              title="Devoluciones"
              subtitle="Registrar devoluciones con evidencia"
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <form className="space-y-6">
            {/* Selector de tipo - Siempre visible */}
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
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Próximo lote: <span className="font-semibold text-slate-900 dark:text-slate-100">{nextBatchNumber}</span>
                      </p>
                    </div>

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
                            .map((c) => ({ value: c.id, label: c.commercialName || c.fiscalName })),
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
                      <Button type="button" className="w-full">
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
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
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
                  accessor: (r) => (r.status === 'OPEN' ? '🟡 Pendiente' : r.status === 'FULFILLED' ? '✅ Atendida' : '⛔ Cancelada'),
                },
                { header: 'Destino', accessor: (r) => r.requestedCity },
                { header: 'Solicitado por', accessor: (r) => r.requestedByName ?? '-' },
                { header: 'Fecha', accessor: (r) => new Date(r.createdAt).toLocaleString() },
                {
                  header: 'Detalle',
                  accessor: (r) => {
                    const lines = (r.items ?? [])
                      .filter((it) => it.remainingQuantity > 0 || r.status !== 'OPEN')
                      .slice(0, 4)
                      .map((it) => {
                        const name = it.productName ?? it.productSku ?? it.productId
                        const remaining = Number(it.remainingQuantity)
                        const requested = Number(it.requestedQuantity)
                        let display = ''
                        if (it.presentationQuantity && it.presentationName) {
                          const presQty = Number(it.presentationQuantity)
                          const unitsPer = Number(it.unitsPerPresentation || 1)
                          if (r.status === 'OPEN') {
                            // Mostrar tal cual fue solicitado: cantidad + presentación + (unidades por presentación)
                            display = `${presQty.toFixed(0)} ${it.presentationName} (${unitsPer.toFixed(0)}u) de ${name}`
                          } else {
                            display = `${presQty.toFixed(0)} ${it.presentationName} (${unitsPer.toFixed(0)}u) de ${name}`
                          }
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
              ]}
              data={movementRequestsQuery.data.items}
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
        onClose={() => setShowCreateRequestModal(false)}
        title="Crear solicitud de movimiento"
        maxWidth="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createRequestMutation.mutate()
          }}
          className="space-y-4"
        >
          <Select
            label="Sucursal que solicita"
            value={requestWarehouseId}
            onChange={(e) => setRequestWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'Selecciona una sucursal' },
              ...(warehousesQuery.data?.items ?? [])
                .filter((w) => w.isActive)
                .map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
            ]}
            disabled={warehousesQuery.isLoading}
            required
          />

          <Input
            label="Solicitado por"
            type="text"
            value={requestRequestedByName}
            onChange={(e) => setRequestRequestedByName(e.target.value)}
            placeholder="Nombre de la persona que solicita"
            required
          />

          <Select
            label="Producto"
            value={requestProductId}
            onChange={(e) => handleRequestProductChange(e.target.value)}
            options={[
              { value: '', label: 'Selecciona un producto' },
              ...(productsQuery.data?.items ?? [])
                .filter((p) => p.isActive)
                .map((p) => ({ value: p.id, label: getProductLabel(p) })),
            ]}
            disabled={productsQuery.isLoading}
            required
          />

          {requestProductId && (
            <div className="space-y-3">
              <h4 className="font-medium text-slate-900 dark:text-slate-100">Presentaciones solicitadas</h4>

              <div className="flex gap-2">
                <Select
                  value=""
                  onChange={(e) => {
                    const presentationId = e.target.value
                    if (presentationId) {
                      const presentation = requestProductPresentationsQuery.data?.items.find(p => p.id === presentationId)
                      if (presentation) {
                        handleAddRequestItem(presentationId, 1)
                      }
                    }
                  }}
                  options={[
                    { value: '', label: 'Selecciona presentación' },
                    ...(requestProductPresentationsQuery.data?.items ?? [])
                      .filter((p) => p.isActive)
                      .map((p) => ({ value: p.id, label: `${p.name} (${p.unitsPerPresentation}u)` })),
                  ]}
                  disabled={requestProductPresentationsQuery.isLoading}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const firstPresentation = requestProductPresentationsQuery.data?.items.find(p => p.isActive)
                    if (firstPresentation) {
                      handleAddRequestItem(firstPresentation.id, 1)
                    }
                  }}
                  disabled={!requestProductPresentationsQuery.data?.items.some(p => p.isActive)}
                >
                  + Agregar
                </Button>
              </div>

              {requestItems.length > 0 && (
                <div className="space-y-2">
                  {requestItems.map((item) => {
                    const presentation = requestProductPresentationsQuery.data?.items.find(p => p.id === item.presentationId)
                    return (
                      <div key={item.presentationId} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded">
                        <span className="flex-1 text-sm">
                          {presentation ? `${presentation.name} (${presentation.unitsPerPresentation}u)` : 'Presentación'}
                        </span>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) => handleUpdateRequestItemQuantity(item.presentationId, Number(e.target.value))}
                          className="w-20"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRemoveRequestItem(item.presentationId)}
                        >
                          ✕
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
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
              onClick={() => setShowCreateRequestModal(false)}
              disabled={createRequestMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={createRequestMutation.isPending}
              disabled={!requestWarehouseId || !requestRequestedByName.trim() || !requestProductId || requestItems.length === 0}
            >
              Crear solicitud
            </Button>
          </div>
        </form>
      </Modal>
    </MainLayout>
  )
}
