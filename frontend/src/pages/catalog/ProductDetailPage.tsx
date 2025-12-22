import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Input, Select, Loading, ErrorState } from '../../components'
import { useNavigation } from '../../hooks'

type Product = {
  id: string
  sku: string
  name: string
  description: string | null
  isActive: boolean
  version: number
  createdAt: string
  updatedAt: string
}

type Batch = {
  id: string
  batchNumber: string
  expiresAt: string | null
  manufacturedAt: string | null
  status: string
  createdAt: string
}

async function fetchProduct(token: string, id: string): Promise<Product> {
  return apiFetch(`/api/v1/products/${id}`, { token })
}

async function createProduct(token: string, data: { sku: string; name: string; description?: string }): Promise<Product> {
  return apiFetch(`/api/v1/products`, {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

async function updateProduct(
  token: string,
  id: string,
  data: { version: number; name?: string; description?: string | null; isActive?: boolean },
): Promise<Product> {
  return apiFetch(`/api/v1/products/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  })
}

async function createBatch(
  token: string,
  productId: string,
  data: { batchNumber: string; expiresAt?: string; manufacturedAt?: string; status: string },
): Promise<Batch> {
  return apiFetch(`/api/v1/products/${productId}/batches`, {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

export function ProductDetailPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const isNew = id === 'new'

  // Form state
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Batch form state
  const [batchNumber, setBatchNumber] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [manufacturedAt, setManufacturedAt] = useState('')
  const [batchStatus, setBatchStatus] = useState('RELEASED')
  const [showBatchForm, setShowBatchForm] = useState(false)

  const productQuery = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProduct(auth.accessToken!, id!),
    enabled: !!auth.accessToken && !isNew && !!id,
  })

  // Initialize form when data loads
  useEffect(() => {
    if (productQuery.data) {
      setSku(productQuery.data.sku)
      setName(productQuery.data.name)
      setDescription(productQuery.data.description || '')
      setIsActive(productQuery.data.isActive)
    }
  }, [productQuery.data])

  const createMutation = useMutation({
    mutationFn: (data: { sku: string; name: string; description?: string }) =>
      createProduct(auth.accessToken!, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      navigate(`/catalog/products/${data.id}`)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: { version: number; name?: string; description?: string | null; isActive?: boolean }) =>
      updateProduct(auth.accessToken!, id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const batchMutation = useMutation({
    mutationFn: (data: { batchNumber: string; expiresAt?: string; manufacturedAt?: string; status: string }) =>
      createBatch(auth.accessToken!, id!, data),
    onSuccess: () => {
      setBatchNumber('')
      setExpiresAt('')
      setManufacturedAt('')
      setBatchStatus('RELEASED')
      setShowBatchForm(false)
      alert('Lote creado exitosamente')
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (isNew) {
      createMutation.mutate({ sku, name, description: description || undefined })
    } else if (productQuery.data) {
      updateMutation.mutate({
        version: productQuery.data.version,
        name,
        description: description || null,
        isActive,
      })
    }
  }

  const handleBatchSubmit = (e: FormEvent) => {
    e.preventDefault()
    batchMutation.mutate({
      batchNumber,
      expiresAt: expiresAt || undefined,
      manufacturedAt: manufacturedAt || undefined,
      status: batchStatus,
    })
  }

  if (!isNew && productQuery.isLoading) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="Cargando...">
          <Loading />
        </PageContainer>
      </MainLayout>
    )
  }

  if (!isNew && productQuery.error) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="Error">
          <ErrorState
            message={productQuery.error instanceof Error ? productQuery.error.message : 'Error al cargar producto'}
            retry={productQuery.refetch}
          />
        </PageContainer>
      </MainLayout>
    )
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title={isNew ? 'Crear Producto' : `Producto: ${sku}`}
        actions={
          <Button variant="secondary" onClick={() => navigate('/catalog/products')}>
            Volver
          </Button>
        }
      >
        <div className="grid gap-6 md:grid-cols-2">
          {/* Product Form */}
          <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {isNew ? 'Datos del Producto' : 'Editar Producto'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="SKU"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                required
                disabled={!isNew || createMutation.isPending}
              />
              <Input
                label="Nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={createMutation.isPending || updateMutation.isPending}
              />
              <Input
                label="Descripción"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={createMutation.isPending || updateMutation.isPending}
              />
              {!isNew && (
                <Select
                  label="Estado"
                  value={isActive ? 'true' : 'false'}
                  onChange={(e) => setIsActive(e.target.value === 'true')}
                  options={[
                    { value: 'true', label: 'Activo' },
                    { value: 'false', label: 'Inactivo' },
                  ]}
                  disabled={updateMutation.isPending}
                />
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={createMutation.isPending || updateMutation.isPending}>
                  {isNew ? 'Crear' : 'Guardar'}
                </Button>
                {(createMutation.error || updateMutation.error) && (
                  <span className="text-sm text-red-600">
                    {createMutation.error instanceof Error
                      ? createMutation.error.message
                      : updateMutation.error instanceof Error
                        ? updateMutation.error.message
                        : 'Error'}
                  </span>
                )}
              </div>
            </form>
          </div>

          {/* Batch Form (only for existing products) */}
          {!isNew && (
            <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Lotes</h3>
                {!showBatchForm && (
                  <Button size="sm" onClick={() => setShowBatchForm(true)}>
                    Crear Lote
                  </Button>
                )}
              </div>
              {showBatchForm && (
                <form onSubmit={handleBatchSubmit} className="space-y-4">
                  <Input
                    label="Número de Lote"
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    required
                    disabled={batchMutation.isPending}
                  />
                  <Input
                    label="Fecha de Vencimiento"
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    disabled={batchMutation.isPending}
                  />
                  <Input
                    label="Fecha de Fabricación"
                    type="date"
                    value={manufacturedAt}
                    onChange={(e) => setManufacturedAt(e.target.value)}
                    disabled={batchMutation.isPending}
                  />
                  <Select
                    label="Estado"
                    value={batchStatus}
                    onChange={(e) => setBatchStatus(e.target.value)}
                    options={[
                      { value: 'RELEASED', label: 'Liberado' },
                      { value: 'QUARANTINE', label: 'Cuarentena' },
                      { value: 'REJECTED', label: 'Rechazado' },
                    ]}
                    disabled={batchMutation.isPending}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" loading={batchMutation.isPending}>
                      Crear
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowBatchForm(false)}
                      disabled={batchMutation.isPending}
                    >
                      Cancelar
                    </Button>
                  </div>
                  {batchMutation.error && (
                    <p className="text-sm text-red-600">
                      {batchMutation.error instanceof Error ? batchMutation.error.message : 'Error al crear lote'}
                    </p>
                  )}
                </form>
              )}
              {!showBatchForm && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Usa el botón "Crear Lote" para agregar lotes a este producto.
                </p>
              )}
            </div>
          )}
        </div>
      </PageContainer>
    </MainLayout>
  )
}
