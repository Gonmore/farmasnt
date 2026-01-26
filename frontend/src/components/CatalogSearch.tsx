import { useQuery } from '@tanstack/react-query'
import React, { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../providers/AuthProvider'
import { Input, Button } from './common'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'

type CatalogSearchItem = { id: string; sku: string; name: string; genericName?: string | null; photoUrl?: string | null }

async function searchCatalog(token: string, query: string, take: number): Promise<{ items: CatalogSearchItem[] }> {
  const params = new URLSearchParams({ q: query, take: String(take) })
  return apiFetch(`/api/v1/catalog/search?${params}`, { token })
}

interface CatalogSearchProps {
  onSearchResults?: (results: CatalogSearchItem[] | null) => void
  className?: string
}

export function CatalogSearch({ onSearchResults, className = '' }: CatalogSearchProps) {
  const auth = useAuth()
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const searchQuery = useQuery({
    queryKey: ['catalog-search', searchTerm],
    queryFn: () => searchCatalog(auth.accessToken!, searchTerm, 50), // Máximo permitido por el backend
    enabled: !!auth.accessToken && searchTerm.length > 0,
  })

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (query.trim()) {
      setSearchTerm(query.trim())
    }
  }

  const handleClear = () => {
    setQuery('')
    setSearchTerm('')
    onSearchResults?.(null)
  }

  // Notificar resultados de búsqueda a la página padre
  useEffect(() => {
    if (searchQuery.data) {
      onSearchResults?.(searchQuery.data.items)
    } else if (!searchTerm || searchQuery.error) {
      onSearchResults?.(null)
    }
  }, [searchQuery.data, searchTerm, searchQuery.error, onSearchResults])

  return (
    <div className={className}>
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Input
            placeholder="Buscar productos por SKU, nombre comercial o genérico..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pr-10"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <Button variant="outline" icon={<MagnifyingGlassIcon />} type="submit" disabled={query.length === 0}>
          Buscar
        </Button>
        <Button variant="outline" onClick={handleClear} disabled={!searchTerm}>
          Limpiar
        </Button>
      </form>

      {searchTerm && (
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {searchQuery.isLoading && 'Buscando...'}
          {searchQuery.error && (
            <span className="text-red-600 dark:text-red-400">
              Error en la búsqueda: {searchQuery.error instanceof Error ? searchQuery.error.message : 'Error desconocido'}
            </span>
          )}
          {searchQuery.data && `Encontrados ${searchQuery.data.items.length} productos`}
        </div>
      )}
    </div>
  )
}