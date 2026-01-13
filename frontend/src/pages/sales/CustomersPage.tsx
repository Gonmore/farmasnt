import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, PaginationCursor } from '../../components'
import { useNavigation } from '../../hooks'

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

async function fetchCustomers(token: string, take: number, cursor?: string, cities?: string[]): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  if (cities && cities.length > 0) {
    // Enviar como string separado por comas
    params.append('cities', cities.join(','))
  }
  return apiFetch(`/api/v1/customers?${params}`, { token })
}

export function CustomersPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const [cursor, setCursor] = useState<string | undefined>()
  const [selectedCities, setSelectedCities] = useState<string[]>([])
  const take = 20

  const customersQuery = useQuery({
    queryKey: ['customers', take, cursor, selectedCities],
    queryFn: () => fetchCustomers(auth.accessToken!, take, cursor, selectedCities.length > 0 ? selectedCities : undefined),
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
        actions={<Button onClick={() => navigate('/sales/customers/new')}>➕ Crear Cliente</Button>}
      >
        {/* Filtro de ciudades - Chips simples */}
        {availableCities.length > 0 && (
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
        )}

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
                    accessor: (c) => (
                      <div className="inline-flex items-center px-3 py-1 rounded-full bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800">
                        <span className="text-sm font-medium text-blue-900 dark:text-blue-100">{c.name}</span>
                      </div>
                    )
                  },
                  { header: 'Ciudad', accessor: (c) => c.city ? c.city.toUpperCase() : '-' },
                  { header: 'Email', accessor: (c) => c.email || '-' },
                  { header: 'Teléfono', accessor: (c) => c.phone || '-' },
                  {
                    header: 'Acciones',
                    accessor: (c) => (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/customers/${c.id}`)}>
                        👁️ Ver
                      </Button>
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
