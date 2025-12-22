import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, PaginationCursor } from '../../components'
import { useNavigation } from '../../hooks'

type AuditEventListItem = {
  id: string
  createdAt: string
  action: string
  entityType: string
  entityId: string | null
}

type ListResponse = { items: AuditEventListItem[]; nextCursor: string | null }

async function fetchAuditEvents(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/audit/events?${params}`, { token })
}

export function AuditListPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const [cursor, setCursor] = useState<string | undefined>()

  const auditQuery = useQuery({
    queryKey: ['audit-events', cursor],
    queryFn: () => fetchAuditEvents(auth.accessToken!, 50, cursor),
    enabled: !!auth.accessToken,
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Auditoría">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {auditQuery.isLoading && <Loading />}
          {auditQuery.error && <ErrorState message="Error al cargar eventos" retry={auditQuery.refetch} />}
          {auditQuery.data && auditQuery.data.items.length === 0 && <EmptyState message="No hay eventos de auditoría" />}
          {auditQuery.data && auditQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'Fecha', accessor: (e) => new Date(e.createdAt).toLocaleString() },
                  { header: 'Acción', accessor: (e) => e.action },
                  { header: 'Tipo', accessor: (e) => e.entityType },
                  { header: 'ID', accessor: (e) => e.entityId?.slice(0, 8) || '-' },
                ]}
                data={auditQuery.data.items}
                keyExtractor={(e) => e.id}
              />
              <PaginationCursor
                hasMore={!!auditQuery.data.nextCursor}
                onLoadMore={() => setCursor(auditQuery.data!.nextCursor!)}
                loading={auditQuery.isFetching}
              />
            </>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
