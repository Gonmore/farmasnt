import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { formatDateOnlyUtc } from '../../lib/date'
import { matchesSearchQuery } from '../../lib/search'
import { useAuth } from '../../providers/AuthProvider'
import { usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Table, Button, Modal, Input, Loading, ErrorState, EmptyState } from '../../components'
import { useNavigation } from '../../hooks'
import { getProductLabel } from '../../lib/productName'
import { MovementQuickActions } from '../../components/MovementQuickActions'
import { EyeIcon } from '@heroicons/react/24/outline'
import { useNotifications } from '../../providers/NotificationsProvider'

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

type ReceptionItemState = {
  fullReception: boolean
  returnQuantity: number
  returnReason: string
}

type ReceptionItemInput = {
  outMovementId: string
  receivedQuantity: number
  returnedQuantity: number
  returnReason?: string
}

type ReceptionInput = {
  items: ReceptionItemInput[]
  note?: string
  photoUrl?: string
  photoKey?: string
}

async function listSentMovementRequests(token: string, warehouseId?: string): Promise<{ items: any[] }> {
  const take = '50'
  const fetchByStatus = async (status: 'SENT' | 'OPEN') => {
    const params = new URLSearchParams({ take, status })
    if (warehouseId) params.set('warehouseId', warehouseId)
    return apiFetch(`/api/v1/stock/movement-requests?${params.toString()}`, { token }) as Promise<{ items: any[] }>
  }

  const [sent, open] = await Promise.all([fetchByStatus('SENT'), fetchByStatus('OPEN')])

  const withPendingShipments = (r: any) => {
    const ms = Array.isArray(r?.movements) ? r.movements : []
    const pending = ms.reduce((sum: number, m: any) => sum + Number(m?.pendingQuantity ?? 0), 0)
    return pending > 0
  }

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

async function confirmReceptionUnified(token: string, requestId: string, input: ReceptionInput): Promise<{ message: string }> {
  return apiFetch(`/api/v1/stock/movement-requests/${encodeURIComponent(requestId)}/reception`, {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  })
}

type TransferReceiveItem = { movementId: string; returnedQuantity: number; returnReason?: string | null }
type TransferReceiveInput = { note?: string | null; photoUrl?: string | null; items?: TransferReceiveItem[] }

async function receiveTransfer(token: string, transferId: string, input: TransferReceiveInput): Promise<any> {
  return apiFetch(`/api/v1/stock/transfers/${encodeURIComponent(transferId)}/receive`, {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  })
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) <= 1e-9) return String(rounded)
  return String(Number(value.toFixed(2)))
}

function cleanCode(code: string | null | undefined): string {
  if (!code) return ''
  return code.replace(/^SUC-/, '')
}

function locLabel(code: string | null | undefined): string {
  return code && code.trim() ? code : '—'
}

function whLocLabel(whCode: string | null | undefined, locCode: string | null | undefined): string {
  const wh = cleanCode(whCode)
  const loc = locLabel(locCode)
  if (!wh && loc === '—') return '—'
  if (!wh) return loc
  if (loc === '—') return wh
  return `${wh}:${loc}`
}

function firstOutMovement(r: any): any {
  if (!Array.isArray(r?.movements) || r.movements.length === 0) return null
  return r.movements[0]
}

function destLocCodeOf(r: any): string | null {
  const reqLoc = r?.toLocation?.code ?? null
  if (reqLoc) return reqLoc
  const m = firstOutMovement(r)
  return m?.toLocation?.code ?? m?.toLocationId ?? null
}

function destWarehouseCodeOf(r: any): string {
  return (
    r?.toLocation?.warehouse?.code ??
    firstOutMovement(r)?.toLocation?.warehouse?.code ??
    r?.warehouse?.code ??
    ''
  )
}

