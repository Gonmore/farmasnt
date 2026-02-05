import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Loading, ErrorState, Button, Input, Select } from '../../components'
import { ProductSelector, type ProductSelectorItem } from '../../components/ProductSelector'

type SupplyItem = { id: string; code: string | null; name: string; baseUnit: string; isActive: boolean }

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

  const supplies = useMemo(() => (suppliesQuery.data?.items ?? []).filter((s) => s.isActive), [suppliesQuery.data])

  const [product, setProduct] = useState<ProductSelectorItem | null>(null)
  const [name, setName] = useState('')
  const [outputQuantity, setOutputQuantity] = useState('')
  const [outputUnit, setOutputUnit] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [items, setItems] = useState<RecipeItemDraft[]>([{ supplyId: '', quantity: '1', unit: 'UN', note: '' }])

  useEffect(() => {
    if (!recipeQuery.data?.item) return
    const r = recipeQuery.data.item
    setProduct({ id: r.productId, sku: r.product.sku, name: r.product.name })
    setName(r.name)
    setOutputQuantity(r.outputQuantity ? String(r.outputQuantity) : '')
    setOutputUnit(r.outputUnit ?? '')
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
      const outUnit = outputUnit.trim() ? outputUnit.trim() : null

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
              <Input label="Unidad salida (opcional)" value={outputUnit} onChange={(e) => setOutputUnit(e.target.value)} disabled={!canWrite} />
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
                <Button type="button" variant="secondary" size="sm" onClick={addLine} disabled={!canWrite}>
                  + Agregar
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
                          onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, supplyId: e.target.value } : x)))}
                          disabled={!canWrite}
                          options={[
                            { value: '', label: 'Seleccionar…' },
                            ...supplies.map((s) => ({
                              value: s.id,
                              label: `${s.name}${s.code ? ` (${s.code})` : ''} — ${s.baseUnit}`,
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
    </MainLayout>
  )
}
