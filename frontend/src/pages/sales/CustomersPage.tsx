import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, PaginationCursor, Input } from '../../components'
import { useNavigation } from '../../hooks'
import { usePermissions } from '../../hooks/usePermissions'
import { EyeIcon, PlusIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'

type CustomerListItem = {
  id: string
  name: string
  nit: string | null
  email: string | null
  phone: string | null
  city: string | null
  isActive: boolean
}

type ListResponse = { items: CustomerListItem[]; nextCursor: string | null }

async function fetchCustomers(token: string, take: number, cursor?: string, cities?: string[], q?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  if (cities && cities.length > 0) {
    // Enviar como string separado por comas
    params.append('cities', cities.join(','))
  }
  if (q && q.trim()) {
    params.append('q', q.trim())
  }
  return apiFetch(`/api/v1/customers?${params}`, { token })
}

export function CustomersPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const permissions = usePermissions()
  const [cursor, setCursor] = useState<string | undefined>()
  const [selectedCities, setSelectedCities] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const take = 20
  const isBranchScoped = permissions.hasPermission('scope:branch') && !permissions.isTenantAdmin
  const branchCity = (permissions.user?.warehouse?.city ?? '').trim().toUpperCase()

  useEffect(() => {
    if (!isBranchScoped || !branchCity) return
    if (selectedCities.length === 1 && selectedCities[0] === branchCity) return
    setSelectedCities([branchCity])
    setCursor(undefined)
  }, [isBranchScoped, branchCity, selectedCities])

  const customersQuery = useQuery({
    queryKey: ['customers', take, cursor, selectedCities, appliedSearch],
    queryFn: () => fetchCustomers(auth.accessToken!, take, cursor, selectedCities.length > 0 ? selectedCities : undefined, appliedSearch || undefined),
    enabled: !!auth.accessToken,
  })

  const availableCities = useMemo((): string[] => {
    // Extraer ciudades únicas de la respuesta de customers, normalizadas a mayúsculas
    if (!customersQuery.data?.items) return []
    
    const cities = customersQuery.data.items
      .map((c: CustomerListItem) => c.city)
      .filter((city): city is string => city !== null && city.trim() !== '')
      .map((city: string) => city.toUpperCase()) // Normalizar a mayúsculas
      .filter((city: string, index: number, arr: string[]) => arr.indexOf(city) === index)
      .sort()
    
    return cities
  }, [customersQuery.data?.items])

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="👥 Clientes"
        actions={<Button variant="primary" icon={<PlusIcon />} onClick={() => navigate('/sales/customers/new')}>Crear Cliente</Button>}
      >
        {/* Buscador de clientes */}
        <div className="mb-4">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setAppliedSearch(searchQuery.trim())
              setCursor(undefined) // Reset pagination on new search
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Input
                placeholder="Buscar clientes por nombre..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setAppliedSearch('')
                    setCursor(undefined)
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              )}
            </div>
            <Button variant="outline" icon={<MagnifyingGlassIcon />} type="submit" disabled={searchQuery.length === 0}>
              Buscar
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery('')
                setAppliedSearch('')
                setCursor(undefined)
              }}
              disabled={!appliedSearch}
            >
              Limpiar
            </Button>
          </form>
          {appliedSearch && (
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {customersQuery.isLoading && 'Buscando...'}
              {customersQuery.error && (
                <span className="text-red-600 dark:text-red-400">
                  Error en la búsqueda: {customersQuery.error instanceof Error ? customersQuery.error.message : 'Error desconocido'}
                </span>
              )}
              {customersQuery.data && `Encontrados ${customersQuery.data.items.length} clientes`}
            </div>
          )}
        </div>

        {/* Filtro de ciudades - Chips simples */}
        {isBranchScoped && branchCity ? (
          <div className="mb-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Ciudad:</span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {branchCity}
            </span>
          </div>
        ) : availableCities.length > 0 ? (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mr-2">Filtrar por ciudad:</span>
              <button
                onClick={() => setSelectedCities([])}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedCities.length === 0
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                Todas
              </button>
              {availableCities.map((city) => {
                const isSelected = selectedCities.includes(city)
                return (
                  <button
                    key={city}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedCities(prev => prev.filter(c => c !== city))
                      } else {
                        setSelectedCities(prev => [...prev, city])
                      }
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                    }`}
                  >
                    {city}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {customersQuery.isLoading && <Loading />}
          {customersQuery.error && <ErrorState message="Error al cargar clientes" retry={customersQuery.refetch} />}
          {customersQuery.data && customersQuery.data.items.length === 0 && <EmptyState message="No hay clientes" />}
          {customersQuery.data && customersQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { 
                    header: 'Nombre', 
                    width: '250px',
                    accessor: (c) => (
                      <div className="inline-flex items-center px-3 py-1 rounded-full bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800">
                        <span className="text-sm font-medium text-blue-900 dark:text-blue-100">{c.name}</span>
                      </div>
                    )
                  },
                  { header: 'Ciudad', width: '130px', accessor: (c) => c.city ? c.city.toUpperCase() : '-' },
                  { header: 'Email', width: '200px', accessor: (c) => c.email || '-' },
                  { header: 'Teléfono', width: '140px', accessor: (c) => c.phone || '-' },
                  {
                    header: 'Acciones',
                    className: 'text-center',
                    width: '120px',
                    accessor: (c) => (
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" icon={<EyeIcon className="w-4 h-4" />} onClick={() => navigate(`/sales/customers/${c.id}`)}>Ver</Button>
                      </div>
                    ),
                  },
                ]}
                data={customersQuery.data.items}
                keyExtractor={(c) => c.id}
              />
              <PaginationCursor
                hasMore={!!customersQuery.data.nextCursor}
                onLoadMore={() => setCursor(customersQuery.data!.nextCursor!)}
                loading={customersQuery.isFetching}
              />
            </>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