export function ReturnsPage() {
  const auth = useAuth()
  const permissions = usePermissions()
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
    queryKey: ['sentMovementRequests', permissions.user?.warehouseId],
    queryFn: () => listSentMovementRequests(auth.accessToken!, permissions.hasPermission('scope:branch') && !permissions.isTenantAdmin ? permissions.user?.warehouseId ?? undefined : undefined),
    enabled: !!auth.accessToken,
    refetchInterval: 15_000,
  })

  // Transferencias (simples y masivas) pendientes de recepción en la sucursal del usuario.
  // Las atenciones de solicitud (FULFILL_REQUEST) pendientes de recepción se gestionan en la pestaña Recepción/Devolución.
  const pendingTransfersQuery = useQuery({
    queryKey: ['pendingTransferReceipts', permissions.user?.warehouseId],
    queryFn: () => apiFetch('/api/v1/stock/completed-movements?take=100&receiptStatus=PENDING', { token: auth.accessToken! }) as Promise<{ items: any[] }>,
    enabled: !!auth.accessToken,
    refetchInterval: 15_000,
    select: (data) =>
      (data.items ?? []).filter(
        (m: any) =>
          m.receiptStatus === 'PENDING' &&
          m.type !== 'FULFILL_REQUEST' &&
          m.fromWarehouseCode !== m.toWarehouseCode
      ),
  })

  // Modal de recepción de transferencias (con posibilidad de devolución parcial por ítem).
  const [transferTarget, setTransferTarget] = useState<any>(null)
  const [transferLines, setTransferLines] = useState<any[]>([])
  const [transferItems, setTransferItems] = useState<Record<string, ReceptionItemState>>({})
  const [transferNote, setTransferNote] = useState('')
  const [transferPhotoFile, setTransferPhotoFile] = useState<File | null>(null)
  const [transferPhotoError, setTransferPhotoError] = useState<string | null>(null)
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)

  const openTransferReceptionModal = async (m: any) => {
    setTransferTarget(m)
    setTransferLines([])
    setTransferItems({})
    setTransferNote('')
    setTransferPhotoFile(null)
    setTransferPhotoError(null)
    setTransferError(null)
    setTransferLoading(true)
    try {
      const data = await apiFetch<any>(
        `/api/v1/stock/completed-movements/${encodeURIComponent(m.id)}/picking?type=${encodeURIComponent(m.type)}`,
        { token: auth.accessToken! },
      )
      const lines = (data.sentLines ?? []).map((l: any) => ({
        movementId: l.movementId,
        productLabel: l.productLabel,
        batchNumber: l.batchNumber,
        quantityUnits: l.quantityUnits,
      }))
      const initial: Record<string, ReceptionItemState> = {}
      for (const l of lines) initial[String(l.movementId)] = { fullReception: true, returnQuantity: 0, returnReason: '' }
      setTransferLines(lines)
      setTransferItems(initial)
    } catch (e: any) {
      setTransferError(e?.message ?? 'No se pudo cargar el detalle de la transferencia')
    } finally {
      setTransferLoading(false)
    }
  }

  const closeTransferReception = () => {
    setTransferTarget(null)
    setTransferLines([])
    setTransferItems({})
    setTransferNote('')
    setTransferPhotoFile(null)
    setTransferPhotoError(null)
    setTransferError(null)
  }

  const transferReceptionMutation = useMutation({
    mutationFn: async () => {
      const lines = transferLines
      const items: TransferReceiveItem[] = []
      for (const line of lines) {
        const mid = String(line.movementId)
        const st = transferItems[mid] ?? { fullReception: true, returnQuantity: 0, returnReason: '' }
        const qty = Number(line.quantityUnits ?? 0)
        let returned = 0
        if (!st.fullReception) returned = Math.min(Number(st.returnQuantity || 0), qty)
        if (returned > 1e-9 && !st.returnReason?.trim()) {
          throw new Error('El motivo de devolución es obligatorio para los ítems devueltos')
        }
        items.push({ movementId: mid, returnedQuantity: returned, returnReason: returned > 1e-9 ? st.returnReason.trim() : null })
      }
      let photoUrl: string | null = null
      if (transferPhotoFile) {
        const presign = await presignReturnPhoto(auth.accessToken!, transferPhotoFile.name, transferPhotoFile.type || 'image/jpeg')
        await uploadToPresignedUrl(presign.uploadUrl, transferPhotoFile, transferPhotoFile.type || 'image/jpeg')
        photoUrl = presign.publicUrl
      }
      if (!transferTarget) throw new Error('No hay transferencia seleccionada')
      return receiveTransfer(auth.accessToken!, transferTarget.id, {
        note: transferNote.trim() || null,
        photoUrl,
        items,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pendingTransferReceipts'] })
      notifications.notify({ kind: 'success', title: 'Transferencia recepcionada', body: 'Se registró la recepción (y devoluciones, si las hubo).' })
      closeTransferReception()
    },
    onError: (e: any) => {
      notifications.notify({ kind: 'error', title: 'No se pudo recepcionar', body: e?.message ?? 'Error desconocido' })
    },
  })

  const [activeTab, setActiveTab] = useState<'returns' | 'receptions'>('receptions')
  const [searchQuery, setSearchQuery] = useState('')

  const [selectedRequest, setSelectedRequest] = useState<any>(null)
  const [showReceptionModal, setShowReceptionModal] = useState(false)
  const [receptionItems, setReceptionItems] = useState<Record<string, ReceptionItemState>>({})
  const [receptionNote, setReceptionNote] = useState('')
  const [receptionPhotoFile, setReceptionPhotoFile] = useState<File | null>(null)
  const [receptionPhotoError, setReceptionPhotoError] = useState<string | null>(null)

  const sortedReturns = useMemo(() => {
    const items = returnsQuery.data?.items ?? []
    return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [returnsQuery.data?.items])

  const filteredReturns = useMemo(() => {
    return sortedReturns.filter((r) => {
      const itemText = (r.items ?? [])
        .map((it) => [it.sku, it.name, it.genericName, it.batchNumber, it.presentationName].filter(Boolean).join(' '))
        .join(' ')

      return matchesSearchQuery(searchQuery, [
        r.reason,
        r.note,
        r.createdAt,
        formatDateOnlyUtc(r.createdAt),
        r.toLocation?.code,
        r.toLocation?.warehouse?.code,
        r.toLocation?.warehouse?.name,
        r.toLocation?.warehouse?.city,
        itemText,
      ])
    })
  }, [sortedReturns, searchQuery])

  const sortedSentRequests = useMemo(() => {
    const items = sentRequestsQuery.data?.items ?? []
    return [...items].sort(
      (a, b) =>
        new Date(b.fulfilledAt || b.createdAt).getTime() - new Date(a.fulfilledAt || a.createdAt).getTime(),
    )
  }, [sentRequestsQuery.data?.items])

  const filteredSentRequests = useMemo(() => {
    return sortedSentRequests.filter((r: any) => {
      const itemText = (r.items ?? [])
        .map((it: any) => [it.productSku, it.productName, it.genericName, it.presentationName, it.presentation?.name].filter(Boolean).join(' '))
        .join(' ')
      const movementText = (r.movements ?? [])
        .map((m: any) => [m.productSku, m.productName, m.genericName, m.createdByName, m.fromLocation?.code, m.toLocation?.code].filter(Boolean).join(' '))
        .join(' ')

      return matchesSearchQuery(searchQuery, [
        r.code,
        r.status,
        r.requestedCity,
        r.requestedByName,
        r.fulfilledByName,
        r.confirmedByName,
        r.note,
        r.createdAt,
        r.fulfilledAt,
        formatDateOnlyUtc(r.createdAt),
        r.fulfilledAt ? formatDateOnlyUtc(r.fulfilledAt) : '',
        r.originWarehouse?.code,
        r.originWarehouse?.name,
        r.originWarehouse?.city,
        r.warehouse?.code,
        r.warehouse?.name,
        r.warehouse?.city,
        itemText,
        movementText,
      ])
    })
  }, [sortedSentRequests, searchQuery])

  const pendingMovements = useMemo(() => {
    const ms = Array.isArray(selectedRequest?.movements) ? selectedRequest.movements : []
    return ms
      .map((m: any) => ({ ...m, pendingQuantity: Number(m?.pendingQuantity ?? 0), quantity: Number(m?.quantity ?? 0) }))
      .filter((m: any) => m.pendingQuantity > 0)
  }, [selectedRequest])

  const matchItemToMovement = (m: any, items: any[]): any | undefined => {
    const normalize = (v: any) => String(v ?? '').trim().toLowerCase()
    const mSku = normalize(m.productSku)
    const mName = normalize(m.productName)
    const mGeneric = normalize(m.genericName)

    for (const it of items) {
      const itSku = normalize(it.productSku)
      const itName = normalize(it.productName)
      const itGeneric = normalize(it.genericName)

      if (mSku && itSku && mSku === itSku) return it
      if (mName && itName && mGeneric && itGeneric && mName === itName && mGeneric === itGeneric) return it
      if (mName && itName && mName === itName) return it
    }
    return undefined
  }

  const confirmReceptionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRequest?.id) throw new Error('Envío inválido')

      const items: ReceptionItemInput[] = []

      for (const m of pendingMovements) {
        const mid = String(m.id)
        const state = receptionItems[mid] ?? { fullReception: true, returnQuantity: 0, returnReason: '' }
        const pending = Number(m.pendingQuantity ?? 0)

        let receivedQty = 0
        let returnedQty = 0

        if (state.fullReception) {
          receivedQty = pending
          returnedQty = 0
        } else {
          returnedQty = Math.min(Number(state.returnQuantity ?? 0), pending)
          receivedQty = pending - returnedQty
        }

        if (receivedQty <= 1e-9 && returnedQty <= 1e-9) continue

        const entry: ReceptionItemInput = {
          outMovementId: mid,
          receivedQuantity: receivedQty,
          returnedQuantity: returnedQty,
        }

        if (returnedQty > 1e-9 && state.returnReason?.trim()) {
          entry.returnReason = state.returnReason.trim()
        }

        items.push(entry)
      }

      if (items.length === 0) throw new Error('No hay cantidades pendientes para recepcionar')

      let photoUrl: string | undefined
      let photoKey: string | undefined

      if (receptionPhotoFile) {
        const presign = await presignReturnPhoto(auth.accessToken!, receptionPhotoFile.name, receptionPhotoFile.type || 'image/jpeg')
        await uploadToPresignedUrl(presign.uploadUrl, receptionPhotoFile, receptionPhotoFile.type || 'image/jpeg')
        photoUrl = presign.publicUrl
        photoKey = presign.key
      }

      return confirmReceptionUnified(auth.accessToken!, selectedRequest.id, {
        items,
        note: receptionNote.trim() || undefined,
        photoUrl,
        photoKey,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sentMovementRequests'] })
      await queryClient.invalidateQueries({ queryKey: ['movement-requests'] })
      notifications.notify({ kind: 'success', title: 'Recepción registrada', body: 'Se registró la recepción/devolución del envío.' })
      setShowReceptionModal(false)
      setSelectedRequest(null)
      setReceptionItems({})
      setReceptionNote('')
      setReceptionPhotoFile(null)
      setReceptionPhotoError(null)
    },
    onError: (e: any) => {
      notifications.notify({ kind: 'error', title: 'No se pudo recepcionar', body: e?.message ?? 'Error desconocido' })
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

  const openReceptionModal = (r: any) => {
    setSelectedRequest(r)
    setShowReceptionModal(true)
    setReceptionNote('')
    setReceptionPhotoFile(null)
    setReceptionPhotoError(null)

    const ms = Array.isArray(r?.movements) ? r.movements : []
    const pending = ms
      .map((m: any) => ({ ...m, pendingQuantity: Number(m?.pendingQuantity ?? 0) }))
      .filter((m: any) => m.pendingQuantity > 0)

    const initial: Record<string, ReceptionItemState> = {}
    for (const m of pending) {
      initial[String(m.id)] = { fullReception: true, returnQuantity: 0, returnReason: '' }
    }
    setReceptionItems(initial)
  }

  const receptionModal = selectedRequest ? (
    <Modal
      isOpen={showReceptionModal}
      onClose={() => {
        if (confirmReceptionMutation.isPending) return
        setShowReceptionModal(false)
        setSelectedRequest(null)
      }}
      title={`📦 Recepción/Devolución${selectedRequest.code ? ` — ${selectedRequest.code}` : ''}`}
      closeOnBackdropClick={false}
      maxWidth="6xl"
    >
      <div className="space-y-4">
        {(() => {
          const fromWarehouse = selectedRequest.originWarehouse?.code ?? selectedRequest.warehouse?.code ?? ''
          const firstMovement = Array.isArray(selectedRequest.movements) && selectedRequest.movements.length > 0 ? selectedRequest.movements[0] : null
          const fromLocation = firstMovement?.fromLocation?.code ?? selectedRequest.fromLocationId ?? null
          const toWarehouse = destWarehouseCodeOf(selectedRequest)
          const toLocation = destLocCodeOf(selectedRequest)

          const fromLabel = whLocLabel(fromWarehouse, fromLocation)
          const toLabel = whLocLabel(toWarehouse, toLocation)

          const sentAt = new Date(selectedRequest.fulfilledAt || selectedRequest.createdAt)
          const tipo = selectedRequest.status === 'OPEN' ? 'Atención parcial' : 'Atención de solicitud'

          return (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">ORG → DEST</div>
                <div className="text-slate-600 dark:text-slate-400">{fromLabel} → {toLabel}</div>
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

        <div>
          <div className="font-medium text-slate-900 dark:text-slate-100 mb-2">Productos enviados</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Lote</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Producto</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Presentación</th>
                  <th className="px-4 py-3 text-right font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Cant. enviada</th>
                  <th className="px-4 py-3 text-right font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Cant. solicitada</th>
                  <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Recepción completa</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-900">
                {pendingMovements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-center text-sm text-slate-500">
                      No hay productos pendientes de recepción.
                    </td>
                  </tr>
                ) : (
                  pendingMovements.map((m: any) => {
                    const mid = String(m.id)
                    const state = receptionItems[mid] ?? { fullReception: true, returnQuantity: 0, returnReason: '' }
                    const matchedItem = matchItemToMovement(m, selectedRequest.items ?? [])
                    const requestedQty = matchedItem ? Number(matchedItem.requestedQuantity ?? matchedItem.quantity ?? 0) : ''

                    return (
                      <tr key={mid} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-4 py-3 text-slate-900 dark:text-slate-100">{m.batch?.batchNumber ?? '-'}</td>
                        <td className="px-4 py-3 text-slate-900 dark:text-slate-100">
                          {getProductLabel({ sku: m.productSku, name: m.productName, genericName: m.genericName } as any) || '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{m.presentation?.name ?? m.presentationName ?? '-'}</td>
                        <td className="px-4 py-3 text-right text-slate-900 dark:text-slate-100">{formatQty(Number(m.quantity))}</td>
                        <td className="px-4 py-3 text-right text-slate-900 dark:text-slate-100">{requestedQty !== '' ? formatQty(Number(requestedQty)) : '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={state.fullReception}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setReceptionItems((prev) => ({
                                  ...prev,
                                  [mid]: {
                                    fullReception: checked,
                                    returnQuantity: checked ? 0 : (prev[mid]?.returnQuantity ?? 0),
                                    returnReason: checked ? '' : (prev[mid]?.returnReason ?? ''),
                                  },
                                }))
                              }}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-slate-700 dark:text-slate-300">Completo</span>
                          </label>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {pendingMovements
            .filter((m: any) => {
              const state = receptionItems[String(m.id)]
              return state && !state.fullReception
            })
            .map((m: any) => {
              const mid = String(m.id)
              const state = receptionItems[mid]
              const pending = Number(m.pendingQuantity ?? 0)

              return (
                <div key={`ret-${mid}`} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {getProductLabel({ sku: m.productSku, name: m.productName, genericName: m.genericName } as any) || '—'} — Lote {m.batch?.batchNumber ?? '-'}
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <Input
                      label={`Cant. a devolver (máx ${formatQty(pending)})`}
                      type="number"
                      min={0}
                      max={pending}
                      value={String(state?.returnQuantity ?? 0)}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        const valid = Number.isFinite(v) && v >= 0 ? Math.min(v, pending) : 0
                        setReceptionItems((prev) => ({
                          ...prev,
                          [mid]: { ...prev[mid]!, returnQuantity: valid },
                        }))
                      }}
                    />
                    <div className="md:col-span-2">
                      <Input
                        label="Motivo de devolución"
                        value={state?.returnReason ?? ''}
                        onChange={(e) =>
                          setReceptionItems((prev) => ({
                            ...prev,
                            [mid]: { ...prev[mid]!, returnReason: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Recibirán: {formatQty(pending - Number(state?.returnQuantity ?? 0))} | Devolverán: {formatQty(Number(state?.returnQuantity ?? 0))}
                  </div>
                </div>
              )
            })}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Evidencia (foto, opcional)</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              setReceptionPhotoFile(f)
              setReceptionPhotoError(null)
              if (f && f.size > 5 * 1024 * 1024) {
                setReceptionPhotoError('La foto no debe superar 5 MB')
              }
            }}
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-4 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          {receptionPhotoFile && <div className="mt-1 text-xs text-slate-500">{receptionPhotoFile.name}</div>}
          {receptionPhotoError && <div className="mt-1 text-xs text-red-600">{receptionPhotoError}</div>}
        </div>

        <Input
          label="Nota general (opcional)"
          value={receptionNote}
          onChange={(e) => setReceptionNote(e.target.value)}
        />

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => { setShowReceptionModal(false); setSelectedRequest(null) }} disabled={confirmReceptionMutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => confirmReceptionMutation.mutate()} disabled={confirmReceptionMutation.isPending}>
            {confirmReceptionMutation.isPending ? 'Procesando…' : 'Confirmar recepción/devolución'}
          </Button>
        </div>
      </div>
    </Modal>
  ) : null

  const transferReceptionModal = transferTarget ? (
    <Modal
      isOpen={!!transferTarget}
      onClose={() => {
        if (transferReceptionMutation.isPending) return
        closeTransferReception()
      }}
      title="Recepcionar transferencia"
      maxWidth="4xl"
      closeOnBackdropClick={false}
    >
      <div className="space-y-4">
        {transferLoading ? (
          <Loading />
        ) : transferError ? (
          <ErrorState message={transferError} retry={transferTarget ? () => openTransferReceptionModal(transferTarget) : undefined} />
        ) : (
          <>
            <div className="text-sm text-slate-600 dark:text-slate-400">
              Marque la recepción completa de cada ítem o indique la cantidad a devolver y el motivo. Opcionalmente adjunte una foto y una nota.
            </div>

            <div className="space-y-3">
              {transferLines.map((line) => {
                const mid = String(line.movementId)
                const state = transferItems[mid] ?? { fullReception: true, returnQuantity: 0, returnReason: '' }
                const qty = Number(line.quantityUnits ?? 0)
                return (
                  <div key={mid} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {line.productLabel} — Lote {line.batchNumber ?? '-'}
                    </div>
                    <div className="text-xs text-slate-500">Cantidad enviada: {formatQty(qty)}</div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={state.fullReception}
                        onChange={(e) =>
                          setTransferItems((prev) => ({ ...prev, [mid]: { ...(prev[mid] ?? { returnQuantity: 0, returnReason: '' }), fullReception: e.target.checked } }))
                        }
                      />
                      Recepción completa
                    </label>
                    {!state.fullReception && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input
                          label="Cantidad a devolver"
                          type="number"
                          min={0}
                          value={state.returnQuantity}
                          onChange={(e) =>
                            setTransferItems((prev) => ({ ...prev, [mid]: { ...(prev[mid] ?? { fullReception: false, returnReason: '' }), returnQuantity: Number(e.target.value) } }))
                          }
                        />
                        <Input
                          label="Motivo de devolución"
                          value={state.returnReason}
                          onChange={(e) =>
                            setTransferItems((prev) => ({ ...prev, [mid]: { ...(prev[mid] ?? { fullReception: false, returnQuantity: 0 }), returnReason: e.target.value } }))
                          }
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Evidencia (foto, opcional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setTransferPhotoFile(f)
                  setTransferPhotoError(null)
                  if (f && f.size > 5 * 1024 * 1024) setTransferPhotoError('La foto no debe superar 5 MB')
                }}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-4 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              {transferPhotoFile && <div className="mt-1 text-xs text-slate-500">{transferPhotoFile.name}</div>}
              {transferPhotoError && <div className="mt-1 text-xs text-red-600">{transferPhotoError}</div>}
            </div>

            <Input label="Nota general (opcional)" value={transferNote} onChange={(e) => setTransferNote(e.target.value)} />

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={closeTransferReception} disabled={transferReceptionMutation.isPending}>
                Cancelar
              </Button>
              <Button onClick={() => transferReceptionMutation.mutate()} disabled={transferReceptionMutation.isPending}>
                {transferReceptionMutation.isPending ? 'Procesando…' : 'Confirmar recepción'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  ) : null

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="↩️ Recepción/Devolución">
        <MovementQuickActions currentPath="/stock/returns" />
        <div className="mb-3">
          <div className="text-sm text-slate-600 dark:text-slate-400">Recepción de envíos y devoluciones con evidencia.</div>
        </div>

        <div className="mb-3 max-w-xl">
          <Input
            label="Buscar"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Código (SOL…), persona, fecha, sucursal, producto…"
          />
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
            {!returnsQuery.isLoading && !returnsQuery.isError && sortedReturns.length === 0 && (
              <EmptyState message="No hay devoluciones registradas." />
            )}
            {!returnsQuery.isLoading && !returnsQuery.isError && sortedReturns.length > 0 && filteredReturns.length === 0 && (
              <EmptyState message="No hay resultados." />
            )}
            {!returnsQuery.isLoading && !returnsQuery.isError && filteredReturns.length > 0 && (
              <Table columns={columns as any} data={filteredReturns} keyExtractor={(r: StockReturn) => r.id} />
            )}
          </>
        )}

        {activeTab === 'receptions' && (
          <>
            {sentRequestsQuery.isLoading && <Loading />}
            {sentRequestsQuery.isError && <ErrorState message={(sentRequestsQuery.error as any)?.message ?? 'Error cargando recepciones'} />}
            {!sentRequestsQuery.isLoading && !sentRequestsQuery.isError && sortedSentRequests.length === 0 && (
              <EmptyState message="No hay envíos pendientes de recepción." />
            )}
            {!sentRequestsQuery.isLoading && !sentRequestsQuery.isError && sortedSentRequests.length > 0 && filteredSentRequests.length === 0 && (
              <EmptyState message="No hay resultados." />
            )}
            {!sentRequestsQuery.isLoading && !sentRequestsQuery.isError && filteredSentRequests.length > 0 && (
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
                    accessor: (r: any) => (
                      <div className="leading-tight">
                        <div>{r.status === 'OPEN' ? 'Atención parcial' : 'Atención de solicitud'}</div>
                        {r.code ? <div className="text-xs text-slate-500 dark:text-slate-400">{r.code}</div> : null}
                      </div>
                    ),
                  },
                  {
                    header: 'ORG → DEST',
                    accessor: (r: any) => {
                      const firstMovement = firstOutMovement(r)
                      const fromWarehouse = r.originWarehouse?.code ?? r.warehouse?.code ?? ''
                      const fromLocation = firstMovement?.fromLocation?.code ?? r.fromLocationId ?? null
                      const fromLabel = whLocLabel(fromWarehouse, fromLocation)

                      const toWarehouse = destWarehouseCodeOf(r)
                      const toLocation = destLocCodeOf(r)
                      const toLabel = whLocLabel(toWarehouse, toLocation)

                      return `${fromLabel} → ${toLabel}`
                    },
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
                        onClick={() => openReceptionModal(r)}
                      >
                        Ver
                      </Button>
                    ),
                  },
                ]}
                data={filteredSentRequests}
                keyExtractor={(r) => r.id}
              />
            )}

            {!sentRequestsQuery.isLoading && !sentRequestsQuery.isError && (
              <>
                {pendingTransfersQuery.isLoading && <Loading />}
                {pendingTransfersQuery.data && pendingTransfersQuery.data.length > 0 && (
                  <div className="mt-6">
                    <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Transferencias pendientes de recepción</div>
                    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                      <div className="overflow-x-auto">
                        <Table
                          columns={[
                            {
                              header: 'Fecha envío',
                              width: '140px',
                              accessor: (m: any) => {
                                const d = new Date(m.completedAt || m.createdAt)
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
                              width: '170px',
                              accessor: (m: any) => (
                                <div className="leading-tight">
                                  <div>{m.typeLabel}</div>
                                  {m.number ? <div className="text-xs text-slate-500 dark:text-slate-400">{m.number}</div> : null}
                                </div>
                              ),
                            },
                            {
                              header: 'ORG → DEST',
                              accessor: (m: any) => {
                                const fromLabel = whLocLabel(cleanCode(m.fromWarehouseCode), m.fromLocationCode)
                                const toLabel = whLocLabel(cleanCode(m.toWarehouseCode), m.toLocationCode)
                                return `${fromLabel} → ${toLabel}`
                              },
                            },
                            { header: 'Realizó', accessor: (m: any) => m.fulfilledByName ?? m.requestedByName ?? '-' },
                            { header: 'Ítems', width: '80px', accessor: (m: any) => m.totalItems },
                            {
                              header: 'Acciones',
                              width: '140px',
                              accessor: (m: any) => (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openTransferReceptionModal(m)}
                                >
                                  Recepcionar
                                </Button>
                              ),
                            },
                          ]}
                          data={pendingTransfersQuery.data}
                          keyExtractor={(m) => m.id}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {receptionModal}
        {transferReceptionModal}
      </PageContainer>
    </MainLayout>
  )
}
