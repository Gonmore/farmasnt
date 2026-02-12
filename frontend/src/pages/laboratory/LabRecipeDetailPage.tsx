import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Loading, ErrorState, Button, Input, Select, Modal } from '../../components'
import { ProductSelector, type ProductSelectorItem } from '../../components/ProductSelector'
import { PlusIcon } from '@heroicons/react/24/outline'

type SupplyItem = { id: string; code: string | null; name: string; baseUnit: string; isActive: boolean; totalStock: number }

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

type RecipeItem = {
  id: string
  supplyId: string
  quantity: string
  unit: string
  sortOrder: number
  note: string | null
  supply: { name: string; baseUnit: string }
}

type Recipe = {
  id: string
  productId: string
  name: string
  outputQuantity: string | null
  outputUnit: string | null
  isActive: boolean
  updatedAt: string
  product: { sku: string; name: string }
  items: RecipeItem[]
}

type RecipeItemDraft = { supplyId: string; quantity: string; unit: string; note: string }

async function listSupplies(token: string): Promise<{ items: SupplyItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ take: '100' })
  params.set('category', 'RAW_MATERIAL')
  return apiFetch(`/api/v1/laboratory/supplies?${params}`, { token })
}

async function fetchProductPresentations(token: string, productId: string): Promise<{ items: ProductPresentation[] }> {
  return apiFetch(`/api/v1/products/${productId}/presentations`, { token })
}

async function fetchRecipe(token: string, id: string): Promise<{ item: Recipe }> {
  return apiFetch(`/api/v1/laboratory/recipes/${encodeURIComponent(id)}`, { token })
}

async function createRecipe(
  token: string,
  body: {
    productId: string
    name: string
    outputQuantity?: number | null
    outputUnit?: string | null
    items: Array<{ supplyId: string; quantity: number; unit: string; note?: string | null; sortOrder?: number }>
  },
): Promise<{ id: string }> {
  return apiFetch('/api/v1/laboratory/recipes', { token, method: 'POST', body: JSON.stringify(body) })
}

async function updateRecipe(
  token: string,
  id: string,
  body: {
    name?: string
    outputQuantity?: number | null
    outputUnit?: string | null
    isActive?: boolean
    items?: Array<{ supplyId: string; quantity: number; unit: string; note?: string | null; sortOrder?: number }>
  },
): Promise<{ ok: true; id: string }> {
  return apiFetch(`/api/v1/laboratory/recipes/${encodeURIComponent(id)}`, { token, method: 'PATCH', body: JSON.stringify(body) })
}

async function createSupply(
  token: string,
  body: {
    name: string
    baseUnit: string
    code?: string | null
    category?: 'RAW_MATERIAL' | 'MAINTENANCE'
    initialStock?: number
    locationId?: string
  },
): Promise<{ id: string }> {
  return apiFetch('/api/v1/laboratory/supplies', { token, method: 'POST', body: JSON.stringify(body) })
}

function presentationLabel(pres: ProductPresentation | null | undefined): string {
  if (!pres) return 'Unidad'
  const name = String(pres.name ?? '').trim()
  const units = Number(pres.unitsPerPresentation) || 0
  if (!name || name.toLowerCase() === 'unidad' || !units || units <= 1) return 'Unidad'
  return `${name} (${Math.trunc(units)}u)`
}

