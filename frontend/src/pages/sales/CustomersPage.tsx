import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
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
  isActive: boolean
}

type ListResponse = { items: CustomerListItem[]; nextCursor: string | null }

async function fetchCustomers(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/customers?${params}`, { token })
}

export function CustomersPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const [cursor, setCursor] = useState<string | undefined>()
  const take = 20

  const customersQuery = useQuery({
    queryKey: ['customers', take, cursor],
    queryFn: () => fetchCustomers(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="Clientes"
        actions={<Button onClick={() => navigate('/sales/customers/new')}>Crear Cliente</Button>}
      >
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {customersQuery.isLoading && <Loading />}
          {customersQuery.error && <ErrorState message="Error al cargar clientes" retry={customersQuery.refetch} />}
          {customersQuery.data && customersQuery.data.items.length === 0 && <EmptyState message="No hay clientes" />}
          {customersQuery.data && customersQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'Nombre', accessor: (c) => c.name },
                  { header: 'NIT', accessor: (c) => c.nit || '-' },
                  { header: 'Email', accessor: (c) => c.email || '-' },
                  { header: 'Teléfono', accessor: (c) => c.phone || '-' },
                  {
                    header: 'Acciones',
                    accessor: (c) => (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/customers/${c.id}`)}>
                        Ver
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
