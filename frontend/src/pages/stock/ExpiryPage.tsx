import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatDateOnlyUtc } from '../../lib/date'
import { exportToXlsx } from '../../lib/exportXlsx'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, ExpiryBadge, Button, PaginationCursor } from '../../components'
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
  presentationId?: string | null
  presentationName?: string | null
  unitsPerPresentation?: number | null
  warehouseCode: string
  warehouseName: string
  locationCode: string
}

function formatQtyByBatchPresentation(qtyUnits: number, item: { presentationName?: string | null; unitsPerPresentation?: number | null } | null | undefined): string {
  const qtyNum = Number(qtyUnits)
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) return '0'

  const unitsPer = Number(item?.unitsPerPresentation ?? 0)
  const presName = (item?.presentationName ?? '').trim()
  if (Number.isFinite(unitsPer) && unitsPer > 1 && presName) {
    const count = qtyNum / unitsPer
    const countStr = Number.isFinite(count) && Math.abs(count - Math.round(count)) < 1e-9 ? String(Math.round(count)) : count.toFixed(2)
    return `${countStr} ${presName} (${unitsPer.toFixed(0)}u)`
  }
  return `${qtyNum} unidades`
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
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const take = 100

  const [exporting, setExporting] = useState(false)

  const expiryQuery = useQuery({
    queryKey: ['expiry-summary', take, cursor],
    queryFn: () => fetchExpirySummary(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const handleLoadMore = () => {
    if (expiryQuery.data?.nextCursor) {
      setCursorHistory(prev => [...prev, cursor || ''])
      setCursor(expiryQuery.data.nextCursor)
      setCurrentPage(prev => prev + 1)
    }
  }

  const handleGoBack = () => {
    if (cursorHistory.length > 0) {
      const previousCursor = cursorHistory[cursorHistory.length - 1]
      setCursorHistory(prev => prev.slice(0, -1))
      setCursor(previousCursor || undefined)
      setCurrentPage(prev => Math.max(1, prev - 1))
    }
  }

  const handleGoToStart = () => {
    setCursor(undefined)
    setCursorHistory([])
    setCurrentPage(1)
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
        const totalUnits = Number(item.quantity || '0')
        const reservedUnits = Number(item.reservedQuantity ?? '0')
        const availableUnits =
          typeof item.availableQuantity === 'string'
            ? Number(item.availableQuantity || '0')
            : Math.max(0, totalUnits - reservedUnits)

        const total = formatQtyByBatchPresentation(totalUnits, item)
        const reserved = formatQtyByBatchPresentation(reservedUnits, item)
        const available = formatQtyByBatchPresentation(availableUnits, item)

        return {
          SKU: item.sku,
          Producto: item.name,
          Lote: item.batchNumber,
          Vence: formatDateOnlyUtc(item.expiresAt),
          'Días para vencer': item.daysToExpire,
          Estado: item.status,
          'Almacén (código)': item.warehouseCode,
          'Almacén (nombre)': item.warehouseName,
          Ubicación: item.locationCode,
          Total: total,
          'Total (u)': totalUnits,
          Reservado: reserved,
          'Reservado (u)': reservedUnits,
          Disponible: available,
          'Disponible (u)': availableUnits,
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
                  { header: 'Producto', accessor: (item) => item.name, width: '200px' },
                  { header: 'Lote', accessor: (item) => item.batchNumber, width: '120px' },
                  {
                    header: 'Vence',
                    accessor: (item) => formatDateOnlyUtc(item.expiresAt),
                    width: '100px'
                  },
                  {
                    header: 'Días',
                    accessor: (item) => item.daysToExpire,
                    width: '80px'
                  },
                  {
                    header: 'Estado',
                    accessor: (item) => <ExpiryBadge status={item.status} />,
                    width: '100px'
                  },
                  { header: 'Total', accessor: (item) => formatQtyByBatchPresentation(Number(item.quantity), item), width: '160px' },
                  { header: 'Reservado', accessor: (item) => formatQtyByBatchPresentation(Number(item.reservedQuantity ?? 0), item), width: '160px' },
                  {
                    header: 'Disponible',
                    accessor: (item) => {
                      const total = Number(item.quantity || '0')
                      const reserved = Number(item.reservedQuantity ?? '0')
                      const available = typeof item.availableQuantity === 'string' ? Number(item.availableQuantity || '0') : Math.max(0, total - reserved)
                      return formatQtyByBatchPresentation(available, item)
                    },
                    width: '160px'
                  },
                  { header: 'Almacén', accessor: (item) => item.warehouseName, width: '150px' },
                ]}
                data={expiryQuery.data.items}
                keyExtractor={(item) => item.balanceId}
              />
              <PaginationCursor
                hasMore={!!expiryQuery.data?.nextCursor}
                onLoadMore={handleLoadMore}
                loading={expiryQuery.isFetching}
                currentCount={expiryQuery.data?.items.length || 0}
                currentPage={currentPage}
                take={take}
                onGoToStart={cursorHistory.length > 0 ? handleGoToStart : undefined}
                canGoBack={cursorHistory.length > 0}
                onGoBack={cursorHistory.length > 0 ? handleGoBack : undefined}
              />
            </>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
