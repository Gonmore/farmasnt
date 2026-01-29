import { Link } from 'react-router-dom'
import { useAuth } from '../../providers/AuthProvider'
import { useNotifications } from '../../providers/NotificationsProvider'
import { useTenant } from '../../providers/TenantProvider'
import { useTheme } from '../../providers/ThemeProvider'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal, Button, Input, ImageUpload } from '../../components'
import { apiFetch } from '../../lib/api'
import { usePermissions } from '../../hooks/usePermissions'

interface HeaderProps {
  onMenuClick?: () => void
  showMenuButton?: boolean
}

export function Header({ onMenuClick, showMenuButton = false }: HeaderProps) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const tenant = useTenant()
  const theme = useTheme()
  const notifications = useNotifications()
  const me = usePermissions()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [logoDimensions, setLogoDimensions] = useState<{ width: number; height: number } | null>(null)
  const notificationsDropdownRef = useRef<HTMLDivElement | null>(null)
  const userDropdownRef = useRef<HTMLDivElement | null>(null)

  const [editProfileOpen, setEditProfileOpen] = useState(false)
  const [editFullName, setEditFullName] = useState('')
  const [editWarehouseId, setEditWarehouseId] = useState<string>('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [profileError, setProfileError] = useState<string | null>(null)

  type PresignResponse = { uploadUrl: string; publicUrl: string; key: string; method: 'PUT' | string }

  const initials = useMemo(() => {
    const fullName = (me.user?.fullName ?? '').trim()
    const fromName = fullName
      ? fullName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0]!.toUpperCase())
          .join('')
      : ''
    if (fromName) return fromName

    const email = (me.user?.email ?? '').trim()
    if (!email) return 'U'
    const local = email.split('@')[0] ?? email
    const parts = local.split(/[._\-\s]+/).filter(Boolean)
    const letters = parts
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('')
    return letters || local.slice(0, 2).toUpperCase() || 'U'
  }, [me.user?.email, me.user?.fullName])

  const isBranchScoped = me.hasPermission('scope:branch')

  const warehousesQuery = useQuery<{ items: Array<{ id: string; code: string; name: string; city?: string | null; isActive: boolean }> }>({
    queryKey: ['warehouses', 'forProfile'],
    queryFn: () => apiFetch(`/api/v1/warehouses?take=100`, { token: auth.accessToken! }),
    enabled: !!auth.accessToken && editProfileOpen && isBranchScoped,
  })

  async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
    const resp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(text || `Upload failed: ${resp.status}`)
    }
  }

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (!auth.accessToken) throw new Error('No autenticado')
      const cur = currentPassword
      const next = newPassword
      if (!cur || !next) throw new Error('Complete todos los campos')
      if (next !== confirmPassword) throw new Error('La confirmación no coincide')

      await apiFetch('/api/v1/auth/change-password', {
        token: auth.accessToken,
        method: 'POST',
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      })
    },
    onSuccess: () => {
      setProfileError(null)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setEditProfileOpen(false)
    },
    onError: (e: any) => {
      setProfileError(e?.message || 'No se pudo cambiar la contraseña')
    },
  })

  const uploadPhotoMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!auth.accessToken) throw new Error('No autenticado')
      if (!me.user) throw new Error('Usuario no cargado')
      if (!me.user.version) throw new Error('Versión de usuario no disponible')

      const presign = await apiFetch<PresignResponse>('/api/v1/auth/me/photo-upload', {
        token: auth.accessToken,
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      })
      await uploadToPresignedUrl(presign.uploadUrl, file)

      await apiFetch('/api/v1/auth/me', {
        token: auth.accessToken,
        method: 'PATCH',
        body: JSON.stringify({ version: me.user.version, photoUrl: presign.publicUrl, photoKey: presign.key }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      setEditProfileOpen(false)
    },
  })

  const removePhotoMutation = useMutation({
    mutationFn: async () => {
      if (!auth.accessToken) throw new Error('No autenticado')
      if (!me.user) throw new Error('Usuario no cargado')
      if (!me.user.version) throw new Error('Versión de usuario no disponible')
      await apiFetch('/api/v1/auth/me', {
        token: auth.accessToken,
        method: 'PATCH',
        body: JSON.stringify({ version: me.user.version, photoUrl: null, photoKey: null }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })

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
      const target = e.target as Node | null
      if (notificationsOpen && notificationsDropdownRef.current && target && !notificationsDropdownRef.current.contains(target)) {
        setNotificationsOpen(false)
      }
      if (userMenuOpen && userDropdownRef.current && target && !userDropdownRef.current.contains(target)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [notificationsOpen, userMenuOpen])

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

              <div className="relative" ref={notificationsDropdownRef}>
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

              <div className="relative" ref={userDropdownRef}>
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-full p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                  title={me.user?.email ?? 'Usuario'}
                >
                  {me.user?.photoUrl ? (
                    <img
                      src={me.user.photoUrl}
                      alt="Avatar"
                      className="h-9 w-9 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                      {initials}
                    </div>
                  )}
                  <svg className="h-4 w-4 text-slate-500 dark:text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <div className="border-b border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400">
                      {me.user?.fullName ? <div className="font-semibold text-slate-900 dark:text-slate-100">{me.user.fullName}</div> : null}
                      <div className="truncate">{me.user?.email ?? ''}</div>
                    </div>
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                      onClick={() => {
                        setUserMenuOpen(false)
                        setEditProfileOpen(true)
                        setEditFullName(me.user?.fullName ?? '')
                        setEditWarehouseId(me.user?.warehouseId ?? '')
                        setProfileError(null)
                      }}
                    >
                      Editar perfil
                    </button>
                    <div className="border-t border-slate-200 dark:border-slate-700" />
                    <button
                      className="w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
                      onClick={auth.logout}
                    >
                      Salir
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        isOpen={editProfileOpen}
        onClose={() => {
          if (changePasswordMutation.isPending || uploadPhotoMutation.isPending || removePhotoMutation.isPending) return
          setEditProfileOpen(false)
        }}
        title="Editar Perfil"
        maxWidth="md"
      >
        <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-2">
          {/* Nombre completo y rol en la misma fila */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Input
                label="Nombre completo"
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                placeholder="Ej: Juan Pérez"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Rol</label>
              <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 dark:border-slate-700 dark:bg-slate-800">
                {me.roles && me.roles.length > 0 ? (
                  <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    {me.roles[0].name}
                  </span>
                ) : (
                  <span className="text-sm text-slate-500">Sin rol asignado</span>
                )}
              </div>
            </div>
          </div>

          {/* Foto de perfil */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Foto de perfil</label>
            <ImageUpload
              currentImageUrl={me.user?.photoUrl ?? null}
              mode="select"
              loading={uploadPhotoMutation.isPending || removePhotoMutation.isPending}
              onImageSelect={(file) => uploadPhotoMutation.mutate(file)}
              onImageRemove={() => removePhotoMutation.mutate()}
            />
          </div>

          {/* Sucursal (solo usuarios scoped) */}
          {isBranchScoped && (
            <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
              <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Sucursal</div>
              <label className="mb-2 block text-xs text-slate-500 dark:text-slate-400">
                Esta selección limita clientes/cotizaciones/pagos/entregas por ciudad.
              </label>
              <select
                value={editWarehouseId}
                onChange={(e) => setEditWarehouseId(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                disabled={warehousesQuery.isLoading}
              >
                <option value="">(Sin sucursal seleccionada)</option>
                {(warehousesQuery.data?.items ?? [])
                  .filter((w) => w.isActive)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} - {w.name}
                      {w.city ? ` (${String(w.city).toUpperCase()})` : ''}
                    </option>
                  ))}
              </select>
              {me.user?.warehouseId && me.user?.warehouse && !me.user.warehouse.isActive && (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                  La sucursal actual está inactiva. Seleccione otra.
                </div>
              )}
            </div>
          )}

          {/* Cambiar contraseña (opcional) */}
          <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
            <div className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">Cambiar contraseña (opcional)</div>
            <div className="space-y-3">
              <Input
                label="Contraseña actual"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Dejar en blanco para no cambiar"
              />
              {currentPassword && (
                <>
                  <Input
                    label="Nueva contraseña"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <Input
                    label="Confirmar nueva contraseña"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </>
              )}
            </div>
          </div>

          {profileError && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {profileError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setEditProfileOpen(false)}
              disabled={changePasswordMutation.isPending || uploadPhotoMutation.isPending || removePhotoMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                setProfileError(null)
                try {
                  // Cambiar contraseña si se proporcionó
                  if (currentPassword && newPassword) {
                    if (newPassword !== confirmPassword) throw new Error('Las contraseñas no coinciden')
                    await changePasswordMutation.mutateAsync()
                  }
                  // Actualizar nombre si cambió
                  if (editFullName.trim() !== (me.user?.fullName ?? '').trim()) {
                    if (!me.user?.version) throw new Error('Versión de usuario no disponible')
                    await apiFetch('/api/v1/auth/me', {
                      token: auth.accessToken!,
                      method: 'PATCH',
                      body: JSON.stringify({ version: me.user.version, fullName: editFullName.trim() || null }),
                    })
                    queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
                  }

                  // Actualizar sucursal si cambió
                  if (isBranchScoped) {
                    const current = me.user?.warehouseId ?? ''
                    const next = editWarehouseId
                    if (current !== next) {
                      if (!me.user?.version) throw new Error('Versión de usuario no disponible')
                      await apiFetch('/api/v1/auth/me', {
                        token: auth.accessToken!,
                        method: 'PATCH',
                        body: JSON.stringify({ version: me.user.version, warehouseId: next ? next : null }),
                      })
                      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
                    }
                  }
                  setEditProfileOpen(false)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                } catch (e: any) {
                  setProfileError(e?.message || 'Error al guardar cambios')
                }
              }}
              loading={changePasswordMutation.isPending || uploadPhotoMutation.isPending || removePhotoMutation.isPending}
            >
              Guardar
            </Button>
          </div>
        </div>
      </Modal>
    </header>
  )
}
