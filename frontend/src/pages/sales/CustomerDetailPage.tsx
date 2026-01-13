import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { MainLayout, PageContainer, Input, Button, Loading, ErrorState, Select, MapSelector, CitySelector } from '../../components'
import { useNavigation } from '../../hooks'

type Customer = {
  id: string
  name: string
  businessName?: string | null
  nit: string | null
  contactName?: string | null
  contactBirthDay?: number | null
  contactBirthMonth?: number | null
  contactBirthYear?: number | null
  email: string | null
  phone: string | null
  address: string | null
  city?: string | null
  zone?: string | null
  mapsUrl?: string | null
  isActive: boolean
  creditDays7Enabled?: boolean
  creditDays14Enabled?: boolean
  version: number
  createdAt: string
}

async function fetchCustomer(token: string, customerId: string): Promise<Customer> {
  return apiFetch(`/api/v1/customers/${customerId}`, { token })
}

async function createCustomer(
  token: string,
  data: { name: string; businessName?: string; nit?: string; contactName?: string; contactBirthDay?: number; contactBirthMonth?: number; contactBirthYear?: number; email?: string; phone?: string; address?: string; city?: string; zone?: string; mapsUrl?: string; creditDays7Enabled?: boolean; creditDays14Enabled?: boolean },
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
    businessName?: string
    nit?: string
    contactName?: string
    contactBirthDay?: number
    contactBirthMonth?: number
    contactBirthYear?: number
    email?: string
    phone?: string
    address?: string
    isActive?: boolean
    city?: string
    zone?: string
    mapsUrl?: string
    creditDays7Enabled?: boolean
    creditDays14Enabled?: boolean
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
  const tenant = useTenant()
  const navigate = useNavigate()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()
  const { customerId } = useParams<{ customerId?: string }>()
  const isNew = !customerId

  const tenantCountry = (tenant.branding?.country ?? '').trim() || 'BOLIVIA'
  const [mapMode, setMapMode] = useState<'manual' | 'interactive'>('manual')

  const [name, setName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [nit, setNit] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactBirthDay, setContactBirthDay] = useState('')
  const [contactBirthMonth, setContactBirthMonth] = useState('')
  const [contactBirthYear, setContactBirthYear] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [zone, setZone] = useState('')
  const [mapsUrl, setMapsUrl] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [creditDays7Enabled, setCreditDays7Enabled] = useState(false)
  const [creditDays14Enabled, setCreditDays14Enabled] = useState(false)
  const [error, setError] = useState('')

  const handleMapLocationSelect = useCallback((mapsUrl: string, geocodedAddress?: string) => {
    setMapsUrl(mapsUrl)
    if (geocodedAddress) {
      setAddress(geocodedAddress)
    }
  }, [])

  const customerQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomer(auth.accessToken!, customerId!),
    enabled: !!auth.accessToken && !!customerId,
  })

  // Cargar datos cuando se obtiene el cliente
  React.useEffect(() => {
    if (customerQuery.data) {
      setName(customerQuery.data.name)
      setBusinessName(customerQuery.data.businessName || '')
      setNit(customerQuery.data.nit || '')
      setContactName(customerQuery.data.contactName || '')
      setContactBirthDay(customerQuery.data.contactBirthDay?.toString() || '')
      setContactBirthMonth(customerQuery.data.contactBirthMonth?.toString() || '')
      setContactBirthYear(customerQuery.data.contactBirthYear?.toString() || '')
      setEmail(customerQuery.data.email || '')
      setPhone(customerQuery.data.phone || '')
      setAddress(customerQuery.data.address || '')
      setCity(customerQuery.data.city || '')
      setZone(customerQuery.data.zone || '')
      setMapsUrl(customerQuery.data.mapsUrl || '')
      setIsActive(customerQuery.data.isActive)
      setCreditDays7Enabled(!!customerQuery.data.creditDays7Enabled)
      setCreditDays14Enabled(!!customerQuery.data.creditDays14Enabled)
    }
  }, [customerQuery.data])

  const createMutation = useMutation({
    mutationFn: () =>
      createCustomer(auth.accessToken!, {
        name,
        ...(businessName && { businessName }),
        ...(nit && { nit }),
        ...(contactName && { contactName }),
        ...(contactBirthDay && { contactBirthDay: parseInt(contactBirthDay) }),
        ...(contactBirthMonth && { contactBirthMonth: parseInt(contactBirthMonth) }),
        ...(contactBirthYear && { contactBirthYear: parseInt(contactBirthYear) }),
        ...(email && { email }),
        ...(phone && { phone }),
        ...(address && { address }),
        ...(city && { city }),
        ...(zone && { zone }),
        ...(mapsUrl && { mapsUrl }),
        creditDays7Enabled,
        creditDays14Enabled,
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
        ...(businessName && { businessName }),
        ...(nit && { nit }),
        ...(contactName && { contactName }),
        ...(contactBirthDay && { contactBirthDay: parseInt(contactBirthDay) }),
        ...(contactBirthMonth && { contactBirthMonth: parseInt(contactBirthMonth) }),
        ...(contactBirthYear && { contactBirthYear: parseInt(contactBirthYear) }),
        ...(email && { email }),
        ...(phone && { phone }),
        ...(address && { address }),
        ...(city && { city }),
        ...(zone && { zone }),
        ...(mapsUrl && { mapsUrl }),
        isActive,
        creditDays7Enabled,
        creditDays14Enabled,
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
              label="Razón Social"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Razón social (opcional)"
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Nombre de Contacto"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Persona principal de contacto"
                disabled={isSubmitting}
              />
              <div className="grid grid-cols-3 gap-2">
                <Select
                  label="Día"
                  value={contactBirthDay}
                  onChange={(e) => setContactBirthDay(e.target.value)}
                  disabled={isSubmitting}
                  options={[
                    { value: '', label: 'Día' },
                    ...Array.from({ length: 31 }, (_, i) => ({
                      value: (i + 1).toString(),
                      label: (i + 1).toString(),
                    })),
                  ]}
                />
                <Select
                  label="Mes"
                  value={contactBirthMonth}
                  onChange={(e) => setContactBirthMonth(e.target.value)}
                  disabled={isSubmitting}
                  options={[
                    { value: '', label: 'Mes' },
                    { value: '1', label: 'Ene' },
                    { value: '2', label: 'Feb' },
                    { value: '3', label: 'Mar' },
                    { value: '4', label: 'Abr' },
                    { value: '5', label: 'May' },
                    { value: '6', label: 'Jun' },
                    { value: '7', label: 'Jul' },
                    { value: '8', label: 'Ago' },
                    { value: '9', label: 'Sep' },
                    { value: '10', label: 'Oct' },
                    { value: '11', label: 'Nov' },
                    { value: '12', label: 'Dic' },
                  ]}
                />
                <Input
                  label="Año"
                  type="number"
                  value={contactBirthYear}
                  onChange={(e) => setContactBirthYear(e.target.value)}
                  placeholder="1990"
                  min="1900"
                  max="2100"
                  disabled={isSubmitting}
                />
              </div>
            </div>

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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Ciudad
                </label>
                <CitySelector
                  country={tenantCountry}
                  value={city}
                  onChange={setCity}
                  disabled={isSubmitting}
                />
              </div>
              <Input
                label="Zona"
                type="text"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="ZONA SUR"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mapMode"
                    value="manual"
                    checked={mapMode === 'manual'}
                    onChange={(e) => setMapMode(e.target.value as 'manual' | 'interactive')}
                    disabled={isSubmitting}
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Ingresar URL manualmente
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mapMode"
                    value="interactive"
                    checked={mapMode === 'interactive'}
                    onChange={(e) => setMapMode(e.target.value as 'manual' | 'interactive')}
                    disabled={isSubmitting}
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Seleccionar en mapa
                  </span>
                </label>
              </div>

              {mapMode === 'manual' ? (
                <Input
                  label="Ubicación (Google Maps URL)"
                  type="url"
                  value={mapsUrl}
                  onChange={(e) => setMapsUrl(e.target.value)}
                  placeholder="https://maps.app.goo.gl/... o https://www.google.com/maps/@..."
                  disabled={isSubmitting}
                />
              ) : (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                    Ubicación en Mapa
                  </label>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Haz clic en el mapa para seleccionar la ubicación del cliente
                  </p>
                  <MapSelector
                    city={city}
                    zone={zone}
                    address={address}
                    mapsUrl={mapsUrl}
                    onLocationSelect={handleMapLocationSelect}
                    disabled={isSubmitting}
                  />
                  {mapsUrl && (
                    <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-800 rounded text-xs text-slate-600 dark:text-slate-400 break-all">
                      URL generada: {mapsUrl}
                    </div>
                  )}

                  <Input
                    label="Dirección"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Dirección del cliente"
                    disabled={isSubmitting}
                  />
                </div>
              )}
            </div>

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

            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">Términos de pago</div>
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={creditDays7Enabled}
                    onChange={(e) => setCreditDays7Enabled(e.target.checked)}
                    disabled={isSubmitting}
                    className="h-4 w-4"
                  />
                  Habilitar crédito 7 días
                </label>
                <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={creditDays14Enabled}
                    onChange={(e) => setCreditDays14Enabled(e.target.checked)}
                    disabled={isSubmitting}
                    className="h-4 w-4"
                  />
                  Habilitar crédito 14 días
                </label>
              </div>
            </div>

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
