import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState } from '../../components'
import { useNavigation } from '../../hooks'

type AdminRoleListItem = {
  id: string
  code: string
  name: string
  isSystem: boolean
}

async function fetchRoles(token: string): Promise<{ items: AdminRoleListItem[] }> {
  return apiFetch(`/api/v1/admin/roles`, { token })
}

export function RolesPage() {
  const auth = useAuth()
  const navGroups = useNavigation()

  const rolesQuery = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => fetchRoles(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Roles">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {rolesQuery.isLoading && <Loading />}
          {rolesQuery.error && <ErrorState message="Error al cargar roles" retry={rolesQuery.refetch} />}
          {rolesQuery.data && rolesQuery.data.items.length === 0 && <EmptyState message="No hay roles" />}
          {rolesQuery.data && rolesQuery.data.items.length > 0 && (
            <Table
              columns={[
                { header: 'Código', accessor: (r) => r.code },
                { header: 'Nombre', accessor: (r) => r.name },
                { header: 'Sistema', accessor: (r) => (r.isSystem ? 'Sí' : 'No') },
              ]}
              data={rolesQuery.data.items}
              keyExtractor={(r) => r.id}
            />
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
