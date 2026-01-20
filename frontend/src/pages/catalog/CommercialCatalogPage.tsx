import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { getProductDisplayName } from '../../lib/productName'
import { useAuth, useCart, useTenant } from '../../providers'
import { MainLayout, PageContainer, Button, Loading, ErrorState, EmptyState, CatalogSearch, ProductPhoto } from '../../components'
import { useNavigation } from '../../hooks'
import { EyeIcon, ShoppingCartIcon } from '@heroicons/react/24/outline'

type Product = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  photoUrl?: string | null
  price?: string | null
  isActive: boolean
}

type ProductDetail = {
  id: string
  sku: string
  name: string
  genericName?: string | null
  description: string | null
  photoUrl?: string | null
  price?: string | null
  stock: number
}

type ListResponse = { items: Product[]; nextCursor: string | null }

async function fetchProducts(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  if (cursor) params.append('cursor', cursor)
  return apiFetch(`/api/v1/products?${params}`, { token })
}

async function fetchProductBatches(token: string, productId: string): Promise<any> {
  try {
    const response = await apiFetch(`/api/v1/products/${productId}/batches?take=100`, { token }) as any
    return response.items || []
  } catch (error) {
    return []
  }
}

async function fetchProductDetail(token: string, productId: string): Promise<ProductDetail> {
  const product = await apiFetch(`/api/v1/products/${productId}`, { token }) as any
  const batches = await fetchProductBatches(token, productId)
  
  const totalStock = batches.reduce((total: number, batch: any) => {
    const available = batch.totalAvailableQuantity ?? String(Math.max(0, Number(batch.totalQuantity || '0') - Number(batch.totalReservedQuantity || '0')))
    return total + parseInt(available || '0')
  }, 0)
  
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    genericName: product.genericName ?? null,
    description: product.description,
    photoUrl: product.photoUrl,
    price: product.price,
    stock: totalStock
  }
}

