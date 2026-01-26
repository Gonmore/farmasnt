import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, Modal, Input } from '../../components'
import { useNavigation } from '../../hooks'
import { UserGroupIcon, PowerIcon, KeyIcon, PlusIcon } from '@heroicons/react/24/outline'

type AdminUserListItem = {
  id: string
  email: string
  fullName: string | null
  isActive: boolean
  createdAt: string
  roleIds?: string[]
}

type RolesResponse = { items: Array<{ id: string; code: string; name: string }> }

async function fetchUsers(token: string): Promise<{ items: AdminUserListItem[] }> {
  return apiFetch(`/api/v1/admin/users`, { token })
}

async function fetchRoles(token: string): Promise<RolesResponse> {
  return apiFetch(`/api/v1/admin/roles?take=50`, { token })
}

export function UsersPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [rolesOpen, setRolesOpen] = useState<{ open: boolean; userId: string; email: string } | null>(null)
  const [resetOpen, setResetOpen] = useState<{ open: boolean; userId: string; email: string } | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)

  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createFullName, setCreateFullName] = useState('')
  const [createRoleId, setCreateRoleId] = useState<string>('')

  const [selectedRoleId, setSelectedRoleId] = useState<string>('')

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => fetchUsers(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const rolesQuery = useQuery({
    queryKey: ['admin-roles-mini'],
    queryFn: () => fetchRoles(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiFetch(`/api/v1/admin/users`, {
        method: 'POST',
        token: auth.accessToken!,
        body: JSON.stringify({
          email: createEmail,
          password: createPassword,
          fullName: createFullName.trim() ? createFullName.trim() : undefined,
          roleIds: createRoleId ? [createRoleId] : undefined,
        }),
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-users'] })
      setCreateOpen(false)
      setCreateEmail('')
      setCreatePassword('')
      setCreateFullName('')
      setCreateRoleId('')
    },
  })

  const statusMutation = useMutation({
    mutationFn: async (input: { userId: string; isActive: boolean }) => {
      return apiFetch(`/api/v1/admin/users/${encodeURIComponent(input.userId)}/status`, {
        method: 'PATCH',
        token: auth.accessToken!,
        body: JSON.stringify({ isActive: input.isActive }),
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  const resetMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiFetch<{ userId: string; temporaryPassword: string }>(
        `/api/v1/admin/users/${encodeURIComponent(userId)}/reset-password`,
        {
          method: 'POST',
          token: auth.accessToken!,
          body: JSON.stringify({}),
        },
      )
    },
    onSuccess: (data) => {
      setTempPassword(data.temporaryPassword)
    },
  })

  const rolesMutation = useMutation({
    mutationFn: async (input: { userId: string; roleIds: string[] }) => {
      return apiFetch(`/api/v1/admin/users/${encodeURIComponent(input.userId)}/roles`, {
        method: 'PUT',
        token: auth.accessToken!,
        body: JSON.stringify({ roleIds: input.roleIds }),
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-users'] })
      setRolesOpen(null)
      setSelectedRoleId('')
    },
  })

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Usuarios">
        <div className="mb-3 flex justify-end">
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreateOpen(true)}>Crear usuario</Button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {usersQuery.isLoading && <Loading />}
          {usersQuery.error && <ErrorState message="Error al cargar usuarios" retry={usersQuery.refetch} />}
          {usersQuery.data && usersQuery.data.items.length === 0 && <EmptyState message="No hay usuarios" />}
          {usersQuery.data && usersQuery.data.items.length > 0 && (
            <Table
              columns={[
                { header: 'Email', accessor: (u) => u.email },
                { header: 'Nombre', accessor: (u) => u.fullName || '-' },
                { header: 'Estado', accessor: (u) => (u.isActive ? 'Activo' : 'Inactivo') },
                { header: 'Creado', accessor: (u) => new Date(u.createdAt).toLocaleDateString() },
                {
                  header: 'Acciones',
                  className: 'text-center w-auto',
                  accessor: (u) => (
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<UserGroupIcon className="w-4 h-4" />}
                        onClick={() => {
                          setRolesOpen({ open: true, userId: u.id, email: u.email })
                          setSelectedRoleId((u.roleIds ?? [])[0] ?? '')
                        }}
                      >
                        Roles
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<PowerIcon className="w-4 h-4" />}
                        onClick={() => statusMutation.mutate({ userId: u.id, isActive: !u.isActive })}
                        disabled={statusMutation.isPending}
                      >
                        {u.isActive ? 'Desactivar' : 'Activar'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<KeyIcon className="w-4 h-4" />}
                        onClick={() => {
                          setResetOpen({ open: true, userId: u.id, email: u.email })
                          setTempPassword(null)
                        }}
                      >
                        Reset
                      </Button>
                    </div>
                  ),
                },
              ]}
              data={usersQuery.data.items}
              keyExtractor={(u) => u.id}
            />
          )}
        </div>

        <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="Crear usuario">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
            className="space-y-4"
          >
            <Input type="email" label="Email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} required />
            <Input
              type="password"
              label="Contraseña"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              required
            />
            <Input
              type="text"
              label="Nombre (opcional)"
              value={createFullName}
              onChange={(e) => setCreateFullName(e.target.value)}
            />

            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Roles</div>
              {rolesQuery.isLoading && <div className="text-sm text-slate-600 dark:text-slate-400">Cargando roles...</div>}
              {rolesQuery.data?.items?.length ? (
                <div className="max-h-56 overflow-auto rounded border border-slate-200 p-2 dark:border-slate-700">
                  {rolesQuery.data.items.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                      <input
                        type="radio"
                        name="createRole"
                        checked={createRoleId === r.id}
                        onChange={() => setCreateRoleId(r.id)}
                      />
                      <span>
                        {r.name} ({r.code})
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-400">No hay roles</div>
              )}
            </div>

            {createMutation.error && (
              <div className="rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {(createMutation.error as any)?.message ?? 'Error al crear usuario'}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creando...' : 'Crear'}
              </Button>
            </div>
          </form>
        </Modal>

        <Modal
          isOpen={Boolean(rolesOpen?.open)}
          onClose={() => setRolesOpen(null)}
          title={rolesOpen ? `Roles: ${rolesOpen.email}` : 'Roles'}
        >
          <div className="space-y-4">
            <div className="max-h-72 overflow-auto rounded border border-slate-200 p-2 dark:border-slate-700">
              {(rolesQuery.data?.items ?? []).map((r) => (
                <label key={r.id} className="flex items-center gap-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                  <input
                    type="radio"
                    name="editRole"
                    checked={selectedRoleId === r.id}
                    onChange={() => setSelectedRoleId(r.id)}
                  />
                  <span>
                    {r.name} ({r.code})
                  </span>
                </label>
              ))}
            </div>

            {rolesMutation.error && (
              <div className="rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {(rolesMutation.error as any)?.message ?? 'Error al actualizar roles'}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRolesOpen(null)} disabled={rolesMutation.isPending}>
                Cancelar
              </Button>
              <Button
                onClick={() => rolesOpen && rolesMutation.mutate({ userId: rolesOpen.userId, roleIds: selectedRoleId ? [selectedRoleId] : [] })}
                disabled={rolesMutation.isPending}
              >
                Guardar
              </Button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={Boolean(resetOpen?.open)}
          onClose={() => {
            setResetOpen(null)
            setTempPassword(null)
          }}
          title={resetOpen ? `Resetear contraseña: ${resetOpen.email}` : 'Resetear contraseña'}
        >
          <div className="space-y-4">
            <Button
              onClick={() => resetOpen && resetMutation.mutate(resetOpen.userId)}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? 'Reseteando...' : 'Generar contraseña temporal'}
            </Button>

            {tempPassword && (
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                Contraseña temporal: <span className="font-mono">{tempPassword}</span>
              </div>
            )}

            {resetMutation.error && (
              <div className="rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {(resetMutation.error as any)?.message ?? 'Error al resetear la contraseña'}
              </div>
            )}
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
