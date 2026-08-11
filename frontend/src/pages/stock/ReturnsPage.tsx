import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { formatDateOnlyUtc } from '../../lib/date'
import { matchesSearchQuery } from '../../lib/search'
import { useAuth } from '../../providers/AuthProvider'
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
      maxWidth="6xl"
    >
      <div className="space-y-4">
        {(() => {
          const fromWarehouse = selectedRequest.originWarehouse?.code ?? selectedRequest.warehouse?.code ?? ''
          const firstMovement = Array.isArray(selectedRequest.movements) && selectedRequest.movements.length > 0 ? selectedRequest.movements[0] : null
          const fromLocation = firstMovement?.fromLocation?.code ?? selectedRequest.fromLocationId ?? null
          const toWarehouse = selectedRequest.toLocation?.warehouse?.code ?? selectedRequest.warehouse?.code ?? ''
          const toLocation = selectedRequest.toLocation?.code ?? null

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
                      const fromWarehouse = r.originWarehouse?.code ?? r.warehouse?.code ?? ''
                      const firstMovement = Array.isArray(r.movements) && r.movements.length > 0 ? r.movements[0] : null
                      const fromLocation = firstMovement?.fromLocation?.code ?? r.fromLocationId ?? null
                      const toWarehouse = r.toLocation?.warehouse?.code ?? r.warehouse?.code ?? ''
                      const toLocation = r.toLocation?.code ?? null

                      const fromLabel = whLocLabel(fromWarehouse, fromLocation)
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
          </>
        )}

        {receptionModal}
      </PageContainer>
    </MainLayout>
  )
}
