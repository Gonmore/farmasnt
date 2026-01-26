import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { getProductDisplayName } from '../../lib/productName'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, PaginationCursor, Modal, ExpiryBadge, CatalogSearch } from '../../components'
import { useNavigation } from '../../hooks'
import type { ExpiryStatus } from '../../components'
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

function calculateExpiryStatus(expiresAt: string): ExpiryStatus {
  const expiryDate = new Date(expiresAt)
  const today = new Date()
  const daysToExpire = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (daysToExpire < 0) return 'EXPIRED'
  if (daysToExpire <= 30) return 'RED'
  if (daysToExpire <= 90) return 'YELLOW'
  return 'GREEN'
}

export function ProductsListPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
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
          const batches = await fetchProductBatches(auth.accessToken!, product.id).catch(() => [])

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
            batches: batchSummaries.slice(0, 3) // Show first 3 batches
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
          const batches = await fetchProductBatches(auth.accessToken!, product.id).catch(() => [])

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
            batches: batchSummaries.slice(0, 3) // Show first 3 batches
          }
        })
      )

      return enrichments
    },
    enabled: !!auth.accessToken && !!searchResults,
  })

  // Combine search results with enrichment data
  const combinedSearchData = useMemo(() => {
    if (!searchResults) return null
    if (!searchEnrichmentQuery.data) {
      // Return search results with default enrichment values
      return searchResults.map(product => ({
        ...product,
        batches: []
      }))
    }

    const enrichmentMap = new Map(searchEnrichmentQuery.data.map(e => [e.id, e]))

    return searchResults.map(product => {
      const enrichment = enrichmentMap.get(product.id)
      return enrichment ? { ...product, ...enrichment } : {
        ...product,
        batches: []
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
          batches: []
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
          batches: []
        }
      })
    }
  }, [productsQuery.data, enrichmentQuery.data])

  const handleLoadMore = () => {
    if (combinedData?.nextCursor) {
      setCursorHistory(prev => [...prev, cursor || ''])
      setCursor(combinedData.nextCursor)
    }
  }

  const handleGoBack = () => {
    if (cursorHistory.length > 0) {
      const previousCursor = cursorHistory[cursorHistory.length - 1]
      setCursorHistory(prev => prev.slice(0, -1))
      setCursor(previousCursor || undefined)
    }
  }

  const handleGoToStart = () => {
    setCursor(undefined)
    setCursorHistory([])
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
                    header: 'Stock',
                    accessor: (p) => {
                      // Determinar si usar datos de búsqueda o datos normales
                      const isSearchResult = !!searchResults
                      const productData = isSearchResult ? combinedSearchData?.find(sp => sp.id === p.id) : p
                      
                      if (!productData) return '-'
                      
                      return (
                        <div className="cursor-pointer">
                          <div
                            className="text-2xl hover:scale-110 transition-transform font-bold text-green-600"
                            onClick={() => productData.batches.length > 0 && setStockModal({ isOpen: true, product: productData })}
                            title={productData.batches.length > 0 ? "Ver stock completo" : "Sin stock"}
                          >
                            {productData.batches.length > 0 ? productData.batches.reduce((total: number, batch: any) => total + parseInt(batch.totalAvailableQuantity || batch.totalQuantity), 0) : '➖'}
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
        <div className="space-y-4">
          {stockModal.product?.batches && stockModal.product.batches.length > 0 ? (
            <div className="grid gap-3">
              {stockModal.product.batches.map((batch, idx) => {
                const expiryStatus = batch.expiresAt ? calculateExpiryStatus(batch.expiresAt) : 'GREEN'
                const bgColorClass = {
                  EXPIRED: 'from-red-50 to-red-100 border-red-200',
                  RED: 'from-red-50 to-red-100 border-red-200',
                  YELLOW: 'from-yellow-50 to-yellow-100 border-yellow-200',
                  GREEN: 'from-green-50 to-emerald-50 border-green-200'
                }[expiryStatus]

                return (
                  <div key={idx} className={`flex items-center justify-between p-4 bg-gradient-to-r ${bgColorClass} rounded-lg border`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm">📦</span>
                      </div>
                      <div>
                        <div className="font-medium text-slate-700">Lote {batch.batchNumber}</div>
                        <div className="text-sm text-slate-500">{batch.warehouseName}</div>
                        {batch.expiresAt && (
                          <div className="text-xs text-slate-600 mt-1">
                            Vence: {new Date(batch.expiresAt).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2">
                      <div>
                        <span className="text-3xl font-bold text-green-600">{batch.totalAvailableQuantity || batch.totalQuantity}</span>
                        <span className="text-green-500 ml-1">disp.</span>
                        <div className="text-xs text-slate-600">
                          {batch.totalReservedQuantity || '0'} res. · {batch.totalQuantity} total
                        </div>
                      </div>
                      {batch.expiresAt && <ExpiryBadge status={expiryStatus} />}
                    </div>
                  </div>
                )
              })}
              <div className="mt-6 p-4 bg-slate-100 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-700">Total disponible en todos los almacenes:</span>
                  <span className="text-3xl font-bold text-slate-800">
                    {stockModal.product.batches.reduce((total, batch) => total + parseInt(batch.totalAvailableQuantity || batch.totalQuantity), 0)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <span className="text-4xl mb-4 block">📭</span>
              <p className="text-lg">Este producto no tiene stock disponible</p>
            </div>
          )}
        </div>
      </Modal>
    </MainLayout>
  )
}
