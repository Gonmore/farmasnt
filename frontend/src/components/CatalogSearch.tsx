import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { getProductDisplayName } from '../lib/productName'
import { useAuth } from '../providers/AuthProvider'
import { Input, Button, Table, Loading, ErrorState, EmptyState } from './common'
import { useNavigate } from 'react-router-dom'

type CatalogSearchItem = { id: string; sku: string; name: string; genericName?: string | null }

async function searchCatalog(token: string, query: string, take: number): Promise<{ items: CatalogSearchItem[] }> {
  const params = new URLSearchParams({ q: query, take: String(take) })
  return apiFetch(`/api/v1/catalog/search?${params}`, { token })
}

interface CatalogSearchProps {
  className?: string
}

export function CatalogSearch({ className = '' }: CatalogSearchProps) {
  const auth = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const searchQuery = useQuery({
    queryKey: ['catalog-search', searchTerm],
    queryFn: () => searchCatalog(auth.accessToken!, searchTerm, 20),
    enabled: !!auth.accessToken && searchTerm.length > 0,
  })

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSearchTerm(query)
  }

  const handleProductClick = (productId: string) => {
    navigate(`/catalog/products/${productId}`)
  }

  return (
    <div className={className}>
      <form onSubmit={handleSearch} className="mb-4">
        <div className="flex gap-2">
          <Input
            placeholder="Buscar productos por SKU, nombre comercial o genérico..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={query.length === 0}>
            🔍 Buscar
          </Button>
        </div>
      </form>

      {searchTerm && (
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {searchQuery.isLoading && <Loading />}
          {searchQuery.error && (
            <ErrorState
              message={searchQuery.error instanceof Error ? searchQuery.error.message : 'Error en la búsqueda'}
              retry={searchQuery.refetch}
            />
          )}
          {searchQuery.data && searchQuery.data.items.length === 0 && (
            <EmptyState message={`No se encontraron productos para "${searchTerm}"`} />
          )}
          {searchQuery.data && searchQuery.data.items.length > 0 && (
            <Table
              columns={[
                { header: 'SKU', accessor: (p: CatalogSearchItem) => p.sku },
                { header: 'Nombre', accessor: (p: CatalogSearchItem) => getProductDisplayName(p) },
                {
                  header: 'Acciones',
                  accessor: (p: CatalogSearchItem) => (
                    <Button size="sm" variant="ghost" onClick={() => handleProductClick(p.id)}>
                      👁️ Ver
                    </Button>
                  ),
                },
              ]}
              data={searchQuery.data.items}
              keyExtractor={(p: CatalogSearchItem) => p.id}
            />
          )}
        </div>
      )}
    </div>
  )
}