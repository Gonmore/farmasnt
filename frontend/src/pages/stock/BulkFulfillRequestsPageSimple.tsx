import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MainLayout, PageContainer, Select, Input, Button, Modal } from '../../components'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { useNavigation } from '../../hooks'
import { useAuth } from '../../providers/AuthProvider'
import { apiFetch } from '../../lib/api'

type WarehouseListItem = { id: string; code: string; name: string; city?: string | null; isActive: boolean }

type LocationListItem = { id: string; warehouseId: string; code: string; isActive: boolean }

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
  confirmationStatus?: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  requestedCity: string
  requestedByName: string | null
  note?: string | null
  createdAt: string
  fulfilledAt: string | null
  confirmedAt?: string | null
  confirmationNote?: string | null
  items: MovementRequestItem[]
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch('/api/v1/warehouses?take=100', { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  return apiFetch(`/api/v1/warehouses/${encodeURIComponent(warehouseId)}/locations?take=100`, { token })
}

type StockBatch = {
  id: string
  batchId: string
  batchNumber: string | null
  productId: string
  productName: string | null
  productSku: string | null
  presentationId: string | null
  presentationName: string | null
  unitsPerPresentation: number | null
  quantity: number
  expiryDate: string | null
}

async function listLocationStock(token: string, locationId: string): Promise<{ items: StockBatch[] }> {
  const data = await apiFetch<{ items: any[] }>(`/api/v1/reports/stock/balances-expanded?locationId=${locationId}&take=1000`, { token })
  
  const items: StockBatch[] = data.items
    .filter((item: any) => item.quantity > 0)
    .map((item: any) => {
      // Find the appropriate presentation
      let presentation = null
      if (item.batch?.presentation) {
        presentation = item.batch.presentation
      } else if (item.product?.presentations) {
        // Use default presentation or first one
        presentation = item.product.presentations.find((p: any) => p.isDefault) || item.product.presentations[0]
      }
      
      return {
        id: item.id,
        batchId: item.batchId,
        batchNumber: item.batch?.batchNumber || 'Sin lote',
        productId: item.productId,
        productName: item.product?.name || null,
        productSku: item.product?.sku || null,
        presentationId: presentation?.id || null,
        presentationName: presentation?.name || item.product?.presentationWrapper || null,
        unitsPerPresentation: presentation?.unitsPerPresentation || null,
        quantity: Number(item.quantity),
        expiryDate: item.batch?.expiresAt || null,
      }
    })
  
  return { items }
}

async function listMovementRequests(token: string): Promise<{ items: MovementRequest[] }> {
  const response = await apiFetch<{ items: any[] }>('/api/v1/stock/movement-requests?take=50', { token })
  return {
    items: response.items.map((req: any) => ({
      ...req,
      items: (req.items ?? []).map((item: any) => ({
        ...item,
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
      })),
    })),
  }
}

export function BulkFulfillRequestsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()

  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [fromLocationId, setFromLocationId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [note, setNote] = useState('')
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([])
  const [isFulfillModalOpen, setIsFulfillModalOpen] = useState(false)
  const [batchSelections, setBatchSelections] = useState<Record<string, number>>({})

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'fulfillRequests'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const fromLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'fulfillRequests', 'from', fromWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, fromWarehouseId),
    enabled: !!auth.accessToken && !!fromWarehouseId,
  })

  const toLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'fulfillRequests', 'to', toWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, toWarehouseId),
    enabled: !!auth.accessToken && !!toWarehouseId,
  })

  const locationStockQuery = useQuery({
    queryKey: ['locationStock', fromLocationId],
    queryFn: () => listLocationStock(auth.accessToken!, fromLocationId),
    enabled: !!auth.accessToken && !!fromLocationId && isFulfillModalOpen,
  })

  const movementRequestsQuery = useQuery({
    queryKey: ['movement-requests'],
    queryFn: () => listMovementRequests(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const activeWarehouses = useMemo(
    () => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive),
    [warehousesQuery.data?.items],
  )

  const availableFromWarehouses = activeWarehouses
  const availableToWarehouses = activeWarehouses.filter((w) => w.id !== fromWarehouseId)

  const canSubmit = !!fromWarehouseId && !!fromLocationId && !!toWarehouseId && !!toLocationId

  const filteredRequests = useMemo(() => {
    if (!movementRequestsQuery.data?.items || !toWarehouseId) return []

    return movementRequestsQuery.data.items.filter(
      (request: MovementRequest) =>
        request.status === 'OPEN' &&
        request.requestedCity === activeWarehouses.find((w) => w.id === toWarehouseId)?.city
    )
  }, [movementRequestsQuery.data, toWarehouseId, activeWarehouses])

  const selectedRequests = useMemo(() => {
    return filteredRequests.filter((request: MovementRequest) => selectedRequestIds.includes(request.id))
  }, [filteredRequests, selectedRequestIds])

  const requestedProducts = useMemo(() => {
    const productsMap = new Map()
    
    selectedRequests.forEach((request: MovementRequest) => {
      request.items.forEach((item: MovementRequestItem) => {
        const key = `${item.productId}-${item.presentationId || 'no-presentation'}`
        if (!productsMap.has(key)) {
          productsMap.set(key, {
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            presentationId: item.presentationId,
            presentationName: item.presentationName,
            unitsPerPresentation: item.unitsPerPresentation,
            totalRequested: 0,
            remaining: 0
          })
        }
        const product = productsMap.get(key)
        const presentationQuantity = item.unitsPerPresentation && item.unitsPerPresentation > 0 
          ? Math.ceil(item.requestedQuantity / item.unitsPerPresentation)
          : item.presentationQuantity || item.requestedQuantity
        
        product.totalRequested += presentationQuantity
        product.remaining += presentationQuantity
      })
    })
    
    return Array.from(productsMap.values())
  }, [selectedRequests])

  const availableBatches = useMemo(() => {
    if (!locationStockQuery.data?.items || !requestedProducts.length) return []
    
    const requestedProductIds = new Set(requestedProducts.map(p => p.productId))
    
    return locationStockQuery.data.items.filter(batch => 
      requestedProductIds.has(batch.productId) && batch.quantity > 0
    )
  }, [locationStockQuery.data, requestedProducts])

  const getExpiryColor = (expiryDate: string | null) => {
    if (!expiryDate) return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
    
    const now = new Date()
    const expiry = new Date(expiryDate)
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysUntilExpiry < 0) return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' // Vencido
    if (daysUntilExpiry <= 30) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' // Próximo a vencer
    if (daysUntilExpiry <= 90) return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' // Advertencia
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' // Bueno
  }

  const calculateAutoSelectQuantity = (product: typeof requestedProducts[0], batch: any) => {
    const batchUnitsPerPresentation = parseInt(batch.unitsPerPresentation) || 1
    const productUnitsPerPresentation = product.unitsPerPresentation || 1
    
    // Si el lote tiene la misma presentación que lo solicitado
    if (batch.presentationId === product.presentationId) {
      return Math.min(product.remaining, batch.quantity)
    }
    
    // Si el lote es de unidades individuales (unitsPerPresentation === 1) y el producto tiene presentación empaquetada
    if (batchUnitsPerPresentation === 1 && product.presentationId && productUnitsPerPresentation > 1) {
      const unitsNeeded = product.remaining * productUnitsPerPresentation
      return Math.min(unitsNeeded, batch.quantity)
    }
    
    // Si el lote tiene presentación empaquetada y el producto solicita unidades individuales
    if (batchUnitsPerPresentation > 1 && (!product.presentationId || productUnitsPerPresentation === 1)) {
      const presentationsNeeded = Math.ceil(product.remaining / batchUnitsPerPresentation)
      return Math.min(presentationsNeeded, batch.quantity)
    }
    
    // Si el producto tiene presentación empaquetada y el lote es de unidades individuales
    if (product.presentationId && productUnitsPerPresentation > 1 && batchUnitsPerPresentation === 1) {
      const unitsNeeded = product.remaining * productUnitsPerPresentation
      return Math.min(unitsNeeded, batch.quantity)
    }
    
    // En otros casos, usar la lógica actual (mismas unidades)
    return Math.min(product.remaining, batch.quantity)
  }

  const getQuantityStatus = (product: typeof requestedProducts[0], batch: any) => {
    const batchUnitsPerPresentation = parseInt(batch.unitsPerPresentation) || 1
    const productUnitsPerPresentation = product.unitsPerPresentation || 1
    
    const calculatedQuantity = calculateAutoSelectQuantity(product, batch)
    let requiredQuantity = product.remaining
    
    // Si el lote tiene presentación empaquetada y el producto solicita unidades individuales
    if (batchUnitsPerPresentation > 1 && (!product.presentationId || productUnitsPerPresentation === 1)) {
      requiredQuantity = Math.ceil(product.remaining / batchUnitsPerPresentation)
    }
    // Si el lote es de unidades individuales y el producto tiene presentación empaquetada
    else if (batchUnitsPerPresentation === 1 && product.presentationId && productUnitsPerPresentation > 1) {
      requiredQuantity = product.remaining * productUnitsPerPresentation
    }
    // Si el producto tiene presentación empaquetada y el lote es de unidades individuales
    else if (product.presentationId && productUnitsPerPresentation > 1 && batchUnitsPerPresentation === 1) {
      requiredQuantity = product.remaining * productUnitsPerPresentation
    }
    
    if (calculatedQuantity < requiredQuantity) {
      return 'insufficient' // No hay suficiente cantidad
    }
    return 'sufficient' // Hay suficiente cantidad
  }

  const isExactPresentationMatch = (product: typeof requestedProducts[0], batch: any) => {
    const batchUnitsPerPresentation = parseInt(batch.unitsPerPresentation) || 1
    const productUnitsPerPresentation = product.unitsPerPresentation || 1
    
    // Misma presentación exacta
    if (batch.presentationId === product.presentationId) {
      return true
    }
    
    // Si se solicita unidades individuales y el lote las tiene
    if ((!product.presentationId || productUnitsPerPresentation === 1) && batchUnitsPerPresentation === 1) {
      return true
    }
    
    // Si se solicitan unidades empaquetadas y el lote tiene unidades individuales
    if (product.presentationId && productUnitsPerPresentation > 1 && batchUnitsPerPresentation === 1) {
      return false // No es match exacto, pero sí convertible
    }
    
    // Si se solicita unidades individuales y el lote tiene presentación empaquetada
    if ((!product.presentationId || productUnitsPerPresentation === 1) && batchUnitsPerPresentation > 1) {
      return false // No es match exacto, pero sí convertible
    }
    
    return false
  }

  const convertQuantityToProductPresentation = (quantity: number, batch: any, product: typeof requestedProducts[0]) => {
    const batchUnitsPerPresentation = parseInt(batch.unitsPerPresentation) || 1
    const productUnitsPerPresentation = product.unitsPerPresentation || 1
    
    // Si el lote tiene la misma presentación que el producto
    if (batch.presentationId === product.presentationId) {
      return quantity
    }
    
    // Si el lote es de unidades individuales y el producto tiene presentación empaquetada
    if (batchUnitsPerPresentation === 1 && product.presentationId && productUnitsPerPresentation > 1) {
      // Convertir unidades individuales a presentaciones empaquetadas
      return quantity / productUnitsPerPresentation
    }
    
    // Si el lote tiene presentación empaquetada y el producto solicita unidades individuales
    if (batchUnitsPerPresentation > 1 && (!product.presentationId || productUnitsPerPresentation === 1)) {
      // Convertir presentaciones empaquetadas a unidades individuales
      return quantity * batchUnitsPerPresentation
    }
    
    // Si el producto tiene presentación empaquetada y el lote es de unidades individuales
    if (product.presentationId && productUnitsPerPresentation > 1 && batchUnitsPerPresentation === 1) {
      // Convertir unidades individuales a presentaciones empaquetadas
      return quantity / productUnitsPerPresentation
    }
    
    // En otros casos, devolver la cantidad sin conversión
    return quantity
  }

  const getProductFulfillmentStatus = (product: typeof requestedProducts[0]) => {
    const selectedEquivalentQuantity = Object.entries(batchSelections).reduce((total, [batchId, quantity]) => {
      const batch = availableBatches.find(b => b.id === batchId)
      if (batch && batch.productId === product.productId) {
        const convertedQuantity = convertQuantityToProductPresentation(quantity, batch, product)
        return total + convertedQuantity
      }
      return total
    }, 0)
    
    return selectedEquivalentQuantity >= product.remaining
  }

  const queryClient = useQueryClient()

  const bulkFulfillMutation = useMutation({
    mutationFn: async (data: { 
      fulfillments: Array<{
        requestId: string
        items: Array<{
          productId: string
          batchId: string
          quantity: number
        }>
      }>
      fromLocationId: string
      toLocationId: string
      note?: string 
    }) => {
      return apiFetch('/api/v1/stock/movement-requests/bulk-fulfill', {
        method: 'POST',
        token: auth.accessToken!,
        body: JSON.stringify(data),
      })
    },
    onSuccess: () => {
      // Refrescar las queries para mostrar los cambios
      queryClient.invalidateQueries({ queryKey: ['movement-requests'] })
      // Limpiar la selección después del éxito
      setSelectedRequestIds([])
      setBatchSelections({})
      setNote('')
      setIsFulfillModalOpen(false)
    },
  })

  console.log('BulkFulfillRequestsPage loaded')
  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="✅ Atender solicitudes">
        <MovementQuickActions currentPath="/stock/fulfill-requests" />
        <div className="mb-4 text-sm text-slate-700 dark:text-slate-300">Envía stock a solicitudes OPEN desde un almacén origen a un almacén destino.</div>

        <div className="grid gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="Almacén origen"
                value={fromWarehouseId}
                onChange={(e) => {
                  setFromWarehouseId(e.target.value)
                  setFromLocationId('')
                  // Si el destino era el mismo que el origen, lo limpiamos
                  if (toWarehouseId === e.target.value) {
                    setToWarehouseId('')
                    setToLocationId('')
                  }
                }}
                options={[
                  { value: '', label: 'Selecciona almacén' },
                  ...availableFromWarehouses.map((w) => ({
                    value: w.id,
                    label: `${w.code} - ${w.name}${w.city ? ` (${w.city})` : ''}`,
                  })),
                ]}
                disabled={warehousesQuery.isLoading}
              />

              <Select
                label="Ubicación origen"
                value={fromLocationId}
                onChange={(e) => setFromLocationId(e.target.value)}
                options={[
                  { value: '', label: 'Selecciona ubicación' },
                  ...(fromLocationsQuery.data?.items ?? [])
                    .filter((l) => l.isActive)
                    .map((l) => ({ value: l.id, label: l.code })),
                ]}
                disabled={!fromWarehouseId || fromLocationsQuery.isLoading}
              />

              <Select
                label="Almacén destino"
                value={toWarehouseId}
                onChange={(e) => {
                  setToWarehouseId(e.target.value)
                  setToLocationId('')
                }}
                options={[
                  { value: '', label: 'Selecciona almacén' },
                  ...availableToWarehouses.map((w) => ({
                    value: w.id,
                    label: `${w.code} - ${w.name}${w.city ? ` (${w.city})` : ''}`,
                  })),
                ]}
                disabled={warehousesQuery.isLoading}
              />

              <Select
                label="Ubicación destino"
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
                options={[
                  { value: '', label: 'Selecciona ubicación' },
                  ...(toLocationsQuery.data?.items ?? [])
                    .filter((l) => l.isActive)
                    .map((l) => ({ value: l.id, label: l.code })),
                ]}
                disabled={!toWarehouseId || toLocationsQuery.isLoading}
              />
            </div>

            <div className="mt-3">
              <Input
                label="Nota (opcional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej: Atención de pedidos SCZ"
              />
            </div>

            {/* Multiselect de solicitudes abiertas */}
            {filteredRequests.length > 0 && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Solicitudes a atender
                </label>
                <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-md dark:border-slate-700">
                  {filteredRequests.map((request: MovementRequest) => (
                    <div key={request.id} className="flex items-center p-3 border-b border-slate-100 last:border-b-0 dark:border-slate-700">
                      <input
                        type="checkbox"
                        id={`request-${request.id}`}
                        checked={selectedRequestIds.includes(request.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedRequestIds(prev => [...prev, request.id])
                          } else {
                            setSelectedRequestIds(prev => prev.filter(id => id !== request.id))
                          }
                        }}
                        className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded"
                      />
                      <label htmlFor={`request-${request.id}`} className="flex-1 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1">
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                {request.requestedByName || 'Usuario desconocido'}
                              </span>
                              {request.note && (
                                <span
                                  className="text-xs cursor-help"
                                  title={request.note}
                                >
                                  📝
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {new Date(request.createdAt).toLocaleString('es-ES')}
                            </span>
                          </div>
                          <div className="flex-1 text-xs text-slate-600 dark:text-slate-400 ml-4">
                            {request.items.map((item: MovementRequestItem, index: number) => {
                              const presentationQuantity = item.unitsPerPresentation && item.unitsPerPresentation > 0 
                                ? Math.ceil(item.requestedQuantity / item.unitsPerPresentation)
                                : item.presentationQuantity || item.requestedQuantity;
                              return (
                                <div key={index} className="text-xs">
                                  (<strong>{presentationQuantity}</strong>, {item.presentationName || 'Sin presentación'}{item.unitsPerPresentation ? ` (${item.unitsPerPresentation}u)` : ''} - {item.productName || 'Producto desconocido'})
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
                {selectedRequestIds.length > 0 && (
                  <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                    {selectedRequestIds.length} solicitud{selectedRequestIds.length !== 1 ? 'es' : ''} seleccionada{selectedRequestIds.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Button 
                onClick={() => {
                  setBatchSelections({})
                  setIsFulfillModalOpen(true)
                }}
                disabled={!canSubmit || selectedRequestIds.length === 0}
              >
                Atender {selectedRequestIds.length > 0 ? `${selectedRequestIds.length} solicitud${selectedRequestIds.length !== 1 ? 'es' : ''}` : 'solicitudes'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setFromWarehouseId('')
                  setFromLocationId('')
                  setToWarehouseId('')
                  setToLocationId('')
                  setNote('')
                  setSelectedRequestIds([])
                }}
              >
                Limpiar selección
              </Button>
            </div>

            {bulkFulfillMutation.isError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md dark:bg-red-900/20 dark:border-red-800">
                <div className="text-sm text-red-800 dark:text-red-200">
                  Error al atender solicitudes: {(bulkFulfillMutation.error as any)?.response?.data?.message || 
                    (bulkFulfillMutation.error instanceof Error ? bulkFulfillMutation.error.message : 'Error desconocido')}
                </div>
              </div>
            )}

            {bulkFulfillMutation.isSuccess && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md dark:bg-green-900/20 dark:border-green-800">
                <div className="text-sm text-green-800 dark:text-green-200">
                  ✅ Solicitudes atendidas exitosamente
                </div>
              </div>
            )}
          </div>
        </div>
      </PageContainer>

      <Modal
        isOpen={isFulfillModalOpen}
        onClose={() => {
          setIsFulfillModalOpen(false)
          setBatchSelections({})
        }}
        title={`Transferencia de ${activeWarehouses.find(w => w.id === fromWarehouseId)?.name || 'Origen'} a ${activeWarehouses.find(w => w.id === toWarehouseId)?.name || 'Destino'}`}
        maxWidth="2xl"
      >
        <div className="space-y-6 max-h-96 overflow-y-auto">
          {/* Lo Solicitado */}
          <div className="border border-slate-200 rounded-lg p-4 dark:border-slate-700">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Lo Solicitado</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="w-12 py-2 px-3"></th>
                    <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-300">Producto</th>
                    <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-300">Presentación</th>
                    <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-300">Se requiere</th>
                  </tr>
                </thead>
                <tbody>
                  {requestedProducts.map((product, index) => {
                    const isFulfilled = getProductFulfillmentStatus(product)
                    return (
                      <tr key={index} className="border-b border-slate-100 dark:border-slate-700">
                        <td className="py-3 px-3 text-center">
                          <div className={`inline-flex items-center justify-center w-6 h-6 rounded-full border-2 ${
                            isFulfilled 
                              ? 'border-green-500 bg-green-50 dark:bg-green-900/20' 
                              : 'border-slate-300 bg-slate-50 dark:bg-slate-800 dark:border-slate-600'
                          }`}>
                            <span className={`text-sm ${isFulfilled ? 'text-green-600 dark:text-green-400' : 'text-slate-400 dark:text-slate-500'}`}>
                              ✓
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                            {product.productName || 'Producto desconocido'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                          {product.unitsPerPresentation === 1 
                            ? 'Unidad' 
                            : (product.presentationName || 'Sin presentación') + (product.unitsPerPresentation && product.unitsPerPresentation > 1 ? ` (${product.unitsPerPresentation}u)` : '')}
                        </td>
                        <td className="py-3 px-3">
                          <strong className="text-slate-900 dark:text-slate-100">{product.remaining}</strong>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Lo Seleccionado */}
          <div className="border border-slate-200 rounded-lg p-4 dark:border-slate-700">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Lo Seleccionado</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-300">Producto</th>
                    <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-300">Lote (Vencimiento)</th>
                    <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-300">Presentación</th>
                    <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-300">Disp</th>
                    <th className="text-left py-2 px-3 font-medium text-slate-700 dark:text-slate-300">Selección</th>
                  </tr>
                </thead>
                <tbody>
                  {requestedProducts.map((product) => {
                    const productBatches = availableBatches.filter(batch => batch.productId === product.productId)
                    
                    return (
                      <React.Fragment key={product.productId}>
                        {/* Línea arriba del producto */}
                        <tr>
                          <td colSpan={5} className="py-1">
                            <div className="border-b-4 border-blue-500"></div>
                          </td>
                        </tr>

                        {/* Fila principal del producto */}
                        <tr className="bg-slate-50 dark:bg-slate-800">
                          <td className="py-3 px-3" rowSpan={productBatches.length || 1}>
                            <div>
                              <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                                {product.productName || 'Producto desconocido'}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {product.productSku || 'Sin SKU'}
                              </div>
                            </div>
                          </td>
                          {productBatches.length === 0 ? (
                            <>
                              <td className="py-3 px-3 text-slate-500 dark:text-slate-400 italic" colSpan={4}>
                                No hay lotes disponibles
                              </td>
                            </>
                          ) : (
                            <>
                              {/* Primera fila del lote */}
                              <td className="py-3 px-3">
                                <div>
                                  <div className="text-xs text-slate-700 dark:text-slate-300">
                                    {productBatches[0].batchNumber}
                                  </div>
                                  <div className={`text-xs px-2 py-1 rounded-full inline-block ${getExpiryColor(productBatches[0].expiryDate)}`}>
                                    {productBatches[0].expiryDate ? new Date(productBatches[0].expiryDate).toLocaleDateString('es-ES') : 'Sin fecha'}
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                <div className="text-xs text-slate-700 dark:text-slate-300">
                                  {productBatches[0].unitsPerPresentation === 1 
                                    ? 'Unidad' 
                                    : (productBatches[0].presentationName || 'Sin presentación') + (productBatches[0].unitsPerPresentation && productBatches[0].unitsPerPresentation > 1 ? ` (${productBatches[0].unitsPerPresentation}u)` : '')}
                                  {isExactPresentationMatch(product, productBatches[0]) && (
                                    <span className="ml-1 text-yellow-500">⭐</span>
                                  )}
                                  {getQuantityStatus(product, productBatches[0]) === 'insufficient' && (
                                    <span className="ml-1 text-red-500 text-xs" title="Cantidad insuficiente">⚠️</span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                                {productBatches[0].quantity}
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={!!batchSelections[productBatches[0].id]}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setBatchSelections(prev => ({
                                          ...prev,
                                          [productBatches[0].id]: calculateAutoSelectQuantity(product, productBatches[0])
                                        }))
                                      } else {
                                        setBatchSelections(prev => {
                                          const newSelections = { ...prev }
                                          delete newSelections[productBatches[0].id]
                                          return newSelections
                                        })
                                      }
                                    }}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded"
                                  />
                                  <Input
                                    type="number"
                                    value={batchSelections[productBatches[0].id] || ''}
                                    onChange={(e) => {
                                      const value = parseInt(e.target.value) || 0
                                      setBatchSelections(prev => ({
                                        ...prev,
                                        [productBatches[0].id]: Math.min(value, productBatches[0].quantity)
                                      }))
                                    }}
                                    disabled={!batchSelections[productBatches[0].id]}
                                    min="0"
                                    max={productBatches[0].quantity}
                                    className="w-20"
                                    placeholder="0"
                                  />
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                        
                        {/* Filas adicionales de lotes */}
                        {productBatches.slice(1).map((batch) => (
                          <tr key={batch.id} className="border-b border-slate-100 dark:border-slate-700">
                            <td className="py-3 px-3">
                              <div>
                                <div className="text-xs text-slate-700 dark:text-slate-300">
                                  {batch.batchNumber}
                                </div>
                                <div className={`text-xs px-2 py-1 rounded-full inline-block ${getExpiryColor(batch.expiryDate)}`}>
                                  {batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString('es-ES') : 'Sin fecha'}
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="text-xs text-slate-700 dark:text-slate-300">
                                  {batch.unitsPerPresentation === 1 
                                    ? 'Unidad' 
                                    : (batch.presentationName || 'Sin presentación') + (batch.unitsPerPresentation && batch.unitsPerPresentation > 1 ? ` (${batch.unitsPerPresentation}u)` : '')}
                                {isExactPresentationMatch(product, batch) && (
                                  <span className="ml-1 text-yellow-500">⭐</span>
                                )}
                                {getQuantityStatus(product, batch) === 'insufficient' && (
                                  <span className="ml-1 text-red-500 text-xs" title="Cantidad insuficiente">⚠️</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                              {batch.quantity}
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={!!batchSelections[batch.id]}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setBatchSelections(prev => ({
                                        ...prev,
                                        [batch.id]: calculateAutoSelectQuantity(product, batch)
                                      }))
                                    } else {
                                      setBatchSelections(prev => {
                                        const newSelections = { ...prev }
                                        delete newSelections[batch.id]
                                        return newSelections
                                      })
                                    }
                                  }}
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded"
                                />
                                <Input
                                  type="number"
                                  value={batchSelections[batch.id] || ''}
                                  onChange={(e) => {
                                    const value = parseInt(e.target.value) || 0
                                    setBatchSelections(prev => ({
                                      ...prev,
                                      [batch.id]: Math.min(value, batch.quantity)
                                    }))
                                  }}
                                  disabled={!batchSelections[batch.id]}
                                  min="0"
                                  max={batch.quantity}
                                  className="w-20"
                                  placeholder="0"
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}

                  {/* Línea final abajo de todos los productos */}
                  <tr>
                    <td colSpan={5} className="py-1">
                      <div className="border-b-4 border-blue-500"></div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
          <Button variant="secondary" onClick={() => setIsFulfillModalOpen(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={() => {
              // Preparar los datos para el fulfillment parcial
              const fulfillments: Array<{
                requestId: string
                items: Array<{
                  productId: string
                  batchId: string
                  quantity: number
                }>
              }> = []

              // Agrupar las selecciones por solicitud
              const selectionsByRequest: Record<string, Array<{
                productId: string
                batchId: string
                quantity: number
              }>> = {}

              Object.entries(batchSelections).forEach(([batchId, quantity]) => {
                const batch = availableBatches.find(b => b.id === batchId)
                if (batch && quantity > 0) {
                  // Encontrar qué solicitud contiene este producto
                  const request = movementRequestsQuery.data?.items.find(req => 
                    req.items.some(item => item.productId === batch.productId)
                  )
                  
                  if (request) {
                    if (!selectionsByRequest[request.id]) {
                      selectionsByRequest[request.id] = []
                    }
                    
                    selectionsByRequest[request.id].push({
                      productId: batch.productId,
                      batchId: batch.id,
                      quantity: quantity
                    })
                  }
                }
              })

              // Convertir a formato de fulfillments
              Object.entries(selectionsByRequest).forEach(([requestId, items]) => {
                fulfillments.push({
                  requestId,
                  items
                })
              })

              bulkFulfillMutation.mutate({
                fulfillments,
                fromLocationId,
                toLocationId,
                note
              })
            }}
            disabled={Object.keys(batchSelections).length === 0 || bulkFulfillMutation.isPending}
          >
            {bulkFulfillMutation.isPending ? 'Procesando...' : 'Confirmar Transferencia'}
          </Button>
        </div>
      </Modal>
    </MainLayout>
  )
}