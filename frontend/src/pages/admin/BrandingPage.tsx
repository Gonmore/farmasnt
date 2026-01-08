import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { MainLayout, PageContainer, Button, Input, Loading, ErrorState } from '../../components'
import { useNavigation } from '../../hooks'

type BrandingData = {
  tenantId: string
  tenantName: string
  logoUrl: string | null
  brandPrimary: string | null
  brandSecondary: string | null
  brandTertiary: string | null
  defaultTheme: 'LIGHT' | 'DARK'
  currency: string
}

export function BrandingPage() {
  const navGroups = useNavigation()
  const queryClient = useQueryClient()
  
  const [logoUrl, setLogoUrl] = useState('')
  const [brandPrimary, setBrandPrimary] = useState('#3b82f6')
  const [brandSecondary, setBrandSecondary] = useState('#10b981')
  const [brandTertiary, setBrandTertiary] = useState('#f59e0b')
  const [defaultTheme, setDefaultTheme] = useState<'LIGHT' | 'DARK'>('LIGHT')
  const [currency, setCurrency] = useState('BOB')

  const brandingQuery = useQuery<BrandingData>({
    queryKey: ['tenant', 'branding'],
    queryFn: async () => {
      const response = await api.get<BrandingData>('/api/v1/tenant/branding')
      const data = response.data
      // Inicializar form con datos actuales
      setLogoUrl(data.logoUrl || '')
      setBrandPrimary(data.brandPrimary || '#3b82f6')
      setBrandSecondary(data.brandSecondary || '#10b981')
      setBrandTertiary(data.brandTertiary || '#f59e0b')
      setDefaultTheme(data.defaultTheme)
      setCurrency(data.currency || 'BOB')
      return data
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<BrandingData>) => {
      const response = await api.patch<BrandingData>('/api/v1/tenant/branding', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', 'branding'] })
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateMutation.mutateAsync({
      logoUrl: logoUrl || null,
      brandPrimary,
      brandSecondary,
      brandTertiary,
      defaultTheme,
      currency,
    })
  }

  if (brandingQuery.isLoading) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="Branding">
          <Loading />
        </PageContainer>
      </MainLayout>
    )
  }

  if (brandingQuery.error) {
    return (
      <MainLayout navGroups={navGroups}>
        <PageContainer title="Branding">
          <ErrorState 
            message="Error al cargar branding" 
            retry={brandingQuery.refetch}
          />
        </PageContainer>
      </MainLayout>
    )
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Branding">
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Logo URL */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Logo URL
              </label>
              <Input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
              />
              <p className="mt-1 text-xs text-slate-500">
                URL completa del logo de tu empresa (se recomienda formato PNG o SVG)
              </p>
              {logoUrl && (
                <div className="mt-3 p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800">
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">Vista previa:</p>
                  <img src={logoUrl} alt="Logo preview" className="h-16 w-auto" onError={(e) => {
                    e.currentTarget.src = ''
                    e.currentTarget.alt = 'Error al cargar imagen'
                  }} />
                </div>
              )}
            </div>

            {/* Colores */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Color Primario
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={brandPrimary}
                    onChange={(e) => setBrandPrimary(e.target.value)}
                    className="h-10 w-20 rounded border border-slate-300 dark:border-slate-600 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={brandPrimary}
                    onChange={(e) => setBrandPrimary(e.target.value)}
                    placeholder="#3b82f6"
                    className="flex-1"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">Botones principales, enlaces</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Color Secundario
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={brandSecondary}
                    onChange={(e) => setBrandSecondary(e.target.value)}
                    className="h-10 w-20 rounded border border-slate-300 dark:border-slate-600 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={brandSecondary}
                    onChange={(e) => setBrandSecondary(e.target.value)}
                    placeholder="#10b981"
                    className="flex-1"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">Estados de éxito, confirmaciones</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Color Terciario
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={brandTertiary}
                    onChange={(e) => setBrandTertiary(e.target.value)}
                    className="h-10 w-20 rounded border border-slate-300 dark:border-slate-600 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={brandTertiary}
                    onChange={(e) => setBrandTertiary(e.target.value)}
                    placeholder="#f59e0b"
                    className="flex-1"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">Alertas, notificaciones</p>
              </div>
            </div>

            {/* Tema por defecto */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Tema por Defecto
              </label>
              <div className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="LIGHT"
                    checked={defaultTheme === 'LIGHT'}
                    onChange={(e) => setDefaultTheme(e.target.value as 'LIGHT' | 'DARK')}
                    className="mr-2"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">☀️ Claro</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="DARK"
                    checked={defaultTheme === 'DARK'}
                    onChange={(e) => setDefaultTheme(e.target.value as 'LIGHT' | 'DARK')}
                    className="mr-2"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">🌙 Oscuro</span>
                </label>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Tema que se aplicará por defecto a los usuarios de tu tenant
              </p>
            </div>

            {/* Divisa */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Divisa
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="BOB">BOB - Boliviano</option>
                <option value="USD">USD - Dólar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="PEN">PEN - Sol Peruano</option>
                <option value="ARS">ARS - Peso Argentino</option>
                <option value="CLP">CLP - Peso Chileno</option>
                <option value="BRL">BRL - Real Brasileño</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Divisa que se mostrará en precios del catálogo comercial
              </p>
            </div>

            {/* Mensaje de éxito */}
            {updateMutation.isSuccess && (
              <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-700 dark:text-green-400">
                  ✅ Branding actualizado exitosamente
                </p>
              </div>
            )}

            {/* Mensaje de error */}
            {updateMutation.isError && (
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-700 dark:text-red-400">
                  ❌ Error al actualizar branding
                </p>
              </div>
            )}

            {/* Botones */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setLogoUrl(brandingQuery.data?.logoUrl || '')
                  setBrandPrimary(brandingQuery.data?.brandPrimary || '#3b82f6')
                  setBrandSecondary(brandingQuery.data?.brandSecondary || '#10b981')
                  setBrandTertiary(brandingQuery.data?.brandTertiary || '#f59e0b')
                  setDefaultTheme(brandingQuery.data?.defaultTheme || 'LIGHT')
                  setCurrency(brandingQuery.data?.currency || 'BOB')
                }}
                disabled={updateMutation.isPending}
              >
                Restablecer
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Guardando...' : 'Guardar Cambios'}
              </Button>
            </div>
          </form>
        </div>
      </PageContainer>
    </MainLayout>
  )
}

