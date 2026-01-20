import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { exportToXlsx } from '../../lib/exportXlsx'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, ExpiryBadge, Button } from '../../components'
import { useNavigation } from '../../hooks'
import type { ExpiryStatus } from '../../components'
import { DocumentArrowDownIcon } from '@heroicons/react/24/outline'

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

  const [exporting, setExporting] = useState(false)

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

  const handleExportExcel = async () => {
    if (!auth.accessToken || exporting) return
    setExporting(true)
    try {
      const all: ExpirySummaryItem[] = []
      let next: string | undefined
      let generatedAt = new Date().toISOString()

      // Fetch all pages (server-side cursor pagination)
      while (true) {
        const page = await fetchExpirySummary(auth.accessToken, 200, next)
        generatedAt = page.generatedAt ?? generatedAt
        all.push(...page.items)
        if (!page.nextCursor) break
        next = page.nextCursor
      }

      const rows = all.map((item) => {
        const total = Number(item.quantity || '0')
        const reserved = Number(item.reservedQuantity ?? '0')
        const available =
          typeof item.availableQuantity === 'string'
            ? Number(item.availableQuantity || '0')
            : Math.max(0, total - reserved)

        return {
          SKU: item.sku,
          Producto: item.name,
          Lote: item.batchNumber,
          Vence: new Date(item.expiresAt).toLocaleDateString(),
          'Días para vencer': item.daysToExpire,
          Estado: item.status,
          'Almacén (código)': item.warehouseCode,
          'Almacén (nombre)': item.warehouseName,
          Ubicación: item.locationCode,
          Total: total,
          Reservado: reserved,
          Disponible: available,
        }
      })

      const date = new Date().toISOString().slice(0, 10)
      exportToXlsx(`vencimientos_${date}.xlsx`, [
        {
          name: 'Vencimientos',
          rows,
        },
        {
          name: 'Meta',
          rows: [{ Generado: new Date(generatedAt).toLocaleString(), Filas: rows.length }],
        },
      ])
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Error al exportar a Excel')
    } finally {
      setExporting(false)
    }
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="Vencimientos"
        actions={
          <Button variant="outline" icon={<DocumentArrowDownIcon />} onClick={handleExportExcel} loading={exporting}>
            Exportar Excel
          </Button>
        }
      >
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
