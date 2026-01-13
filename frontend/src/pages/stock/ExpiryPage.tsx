import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, ExpiryBadge } from '../../components'
import { useNavigation } from '../../hooks'
import type { ExpiryStatus } from '../../components'

type ExpirySummaryItem = {
  balanceId: string
  productId: string
  sku: string
  name: string
  batchId: string
  batchNumber: string
  expiresAt: string
  daysToExpire: number
  status: ExpiryStatus
  quantity: string
  reservedQuantity?: string
  availableQuantity?: string
  warehouseCode: string
  warehouseName: string
  locationCode: string
}

type ListResponse = { items: ExpirySummaryItem[]; nextCursor: string | null; generatedAt: string }

async function fetchExpirySummary(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/stock/expiry/summary?${params}`, { token })
}

export function ExpiryPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const [cursor, setCursor] = useState<string | undefined>()
  const take = 100

  const expiryQuery = useQuery({
    queryKey: ['expiry-summary', take, cursor],
    queryFn: () => fetchExpirySummary(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const handleLoadMore = () => {
    if (expiryQuery.data?.nextCursor) {
      setCursor(expiryQuery.data.nextCursor)
    }
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Vencimientos">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {expiryQuery.isLoading && <Loading />}
          {expiryQuery.error && (
            <ErrorState
              message={expiryQuery.error instanceof Error ? expiryQuery.error.message : 'Error al cargar vencimientos'}
              retry={expiryQuery.refetch}
            />
          )}
          {expiryQuery.data && expiryQuery.data.items.length === 0 && (
            <EmptyState message="No hay alertas de vencimiento" />
          )}
          {expiryQuery.data && expiryQuery.data.items.length > 0 && (
            <>
              <Table
                columns={[
                  { header: 'SKU', accessor: (item) => item.sku },
                  { header: 'Producto', accessor: (item) => item.name },
                  { header: 'Lote', accessor: (item) => item.batchNumber },
                  {
                    header: 'Vence',
                    accessor: (item) => new Date(item.expiresAt).toLocaleDateString(),
                  },
                  {
                    header: 'Días',
                    accessor: (item) => item.daysToExpire,
                  },
                  {
                    header: 'Estado',
                    accessor: (item) => <ExpiryBadge status={item.status} />,
                  },
                  { header: 'Total', accessor: (item) => item.quantity },
                  { header: 'Reservado', accessor: (item) => item.reservedQuantity ?? '0' },
                  {
                    header: 'Disponible',
                    accessor: (item) => {
                      if (typeof item.availableQuantity === 'string') return item.availableQuantity
                      const total = Number(item.quantity || '0')
                      const reserved = Number(item.reservedQuantity ?? '0')
                      return String(Math.max(0, total - reserved))
                    },
                  },
                  { header: 'Almacén', accessor: (item) => `${item.warehouseCode} - ${item.locationCode}` },
                ]}
                data={expiryQuery.data.items}
                keyExtractor={(item) => item.balanceId}
              />
              {expiryQuery.data.nextCursor && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={expiryQuery.isFetching}
                    className="rounded bg-slate-200 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                  >
                    {expiryQuery.isFetching ? 'Cargando...' : 'Cargar más'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
