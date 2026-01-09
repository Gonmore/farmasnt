import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Input, Button, Loading, ErrorState } from '../../components'
import { useNavigation } from '../../hooks'

type Customer = {
  id: string
  name: string
  nit: string | null
  email: string | null
  phone: string | null
  address: string | null
  isActive: boolean
  version: number
  createdAt: string
}

async function fetchCustomer(token: string, customerId: string): Promise<Customer> {
  return apiFetch(`/api/v1/customers/${customerId}`, { token })
}

async function createCustomer(
  token: string,
  data: { name: string; nit?: string; email?: string; phone?: string; address?: string },
): Promise<Customer> {
  return apiFetch(`/api/v1/customers`, {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

async function updateCustomer(
  token: string,
  customerId: string,
  data: {
    version: number
    name?: string
    nit?: string
    email?: string
    phone?: string
    address?: string
    isActive?: boolean
  },
): Promise<Customer> {
  return apiFetch(`/api/v1/customers/${customerId}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  })
}

export function CustomerDetailPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()
  const { customerId } = useParams<{ customerId?: string }>()
  const isNew = !customerId

  const [name, setName] = useState('')
  const [nit, setNit] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState('')

  const customerQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomer(auth.accessToken!, customerId!),
    enabled: !!auth.accessToken && !!customerId,
  })

  // Cargar datos cuando se obtiene el cliente
  React.useEffect(() => {
    if (customerQuery.data) {
      setName(customerQuery.data.name)
      setNit(customerQuery.data.nit || '')
      setEmail(customerQuery.data.email || '')
      setPhone(customerQuery.data.phone || '')
      setAddress(customerQuery.data.address || '')
      setIsActive(customerQuery.data.isActive)
    }
  }, [customerQuery.data])

  const createMutation = useMutation({
    mutationFn: () =>
      createCustomer(auth.accessToken!, {
        name,
        ...(nit && { nit }),
        ...(email && { email }),
        ...(phone && { phone }),
        ...(address && { address }),
      }),
    onSuccess: (newCustomer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      alert('Cliente creado exitosamente')
      navigate(`/sales/customers/${newCustomer.id}`)
    },
    onError: (err: any) => {
      setError(err instanceof Error ? err.message : 'Error al crear cliente')
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!customerQuery.data) throw new Error('Cliente no cargado')
      return updateCustomer(auth.accessToken!, customerId!, {
        version: customerQuery.data.version,
        name,
        ...(nit && { nit }),
        ...(email && { email }),
        ...(phone && { phone }),
        ...(address && { address }),
        isActive,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
      alert('Cliente actualizado exitosamente')
      setError('')
    },
    onError: (err: any) => {
      setError(err instanceof Error ? err.message : 'Error al actualizar cliente')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('El nombre es requerido')
      return
    }

    if (isNew) {
      createMutation.mutate()
    } else {
      updateMutation.mutate()
    }
  }

  if (!isNew && customerQuery.isLoading) return <Loading />
  if (!isNew && customerQuery.error) return <ErrorState message="Error al cargar cliente" retry={customerQuery.refetch} />

  const isSubmitting = isNew ? createMutation.isPending : updateMutation.isPending

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title={isNew ? '➕ Crear Cliente' : `✏️ ${name || 'Cliente'}`}>
        <div className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              label="Nombre"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del cliente"
              required
              disabled={isSubmitting}
            />

            <Input
              label="NIT"
              type="text"
              value={nit}
              onChange={(e) => setNit(e.target.value)}
              placeholder="Ej: 1234567890"
              disabled={isSubmitting}
            />

            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@ejemplo.com"
              disabled={isSubmitting}
            />

            <Input
              label="Teléfono"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+591 XXXXXXXXX"
              disabled={isSubmitting}
            />

            <Input
              label="Dirección"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Dirección del cliente"
              disabled={isSubmitting}
            />

            {!isNew && (
              <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={isSubmitting}
                  className="h-4 w-4"
                />
                <label htmlFor="isActive" className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Cliente Activo
                </label>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <Button type="submit" className="flex-1" loading={isSubmitting}>
                {isNew ? 'Crear Cliente' : 'Guardar Cambios'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/sales/customers')} disabled={isSubmitting}>
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      </PageContainer>
    </MainLayout>
  )
}
