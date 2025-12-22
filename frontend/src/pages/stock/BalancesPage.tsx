import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState } from '../../components'
import { useNavigation } from '../../hooks'

type BalanceExpandedItem = {
  id: string
  quantity: string
  updatedAt: string
  product: { sku: string; name: string }
  batch: { batchNumber: string; expiresAt: string | null } | null
  location: {
    code: string
    warehouse: { code: string; name: string }
  }
}

async function fetchBalances(token: string): Promise<{ items: BalanceExpandedItem[] }> {
  return apiFetch(`/api/v1/reports/stock/balances-expanded`, { token })
}

export function BalancesPage() {
  const auth = useAuth()
  const navGroups = useNavigation()

  const balancesQuery = useQuery({
    queryKey: ['balances'],
    queryFn: () => fetchBalances(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Balances de Stock">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {balancesQuery.isLoading && <Loading />}
          {balancesQuery.error && (
            <ErrorState
              message={balancesQuery.error instanceof Error ? balancesQuery.error.message : 'Error al cargar balances'}
              retry={balancesQuery.refetch}
            />
          )}
          {balancesQuery.data && balancesQuery.data.items.length === 0 && (
            <EmptyState message="No hay balances de stock" />
          )}
          {balancesQuery.data && balancesQuery.data.items.length > 0 && (
            <Table
              columns={[
                { header: 'SKU', accessor: (b) => b.product.sku },
                { header: 'Producto', accessor: (b) => b.product.name },
                { header: 'Lote', accessor: (b) => b.batch?.batchNumber || 'Sin lote' },
                { header: 'Cantidad', accessor: (b) => b.quantity },
                { header: 'Almacén', accessor: (b) => b.location.warehouse.name },
                { header: 'Ubicación', accessor: (b) => b.location.code },
              ]}
              data={balancesQuery.data.items}
              keyExtractor={(b) => b.id}
            />
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
