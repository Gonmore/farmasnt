import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Input, Loading } from '../components'
import { useTenant } from '../providers/TenantProvider'
import { apiFetch } from '../lib/api'
import { Footer } from '../components/layout/Footer'

type ResetRequestBody = { email: string }
type ResetConfirmBody = { token: string; newPassword: string }

export function ResetPasswordPage() {
  const tenant = useTenant()
  const [searchParams] = useSearchParams()

  const initialToken = useMemo(() => searchParams.get('token') ?? '', [searchParams])

  const mode = initialToken ? 'confirm' : 'request'

  const [email, setEmail] = useState('')
  const [token, setToken] = useState(initialToken)
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submitRequest = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      await apiFetch('/api/v1/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email } satisfies ResetRequestBody),
      })
      setMessage('Si el email existe, te enviamos instrucciones para restablecer tu contraseña.')
    } catch (err: any) {
      setError(err?.message ?? 'Error al solicitar el reseteo')
    } finally {
      setLoading(false)
    }
  }

  const submitConfirm = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      await apiFetch('/api/v1/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword } satisfies ResetConfirmBody),
      })
      setMessage('Contraseña actualizada. Ya puedes iniciar sesión.')
    } catch (err: any) {
      setError(err?.message ?? 'Error al actualizar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-slate-200 bg-white p-8 shadow-lg dark:border-slate-700 dark:bg-slate-900">
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
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  {mode === 'request' ? 'Restablecer contraseña' : 'Nueva contraseña'}
                </h2>
                <button
                  type="button"
                  onClick={() => window.location.href = '/login'}
                  className="text-sm text-slate-600 hover:underline dark:text-slate-400"
                >
                  Volver
                </button>
              </div>

              {mode === 'request' && (
                <form onSubmit={submitRequest} className="space-y-4">
                  <Input
                    type="email"
                    label="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    disabled={loading}
                  />
                  <Button type="submit" className="w-full" loading={loading}>
                    Enviar instrucciones
                  </Button>
                </form>
              )}

              {mode === 'confirm' && (
                <form onSubmit={submitConfirm} className="space-y-4">
                  <Input
                    type="text"
                    label="Token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    disabled={loading}
                  />
                  <Input
                    type="password"
                    label="Nueva contraseña"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    disabled={loading}
                  />
                  <Button type="submit" className="w-full" loading={loading}>
                    Actualizar contraseña
                  </Button>
                </form>
              )}

              {message && (
                <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                  {message}
                </div>
              )}

              {error && (
                <div className="rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}