export function CommercialCatalogPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const cart = useCart()
  const tenant = useTenant()
  const currency = tenant.branding?.currency || 'BOB'
  const [cursor, setCursor] = useState<string | undefined>()
  const [detailModal, setDetailModal] = useState<{ isOpen: boolean; productId: string | null }>({
    isOpen: false,
    productId: null
  })
  const take = 20

  const productsQuery = useQuery({
    queryKey: ['commercial-products', take, cursor],
    queryFn: () => fetchProducts(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const productDetailQuery = useQuery({
    queryKey: ['product-detail', detailModal.productId],
    queryFn: () => fetchProductDetail(auth.accessToken!, detailModal.productId!),
    enabled: !!auth.accessToken && !!detailModal.productId && detailModal.isOpen,
  })

  const handleLoadMore = () => {
    if (productsQuery.data?.nextCursor) {
      setCursor(productsQuery.data.nextCursor)
    }
  }

  const handleViewDetail = (productId: string) => {
    setDetailModal({ isOpen: true, productId })
  }

  const handleCloseDetail = () => {
    setDetailModal({ isOpen: false, productId: null })
  }

  const handleAddToCart = (product: Product) => {
    cart.addItem({
      id: product.id,
      sku: product.sku,
      name: getProductDisplayName(product),
      price: parseFloat(product.price || '0'),
      quantity: 1,
      photoUrl: product.photoUrl || null
    })
  }

  // Filter only active products
  const activeProducts = productsQuery.data?.items.filter(p => p.isActive) || []

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="🛒 Catálogo Comercial">
        <CatalogSearch className="mb-6" />
        <div className="rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-900 dark:to-slate-800/50 p-6 shadow-lg">
          {productsQuery.isLoading && <Loading />}
          {productsQuery.error && (
            <ErrorState
              message={productsQuery.error instanceof Error ? productsQuery.error.message : 'Error al cargar productos'}
              retry={productsQuery.refetch}
            />
          )}
          {activeProducts.length === 0 && !productsQuery.isLoading && (
            <EmptyState message="No hay productos disponibles en el catálogo" />
          )}
          {activeProducts.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {activeProducts.map((product) => (
                  <div
                    key={product.id}
                    className="border border-slate-200/60 dark:border-slate-600/60 rounded-xl overflow-hidden bg-white/80 dark:bg-slate-800/80 shadow-md hover:shadow-xl hover:scale-[1.02] transition-all duration-300 backdrop-blur-sm"
                  >
                    {/* Imagen del producto */}
                    <div className="aspect-square bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center relative overflow-hidden">
                      <ProductPhoto
                        url={product.photoUrl}
                        alt={getProductDisplayName(product)}
                        className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
                        placeholder={<div className="text-6xl text-slate-400 drop-shadow-sm">📦</div>}
                      />
                      {/* Overlay sutil */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300" />
                    </div>

                    {/* Información del producto */}
                    <div className="p-3 space-y-2">
                      <div>
                        <h3 className="font-bold text-slate-900 dark:text-white text-base line-clamp-2 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                          {getProductDisplayName(product)}
                        </h3>
                      </div>

                      <div className="text-xl font-bold text-transparent bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text drop-shadow-sm">
                        {parseFloat(product.price || '0').toFixed(2)} {currency}
                      </div>

                      {/* Botones de acción */}
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<EyeIcon className="w-4 h-4" />}
                          onClick={() => handleViewDetail(product.id)}
                          className="flex-1 text-xs"
                        >
                          Ver
                        </Button>
                        <Button
                          size="sm"
                          variant="success"
                          icon={<ShoppingCartIcon className="w-4 h-4" />}
                          onClick={() => handleAddToCart(product)}
                          className="flex-1 text-xs"
                        >
                          Agregar
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {productsQuery.data?.nextCursor && (
                <div className="mt-8 flex justify-center">
                  <Button
                    onClick={handleLoadMore}
                    loading={productsQuery.isFetching}
                    variant="secondary"
                    className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                  >
                    Cargar más productos
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </PageContainer>

      {/* Modal de detalle del producto personalizado */}
      {detailModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="relative max-w-2xl w-full max-h-[90vh] overflow-y-auto bg-gradient-to-br from-white via-blue-50/30 to-purple-50/20 dark:from-slate-800 dark:via-slate-700 dark:to-slate-600 rounded-2xl shadow-2xl border border-slate-200/50 dark:border-slate-600/50">
            {/* Botón cerrar */}
            <button
              onClick={handleCloseDetail}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center justify-center shadow-md"
            >
              <span className="text-slate-600 dark:text-slate-300 text-xl font-bold">×</span>
            </button>

            {productDetailQuery.isLoading && (
              <div className="p-8 flex justify-center">
                <Loading />
              </div>
            )}

            {productDetailQuery.error && (
              <div className="p-8">
                <ErrorState
                  message="Error al cargar el detalle del producto"
                  retry={productDetailQuery.refetch}
                />
              </div>
            )}

            {productDetailQuery.data && (
              <div className="p-6 space-y-6">
                {/* Header con gradiente */}
                <div className="text-center pb-4 border-b border-slate-200 dark:border-slate-600">
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                    {productDetailQuery.data.name}
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 mt-1">SKU: {productDetailQuery.data.sku}</p>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  {/* Imagen con mejor styling */}
                  <div className="space-y-4">
                    <div className="aspect-square bg-gradient-to-br from-slate-100 via-slate-200 to-slate-300 dark:from-slate-700 dark:via-slate-600 dark:to-slate-500 rounded-xl flex items-center justify-center shadow-lg overflow-hidden">
                      <ProductPhoto
                        url={productDetailQuery.data.photoUrl}
                        alt={productDetailQuery.data.name}
                        className="w-full h-full object-cover"
                        placeholder={<div className="text-8xl text-slate-400 drop-shadow-lg">📦</div>}
                      />
                    </div>
                  </div>

                  {/* Información con colores mejorados */}
                  <div className="space-y-6">
                    {/* Precio destacado */}
                    <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl p-6 text-center shadow-lg">
                      <div className="text-4xl font-bold text-white drop-shadow-lg">
                        {parseFloat(productDetailQuery.data.price || '0').toFixed(2)} {currency}
                      </div>
                      <div className="text-green-100 mt-1 text-sm">Precio final</div>
                    </div>

                    {/* Stock con colores */}
                    <div className="bg-gradient-to-r from-blue-500 to-cyan-600 rounded-xl p-6 shadow-lg">
                      <div className="flex justify-between items-center text-white">
                        <span className="font-medium">Stock disponible:</span>
                        <span className="text-3xl font-bold drop-shadow-lg">
                          {productDetailQuery.data.stock}
                        </span>
                      </div>
                      <div className="text-blue-100 mt-2 text-sm">unidades disponibles</div>
                    </div>
                  </div>
                </div>

                {/* Descripción con mejor styling */}
                {productDetailQuery.data.description && (
                  <div className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-600 rounded-xl p-6 shadow-md">
                    <h4 className="font-bold text-slate-900 dark:text-white mb-3 flex items-center">
                      <span className="w-2 h-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full mr-3"></span>
                      Descripción del producto
                    </h4>
                    <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {productDetailQuery.data.description}
                    </p>
                  </div>
                )}

                {/* Botones de acción mejorados */}
                <div className="flex gap-4 pt-4">
                  <Button
                    onClick={() => {
                      const product = productsQuery.data?.items.find(p => p.id === detailModal.productId)
                      if (product) {
                        handleAddToCart(product)
                        handleCloseDetail()
                      }
                    }}
                    disabled={productDetailQuery.data.stock === 0}
                    className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 font-semibold py-3"
                  >
                    🛒 Agregar al carrito
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleCloseDetail}
                    className="px-8 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    Cerrar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </MainLayout>
  )
}
