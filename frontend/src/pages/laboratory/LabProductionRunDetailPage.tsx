import { useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Loading, ErrorState, Table, Button, Modal, Input, Select } from '../../components'

type SupplyItem = { id: string; code: string | null; name: string; baseUnit: string; isActive: boolean }

type LaboratoryListItem = { id: string; name: string; city: string | null; warehouseId: string; isActive: boolean }
type LocationListItem = { id: string; warehouseId: string; code: string; isActive: boolean }

type SupplyBalanceItem = {
  id: string
  quantity: string
  locationId: string
  lotId: string | null
  location: { id: string; code: string }
  lot: { id: string; lotNumber: string; expiresAt: string | null } | null
}

type RunDetail = {
  id: string
  laboratoryId: string
  requestId: string | null
  recipeId: string
  productId: string
  plannedOutputQuantity: string | null
  outputUnit: string | null
  actualOutputQuantity: string | null
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  startedAt: string | null
  completedAt: string | null
  note: string | null
  createdAt: string
  updatedAt: string
  laboratory: { id: string; name: string; city: string | null; defaultLocationId: string | null; quarantineLocationId: string | null }
  product: { sku: string; name: string }
  recipe: { id: string; name: string }
  inputs: Array<{ id: string; supplyId: string; lotId: string | null; quantity: string; unit: string; note: string | null; supply: { name: string; baseUnit: string }; lot: { lotNumber: string } | null }>
  outputs: Array<{ id: string; batchId: string; quantity: string; unit: string; batch: { batchNumber: string; status: 'QUARANTINE' | 'RELEASED'; expiresAt: string | null; manufacturingDate: string | null } }>
  waste: Array<{ id: string; supplyId: string | null; lotId: string | null; quantity: string; unit: string; reason: string | null; supply: { name: string } | null; lot: { lotNumber: string } | null }>
}

type CompleteInputLine = { supplyId: string; lotId: string; quantity: string; unit: string; note: string }
type CompleteOutputLine = { batchNumber: string; quantity: string; unit: string; manufacturingDate: string; expiresAt: string }
type CompleteWasteLine = { supplyId: string; lotId: string; quantity: string; unit: string; reason: string }

async function fetchRun(token: string, id: string): Promise<{ item: RunDetail }> {
  return apiFetch(`/api/v1/laboratory/production-runs/${encodeURIComponent(id)}`, { token })
}

async function startRun(token: string, id: string): Promise<{ ok: true; id: string }> {
  return apiFetch(`/api/v1/laboratory/production-runs/${encodeURIComponent(id)}/start`, { token, method: 'POST' })
}

async function completeRun(
  token: string,
  id: string,
  body: {
    note?: string | null
    inputs?: Array<{ supplyId: string; lotId?: string | null; fromLocationId?: string | null; quantity: number; unit: string; note?: string | null }>
    waste?: Array<{ supplyId?: string | null; lotId?: string | null; fromLocationId?: string | null; quantity: number; unit: string; reason?: string | null }>
    outputs: Array<{ batchNumber: string; quantity: number; unit: string; manufacturingDate?: string | null; expiresAt?: string | null }>
  },
): Promise<any> {
  return apiFetch(`/api/v1/laboratory/production-runs/${encodeURIComponent(id)}/complete`, { token, method: 'POST', body: JSON.stringify(body) })
}

async function releaseBatch(token: string, batchId: string, qcNote?: string | null): Promise<{ ok: true; batchId: string }> {
  return apiFetch(`/api/v1/laboratory/batches/${encodeURIComponent(batchId)}/release`, { token, method: 'POST', body: JSON.stringify({ qcNote: qcNote ?? null }) })
}

async function fetchSupplyBalances(token: string, supplyId: string, locationId?: string | null): Promise<{ items: SupplyBalanceItem[] }> {
  const params = new URLSearchParams({ supplyId })
  if (locationId) params.set('locationId', locationId)
  return apiFetch(`/api/v1/laboratory/supply-balances?${params}`, { token })
}

