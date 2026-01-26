import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { getProductDisplayName } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Input, Table, Loading, ErrorState, EmptyState, Button, IconButton } from '../../components'
import { useNavigation } from '../../hooks'
import { useNavigate } from 'react-router-dom'
import { ICON_VIEW } from '../../lib/actionIcons'

type CatalogSearchItem = { id: string; sku: string; name: string; genericName?: string | null }

async function searchCatalog(token: string, query: string, take: number): Promise<{ items: CatalogSearchItem[] }> {
  const params = new URLSearchParams({ q: query, take: String(take) })
  return apiFetch(`/api/v1/catalog/search?${params}`, { token })
}

export function CatalogSearchPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const searchQuery = useQuery({
    queryKey: ['catalog-search', searchTerm],
    queryFn: () => searchCatalog(auth.accessToken!, searchTerm, 20),
    enabled: !!auth.accessToken && searchTerm.length > 0,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchTerm(query)
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Búsqueda de Catálogo">
        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex gap-2">
            <Input
              placeholder="Buscar por SKU, nombre comercial o genérico..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={query.length === 0}>
              Buscar
            </Button>
          </div>
        </form>

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {searchQuery.isLoading && <Loading />}
          {searchQuery.error && (
            <ErrorState
              message={searchQuery.error instanceof Error ? searchQuery.error.message : 'Error en la búsqueda'}
              retry={searchQuery.refetch}
            />
          )}
          {!searchQuery.data && !searchQuery.isLoading && !searchQuery.error && (
            <EmptyState message="Ingresa un término de búsqueda" />
          )}
          {searchQuery.data && searchQuery.data.items.length === 0 && (
            <EmptyState message="No se encontraron resultados" />
          )}
          {searchQuery.data && searchQuery.data.items.length > 0 && (
            <Table
              columns={[
                { header: 'SKU', accessor: (item) => item.sku },
                { header: 'Nombre', accessor: (item) => getProductDisplayName(item) },
                {
                  header: 'Acciones',
                  className: 'text-center w-auto',
                  accessor: (item) => (
                    <div className="flex items-center justify-center gap-1">
                      <IconButton label="Ver" icon={ICON_VIEW} onClick={() => navigate(`/catalog/products/${item.id}`)} />
                    </div>
                  ),
                },
              ]}
              data={searchQuery.data.items}
              keyExtractor={(item) => item.id}
            />
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
