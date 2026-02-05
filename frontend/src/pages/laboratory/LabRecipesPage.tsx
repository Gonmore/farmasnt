import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigation, usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Table, Loading, ErrorState, PaginationCursor, Button } from '../../components'

type RecipeListItem = {
  id: string
  productId: string
  name: string
  outputQuantity: string | null
  outputUnit: string | null
  isActive: boolean
  updatedAt: string
  product: { sku: string; name: string }
}

type ListResponse = { items: RecipeListItem[]; nextCursor: string | null }

async function listRecipes(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/api/v1/laboratory/recipes?${params}`, { token })
}

export function LabRecipesPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const navigate = useNavigate()

  const canWrite = perms.hasPermission('stock:manage')

  const [cursor, setCursor] = useState<string | undefined>()
  const take = 50

  const recipesQuery = useQuery({
    queryKey: ['laboratory', 'recipes', { take, cursor }],
    queryFn: () => listRecipes(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const columns = useMemo(
    () => [
      { header: 'Producto', accessor: (r: RecipeListItem) => `${r.product.sku} — ${r.product.name}`, className: 'wrap' },
      { header: 'Receta', accessor: (r: RecipeListItem) => r.name, className: 'wrap' },
      {
        header: 'Salida',
        accessor: (r: RecipeListItem) =>
          r.outputQuantity && r.outputUnit ? `${r.outputQuantity} ${r.outputUnit}` : r.outputQuantity ? `${r.outputQuantity}` : '—',
      },
      { header: 'Activa', accessor: (r: RecipeListItem) => (r.isActive ? 'Sí' : 'No') },
      { header: 'Actualizado', accessor: (r: RecipeListItem) => new Date(r.updatedAt).toLocaleString(), className: 'wrap' },
      {
        header: 'Acciones',
        accessor: (r: RecipeListItem) => (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate(`/laboratory/recipes/${encodeURIComponent(r.id)}`)}>
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
      <PageContainer title="🧪 Laboratorio — Recetas">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm text-slate-600 dark:text-slate-300">Recetas por producto (1 por producto).</div>
          <Button onClick={() => navigate('/laboratory/recipes/new')} disabled={!canWrite}>
            Nueva receta
          </Button>
        </div>

        {recipesQuery.isLoading ? (
          <Loading />
        ) : recipesQuery.error ? (
          <ErrorState message={(recipesQuery.error as any)?.message ?? 'Error al cargar recetas'} />
        ) : (
          <>
            <Table columns={columns as any} data={recipesQuery.data?.items ?? []} keyExtractor={(r: RecipeListItem) => r.id} />
            <div className="mt-3">
              <PaginationCursor
                hasMore={!!recipesQuery.data?.nextCursor}
                onLoadMore={() => setCursor(recipesQuery.data!.nextCursor!)}
                loading={recipesQuery.isFetching}
              />
            </div>
          </>
        )}
      </PageContainer>
    </MainLayout>
  )
}
