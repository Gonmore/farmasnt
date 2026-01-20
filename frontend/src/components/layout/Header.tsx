import { Link } from 'react-router-dom'
import { useAuth } from '../../providers/AuthProvider'
import { useNotifications } from '../../providers/NotificationsProvider'
import { useTenant } from '../../providers/TenantProvider'
import { useTheme } from '../../providers/ThemeProvider'
import { useEffect, useRef, useState } from 'react'

interface HeaderProps {
  onMenuClick?: () => void
  showMenuButton?: boolean
}

export function Header({ onMenuClick, showMenuButton = false }: HeaderProps) {
  const auth = useAuth()
  const tenant = useTenant()
  const theme = useTheme()
  const notifications = useNotifications()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [logoDimensions, setLogoDimensions] = useState<{ width: number; height: number } | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (tenant.branding?.logoUrl) {
      const img = new Image()
      img.onload = () => {
        setLogoDimensions({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.src = tenant.branding.logoUrl
    } else {
      setLogoDimensions(null)
    }
  }, [tenant.branding?.logoUrl])

  const getLogoClassName = () => {
    if (!logoDimensions) return 'h-12 w-auto'
    
    const aspectRatio = logoDimensions.width / logoDimensions.height
    if (aspectRatio >= 0.8 && aspectRatio <= 1.2) {
      // Casi cuadrado
      return 'h-12 w-12 object-contain'
    } else {
      // Rectangular
      return 'h-12 w-auto'
    }
  }

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!notificationsOpen) return
      const target = e.target as Node | null
      if (dropdownRef.current && target && !dropdownRef.current.contains(target)) {
        setNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [notificationsOpen])

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          {showMenuButton && (
            <button
              onClick={onMenuClick}
              className="rounded p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden"
              title="Menú"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <Link to="/" className="flex items-center gap-3">
            {tenant.branding?.logoUrl ? (
              <img 
                src={tenant.branding.logoUrl} 
                alt={tenant.branding.tenantName || 'Logo'} 
                className={getLogoClassName()} 
              />
            ) : (
              <img 
                src={theme.mode === 'dark' ? '/Logo_Blanco.png' : '/Logo_Azul.png'} 
                alt="Logo" 
                className="h-10 w-auto" 
              />
            )}
          </Link>
        </div>

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

              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => {
                    const next = !notificationsOpen
                    setNotificationsOpen(next)
                    if (next) notifications.markAllRead()
                  }}
                  className="relative rounded p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  title="Notificaciones"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                  {notifications.unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold text-white">
                      {notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}
                    </span>
                  )}
                </button>

                {!notificationsOpen && notifications.toast && (
                  <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-start gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {notifications.toast.title}
                        </div>
                        {notifications.toast.body && (
                          <div className="mt-1 whitespace-pre-line text-xs text-slate-600 dark:text-slate-400">
                            {notifications.toast.body}
                          </div>
                        )}
                        {notifications.toast.linkTo && (
                          <div className="mt-2">
                            <Link
                              to={notifications.toast.linkTo}
                              className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                              onClick={() => notifications.dismissToast()}
                            >
                              Ver detalle
                            </Link>
                          </div>
                        )}
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
                          {new Date(notifications.toast.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <button
                        className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                        onClick={() => notifications.dismissToast()}
                        title="Cerrar"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}

                {notificationsOpen && (
                  <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700">
                      <span>Notificaciones</span>
                      <button
                        className="text-xs text-slate-600 hover:underline dark:text-slate-300"
                        onClick={() => notifications.clear()}
                      >
                        Limpiar
                      </button>
                    </div>
                    <div className="max-h-96 overflow-auto">
                      {notifications.notifications.length === 0 ? (
                        <div className="p-3 text-sm text-slate-600 dark:text-slate-400">Sin notificaciones.</div>
                      ) : (
                        notifications.notifications.slice(0, 12).map((n) => (
                          <div key={n.id} className="border-b border-slate-100 p-3 last:border-b-0 dark:border-slate-800">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{n.title}</div>
                            {n.body && <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">{n.body}</div>}
                            {n.linkTo && (
                              <div className="mt-2">
                                <Link to={n.linkTo} className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
                                  Abrir
                                </Link>
                              </div>
                            )}
                            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
                              {new Date(n.createdAt).toLocaleString()}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

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
