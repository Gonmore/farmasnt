import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getProductDisplayName } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, PaginationCursor, Modal, CatalogSearch } from '../../components'
import { useNavigation } from '../../hooks'
import { EyeIcon, PlusIcon } from '@heroicons/react/24/outline'

type ProductListItem = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  isActive: boolean
  version: number
  updatedAt: string
  batches?: Array<{
    batchNumber: string
    warehouseName: string
    totalQuantity: string
    totalReservedQuantity?: string
    totalAvailableQuantity?: string
    expiresAt?: string
  }>
  presentations?: Array<{
    id: string
    name: string
    unitsPerPresentation: number
    isDefault: boolean
  }>
}

type ListResponse = { items: ProductListItem[]; nextCursor: string | null }

async function fetchProducts(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/products?${params}`, { token })
}

async function fetchProductBatches(token: string, productId: string) {
  try {
    const response = await apiFetch(`/api/v1/products/${productId}/batches?take=100`, { token }) as any
    return response.items || []
  } catch (error) {
    return []
  }
}

async function fetchBalancesExpanded(token: string, productId: string): Promise<{ items: any[] }> {
  const params = new URLSearchParams({ take: '200', productId })
  return apiFetch(`/api/v1/reports/stock/balances-expanded?${params}`, { token })
}

function formatQtyByBatchPresentation(qtyUnits: number, batch: { presentationName?: string | null; unitsPerPresentation?: number | null } | null | undefined): string {
  const qtyNum = Number(qtyUnits)
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) return '0'

  const unitsPer = Number(batch?.unitsPerPresentation ?? 0)
  const presName = (batch?.presentationName ?? '').trim()
  if (Number.isFinite(unitsPer) && unitsPer > 1 && presName) {
    const count = qtyNum / unitsPer
    const countStr = Number.isFinite(count) && Math.abs(count - Math.round(count)) < 1e-9 ? String(Math.round(count)) : count.toFixed(2)
    return `${countStr} ${presName} (${unitsPer.toFixed(0)}u)`
  }

  return `${qtyNum} unidades`
}

import React from 'react'

function formatStockWithEmojis(availableUnits: number, presentation: { name?: string | null; unitsPerPresentation?: number | null } | null | undefined): React.JSX.Element {
  const unitsPer = Number(presentation?.unitsPerPresentation ?? 0)
  const presName = (presentation?.name ?? '').trim().toLowerCase()

  // Función para obtener el emoji según el tipo de presentación
  const getEmoji = (presentationName: string): string => {
    if (presentationName.includes('unidad') || presentationName.includes('píldora') || presentationName.includes('cápsula') || presentationName.includes('comprimido') || presentationName.includes('tableta')) {
      return '💊'
    } else if (presentationName.includes('frasco') || presentationName.includes('botella')) {
      return '🧴'
    } else {
      return '📦'
    }
  }

  if (Number.isFinite(unitsPer) && unitsPer > 1 && presName && availableUnits >= unitsPer) {
    const completePresentations = Math.floor(availableUnits / unitsPer)
    const remainingUnits = availableUnits % unitsPer

    const emoji = getEmoji(presName)
    const presentationName = presentation?.name || 'presentación'
    const presentationText = completePresentations === 1 ? presentationName : `${presentationName}${presentationName.endsWith('s') ? '' : 's'}`

    return (
      <div className="text-right">
        <div className="text-sm text-slate-600 dark:text-slate-400 leading-tight">
          {completePresentations} {presentationText} ({unitsPer} u) {emoji}
        </div>
        {remainingUnits > 0 && (
          <div className="text-sm text-slate-600 dark:text-slate-400 leading-tight">
            {remainingUnits} unidades sueltas 💊
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="text-right">
      <div className="text-sm text-slate-600 dark:text-slate-400 leading-tight">
        {availableUnits} unidades 💊
      </div>
    </div>
  )
}

export function ProductsListPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const take = 20

  // Modal states
  const [stockModal, setStockModal] = useState<{ isOpen: boolean; product: ProductListItem | null }>({ isOpen: false, product: null })

  const productsQuery = useQuery({
    queryKey: ['products', take, cursor],
    queryFn: () => fetchProducts(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  // Separate query for enrichment data
  const enrichmentQuery = useQuery({
    queryKey: ['products-enrichment', productsQuery.data?.items?.map(p => p.id)],
    queryFn: async () => {
      if (!productsQuery.data?.items || !auth.accessToken) return null

      const enrichments = await Promise.all(
        productsQuery.data.items.map(async (product) => {
          const [batches, presentationsResp] = await Promise.all([
            fetchProductBatches(auth.accessToken!, product.id).catch(() => []),
            apiFetch(`/api/v1/products/${product.id}/presentations`, { token: auth.accessToken }).catch(() => ({ items: [] }))
          ])

          // Process batches to get warehouse totals
          const batchSummaries = batches.map((batch: any) => ({
            batchNumber: batch.batchNumber,
            warehouseName: batch.locations?.[0]?.warehouseName || 'Sin ubicación',
            totalQuantity: batch.totalQuantity || '0',
            totalReservedQuantity: batch.totalReservedQuantity || '0',
            totalAvailableQuantity: batch.totalAvailableQuantity || String(Math.max(0, Number(batch.totalQuantity || '0') - Number(batch.totalReservedQuantity || '0'))),
            expiresAt: batch.expiresAt
          }))

          return {
            id: product.id,
            batches: batchSummaries.slice(0, 3), // Show first 3 batches
            presentations: (presentationsResp as any).items || []
          }
        })
      )

      return enrichments
    },
    enabled: !!productsQuery.data?.items && !!auth.accessToken,
  })

  // Query for enrichment data of search results
  const searchEnrichmentQuery = useQuery({
    queryKey: ['search-enrichment', searchResults?.map(p => p.id)],
    queryFn: async () => {
      if (!searchResults || !auth.accessToken) return null

      const enrichments = await Promise.all(
        searchResults.map(async (product) => {
          const [batches, presentationsResp] = await Promise.all([
            fetchProductBatches(auth.accessToken!, product.id).catch(() => []),
            apiFetch(`/api/v1/products/${product.id}/presentations`, { token: auth.accessToken }).catch(() => ({ items: [] }))
          ])

          // Process batches to get warehouse totals
          const batchSummaries = batches.map((batch: any) => ({
            batchNumber: batch.batchNumber,
            warehouseName: batch.locations?.[0]?.warehouseName || 'Sin ubicación',
            totalQuantity: batch.totalQuantity || '0',
            totalReservedQuantity: batch.totalReservedQuantity || '0',
            totalAvailableQuantity: batch.totalAvailableQuantity || String(Math.max(0, Number(batch.totalQuantity || '0') - Number(batch.totalReservedQuantity || '0'))),
            expiresAt: batch.expiresAt
          }))

          return {
            id: product.id,
            batches: batchSummaries.slice(0, 3), // Show first 3 batches
            presentations: (presentationsResp as any).items || []
          }
        })
      )

      return enrichments
    },
    enabled: !!auth.accessToken && !!searchResults,
  })

  // Query for stock balances when modal is open
  const stockBalancesQuery = useQuery({
    queryKey: ['stock-balances', stockModal.product?.id],
    queryFn: () => fetchBalancesExpanded(auth.accessToken!, stockModal.product!.id),
    enabled: !!auth.accessToken && stockModal.isOpen && !!stockModal.product,
  })

  // Group balances by warehouse for modal display
  const groupedBalancesForModal = useMemo(() => {
    if (!stockBalancesQuery.data?.items) return []

    const map = new Map<string, {
      warehouseId: string
      warehouseName: string
      totalQuantity: number
      totalReservedQuantity: number
      totalAvailableQuantity: number
      presentationName: string | null
      unitsPerPresentation: number | null
    }>()

    for (const item of stockBalancesQuery.data.items) {
      const qty = Number(item.quantity)
      if (!Number.isFinite(qty) || qty <= 0) continue

      const reserved = Math.max(0, Number(item.reservedQuantity ?? '0'))
      const available = Math.max(0, qty - reserved)

      const warehouseId = item.location.warehouse.id
      let group = map.get(warehouseId)
      if (!group) {
        group = {
          warehouseId,
          warehouseName: item.location.warehouse.name,
          totalQuantity: 0,
          totalReservedQuantity: 0,
          totalAvailableQuantity: 0,
          presentationName: item.batch?.presentation?.name ?? null,
          unitsPerPresentation: item.batch?.presentation?.unitsPerPresentation ?? null
        }
        map.set(warehouseId, group)
      }

      group.totalQuantity += qty
      group.totalReservedQuantity += reserved
      group.totalAvailableQuantity += available
    }

    return Array.from(map.values()).sort((a, b) => a.warehouseName.localeCompare(b.warehouseName))
  }, [stockBalancesQuery.data])

  // Combine search results with enrichment data
  const combinedSearchData = useMemo(() => {
    if (!searchResults) return null
    if (!searchEnrichmentQuery.data) {
      // Return search results with default enrichment values
      return searchResults.map(product => ({
        ...product,
        batches: [],
        presentations: []
      }))
    }

    const enrichmentMap = new Map(searchEnrichmentQuery.data.map(e => [e.id, e]))

    return searchResults.map(product => {
      const enrichment = enrichmentMap.get(product.id)
      return enrichment ? { ...product, ...enrichment } : {
        ...product,
        batches: [],
        presentations: []
      }
    })
  }, [searchResults, searchEnrichmentQuery.data])

  // Combine the data
  const combinedData = useMemo(() => {
    if (!productsQuery.data) return null
    if (!enrichmentQuery.data) {
      // Return products with default enrichment values
      return {
        ...productsQuery.data,
        items: productsQuery.data.items.map(product => ({
          ...product,
          batches: [],
          presentations: []
        }))
      }
    }

    const enrichmentMap = new Map(enrichmentQuery.data.map(e => [e.id, e]))

    return {
      ...productsQuery.data,
      items: productsQuery.data.items.map(product => {
        const enrichment = enrichmentMap.get(product.id)
        return enrichment ? { ...product, ...enrichment } : {
          ...product,
          hasRecipe: false,
          recipeItems: [],
          batches: [],
          presentations: []
        }
      })
    }
  }, [productsQuery.data, enrichmentQuery.data])

  const handleLoadMore = () => {
    if (combinedData?.nextCursor) {
      setCursorHistory(prev => [...prev, cursor || ''])
      setCursor(combinedData.nextCursor)
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

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="🏷️ Productos"
        actions={
          <Button variant="primary" icon={<PlusIcon />} onClick={() => navigate('/catalog/products/new')}>
            Crear Producto
          </Button>
        }
      >
        <CatalogSearch className="mb-6" onSearchResults={setSearchResults} />
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {productsQuery.isLoading && !searchResults && <Loading />}
          {productsQuery.error && !searchResults && (
            <ErrorState
              message={productsQuery.error instanceof Error ? productsQuery.error.message : 'Error al cargar productos'}
              retry={productsQuery.refetch}
            />
          )}
          {searchResults && searchEnrichmentQuery.isLoading && (
            <Loading />
          )}
          {searchResults && searchEnrichmentQuery.error && (
            <ErrorState
              message={searchEnrichmentQuery.error instanceof Error ? searchEnrichmentQuery.error.message : 'Error al cargar información de stock'}
              retry={searchEnrichmentQuery.refetch}
            />
          )}
          {searchResults && !searchEnrichmentQuery.isLoading && searchResults.length === 0 && (
            <EmptyState message="No se encontraron productos" />
          )}
          {!searchResults && combinedData && combinedData.items.length === 0 && (
            <EmptyState
              message="No hay productos"
              action={
                <Button variant="primary" icon={<PlusIcon />} onClick={() => navigate('/catalog/products/new')}>
                  Crear primer producto
                </Button>
              }
            />
          )}
          {((combinedSearchData && combinedSearchData.length > 0) || (combinedData && combinedData.items.length > 0 && !searchResults)) && (
            <>
              <Table
                columns={[
                  { header: 'SKU', accessor: (p) => p.sku },
                  { header: 'Nombre', accessor: (p) => getProductDisplayName(p) },
                  {
                    header: 'STOCK(unidades)',
                    accessor: (p) => {
                      // Determinar si usar datos de búsqueda o datos normales
                      const isSearchResult = !!searchResults
                      const productData = isSearchResult ? combinedSearchData?.find(sp => sp.id === p.id) : p
                      
                      if (!productData) return '-'
                      
                      const totalUnits = productData.batches.reduce((total: number, batch: any) => total + parseInt(batch.totalAvailableQuantity || batch.totalQuantity), 0)
                      
                      return (
                        <div className="cursor-pointer">
                          <div
                            className="text-2xl hover:scale-110 transition-transform font-bold text-green-600"
                            onClick={() => productData.batches.length > 0 && setStockModal({ isOpen: true, product: productData })}
                            title={productData.batches.length > 0 ? "Ver stock completo" : "Sin stock"}
                          >
                            {productData.batches.length > 0 ? totalUnits : '➖'}
                          </div>
                        </div>
                      )
                    },
                  },
                  {
                    header: 'Acciones',
                    className: 'text-center w-auto',
                    accessor: (p) => (
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" icon={<EyeIcon className="w-4 h-4" />} onClick={() => navigate(`/catalog/products/${p.id}`)}>Ver</Button>
                      </div>
                    ),
                  },
                ]}
                data={combinedSearchData || combinedData?.items || []}
                keyExtractor={(p) => p.id}
                rowClassName={(p) => searchResults ? '' : (p.isActive ? '' : 'bg-red-50')}
              />
              {!searchResults && combinedData && (
                <PaginationCursor
                  hasMore={!!combinedData.nextCursor}
                  onLoadMore={handleLoadMore}
                  loading={productsQuery.isFetching || enrichmentQuery.isFetching || searchEnrichmentQuery.isFetching}
                  currentCount={combinedData.items.length}
                  currentPage={currentPage}
                  take={take}
                  onGoToStart={cursorHistory.length > 0 ? handleGoToStart : undefined}
                  canGoBack={cursorHistory.length > 0}
                  onGoBack={cursorHistory.length > 0 ? handleGoBack : undefined}
                />
              )}
            </>
          )}
        </div>
      </PageContainer>

      {/* Stock Modal */}
      <Modal
        isOpen={stockModal.isOpen}
        onClose={() => setStockModal({ isOpen: false, product: null })}
        title={`Stock - ${stockModal.product?.name || ''}`}
        maxWidth="lg"
      >
        <div className="flex flex-col max-h-[80vh]">
          {/* Fixed header with total */}
          <div className="flex-shrink-0 p-4 bg-slate-50 dark:bg-slate-800 rounded-t-lg border-b border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-700 dark:text-slate-300">Total disponible en todos los almacenes:</span>
              <span className="text-2xl font-bold text-slate-800 dark:text-slate-200">
                {(() => {
                  const totalAvailable = groupedBalancesForModal.reduce((total, warehouse) => total + warehouse.totalAvailableQuantity, 0)
                  return (
                    <span>
                      <span className="text-2xl">{totalAvailable}</span>
                      <span className="text-sm ml-1 text-slate-800 dark:text-slate-200">unidades</span>
                    </span>
                  )
                })()}
              </span>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-4">
            {stockBalancesQuery.isLoading ? (
              <Loading />
            ) : stockBalancesQuery.error ? (
              <ErrorState
                message={stockBalancesQuery.error instanceof Error ? stockBalancesQuery.error.message : 'Error al cargar stock'}
                retry={stockBalancesQuery.refetch}
              />
            ) : groupedBalancesForModal.length > 0 ? (
              <div className="grid gap-4">
                {groupedBalancesForModal.map((warehouse, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-lg">🏢</span>
                      </div>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100 text-lg">{warehouse.warehouseName}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          {formatQtyByBatchPresentation(warehouse.totalReservedQuantity, {
                            presentationName: warehouse.presentationName,
                            unitsPerPresentation: warehouse.unitsPerPresentation
                          })} reservados
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      {formatStockWithEmojis(warehouse.totalAvailableQuantity, {
                        name: warehouse.presentationName,
                        unitsPerPresentation: warehouse.unitsPerPresentation
                      })}
                      <div className="text-sm font-bold text-blue-600 mt-1">
                        total: {warehouse.totalAvailableQuantity} unidades
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <span className="text-4xl mb-4 block">📭</span>
                <p className="text-lg">Este producto no tiene stock disponible</p>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </MainLayout>
  )
}