async function listSupplies(token: string): Promise<{ items: SupplyItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ take: '100' })
  params.set('category', 'RAW_MATERIAL')
  return apiFetch(`/api/v1/laboratory/supplies?${params}`, { token })
}

async function listLaboratories(token: string): Promise<{ items: LaboratoryListItem[] }> {
  return apiFetch('/api/v1/laboratories', { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  return apiFetch(`/api/v1/warehouses/${encodeURIComponent(warehouseId)}/locations?take=100`, { token })
}

type RecipeDetail = { item: { id: string; items: Array<{ supplyId: string; quantity: string; unit: string }> } }

async function fetchRecipeDetail(token: string, id: string): Promise<RecipeDetail> {
  return apiFetch(`/api/v1/laboratory/recipes/${encodeURIComponent(id)}`, { token })
}

export function LabProductionRunDetailPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { id } = useParams<{ id: string }>()
  const runId = id ?? ''

  const canWrite = perms.hasPermission('stock:manage')

  const suppliesQuery = useQuery({
    queryKey: ['laboratory', 'supplies', { take: 100, cursor: undefined }],
    queryFn: () => listSupplies(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const supplies = useMemo(() => (suppliesQuery.data?.items ?? []).filter((s) => s.isActive), [suppliesQuery.data])

  const labsQuery = useQuery({
    queryKey: ['laboratory', 'labs', 'forRunComplete'],
    queryFn: () => listLaboratories(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const runQuery = useQuery({
    queryKey: ['laboratory', 'production-run', runId],
    queryFn: () => fetchRun(auth.accessToken!, runId),
    enabled: !!auth.accessToken && !!runId,
  })

  const item = runQuery.data?.item

  const startMutation = useMutation({
    mutationFn: () => startRun(auth.accessToken!, runId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-run', runId] })
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-runs'] })
    },
  })

  const [showComplete, setShowComplete] = useState(false)
  const [completeNote, setCompleteNote] = useState('')
  const [consumeFromLocationId, setConsumeFromLocationId] = useState('')
  const [inputs, setInputs] = useState<CompleteInputLine[]>([])
  const [outputs, setOutputs] = useState<CompleteOutputLine[]>([{ batchNumber: '', quantity: '', unit: 'UN', manufacturingDate: '', expiresAt: '' }])
  const [waste, setWaste] = useState<CompleteWasteLine[]>([])

  const openComplete = () => {
    if (!item) return
    setCompleteNote('')
    setConsumeFromLocationId(item.laboratory.defaultLocationId ?? '')
    setInputs([])
    setWaste([])
    setOutputs([
      {
        batchNumber: '',
        quantity: item.plannedOutputQuantity ? String(item.plannedOutputQuantity) : '',
        unit: item.outputUnit ?? 'UN',
        manufacturingDate: '',
        expiresAt: '',
      },
    ])
    setShowComplete(true)
  }

  const recipeDetailQuery = useQuery({
    queryKey: ['laboratory', 'recipe', item?.recipe.id ?? ''],
    queryFn: () => fetchRecipeDetail(auth.accessToken!, item!.recipe.id),
    enabled: !!auth.accessToken && !!showComplete && !!item?.recipe?.id,
  })

  const prefillFromRecipe = () => {
    const recipeItems = recipeDetailQuery.data?.item?.items ?? []
    if (!recipeItems.length) return

    setInputs((prev) => {
      const existing = new Set(prev.map((x) => x.supplyId).filter(Boolean))
      const additions: CompleteInputLine[] = recipeItems
        .filter((it) => it.supplyId && !existing.has(it.supplyId))
        .map((it) => ({
          supplyId: it.supplyId,
          lotId: '',
          quantity: String(it.quantity ?? ''),
          unit: String(it.unit ?? 'UN'),
          note: '',
        }))
      return [...prev, ...additions]
    })
  }

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error('Corrida no cargada')
      if (!item.laboratory.quarantineLocationId) throw new Error('Configurá quarantineLocationId en el laboratorio')

      const mappedOutputs = outputs
        .map((o) => ({
          batchNumber: o.batchNumber.trim(),
          quantity: Number(o.quantity),
          unit: o.unit.trim() || (item.outputUnit ?? 'UN'),
          manufacturingDate: o.manufacturingDate.trim() ? new Date(o.manufacturingDate).toISOString() : null,
          expiresAt: o.expiresAt.trim() ? new Date(o.expiresAt).toISOString() : null,
        }))
        .filter((o) => o.batchNumber && Number.isFinite(o.quantity) && o.quantity > 0)

      if (!mappedOutputs.length) throw new Error('Agregá al menos un output válido (lote + cantidad)')

      const fromLocationId = consumeFromLocationId.trim() ? consumeFromLocationId.trim() : null

      if ((inputs.length > 0 || waste.length > 0) && !fromLocationId) {
        throw new Error('Seleccioná la ubicación origen (insumos) para registrar consumo/merma')
      }

      const mappedInputs = inputs
        .map((i) => ({
          supplyId: i.supplyId,
          lotId: i.lotId.trim() ? i.lotId.trim() : null,
          fromLocationId,
          quantity: Number(i.quantity),
          unit: i.unit.trim() || 'UN',
          note: i.note.trim() ? i.note.trim() : null,
        }))
        .filter((i) => i.supplyId && Number.isFinite(i.quantity) && i.quantity > 0)

      const mappedWaste = waste
        .map((w) => ({
          supplyId: w.supplyId.trim() ? w.supplyId.trim() : null,
          lotId: w.lotId.trim() ? w.lotId.trim() : null,
          fromLocationId,
          quantity: Number(w.quantity),
          unit: w.unit.trim() || 'UN',
          reason: w.reason.trim() ? w.reason.trim() : null,
        }))
        .filter((w) => Number.isFinite(w.quantity) && w.quantity > 0)

      return completeRun(auth.accessToken!, runId, {
        note: completeNote.trim() ? completeNote.trim() : null,
        inputs: mappedInputs.length ? mappedInputs : undefined,
        waste: mappedWaste.length ? mappedWaste : undefined,
        outputs: mappedOutputs,
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-run', runId] })
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-runs'] })
      setShowComplete(false)
    },
  })

  const [releaseBatchId, setReleaseBatchId] = useState<string | null>(null)
  const [qcNote, setQcNote] = useState('')

  const releaseMutation = useMutation({
    mutationFn: () => releaseBatch(auth.accessToken!, releaseBatchId!, qcNote.trim() ? qcNote.trim() : null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-run', runId] })
      setReleaseBatchId(null)
      setQcNote('')
    },
  })

  const outputsColumns = useMemo(
    () => [
      { header: 'Lote', accessor: (o: any) => o.batch.batchNumber },
      { header: 'Estado', accessor: (o: any) => o.batch.status },
      { header: 'Cantidad', accessor: (o: any) => `${o.quantity} ${o.unit}` },
      { header: 'F. Fab', accessor: (o: any) => (o.batch.manufacturingDate ? new Date(o.batch.manufacturingDate).toLocaleDateString() : '—') },
      { header: 'Vence', accessor: (o: any) => (o.batch.expiresAt ? new Date(o.batch.expiresAt).toLocaleDateString() : '—') },
      {
        header: 'QC',
        accessor: (o: any) => (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setReleaseBatchId(o.batchId)
                setQcNote('')
              }}
              disabled={!canWrite || o.batch.status !== 'QUARANTINE'}
            >
              Liberar
            </Button>
          </div>
        ),
      },
    ],
    [canWrite],
  )

  const inputsColumns = useMemo(
    () => [
      { header: 'Insumo', accessor: (i: any) => i.supply.name, className: 'wrap' },
      { header: 'Lote', accessor: (i: any) => i.lot?.lotNumber ?? '—', className: 'wrap' },
      { header: 'Cantidad', accessor: (i: any) => `${i.quantity} ${i.unit}` },
      { header: 'Nota', accessor: (i: any) => i.note ?? '—', className: 'wrap' },
    ],
    [],
  )

  const wasteColumns = useMemo(
    () => [
      { header: 'Insumo', accessor: (w: any) => w.supply?.name ?? w.supplyId ?? '—', className: 'wrap' },
      { header: 'Lote', accessor: (w: any) => w.lot?.lotNumber ?? '—', className: 'wrap' },
      { header: 'Cantidad', accessor: (w: any) => `${w.quantity} ${w.unit}` },
      { header: 'Razón', accessor: (w: any) => w.reason ?? '—', className: 'wrap' },
    ],
    [],
  )

  const addInput = () => setInputs((prev) => [...prev, { supplyId: '', lotId: '', quantity: '1', unit: 'UN', note: '' }])
  const removeInput = (idx: number) => setInputs((prev) => prev.filter((_, i) => i !== idx))
  const addOutput = () => setOutputs((prev) => [...prev, { batchNumber: '', quantity: '', unit: item?.outputUnit ?? 'UN', manufacturingDate: '', expiresAt: '' }])
  const removeOutput = (idx: number) => setOutputs((prev) => prev.filter((_, i) => i !== idx))
  const addWaste = () => setWaste((prev) => [...prev, { supplyId: '', lotId: '', quantity: '1', unit: 'UN', reason: '' }])
  const removeWaste = (idx: number) => setWaste((prev) => prev.filter((_, i) => i !== idx))

  const activeLabs = useMemo(() => (labsQuery.data?.items ?? []).filter((l) => l.isActive), [labsQuery.data])
  const selectedLab = useMemo(() => {
    if (!item?.laboratoryId) return null
    return activeLabs.find((l) => l.id === item.laboratoryId) ?? null
  }, [activeLabs, item?.laboratoryId])

  const locationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'forRunComplete', selectedLab?.warehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, selectedLab!.warehouseId),
    enabled: !!auth.accessToken && !!selectedLab?.warehouseId,
  })

  const activeLocations = useMemo(() => (locationsQuery.data?.items ?? []).filter((l) => l.isActive), [locationsQuery.data])

  // Dynamic lot options per input line (single hook call)
  const balancesQueries = useQueries({
    queries: inputs.map((i) => ({
      queryKey: ['laboratory', 'supply-balances', { supplyId: i.supplyId, locationId: consumeFromLocationId }],
      queryFn: () => fetchSupplyBalances(auth.accessToken!, i.supplyId, consumeFromLocationId),
      enabled: !!auth.accessToken && !!consumeFromLocationId && !!i.supplyId,
    })),
  })

  // Dynamic lot options per waste line (single hook call)
  const wasteBalancesQueries = useQueries({
    queries: waste.map((w) => ({
      queryKey: ['laboratory', 'supply-balances', { supplyId: w.supplyId, locationId: consumeFromLocationId }],
      queryFn: () => fetchSupplyBalances(auth.accessToken!, w.supplyId, consumeFromLocationId),
      enabled: !!auth.accessToken && !!consumeFromLocationId && !!w.supplyId,
    })),
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title={item ? `🧪 Corrida — ${item.product.sku}` : '🧪 Corrida'}>
        {runQuery.isLoading ? (
          <Loading />
        ) : runQuery.error ? (
          <ErrorState message={(runQuery.error as any)?.message ?? 'Error al cargar corrida'} />
        ) : !item ? (
          <ErrorState message="No encontrado" />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <div>Estado: {item.status}</div>
                <div>Laboratorio: {item.laboratory.name}</div>
                <div>Producto: {item.product.sku} — {item.product.name}</div>
                <div>Receta: {item.recipe.name}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => navigate('/laboratory/production-runs')}>
                  Volver
                </Button>
                <Button onClick={() => startMutation.mutate()} disabled={!canWrite || startMutation.isPending || item.status !== 'DRAFT'}>
                  Iniciar
                </Button>
                <Button onClick={openComplete} disabled={!canWrite || item.status !== 'IN_PROGRESS'}>
                  Completar
                </Button>
              </div>
            </div>

            {item.note ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200">
                {item.note}
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">Outputs (batches)</div>
              <Table columns={outputsColumns as any} data={item.outputs ?? []} keyExtractor={(o: any) => o.id} />
            </div>

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">Inputs (consumo)</div>
              <Table columns={inputsColumns as any} data={item.inputs ?? []} keyExtractor={(i: any) => i.id} />
            </div>

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">Merma</div>
              <Table columns={wasteColumns as any} data={item.waste ?? []} keyExtractor={(w: any) => w.id} />
            </div>

            <Modal isOpen={showComplete} onClose={() => setShowComplete(false)} title="Completar corrida" maxWidth="2xl">
              <div className="space-y-4">
                <Input label="Nota (opcional)" value={completeNote} onChange={(e) => setCompleteNote(e.target.value)} />

                <Select
                  label="Ubicación origen (insumos)"
                  value={consumeFromLocationId}
                  onChange={(e) => setConsumeFromLocationId(e.target.value)}
                  options={[
                    { value: '', label: 'Seleccionar…' },
                    ...(consumeFromLocationId && !activeLocations.some((l) => l.id === consumeFromLocationId)
                      ? [{ value: consumeFromLocationId, label: `Actual: ${consumeFromLocationId.slice(0, 8)}…` }]
                      : []),
                    ...activeLocations.map((loc) => ({ value: loc.id, label: loc.code })),
                  ]}
                />

                {(inputs.length > 0 || waste.length > 0) && !consumeFromLocationId ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    Para registrar consumo/merma seleccioná una ubicación origen.
                  </div>
                ) : null}

                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium">Inputs (opcional)</div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={prefillFromRecipe}
                        disabled={recipeDetailQuery.isLoading || !(recipeDetailQuery.data?.item?.items?.length ?? 0)}
                      >
                        {recipeDetailQuery.isLoading ? 'Cargando receta…' : 'Cargar desde receta'}
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={addInput}>
                        + Agregar
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {inputs.map((i, idx) => {
                      const bq = balancesQueries[idx]
                      const balanceItems = (bq?.data?.items ?? []) as SupplyBalanceItem[]
                      return (
                        <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                          <div className="md:col-span-4">
                            <Select
                              label={idx === 0 ? 'Insumo' : undefined}
                              value={i.supplyId}
                              onChange={(e) => {
                                const supplyId = e.target.value
                                const supply = supplies.find((s) => s.id === supplyId)
                                setInputs((prev) =>
                                  prev.map((x, j) =>
                                    j === idx
                                      ? {
                                          ...x,
                                          supplyId,
                                          lotId: '',
                                          unit: x.unit?.trim() ? x.unit : supply?.baseUnit ?? x.unit,
                                        }
                                      : x,
                                  ),
                                )
                              }}
                              options={[
                                { value: '', label: 'Seleccionar…' },
                                ...supplies.map((s) => ({
                                  value: s.id,
                                  label: `${s.name}${s.code ? ` (${s.code})` : ''} — ${s.baseUnit}`,
                                })),
                              ]}
                            />
                          </div>
                          <div className="md:col-span-4">
                            <Select
                              label={idx === 0 ? 'Lote' : undefined}
                              value={i.lotId}
                              onChange={(e) => setInputs((prev) => prev.map((x, j) => (j === idx ? { ...x, lotId: e.target.value } : x)))}
                              options={[
                                { value: '', label: '— sin lote —' },
                                ...balanceItems
                                  .filter((x) => !!x.lotId)
                                  .map((x) => ({
                                    value: x.lotId as string,
                                    label: `${x.lot?.lotNumber ?? x.lotId} — ${x.quantity} @ ${x.location.code}${x.lot?.expiresAt ? ` (vence ${new Date(x.lot.expiresAt).toLocaleDateString()})` : ''}`,
                                  })),
                              ]}
                              disabled={!i.supplyId || !consumeFromLocationId}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Input
                              label={idx === 0 ? 'Cantidad' : undefined}
                              type="number"
                              min={0}
                              step={0.01}
                              value={i.quantity}
                              onChange={(e) => setInputs((prev) => prev.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)))}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Input
                              label={idx === 0 ? 'Unidad' : undefined}
                              value={i.unit}
                              onChange={(e) => setInputs((prev) => prev.map((x, j) => (j === idx ? { ...x, unit: e.target.value } : x)))}
                            />
                          </div>
                          <div className="md:col-span-11">
                            <Input
                              label={idx === 0 ? 'Nota' : undefined}
                              value={i.note}
                              onChange={(e) => setInputs((prev) => prev.map((x, j) => (j === idx ? { ...x, note: e.target.value } : x)))}
                            />
                          </div>
                          <div className="md:col-span-1 flex items-end justify-end">
                            <Button type="button" variant="secondary" size="sm" onClick={() => removeInput(idx)}>
                              ✕
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                    {inputs.length === 0 ? (
                      <div className="text-sm text-slate-600 dark:text-slate-300">(Opcional) cargá consumo de insumos.</div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium">Outputs (requerido)</div>
                    <Button type="button" variant="secondary" size="sm" onClick={addOutput}>
                      + Agregar
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {outputs.map((o, idx) => (
                      <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                        <div className="md:col-span-4">
                          <Input
                            label={idx === 0 ? 'Lote / Batch' : undefined}
                            value={o.batchNumber}
                            onChange={(e) => setOutputs((prev) => prev.map((x, j) => (j === idx ? { ...x, batchNumber: e.target.value } : x)))}
                            placeholder="Ej: LAB-2026-001"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Input
                            label={idx === 0 ? 'Cantidad' : undefined}
                            type="number"
                            min={0}
                            step={0.01}
                            value={o.quantity}
                            onChange={(e) => setOutputs((prev) => prev.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)))}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Input
                            label={idx === 0 ? 'Unidad' : undefined}
                            value={o.unit}
                            onChange={(e) => setOutputs((prev) => prev.map((x, j) => (j === idx ? { ...x, unit: e.target.value } : x)))}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Input
                            label={idx === 0 ? 'F. Fab (opt)' : undefined}
                            type="date"
                            value={o.manufacturingDate}
                            onChange={(e) => setOutputs((prev) => prev.map((x, j) => (j === idx ? { ...x, manufacturingDate: e.target.value } : x)))}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Input
                            label={idx === 0 ? 'Vence (opt)' : undefined}
                            type="date"
                            value={o.expiresAt}
                            onChange={(e) => setOutputs((prev) => prev.map((x, j) => (j === idx ? { ...x, expiresAt: e.target.value } : x)))}
                          />
                        </div>
                        <div className="md:col-span-12 flex justify-end">
                          <Button type="button" variant="secondary" size="sm" onClick={() => removeOutput(idx)}>
                            Quitar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium">Merma (opcional)</div>
                    <Button type="button" variant="secondary" size="sm" onClick={addWaste}>
                      + Agregar
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {waste.map((w, idx) => (
                      <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                        <div className="md:col-span-4">
                          <Select
                            label={idx === 0 ? 'Insumo (opt)' : undefined}
                            value={w.supplyId}
                            onChange={(e) => {
                              const supplyId = e.target.value
                              const supply = supplies.find((s) => s.id === supplyId)
                              setWaste((prev) =>
                                prev.map((x, j) =>
                                  j === idx
                                    ? {
                                        ...x,
                                        supplyId,
                                        lotId: '',
                                        unit: x.unit?.trim() ? x.unit : supply?.baseUnit ?? x.unit,
                                      }
                                    : x,
                                ),
                              )
                            }}
                            options={[
                              { value: '', label: '—' },
                              ...supplies.map((s) => ({
                                value: s.id,
                                label: `${s.name}${s.code ? ` (${s.code})` : ''} — ${s.baseUnit}`,
                              })),
                            ]}
                          />
                        </div>
                        <div className="md:col-span-3">
                          {(() => {
                            const bq = wasteBalancesQueries[idx]
                            const balanceItems = (bq?.data?.items ?? []) as SupplyBalanceItem[]
                            return (
                              <Select
                                label={idx === 0 ? 'Lote (opt)' : undefined}
                                value={w.lotId}
                                onChange={(e) => setWaste((prev) => prev.map((x, j) => (j === idx ? { ...x, lotId: e.target.value } : x)))}
                                options={[
                                  { value: '', label: '— sin lote —' },
                                  ...balanceItems
                                    .filter((x) => !!x.lotId)
                                    .map((x) => ({
                                      value: x.lotId as string,
                                      label: `${x.lot?.lotNumber ?? x.lotId} — ${x.quantity} @ ${x.location.code}${x.lot?.expiresAt ? ` (vence ${new Date(x.lot.expiresAt).toLocaleDateString()})` : ''}`,
                                    })),
                                ]}
                                disabled={!w.supplyId || !consumeFromLocationId}
                              />
                            )
                          })()}
                        </div>
                        <div className="md:col-span-2">
                          <Input
                            label={idx === 0 ? 'Cantidad' : undefined}
                            type="number"
                            min={0}
                            step={0.01}
                            value={w.quantity}
                            onChange={(e) => setWaste((prev) => prev.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)))}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Input
                            label={idx === 0 ? 'Unidad' : undefined}
                            value={w.unit}
                            onChange={(e) => setWaste((prev) => prev.map((x, j) => (j === idx ? { ...x, unit: e.target.value } : x)))}
                          />
                        </div>
                        <div className="md:col-span-12">
                          <Input
                            label={idx === 0 ? 'Razón (opt)' : undefined}
                            value={w.reason}
                            onChange={(e) => setWaste((prev) => prev.map((x, j) => (j === idx ? { ...x, reason: e.target.value } : x)))}
                          />
                        </div>
                        <div className="md:col-span-12 flex justify-end">
                          <Button type="button" variant="secondary" size="sm" onClick={() => removeWaste(idx)}>
                            Quitar
                          </Button>
                        </div>
                      </div>
                    ))}
                    {waste.length === 0 ? (
                      <div className="text-sm text-slate-600 dark:text-slate-300">(Opcional) registrá merma.</div>
                    ) : null}
                  </div>
                </div>

                {completeMutation.error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                    {(completeMutation.error as any)?.message ?? 'Error al completar'}
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setShowComplete(false)} disabled={completeMutation.isPending}>
                    Cancelar
                  </Button>
                  <Button onClick={() => completeMutation.mutate()} disabled={!canWrite || completeMutation.isPending}>
                    {completeMutation.isPending ? 'Completando…' : 'Completar'}
                  </Button>
                </div>
              </div>
            </Modal>

            <Modal isOpen={!!releaseBatchId} onClose={() => setReleaseBatchId(null)} title="Liberar QC" maxWidth="lg">
              <div className="space-y-4">
                <Input label="Nota QC (opcional)" value={qcNote} onChange={(e) => setQcNote(e.target.value)} />

                {releaseMutation.error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                    {(releaseMutation.error as any)?.message ?? 'Error al liberar'}
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setReleaseBatchId(null)} disabled={releaseMutation.isPending}>
                    Cancelar
                  </Button>
                  <Button onClick={() => releaseMutation.mutate()} disabled={!canWrite || releaseMutation.isPending}>
                    {releaseMutation.isPending ? 'Liberando…' : 'Liberar'}
                  </Button>
                </div>
              </div>
            </Modal>

            {startMutation.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {(startMutation.error as any)?.message ?? 'Error al iniciar'}
              </div>
            ) : null}
          </div>
        )}
      </PageContainer>
    </MainLayout>
  )
}
