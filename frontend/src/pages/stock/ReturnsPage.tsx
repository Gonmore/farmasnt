import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { formatDateOnlyUtc } from '../../lib/date'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Button, Modal, Input, Select, Loading, ErrorState, EmptyState } from '../../components'
import { useNavigation } from '../../hooks'
import { getProductLabel } from '../../lib/productName'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { EyeIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { useNotifications } from '../../providers/NotificationsProvider'

type WarehouseListItem = {
  id: string
  code: string
  name: string
  city?: string | null
  isActive: boolean
}

type LocationListItem = {
  id: string
  warehouseId: string
  code: string
  isActive: boolean
}

type ProductListItem = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  isActive: boolean
}

type ProductPresentation = {
  id: string
  name: string
  unitsPerPresentation: string
  isDefault?: boolean
  isActive?: boolean
}

type ProductBatch = {
  id: string
  batchNumber: string
  expiresAt: string | null
  status: string
}

type StockReturnItem = {
  id: string
  productId: string
  sku: string | null
  name: string | null
  genericName: string | null
  batchId: string | null
  batchNumber: string | null
  expiresAt: string | null
  quantity: string
  presentationId: string | null
  presentationName: string | null
  unitsPerPresentation: string | null
  presentationQuantity: string | null
}

type StockReturn = {
  id: string
  reason: string
  note: string | null
  photoUrl: string | null
  createdAt: string
  toLocation: {
    id: string
    code: string
    warehouse: { id: string; code: string | null; name: string | null; city: string | null }
  }
  items: StockReturnItem[]
}

async function listSentMovementRequests(token: string): Promise<{ items: any[] }> {
  const take = '50'
  const fetchByStatus = async (status: 'SENT' | 'OPEN') => {
    const params = new URLSearchParams({ take, status })
    return apiFetch(`/api/v1/stock/movement-requests?${params.toString()}`, { token }) as Promise<{ items: any[] }>
  }

  const [sent, open] = await Promise.all([fetchByStatus('SENT'), fetchByStatus('OPEN')])

  const withPendingShipments = (r: any) => {
    const ms = Array.isArray(r?.movements) ? r.movements : []
    const pending = ms.reduce((sum: number, m: any) => sum + Number(m?.pendingQuantity ?? 0), 0)
    return pending > 0
  }

  // Sent: fully shipped, pending reception/return.
  // Open: partial shipments (only include if there is something shipped pending).
  const merged = [...(sent.items ?? []).filter(withPendingShipments), ...(open.items ?? []).filter(withPendingShipments)]

  const dedup = new Map<string, any>()
  for (const r of merged) {
    const id = String(r?.id ?? '')
    if (!id) continue
    dedup.set(id, r)
  }

  return { items: Array.from(dedup.values()) }
}

async function listReturns(token: string): Promise<{ items: StockReturn[] }> {
  return apiFetch('/api/v1/stock/returns?take=50', { token })
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch('/api/v1/warehouses?take=100', { token })
}

async function listLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  return apiFetch(`/api/v1/warehouses/${encodeURIComponent(warehouseId)}/locations?take=100`, { token })
}

async function fetchProducts(token: string): Promise<{ items: ProductListItem[] }> {
  return apiFetch('/api/v1/products?take=200', { token })
}

async function fetchProductPresentations(token: string, productId: string): Promise<{ items: ProductPresentation[] }> {
  return apiFetch(`/api/v1/products/${encodeURIComponent(productId)}/presentations`, { token })
}

async function fetchProductBatches(token: string, productId: string): Promise<{ items: ProductBatch[] }> {
  return apiFetch(`/api/v1/products/${encodeURIComponent(productId)}/batches?take=50`, { token })
}

async function presignReturnPhoto(token: string, fileName: string, contentType: string): Promise<{ uploadUrl: string; publicUrl: string; key: string; method: string }> {
  return apiFetch('/api/v1/stock/returns/photo-upload', {
    token,
    method: 'POST',
    body: JSON.stringify({ fileName, contentType }),
  })
}

async function uploadToPresignedUrl(uploadUrl: string, file: File, contentType: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  })
  if (!res.ok) throw new Error('No se pudo subir la foto')
}

async function confirmReception(token: string, requestId: string): Promise<{ message: string }> {
  return apiFetch(`/api/v1/stock/movement-requests/${encodeURIComponent(requestId)}/receive`, {
    token,
    method: 'POST',
  })
}

