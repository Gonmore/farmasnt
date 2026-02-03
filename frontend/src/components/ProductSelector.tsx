import { useQuery } from '@tanstack/react-query'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../providers/AuthProvider'
import { Input } from './common'
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline'

export type ProductSelectorItem = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  photoUrl?: string | null
  price?: string | null
  presentations?: Array<{
    id: string
    name: string
    unitsPerPresentation: string
    priceOverride?: string | null
    isDefault: boolean
    sortOrder: number
  }>
}

async function searchCatalog(token: string, query: string): Promise<{ items: ProductSelectorItem[] }> {
  const params = new URLSearchParams({ q: query, take: '50' })
  params.append('includePresentations', 'true')
  return apiFetch(`/api/v1/catalog/search?${params}`, { token })
}

interface ProductSelectorProps {
  value?: { id: string; label: string } | null
  onChange: (product: ProductSelectorItem) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ProductSelector({ value, onChange, placeholder = 'Buscar producto...', disabled, className = '' }: ProductSelectorProps) {
  const auth = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const searchQuery = useQuery({
    queryKey: ['catalog-search-inline', searchTerm],
    queryFn: () => searchCatalog(auth.accessToken!, searchTerm),
    enabled: !!auth.accessToken && searchTerm.trim().length > 0,
  })

  const results = useMemo(() => {
    const items = searchQuery.data?.items ?? []
    return items
      .filter((p) => (p.id && p.sku && p.name))
      .slice(0, 50)
  }, [searchQuery.data])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (product: ProductSelectorItem) => {
    onChange(product)
    setIsOpen(false)
    setSearchTerm('')
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
    if (!isOpen) setIsOpen(true)
  }

  const handleInputFocus = () => {
    setIsOpen(true)
  }

  const displayValue = value?.label ?? ''

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={isOpen ? searchTerm : displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          <ChevronDownIcon className={`h-5 w-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-auto">
          {searchTerm.trim().length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              Escribe para buscar productos
            </div>
          ) : searchQuery.isLoading ? (
            <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              Buscando...
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              No se encontraron productos
            </div>
          ) : (
            results.map((product) => {
              const label = `${product.sku} — ${product.name}`
              const selected = value?.id === product.id
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleSelect(product)}
                  className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 focus:bg-slate-50 dark:focus:bg-slate-700 focus:outline-none flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{label}</div>
                    {product.genericName && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{product.genericName}</div>
                    )}
                  </div>
                  {selected && <CheckIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 ml-2 flex-shrink-0" />}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
