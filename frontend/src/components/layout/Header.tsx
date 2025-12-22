import { Link } from 'react-router-dom'
import { useAuth } from '../../providers/AuthProvider'
import { useTenant } from '../../providers/TenantProvider'
import { useTheme } from '../../providers/ThemeProvider'

export function Header() {
  const auth = useAuth()
  const tenant = useTenant()
  const theme = useTheme()

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex h-16 items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-3">
          {tenant.branding?.logoUrl && (
            <img 
              src={theme.mode === 'dark' ? '/Logo_Blanco.png' : '/Logo_Azul.png'} 
              alt="Logo" 
              className="h-10 w-auto" 
            />
          )}
        </Link>

        <div className="flex items-center gap-4">
          {auth.isAuthenticated && (
            <>
              <button
                onClick={theme.toggle}
                className="rounded p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                title={theme.mode === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              >
                {theme.mode === 'dark' ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                    />
                  </svg>
                )}
              </button>
              <button
                onClick={auth.logout}
                className="rounded bg-slate-200 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
              >
                Salir
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
