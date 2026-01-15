import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider'
import { useTenant } from '../providers/TenantProvider'
import { Button, Input, Loading } from '../components'
import { Footer } from '../components/layout/Footer'

export function LoginPage() {
  const auth = useAuth()
  const tenant = useTenant()
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@demo.local')
  const [password, setPassword] = useState('Admin123!')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    try {
      const reason = sessionStorage.getItem('pf.logoutReason')
      if (reason === 'SESSION_EXPIRED') {
        setNotice('Tu sesión expiró por inactividad. Por favor vuelve a iniciar sesión.')
      }
      if (reason) sessionStorage.removeItem('pf.logoutReason')
    } catch {
      // ignore
    }
  }, [])

  if (auth.isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await auth.login(email, password)
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err?.message ?? 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-full max-w-md space-y-8 rounded-lg border border-slate-200 bg-white p-8 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {/* Branding pre-login */}
          {(tenant.brandingLoading || tenant.branding) && (
            <div className="flex flex-col items-center">
              {tenant.brandingLoading ? (
                <Loading message="Cargando..." />
              ) : (
                <>
                  {tenant.branding?.logoUrl && (
                    <img src={tenant.branding.logoUrl} alt="Logo" className="mb-4 h-16 w-auto" />
                  )}
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {tenant.branding?.tenantName || 'PharmaFlow'}
                  </h1>
                </>
              )}
            </div>
          )}

          {!tenant.brandingLoading && (
            <>
              <div className="text-center">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  Iniciar sesión
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  Ingresa tus credenciales para continuar
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-8 space-y-6">
                <Input
                  type="email"
                  label="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={loading}
                />
                
                <Input
                  type="password"
                  label="Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={loading}
                />

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => window.location.href = '/reset-password'}
                    className="text-sm text-slate-600 hover:underline dark:text-slate-400"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>

                {notice && (
                  <div className="rounded bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                    {notice}
                  </div>
                )}

                {error && (
                  <div className="rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" loading={loading}>
                  Iniciar sesión
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
      
      <Footer />
    </div>
  )
}
