import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Table, Loading, ErrorState, PaginationCursor, Button, Modal, Input, Select } from '../../components'
import { ProductSelector, type ProductSelectorItem } from '../../components/ProductSelector'

type LabItem = { id: string; name: string; city: string | null; isActive: boolean }

type RecipeListItem = {
  id: string
  productId: string
  name: string
  outputQuantity: string | null
  outputUnit: string | null
  isActive: boolean
  product: { sku: string; name: string }
}

type RequestListItem = {
  id: string
  laboratoryId: string
  productId: string
  recipeId: string
  requestedOutputQuantity: string
  outputUnit: string
  status: 'DRAFT' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  neededBy: string | null
  createdAt: string
  updatedAt: string
  laboratory: { id: string; name: string; city: string | null }
  product: { sku: string; name: string }
  recipe: { name: string }
}

type ListResponse<T> = { items: T[]; nextCursor: string | null }

async function listRequests(token: string, take: number, cursor?: string): Promise<ListResponse<RequestListItem>> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/api/v1/laboratory/production-requests?${params}`, { token })
}

async function listLabs(token: string): Promise<{ items: LabItem[] }> {
  return apiFetch('/api/v1/laboratories', { token })
}

async function listRecipes(token: string): Promise<ListResponse<RecipeListItem>> {
  const params = new URLSearchParams({ take: '100' })
  return apiFetch(`/api/v1/laboratory/recipes?${params}`, { token })
}

async function createRequest(
  token: string,
  body: {
    laboratoryId: string
    productId: string
    recipeId: string
    requestedOutputQuantity: number
    outputUnit: string
    neededBy?: string | null
    note?: string | null
  },
): Promise<{ id: string }> {
  return apiFetch('/api/v1/laboratory/production-requests', { token, method: 'POST', body: JSON.stringify(body) })
}

export function LabProductionRequestsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const canWrite = perms.hasPermission('stock:manage')

  const [cursor, setCursor] = useState<string | undefined>()
  const take = 50

  const requestsQuery = useQuery({
    queryKey: ['laboratory', 'production-requests', { take, cursor }],
    queryFn: () => listRequests(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const labsQuery = useQuery({
    queryKey: ['laboratory', 'labs'],
    queryFn: () => listLabs(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const recipesQuery = useQuery({
    queryKey: ['laboratory', 'recipes', { take: 100, cursor: undefined }],
    queryFn: () => listRecipes(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const [showCreate, setShowCreate] = useState(false)
  const [selectedLabId, setSelectedLabId] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<ProductSelectorItem | null>(null)
  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [note, setNote] = useState('')

  const activeLabs = (labsQuery.data?.items ?? []).filter((l) => l.isActive)
  const activeRecipes = (recipesQuery.data?.items ?? []).filter((r) => r.isActive)

  const recipesForProduct = useMemo(() => {
    if (!selectedProduct?.id) return activeRecipes
    return activeRecipes.filter((r) => r.productId === selectedProduct.id)
  }, [activeRecipes, selectedProduct])

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLabId) throw new Error('Seleccioná un laboratorio')
      if (!selectedProduct?.id) throw new Error('Seleccioná un producto')
      if (!selectedRecipeId) throw new Error('Seleccioná una receta')

      const q = Number(qty)
      if (!Number.isFinite(q) || q <= 0) throw new Error('Cantidad inválida')
      const u = unit.trim()
      if (!u) throw new Error('Unidad requerida')

      return createRequest(auth.accessToken!, {
        laboratoryId: selectedLabId,
        productId: selectedProduct.id,
        recipeId: selectedRecipeId,
        requestedOutputQuantity: q,
        outputUnit: u,
        neededBy: neededBy.trim() ? new Date(neededBy).toISOString() : null,
        note: note.trim() ? note.trim() : null,
      })
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['laboratory', 'production-requests'] })
      setShowCreate(false)
      setSelectedLabId('')
      setSelectedProduct(null)
      setSelectedRecipeId('')
      setQty('')
      setUnit('')
      setNeededBy('')
      setNote('')
      navigate(`/laboratory/production-requests/${encodeURIComponent(res.id)}`)
    },
  })

  const columns = useMemo(
    () => [
      { header: 'Estado', accessor: (r: RequestListItem) => r.status },
      { header: 'Laboratorio', accessor: (r: RequestListItem) => r.laboratory.name, className: 'wrap' },
      { header: 'Producto', accessor: (r: RequestListItem) => `${r.product.sku} — ${r.product.name}`, className: 'wrap' },
      { header: 'Receta', accessor: (r: RequestListItem) => r.recipe.name, className: 'wrap' },
      { header: 'Cantidad', accessor: (r: RequestListItem) => `${r.requestedOutputQuantity} ${r.outputUnit}` },
      { header: 'Necesario', accessor: (r: RequestListItem) => (r.neededBy ? new Date(r.neededBy).toLocaleDateString() : '—'), className: 'wrap' },
      {
        header: 'Acciones',
        accessor: (r: RequestListItem) => (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/laboratory/production-requests/${encodeURIComponent(r.id)}`)}>
              Ver
            </Button>
          </div>
        ),
      },
    ],
    [navigate],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="🧪 Laboratorio — Plan de produc">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm text-slate-600 dark:text-slate-300">DRAFT → APPROVED → IN_PROGRESS → COMPLETED.</div>
          <Button onClick={() => setShowCreate(true)} disabled={!canWrite}>
            Nueva solicitud
          </Button>
        </div>

        {requestsQuery.isLoading ? (
          <Loading />
        ) : requestsQuery.error ? (
          <ErrorState message={(requestsQuery.error as any)?.message ?? 'Error al cargar el plan'} />
        ) : (
          <>
            <Table columns={columns as any} data={requestsQuery.data?.items ?? []} keyExtractor={(r: RequestListItem) => r.id} />
            <div className="mt-3">
              <PaginationCursor
                hasMore={!!requestsQuery.data?.nextCursor}
                onLoadMore={() => setCursor(requestsQuery.data!.nextCursor!)}
                loading={requestsQuery.isFetching}
              />
            </div>
          </>
        )}

        <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nueva solicitud" maxWidth="2xl">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                label="Laboratorio"
                value={selectedLabId}
                onChange={(e) => setSelectedLabId(e.target.value)}
                options={[
                  { value: '', label: 'Seleccionar…' },
                  ...activeLabs.map((l) => ({ value: l.id, label: `${l.name}${l.city ? ` (${l.city})` : ''}` })),
                ]}
              />
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Producto</label>
                <ProductSelector
                  value={selectedProduct ? { id: selectedProduct.id, label: `${selectedProduct.sku} — ${selectedProduct.name}` } : null}
                  onChange={(p) => {
                    setSelectedProduct(p)
                    setSelectedRecipeId('')
                  }}
                  disabled={!canWrite}
                  placeholder="Buscar producto…"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Select
                label="Receta"
                value={selectedRecipeId}
                onChange={(e) => {
                  const v = e.target.value
                  setSelectedRecipeId(v)
                  const rec = activeRecipes.find((r) => r.id === v)
                  if (rec?.outputUnit) setUnit(rec.outputUnit)
                }}
                options={[
                  { value: '', label: 'Seleccionar…' },
                  ...recipesForProduct.map((r) => ({ value: r.id, label: `${r.name} — ${r.product.sku}` })),
                ]}
              />
              <Input label="Cantidad" type="number" min={0} step={0.01} value={qty} onChange={(e) => setQty(e.target.value)} />
              <Input label="Unidad" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Ej: UN" />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input label="Necesario para (opcional)" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {createMutation.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {(createMutation.error as any)?.message ?? 'Error al crear'}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={createMutation.isPending}>
                Cancelar
              </Button>
              <Button onClick={() => createMutation.mutate()} disabled={!canWrite || createMutation.isPending}>
                {createMutation.isPending ? 'Creando…' : 'Crear'}
              </Button>
            </div>
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
