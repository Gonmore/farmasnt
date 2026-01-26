import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { getProductDisplayName, getProductLabel } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, Select } from '../../components'
import { useNavigation } from '../../hooks'

type ProductListItem = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  isActive: boolean
}

type ProductListResponse = { items: ProductListItem[]; nextCursor: string | null }

type BalanceExpandedItem = {
  id: string
  quantity: string
  reservedQuantity?: string
  updatedAt: string
  product: { sku: string; name: string; genericName?: string | null }
  batch: { batchNumber: string; expiresAt: string | null; status: string; version: number } | null
  location: {
    code: string
    warehouse: { code: string; name: string }
  }
}

async function fetchProducts(token: string): Promise<ProductListResponse> {
  const params = new URLSearchParams({ take: '50' })
  return apiFetch(`/api/v1/products?${params}`, { token })
}

async function fetchBalances(token: string, productId?: string): Promise<{ items: BalanceExpandedItem[] }> {
  const params = new URLSearchParams()
  if (productId) params.set('productId', productId)
  const qs = params.toString()
  return apiFetch(`/api/v1/reports/stock/balances-expanded${qs ? `?${qs}` : ''}`, { token })
}

function getBatchStatusDisplay(status: string): { text: string; color: string } {
  if (status === 'QUARANTINE') {
    return { text: 'En cuarentena', color: 'text-orange-600 dark:text-orange-400' }
  }
  return { text: 'Liberado', color: 'text-green-600 dark:text-green-400' }
}

export function BalancesPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const [productId, setProductId] = useState('')

  const productsQuery = useQuery({
    queryKey: ['products', 'forBalances'],
    queryFn: () => fetchProducts(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const balancesQuery = useQuery({
    queryKey: ['balances', { productId: productId || null }],
    queryFn: () => fetchBalances(auth.accessToken!, productId || undefined),
    enabled: !!auth.accessToken,
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Balances de Stock">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-200 p-4 dark:border-slate-700">
            <Select
              label="Filtrar por producto"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              options={[
                { value: '', label: 'Todos' },
                ...(productsQuery.data?.items ?? [])
                  .filter((p) => p.isActive)
                  .map((p) => ({ value: p.id, label: getProductLabel(p) })),
              ]}
              disabled={productsQuery.isLoading}
            />
          </div>

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
                { header: 'Producto', accessor: (b) => getProductDisplayName(b.product) },
                { header: 'Lote', accessor: (b) => b.batch?.batchNumber || 'Sin lote' },
                {
                  header: 'Estado',
                  accessor: (b) => {
                    if (!b.batch) return '-'
                    const statusDisplay = getBatchStatusDisplay(b.batch.status)
                    return (
                      <span className={`text-sm font-medium ${statusDisplay.color}`}>
                        {statusDisplay.text}
                      </span>
                    )
                  },
                },
                { header: 'Total', accessor: (b) => b.quantity },
                { header: 'Reservado', accessor: (b) => b.reservedQuantity ?? '0' },
                {
                  header: 'Disponible',
                  accessor: (b) => {
                    const total = Number(b.quantity || '0')
                    const reserved = Number(b.reservedQuantity ?? '0')
                    return String(Math.max(0, total - reserved))
                  },
                },
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