async function returnShipment(
  token: string,
  requestId: string,
  input: { mode: 'ALL' | 'PARTIAL'; reason: string; items?: Array<{ outMovementId: string; quantity: number }> },
): Promise<{ message: string }> {
  return apiFetch(`/api/v1/stock/movement-requests/${encodeURIComponent(requestId)}/return`, {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  })
}

async function createReturn(
  token: string,
  input: {
    toLocationId: string
    reason: string
    photoKey: string
    photoUrl: string
    note?: string
    items: Array<{ productId: string; batchId?: string | null; presentationId?: string; presentationQuantity?: number; quantity?: number; note?: string }>
  },
): Promise<{ id: string; createdAt: string }> {
  return apiFetch('/api/v1/stock/returns', {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function ReturnsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()
  const notifications = useNotifications()

  const returnsQuery = useQuery({
    queryKey: ['stockReturns'],
    queryFn: () => listReturns(auth.accessToken!),
    enabled: !!auth.accessToken,
    refetchInterval: 15_000,
  })

  const sentRequestsQuery = useQuery({
    queryKey: ['sentMovementRequests'],
    queryFn: () => listSentMovementRequests(auth.accessToken!),
    enabled: !!auth.accessToken,
    refetchInterval: 15_000,
  })

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'forReturns'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const productsQuery = useQuery({
    queryKey: ['products', 'forReturns'],
    queryFn: () => fetchProducts(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const activeWarehouses = useMemo(() => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive), [warehousesQuery.data])
  const activeProducts = useMemo(() => (productsQuery.data?.items ?? []).filter((p) => p.isActive), [productsQuery.data])

  const [activeTab, setActiveTab] = useState<'returns' | 'receptions'>('receptions')

  const [selectedRequest, setSelectedRequest] = useState<any>(null)
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [returnMode, setReturnMode] = useState<'ALL' | 'PARTIAL'>('ALL')
  const [returnReason, setReturnReason] = useState('')
  const [returnItems, setReturnItems] = useState<Record<string, number>>({})

  const sortedReturns = useMemo(() => {
    const items = returnsQuery.data?.items ?? []
    return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [returnsQuery.data?.items])

  const sortedSentRequests = useMemo(() => {
    const items = sentRequestsQuery.data?.items ?? []
    return [...items].sort(
      (a, b) =>
        new Date(b.fulfilledAt || b.createdAt).getTime() - new Date(a.fulfilledAt || a.createdAt).getTime(),
    )
  }, [sentRequestsQuery.data?.items])

  const pendingMovements = useMemo(() => {
    const ms = Array.isArray(selectedRequest?.movements) ? selectedRequest.movements : []
    return ms
      .map((m: any) => ({ ...m, pendingQuantity: Number(m?.pendingQuantity ?? 0) }))
      .filter((m: any) => m.pendingQuantity > 0)
  }, [selectedRequest])

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [warehouseId, setWarehouseId] = useState('')
  const locationsQuery = useQuery({
    queryKey: ['locations', 'forReturns', warehouseId],
    queryFn: () => listLocations(auth.accessToken!, warehouseId),
    enabled: !!auth.accessToken && !!warehouseId,
  })
  const activeLocations = useMemo(() => (locationsQuery.data?.items ?? []).filter((l) => l.isActive), [locationsQuery.data])

  const [toLocationId, setToLocationId] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  const [photoFile, setPhotoFile] = useState<File | null>(null)

  // Add-item form
  const [itemProductId, setItemProductId] = useState('')
  const [itemBatchId, setItemBatchId] = useState<string>('')
  const [itemPresentationId, setItemPresentationId] = useState('')
  const [itemPresentationQty, setItemPresentationQty] = useState<number>(1)
  const [itemNote, setItemNote] = useState('')

  const itemPresentationsQuery = useQuery({
    queryKey: ['productPresentations', 'forReturnItem', itemProductId],
    queryFn: () => fetchProductPresentations(auth.accessToken!, itemProductId),
    enabled: !!auth.accessToken && !!itemProductId,
  })

  const itemBatchesQuery = useQuery({
    queryKey: ['productBatches', 'forReturnItem', itemProductId],
    queryFn: () => fetchProductBatches(auth.accessToken!, itemProductId),
    enabled: !!auth.accessToken && !!itemProductId,
  })

  const abbreviateCity = (city: string) => {
    if (!city) return '—'
    const upper = city.toUpperCase()
    if (upper.includes('COCHABAMBA')) return 'CBBA'
    if (upper.includes('LA PAZ')) return 'LPZ'
    if (upper.includes('SANTA CRUZ')) return 'SCZ'
    if (upper.includes('ORURO')) return 'ORU'
    if (upper.includes('POTOSI')) return 'PTS'
    if (upper.includes('SUCRE')) return 'SCR'
    if (upper.includes('TARIJA')) return 'TJA'
    if (upper.includes('PANDO')) return 'PND'
    if (upper.includes('BENI')) return 'BNI'
    return upper.slice(0, 3)
  }

  const activeItemPresentations = useMemo(
    () => (itemPresentationsQuery.data?.items ?? []).filter((p) => (p.isActive ?? true) === true),
    [itemPresentationsQuery.data],
  )

  const defaultPresentationId = useMemo(() => {
    const defaults = activeItemPresentations.filter((p) => p.isDefault)
    return (defaults[0]?.id ?? activeItemPresentations[0]?.id ?? '')
  }, [activeItemPresentations])

  const [items, setItems] = useState<Array<{ productId: string; batchId: string | null; presentationId: string | null; presentationQuantity: number | null; note?: string }>>([])

  const productById = useMemo(() => {
    const m = new Map<string, ProductListItem>()
    for (const p of activeProducts) m.set(p.id, p)
    return m
  }, [activeProducts])

  const addItem = () => {
    setCreateError(null)
    if (!itemProductId) {
      setCreateError('Seleccioná un producto')
      return
    }

    const p = productById.get(itemProductId)
    if (!p) {
      setCreateError('Producto inválido')
      return
    }

    const hasPresentations = activeItemPresentations.length > 0
    const presId = (itemPresentationId || defaultPresentationId || '').trim()

    if (hasPresentations && !presId) {
      setCreateError('Seleccioná una presentación')
      return
    }

    if (!Number.isFinite(itemPresentationQty) || itemPresentationQty <= 0) {
      setCreateError('Ingresá una cantidad válida')
      return
    }

    setItems((prev) => [
      ...prev,
      {
        productId: itemProductId,
        batchId: itemBatchId ? itemBatchId : null,
        presentationId: hasPresentations ? presId : null,
        presentationQuantity: hasPresentations ? itemPresentationQty : null,
        note: itemNote.trim() || undefined,
      },
    ])

    setItemBatchId('')
    setItemNote('')
    setItemPresentationQty(1)
  }

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      setCreateError(null)
      if (!toLocationId) throw new Error('Seleccioná la ubicación destino')
      if (!reason.trim()) throw new Error('Ingresá un motivo')
      if (!photoFile) throw new Error('Adjuntá una foto como evidencia')
      if (items.length === 0) throw new Error('Agregá al menos un ítem')

      const presign = await presignReturnPhoto(auth.accessToken!, photoFile.name, photoFile.type || 'image/jpeg')
      await uploadToPresignedUrl(presign.uploadUrl, photoFile, photoFile.type || 'image/jpeg')

      return createReturn(auth.accessToken!, {
        toLocationId,
        reason: reason.trim(),
        note: note.trim() || undefined,
        photoKey: presign.key,
        photoUrl: presign.publicUrl,
        items: items.map((it) => ({
          productId: it.productId,
          batchId: it.batchId ?? undefined,
          ...(it.presentationId && it.presentationQuantity
            ? { presentationId: it.presentationId, presentationQuantity: it.presentationQuantity }
            : { quantity: 1 }),
          note: it.note,
        })),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['stockReturns'] })
      setShowCreateModal(false)
      setCreateError(null)
      setWarehouseId('')
      setToLocationId('')
      setReason('')
      setNote('')
      setPhotoFile(null)
      setItemProductId('')
      setItemBatchId('')
      setItemPresentationId('')
      setItemPresentationQty(1)
      setItemNote('')
      setItems([])
    },
    onError: (e: any) => {
      setCreateError(e?.message ?? 'Error al crear devolución')
    },
  })

  const confirmReceptionMutation = useMutation({
    mutationFn: (requestId: string) => confirmReception(auth.accessToken!, requestId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sentMovementRequests'] })
      await queryClient.invalidateQueries({ queryKey: ['movement-requests'] })
      notifications.notify({ kind: 'success', title: 'Recepción confirmada', body: 'Se registró la recepción del envío.' })
    },
    onError: (e: any) => {
      notifications.notify({ kind: 'error', title: 'No se pudo recepcionar', body: e?.message ?? 'Error desconocido' })
    },
  })

  const returnMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRequest?.id) throw new Error('Envío inválido')
      const reason = returnReason.trim()
      if (!reason) throw new Error('Ingresá un motivo')

      if (returnMode === 'ALL') {
        return returnShipment(auth.accessToken!, selectedRequest.id, { mode: 'ALL', reason })
      }

      const items = pendingMovements
        .map((m: any) => ({ outMovementId: String(m.id), quantity: Number(returnItems[String(m.id)] ?? 0) }))
        .filter((it: any) => Number.isFinite(it.quantity) && it.quantity > 0)

      if (items.length === 0) throw new Error('Ingresá al menos una cantidad a devolver')

      // Client-side guard: do not exceed pending.
      for (const it of items) {
        const m = pendingMovements.find((x: any) => String(x.id) === String(it.outMovementId))
        const pending = Number(m?.pendingQuantity ?? 0)
        if (it.quantity > pending) throw new Error('La cantidad a devolver excede lo pendiente')
      }

      return returnShipment(auth.accessToken!, selectedRequest.id, { mode: 'PARTIAL', reason, items })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sentMovementRequests'] })
      await queryClient.invalidateQueries({ queryKey: ['movement-requests'] })
      notifications.notify({ kind: 'success', title: 'Devolución registrada', body: 'Se registró la devolución del envío.' })
      setShowReturnModal(false)
      setReturnReason('')
      setReturnItems({})
    },
    onError: (e: any) => {
      notifications.notify({ kind: 'error', title: 'No se pudo devolver', body: e?.message ?? 'Error desconocido' })
    },
  })

  const columns = useMemo(
    () => [
      { header: 'Fecha', width: '170px', accessor: (r: any) => new Date(r.createdAt).toLocaleString() },
      { header: 'Sucursal', accessor: (r: any) => r.toLocation?.warehouse?.name ?? r.toLocation?.warehouse?.code ?? '-' },
      { header: 'Ubicación', width: '120px', accessor: (r: any) => r.toLocation?.code ?? '-' },
      { header: 'Ítems', width: '80px', accessor: (r: any) => (r.items?.length ?? 0) },
      { header: 'Motivo', accessor: (r: any) => r.reason },
      {
        header: 'Evidencia',
        width: '110px',
        accessor: (r: any) =>
          r.photoUrl ? (
            <a className="text-blue-600 underline" href={r.photoUrl} target="_blank" rel="noreferrer">
              Ver foto
            </a>
          ) : (
            '-'
          ),
      },
    ],
    [],
  )

  const receptionModal = selectedRequest ? (
    <Modal
      isOpen={!!selectedRequest}
      onClose={() => setSelectedRequest(null)}
      title="📦 Detalle del envío"
      maxWidth="3xl"
    >
      <div className="space-y-4">
        {(() => {
          const fromCode = selectedRequest.originWarehouse?.city
            ? abbreviateCity(selectedRequest.originWarehouse.city)
            : selectedRequest.originWarehouse?.code?.replace(/^SUC-/, '') ?? '—'
          const toCode = selectedRequest.warehouse?.city
            ? abbreviateCity(selectedRequest.warehouse.city)
            : selectedRequest.requestedCity
              ? abbreviateCity(selectedRequest.requestedCity)
              : selectedRequest.warehouse?.code?.replace(/^SUC-/, '') ?? '—'

          const sentAt = new Date(selectedRequest.fulfilledAt || selectedRequest.createdAt)
          const tipo = selectedRequest.status === 'OPEN' ? 'Atención parcial' : 'Atención de solicitud'

          return (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">ORG -&gt; DEST</div>
                <div className="text-slate-600 dark:text-slate-400">{fromCode} -&gt; {toCode}</div>
              </div>
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">Tipo</div>
                <div className="text-slate-600 dark:text-slate-400">{tipo}</div>
              </div>
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">Solicitante</div>
                <div className="text-slate-600 dark:text-slate-400">{selectedRequest.requestedByName ?? '-'}</div>
              </div>
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">Enviado por</div>
                <div className="text-slate-600 dark:text-slate-400">{selectedRequest.fulfilledByName ?? '-'}</div>
              </div>
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">Fecha envío</div>
                <div className="text-slate-600 dark:text-slate-400">
                  <div>{sentAt.toLocaleDateString()}</div>
                  <div className="text-xs">{sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            </div>
          )
        })()}

        {selectedRequest.status === 'OPEN' && Array.isArray(selectedRequest.items) &&
          (() => {
            const allMovements = Array.isArray(selectedRequest.movements) ? selectedRequest.movements : []
            const normalize = (v: any) => String(v ?? '').trim().toLowerCase()

            const formatQty = (v: number) => {
              if (!Number.isFinite(v)) return '0'
              const rounded = Math.round(v)
              if (Math.abs(v - rounded) <= 1e-9) return String(rounded)
              return String(Number(v.toFixed(2)))
            }

            const movementsForItem = (it: any) => {
              const itSku = normalize(it.productSku)
              const itName = normalize(it.productName)
              const itGeneric = normalize(it.genericName)

              return allMovements.filter((m: any) => {
                const mSku = normalize(m.productSku)
                const mName = normalize(m.productName)
                const mGeneric = normalize(m.genericName)
                if (itSku && mSku) return itSku === mSku
                if (itName && mName && itGeneric && mGeneric) return itName === mName && itGeneric === mGeneric
                if (itName && mName) return itName === mName
                return false
              })
            }

            return (
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100 mb-2">Solicitud</div>

                <div className="rounded-lg border-2 border-blue-500 dark:border-blue-400 overflow-hidden">
                  <div className="grid grid-cols-2 bg-slate-50 dark:bg-slate-800 text-sm">
                    <div className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Solicitado</div>
                    <div className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Enviado</div>
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y-2 divide-blue-200 dark:divide-blue-500/40">
                    {selectedRequest.items.map((it: any) => {
                      const requestedUnits = Number(it.requestedQuantity ?? 0)
                      const remainingUnits = Number(it.remainingQuantity ?? 0)
                      const sentUnits = Math.max(0, requestedUnits - remainingUnits)

                      const unitsPerPresentation = Number(it.unitsPerPresentation ?? it.presentation?.unitsPerPresentation ?? 0)
                      const requestedPres =
                        it.presentationQuantity != null && Number.isFinite(Number(it.presentationQuantity))
                          ? Number(it.presentationQuantity)
                          : unitsPerPresentation > 0
                            ? requestedUnits / unitsPerPresentation
                            : requestedUnits
                      const remainingPres = unitsPerPresentation > 0 ? remainingUnits / unitsPerPresentation : remainingUnits
                      const sentPres = unitsPerPresentation > 0 ? sentUnits / unitsPerPresentation : sentUnits

                      const isDone = remainingPres <= 1e-9

                      const label = getProductLabel({ sku: it.productSku, name: it.productName, genericName: it.genericName } as any)
                      const presentationName = it.presentation?.name ?? it.presentationName ?? '-'
                      const shippedDetails = movementsForItem(it)

                      return (
                        <div key={it.id} className="grid grid-cols-2">
                          <div className="p-3">
                            <div className="flex items-start gap-2">
                              {isDone ? <CheckCircleIcon className="w-5 h-5 text-emerald-600 mt-0.5" /> : null}
                              <div className="flex-1">
                                <div className="font-medium text-slate-900 dark:text-slate-100">{label || '—'}</div>
                                <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                                  <div><strong>Presentación:</strong> {presentationName}</div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                                    <div><strong>Solicitado:</strong> {formatQty(requestedPres)}</div>
                                    <div>
                                      <strong>Pendiente:</strong>{' '}
                                      <span
                                        className={
                                          Math.max(0, remainingPres) <= 1e-9
                                            ? 'text-emerald-700 dark:text-emerald-400'
                                            : 'text-red-700 dark:text-red-400'
                                        }
                                      >
                                        {formatQty(Math.max(0, remainingPres))}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="p-3 bg-slate-50/50 dark:bg-slate-800/30 border-l-2 border-blue-200 dark:border-blue-500/40">
                            {sentPres <= 1e-9 ? (
                              <div className="h-full flex items-center">
                                <div className="w-full border-t border-blue-200 dark:border-blue-500/40" />
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="text-sm text-slate-700 dark:text-slate-200">
                                  <strong>Enviado:</strong> {formatQty(sentPres)}
                                </div>

                                {shippedDetails.length > 0 && (
                                  <div className="space-y-1">
                                    {shippedDetails.map((m: any, idx: number) => {
                                      const mUnitsPerPresentation = Number(m.presentation?.unitsPerPresentation ?? unitsPerPresentation ?? 0)
                                      const mPresQty =
                                        m.presentationQuantity != null && Number.isFinite(Number(m.presentationQuantity))
                                          ? Number(m.presentationQuantity)
                                          : mUnitsPerPresentation > 0
                                            ? Number(m.quantity ?? 0) / mUnitsPerPresentation
                                            : Number(m.quantity ?? 0)

                                      return (
                                        <div
                                          key={`${it.id}-${idx}`}
                                          className="rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                        >
                                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                            <div><strong>Cant:</strong> {formatQty(mPresQty)}</div>
                                            <div><strong>Pres:</strong> {m.presentation?.name ?? '-'}</div>
                                          </div>
                                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 dark:text-slate-400">
                                            <div><strong>Lote:</strong> {m.batch?.batchNumber ?? '-'}</div>
                                            <div><strong>Venc:</strong> {m.batch?.expiresAt ? formatDateOnlyUtc(m.batch.expiresAt) : '-'}</div>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })()}

        {selectedRequest.status !== 'OPEN' && (
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100 mb-2">Productos enviados</div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {selectedRequest.movements?.map((movement: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded">
                  <div className="flex-1">
                    <div className="font-medium">
                      {getProductLabel({ sku: movement.productSku, name: movement.productName, genericName: movement.genericName } as any) || '—'}
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-400 grid grid-cols-2 gap-2 mt-1">
                      <div><strong>Presentación:</strong> {movement.presentation?.name ?? '-'}</div>
                      <div><strong>Cantidad:</strong> {movement.quantity} {Number(movement.pendingQuantity ?? 0) > 0 ? `(pendiente ${movement.pendingQuantity})` : ''}</div>
                      <div><strong>Lote:</strong> {movement.batch?.batchNumber ?? '-'}</div>
                      <div><strong>Vencimiento:</strong> {movement.batch?.expiresAt ? formatDateOnlyUtc(movement.batch.expiresAt) : '-'}</div>
                    </div>
                  </div>
                </div>
              )) || (
                <div className="text-sm text-slate-500">No hay información detallada de envío disponible</div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => setSelectedRequest(null)}>
            Cerrar
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setReturnMode('ALL')
              setReturnReason('')
              const seed: Record<string, number> = {}
              for (const m of pendingMovements) seed[String(m.id)] = Number(m.pendingQuantity ?? 0)
              setReturnItems(seed)
              setShowReturnModal(true)
            }}
            disabled={pendingMovements.length === 0}
          >
            ↩️ Devolver
          </Button>
          <Button 
            onClick={() => {
              confirmReceptionMutation.mutate(selectedRequest.id)
              setSelectedRequest(null)
            }} 
            disabled={confirmReceptionMutation.isPending}
          >
            {confirmReceptionMutation.isPending ? 'Confirmando…' : '✅ Confirmar recepción'}
          </Button>
        </div>
      </div>
    </Modal>
  ) : null

  const returnModal = selectedRequest ? (
    <Modal
      isOpen={showReturnModal}
      onClose={() => {
        if (returnMutation.isPending) return
        setShowReturnModal(false)
      }}
      title="↩️ Devolver envío"
      maxWidth="lg"
    >
      <div className="space-y-3">
        <Input label="Motivo" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />

        <Select
          label="Tipo de devolución"
          value={returnMode}
          onChange={(e) => setReturnMode(e.target.value as any)}
          options={[
            { value: 'ALL', label: 'Devolver todo lo pendiente' },
            { value: 'PARTIAL', label: 'Devolver solo algunos ítems' },
          ]}
        />

        {returnMode === 'PARTIAL' && (
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="mb-2 text-sm font-semibold">Ítems a devolver</div>
            <div className="space-y-2">
              {pendingMovements.length === 0 ? (
                <div className="text-sm text-slate-500">No hay cantidades pendientes para devolver.</div>
              ) : (
                pendingMovements.map((m: any) => (
                  <div key={m.id} className="grid grid-cols-1 gap-2 md:grid-cols-3 items-end rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-800">
                    <div className="md:col-span-2">
                      <div className="font-medium">
                        {getProductLabel({ sku: m.productSku, name: m.productName, genericName: m.genericName } as any) || '—'}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        Pendiente: {Number(m.pendingQuantity ?? 0)}
                        {m.batch?.batchNumber ? ` · Lote ${m.batch.batchNumber}` : ''}
                      </div>
                    </div>
                    <Input
                      label="Cantidad"
                      type="number"
                      value={String(returnItems[String(m.id)] ?? 0)}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setReturnItems((prev) => ({ ...prev, [String(m.id)]: v }))
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setShowReturnModal(false)}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={() => returnMutation.mutate()} disabled={returnMutation.isPending}>
            {returnMutation.isPending ? 'Devolviendo…' : 'Confirmar devolución'}
          </Button>
        </div>
      </div>
    </Modal>
  ) : null

  const createModal = (
    <Modal
      isOpen={showCreateModal}
      onClose={() => {
        if (createMutation.isPending) return
        setShowCreateModal(false)
      }}
      title="➕ Registrar devolución"
      maxWidth="lg"
    >
      <div className="space-y-3">
        {createError && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{createError}</div>}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            label="Sucursal"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value)
              setToLocationId('')
            }}
            options={[
              { value: '', label: 'Seleccionar...' },
              ...activeWarehouses.map((w) => ({ value: w.id, label: `${w.name}${w.city ? ` (${w.city})` : ''}` })),
            ]}
          />

          <Select
            label="Ubicación destino"
            value={toLocationId}
            onChange={(e) => setToLocationId(e.target.value)}
            options={[
              { value: '', label: 'Seleccionar...' },
              ...activeLocations.map((l) => ({ value: l.id, label: l.code })),
            ]}
          />
        </div>

        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Evidencia (foto)</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              setPhotoFile(f)
            }}
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-4 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          {photoFile && <div className="mt-1 text-xs text-slate-500">{photoFile.name}</div>}
        </div>

        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-2 text-sm font-semibold">Ítems</div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select
              label="Producto"
              value={itemProductId}
              onChange={(e) => {
                const next = e.target.value
                setItemProductId(next)
                setItemBatchId('')
                setItemPresentationId('')
              }}
              options={[
                { value: '', label: 'Seleccionar...' },
                ...activeProducts.map((p) => ({ value: p.id, label: getProductLabel(p as any) })),
              ]}
            />

            <Select
              label="Lote (opcional)"
              value={itemBatchId}
              onChange={(e) => setItemBatchId(e.target.value)}
              options={[
                { value: '', label: 'Sin lote' },
                ...(itemBatchesQuery.data?.items ?? []).map((b) => ({
                  value: b.id,
                  label: `${b.batchNumber}${b.expiresAt ? ` (vence ${formatDateOnlyUtc(b.expiresAt)})` : ''}`,
                })),
              ]}
            />

            <Select
              label="Presentación"
              value={itemPresentationId || defaultPresentationId}
              onChange={(e) => setItemPresentationId(e.target.value)}
              disabled={activeItemPresentations.length === 0}
              options={
                activeItemPresentations.length === 0
                  ? [{ value: '', label: '(Sin presentaciones)' }]
                  : activeItemPresentations.map((p) => ({ value: p.id, label: `${p.name} (${p.unitsPerPresentation}u)` }))
              }
            />

            <Input
              label="Cantidad (en presentación)"
              type="number"
              value={String(itemPresentationQty)}
              onChange={(e) => setItemPresentationQty(Number(e.target.value))}
            />
          </div>

          <Input label="Nota del ítem (opcional)" value={itemNote} onChange={(e) => setItemNote(e.target.value)} />

          <div className="mt-2 flex justify-end">
            <Button variant="outline" onClick={addItem}>
              + Agregar
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            {items.length === 0 && <div className="text-sm text-slate-500">Sin ítems agregados.</div>}
            {items.map((it, idx) => {
              const p = productById.get(it.productId)
              const label = p ? getProductLabel(p as any) : it.productId
              return (
                <div key={`${it.productId}-${idx}`} className="flex items-center justify-between rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-800">
                  <div>
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      {it.presentationQuantity ?? '-'} {it.presentationId ? 'presentación(es)' : 'unidad(es)'}
                      {it.batchId ? ' · con lote' : ''}
                      {it.note ? ` · ${it.note}` : ''}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeItem(idx)}>
                    Quitar
                  </Button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setShowCreateModal(false)}>
            Cancelar
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creando…' : 'Crear devolución'}
          </Button>
        </div>
      </div>
    </Modal>
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="↩️ Recepción/Devolución">
        <MovementQuickActions currentPath="/stock/returns" />
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm text-slate-600 dark:text-slate-400">Recepción de envíos y devoluciones con evidencia.</div>
          <Button onClick={() => setShowCreateModal(true)}>➕ Nueva devolución</Button>
        </div>

        <div className="mb-4 border-b border-slate-200 dark:border-slate-700">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('returns')}
              className={`border-b-2 py-2 px-1 text-sm font-medium ${
                activeTab === 'returns'
                  ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300'
              }`}
            >
              Devoluciones
            </button>
            <button
              onClick={() => setActiveTab('receptions')}
              className={`border-b-2 py-2 px-1 text-sm font-medium ${
                activeTab === 'receptions'
                  ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300'
              }`}
            >
              Recepciones
            </button>
          </nav>
        </div>

        {activeTab === 'returns' && (
          <>
            {returnsQuery.isLoading && <Loading />}
            {returnsQuery.isError && <ErrorState message={(returnsQuery.error as any)?.message ?? 'Error cargando devoluciones'} />}
            {!returnsQuery.isLoading && !returnsQuery.isError && (returnsQuery.data?.items?.length ?? 0) === 0 && (
              <EmptyState message="No hay devoluciones registradas." />
            )}
            {!returnsQuery.isLoading && !returnsQuery.isError && (returnsQuery.data?.items?.length ?? 0) > 0 && (
              <Table columns={columns as any} data={sortedReturns} keyExtractor={(r: StockReturn) => r.id} />
            )}
          </>
        )}

        {activeTab === 'receptions' && (
          <>
            {sentRequestsQuery.isLoading && <Loading />}
            {sentRequestsQuery.isError && <ErrorState message={(sentRequestsQuery.error as any)?.message ?? 'Error cargando recepciones'} />}
            {!sentRequestsQuery.isLoading && !sentRequestsQuery.isError && (sentRequestsQuery.data?.items?.length ?? 0) === 0 && (
              <EmptyState message="No hay envíos pendientes de recepción." />
            )}
            {!sentRequestsQuery.isLoading && !sentRequestsQuery.isError && (sentRequestsQuery.data?.items?.length ?? 0) > 0 && (
              <Table
                columns={[
                  {
                    header: 'Fecha envío',
                    width: '140px',
                    accessor: (r: any) => {
                      const d = new Date(r.fulfilledAt || r.createdAt)
                      return (
                        <div>
                          <div>{d.toLocaleDateString()}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                      )
                    },
                  },
                  {
                    header: 'Tipo',
                    width: '150px',
                    accessor: (r: any) => (r.status === 'OPEN' ? 'Atención parcial' : 'Atención de solicitud'),
                  },
                  { 
                    header: 'ORG -> DEST', 
                    accessor: (r: any) => {
                      const fromCode = r.originWarehouse?.city
                        ? abbreviateCity(r.originWarehouse.city)
                        : r.originWarehouse?.code?.replace(/^SUC-/, '') ?? '—'

                      const toCode = r.warehouse?.city
                        ? abbreviateCity(r.warehouse.city)
                        : r.requestedCity
                          ? abbreviateCity(r.requestedCity)
                          : r.warehouse?.code?.replace(/^SUC-/, '') ?? '—'

                      return `${fromCode} -> ${toCode}`
                    }
                  },
                  { header: 'Solicitante', accessor: (r: any) => r.requestedByName },
                  { header: 'Enviado por', accessor: (r: any) => r.fulfilledByName ?? '-' },
                  { header: 'Ítems', width: '80px', accessor: (r: any) => (r.movements?.length ?? r.items?.length ?? 0) },
                  {
                    header: 'Acciones',
                    width: '120px',
                    accessor: (r: any) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<EyeIcon className="w-4 h-4" />}
                        onClick={() => setSelectedRequest(r)}
                      >
                        Ver
                      </Button>
                    ),
                  },
                ]}
                data={sortedSentRequests}
                keyExtractor={(r) => r.id}
              />
            )}
          </>
        )}

        {receptionModal}
        {returnModal}
        {createModal}
      </PageContainer>
    </MainLayout>
  )
}