export function LabRecipeDetailPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const recipeId = !isNew ? (id ?? '') : ''

  const canWrite = perms.hasPermission('stock:manage')

  const [product, setProduct] = useState<ProductSelectorItem | null>(null)
  const [name, setName] = useState('')
  const [outputQuantity, setOutputQuantity] = useState('')
  const [outputUnit, setOutputUnit] = useState('')
  const [outputUnitCustom, setOutputUnitCustom] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [items, setItems] = useState<RecipeItemDraft[]>([{ supplyId: '', quantity: '1', unit: 'UN', note: '' }])

  // Supply creation modal state
  const [showCreateSupplyModal, setShowCreateSupplyModal] = useState(false)
  const [newSupplyName, setNewSupplyName] = useState('')
  const [newSupplyCode, setNewSupplyCode] = useState('')
  const [newSupplyBaseUnit, setNewSupplyBaseUnit] = useState('')
  const [newSupplyInitialStock, setNewSupplyInitialStock] = useState('')

  const suppliesQuery = useQuery({
    queryKey: ['laboratory', 'supplies', { take: 100, cursor: undefined }],
    queryFn: () => listSupplies(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const recipeQuery = useQuery({
    queryKey: ['laboratory', 'recipe', recipeId],
    queryFn: () => fetchRecipe(auth.accessToken!, recipeId),
    enabled: !!auth.accessToken && !isNew && !!recipeId,
  })

  const presentationsQuery = useQuery({
    queryKey: ['productPresentations', product?.id],
    queryFn: () => fetchProductPresentations(auth.accessToken!, product!.id),
    enabled: !!auth.accessToken && !!product?.id,
  })

  const supplies = useMemo(() => (suppliesQuery.data?.items ?? []).filter((s) => s.isActive), [suppliesQuery.data])

  const activePresentations = useMemo(
    () => (presentationsQuery.data?.items ?? []).filter((p) => p.isActive !== false),
    [presentationsQuery.data]
  )

  const outputUnitOptions = useMemo(() => {
    const options = activePresentations.map((p) => ({
      value: p.id,
      label: presentationLabel(p),
    }))
    options.push({ value: 'other', label: 'Otro' })
    return options
  }, [activePresentations])

  const selectedPresentation = activePresentations.find((p) => p.id === outputUnit)
  const isCustomUnit = outputUnit === 'other'

  useEffect(() => {
    if (!recipeQuery.data?.item) return
    const r = recipeQuery.data.item
    setProduct({ id: r.productId, sku: r.product.sku, name: r.product.name })
    setName(r.name)
    setOutputQuantity(r.outputQuantity ? String(r.outputQuantity) : '')
    // Handle output unit - check if it matches any presentation or set as custom
    if (r.outputUnit) {
      // We'll set this after presentations are loaded
      setOutputUnit('') // Reset first
      setOutputUnitCustom(r.outputUnit)
    } else {
      setOutputUnit('')
      setOutputUnitCustom('')
    }
    setIsActive(r.isActive)
    setItems(
      (r.items ?? []).map((it) => ({
        supplyId: it.supplyId,
        quantity: String(it.quantity),
        unit: it.unit,
        note: it.note ?? '',
      })),
    )
  }, [recipeQuery.data])

  useEffect(() => {
    // When product changes, reset output unit selections
    if (product) {
      setOutputUnit('')
      setOutputUnitCustom('')
    }
  }, [product])

  useEffect(() => {
    // When presentations load and we have an existing outputUnit, try to match it
    if (activePresentations.length > 0 && outputUnitCustom && !outputUnit) {
      const matchingPresentation = activePresentations.find(p => presentationLabel(p) === outputUnitCustom)
      if (matchingPresentation) {
        setOutputUnit(matchingPresentation.id)
        setOutputUnitCustom('')
      } else {
        setOutputUnit('other')
        // Keep outputUnitCustom as is
      }
    }
  }, [activePresentations, outputUnitCustom, outputUnit])

  const addLine = () => setItems((prev) => [...prev, { supplyId: '', quantity: '1', unit: 'UN', note: '' }])
  const removeLine = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const saveMutation = useMutation({
    mutationFn: async () => {
      const mappedItems = items
        .map((it, idx) => ({
          supplyId: it.supplyId,
          quantity: Number(it.quantity),
          unit: it.unit.trim() || 'UN',
          note: it.note.trim() ? it.note.trim() : null,
          sortOrder: idx,
        }))
        .filter((x) => x.supplyId && Number.isFinite(x.quantity) && x.quantity > 0)

      if (!mappedItems.length) throw new Error('Agregá al menos un insumo con cantidad válida')

      const outQty = outputQuantity.trim() ? Number(outputQuantity) : null
      const outUnit = isCustomUnit
        ? (outputUnitCustom.trim() || null)
        : selectedPresentation
        ? presentationLabel(selectedPresentation)
        : outputUnit.trim() || null

      if (isNew) {
        if (!product?.id) throw new Error('Seleccioná un producto')
        return createRecipe(auth.accessToken!, {
          productId: product.id,
          name: name.trim() || 'Receta',
          outputQuantity: outQty,
          outputUnit: outUnit,
          items: mappedItems,
        })
      }

      return updateRecipe(auth.accessToken!, recipeId, {
        name: name.trim() || 'Receta',
        outputQuantity: outQty,
        outputUnit: outUnit,
        isActive,
        items: mappedItems,
      })
    },
    onSuccess: async (res: any) => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'recipes'] })
      if (isNew && res?.id) {
        navigate(`/laboratory/recipes/${encodeURIComponent(res.id)}`)
      } else {
        await qc.invalidateQueries({ queryKey: ['laboratory', 'recipe', recipeId] })
      }
    },
  })

  const createSupplyMutation = useMutation({
    mutationFn: async () => {
      if (!newSupplyName.trim() || !newSupplyBaseUnit.trim()) {
        throw new Error('Nombre y unidad base son requeridos')
      }

      const initialStock = newSupplyInitialStock.trim() ? Number(newSupplyInitialStock) : undefined
      if (initialStock !== undefined && (isNaN(initialStock) || initialStock < 0)) {
        throw new Error('Stock inicial debe ser un número positivo')
      }

      return createSupply(auth.accessToken!, {
        name: newSupplyName.trim(),
        baseUnit: newSupplyBaseUnit.trim(),
        code: newSupplyCode.trim() || undefined,
        category: 'RAW_MATERIAL',
        initialStock,
      })
    },
    onSuccess: async () => {
      // Refresh supplies list
      await qc.invalidateQueries({ queryKey: ['laboratory', 'supplies'] })
      // Reset modal state
      setNewSupplyName('')
      setNewSupplyCode('')
      setNewSupplyBaseUnit('')
      setNewSupplyInitialStock('')
      setShowCreateSupplyModal(false)
    },
  })

  const canRender = isNew || !!recipeQuery.data?.item

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title={isNew ? '🧪 Nueva receta' : '🧪 Receta'}>
        {!canRender && recipeQuery.isLoading ? (
          <Loading />
        ) : recipeQuery.error ? (
          <ErrorState message={(recipeQuery.error as any)?.message ?? 'Error al cargar receta'} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Button variant="secondary" onClick={() => navigate('/laboratory/recipes')}>
                Volver
              </Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!canWrite || saveMutation.isPending}>
                {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Producto</label>
                <ProductSelector
                  value={product ? { id: product.id, label: `${product.sku} — ${product.name}` } : null}
                  onChange={(p) => setProduct(p)}
                  disabled={!canWrite || !isNew}
                  placeholder="Buscar producto…"
                />
                {!isNew && recipeQuery.data?.item ? (
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">1 receta por producto.</div>
                ) : null}
              </div>
              <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Input
                label="Cantidad salida (opcional)"
                type="number"
                min={0}
                step={0.01}
                value={outputQuantity}
                onChange={(e) => setOutputQuantity(e.target.value)}
                disabled={!canWrite}
              />
              <Select
                label="Unidad salida (opcional)"
                value={outputUnit}
                onChange={(e) => {
                  setOutputUnit(e.target.value)
                  if (e.target.value !== 'other') {
                    setOutputUnitCustom('')
                  }
                }}
                disabled={!canWrite || !product}
                options={outputUnitOptions}
              />
              {isCustomUnit && (
                <Input
                  label="Unidad personalizada"
                  value={outputUnitCustom}
                  onChange={(e) => setOutputUnitCustom(e.target.value)}
                  disabled={!canWrite}
                  placeholder="Ej: Caja, Blíster, etc."
                />
              )}
              {!isNew ? (
                <Select
                  label="Activa"
                  value={isActive ? 'YES' : 'NO'}
                  onChange={(e) => setIsActive(e.target.value === 'YES')}
                  disabled={!canWrite}
                  options={[
                    { value: 'YES', label: 'Sí' },
                    { value: 'NO', label: 'No' },
                  ]}
                />
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">Insumos</div>
                <Button type="button" variant="ghost" size="sm" icon={<PlusIcon />} onClick={addLine} disabled={!canWrite}>
                  Agregar
                </Button>
              </div>

              {suppliesQuery.isLoading ? (
                <div className="text-sm text-slate-600 dark:text-slate-300">Cargando insumos…</div>
              ) : suppliesQuery.error ? (
                <div className="text-sm text-red-700">Error al cargar insumos</div>
              ) : (
                <div className="space-y-3">
                  {items.map((it, idx) => (
                    <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                      <div className="md:col-span-6">
                        <Select
                          label={idx === 0 ? 'Insumo' : undefined}
                          value={it.supplyId}
                          onChange={(e) => {
                            if (e.target.value === '__create_new__') {
                              // Reset the select value and open modal
                              setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, supplyId: '' } : x)))
                              setShowCreateSupplyModal(true)
                            } else {
                              setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, supplyId: e.target.value } : x)))
                            }
                          }}
                          disabled={!canWrite}
                          options={[
                            { value: '', label: 'Seleccionar…' },
                            { value: '__create_new__', label: '+ Nuevo insumo' },
                            ...supplies.map((s) => ({
                              value: s.id,
                              label: `${s.name}${s.code ? ` (${s.code})` : ''} — ${s.baseUnit} (Stock: ${s.totalStock})`,
                            })),
                          ]}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Input
                          label={idx === 0 ? 'Cantidad' : undefined}
                          type="number"
                          min={0}
                          step={0.01}
                          value={it.quantity}
                          onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))}
                          disabled={!canWrite}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Input
                          label={idx === 0 ? 'Unidad' : undefined}
                          value={it.unit}
                          onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                          disabled={!canWrite}
                        />
                      </div>
                      <div className="md:col-span-2 flex items-end justify-end">
                        <Button type="button" variant="secondary" size="sm" onClick={() => removeLine(idx)} disabled={!canWrite}>
                          ✕
                        </Button>
                      </div>
                      <div className="md:col-span-12">
                        <Input
                          label={idx === 0 ? 'Nota (opcional)' : undefined}
                          value={it.note}
                          onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x)))}
                          disabled={!canWrite}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {saveMutation.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {(saveMutation.error as any)?.message ?? 'Error al guardar'}
              </div>
            ) : null}
          </div>
        )}
      </PageContainer>

      <Modal
        isOpen={showCreateSupplyModal}
        onClose={() => setShowCreateSupplyModal(false)}
        title="Crear nuevo insumo"
      >
        <div className="space-y-4">
          <Input
            label="Nombre"
            value={newSupplyName}
            onChange={(e) => setNewSupplyName(e.target.value)}
            placeholder="Ej: Paracetamol 500mg"
            required
          />
          <Input
            label="Código (opcional)"
            value={newSupplyCode}
            onChange={(e) => setNewSupplyCode(e.target.value)}
            placeholder="Ej: PARA500"
          />
          <Input
            label="Unidad base"
            value={newSupplyBaseUnit}
            onChange={(e) => setNewSupplyBaseUnit(e.target.value)}
            placeholder="Ej: UN, KG, L, MG"
            required
          />
          <Input
            label="Stock inicial (opcional)"
            type="number"
            min={0}
            step={0.01}
            value={newSupplyInitialStock}
            onChange={(e) => setNewSupplyInitialStock(e.target.value)}
            placeholder="Cantidad inicial en inventario"
          />

          {createSupplyMutation.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {(createSupplyMutation.error as any)?.message ?? 'Error al crear insumo'}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowCreateSupplyModal(false)}
              disabled={createSupplyMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => createSupplyMutation.mutate()}
              disabled={createSupplyMutation.isPending}
            >
              {createSupplyMutation.isPending ? 'Creando…' : 'Crear insumo'}
            </Button>
          </div>
        </div>
      </Modal>
    </MainLayout>
  )
}
