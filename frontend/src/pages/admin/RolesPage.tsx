import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Table, Loading, ErrorState, EmptyState, Button, Modal, Input } from '../../components'
import { useNavigation } from '../../hooks'

type AdminRoleListItem = {
  id: string
  code: string
  name: string
  isSystem: boolean
  permissionCodes?: string[]
}

async function fetchRoles(token: string): Promise<{ items: AdminRoleListItem[] }> {
  return apiFetch(`/api/v1/admin/roles`, { token })
}

export function RolesPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState<{ open: boolean; role: AdminRoleListItem } | null>(null)

  const [createCode, setCreateCode] = useState('')
  const [createName, setCreateName] = useState('')
  const [createPermissionCodes, setCreatePermissionCodes] = useState<string[]>([])

  const [editPermissionCodes, setEditPermissionCodes] = useState<string[]>([])

  const rolesQuery = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => fetchRoles(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  // Definir características y sus permisos asociados
  const features = [
    {
      name: 'Productos',
      permissions: [
        { code: 'catalog:read', label: 'Ver' },
        { code: 'catalog:write', label: 'Editar' },
      ],
    },
    {
      name: 'Stock',
      permissions: [
        { code: 'stock:read', label: 'Ver' },
        { code: 'stock:move', label: 'Mover' },
      ],
    },
    {
      name: 'Ventas',
      permissions: [
        { code: 'sales:order:read', label: 'Ver' },
        { code: 'sales:order:write', label: 'Crear' },
      ],
    },
    {
      name: 'Auditoría',
      permissions: [
        { code: 'audit:read', label: 'Ver' },
      ],
    },
    {
      name: 'Usuarios',
      permissions: [
        { code: 'admin:users:manage', label: 'Gestionar' },
      ],
    },
  ]

  // Función para generar código automáticamente desde el nombre
  const generateCodeFromName = (name: string) => {
    return name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '') // Solo letras, números y espacios
      .replace(/\s+/g, '_') // Espacios a guiones bajos
      .replace(/^_+|_+$/g, '') // Quitar guiones al inicio/fin
  }

  // Función para verificar si un permiso está seleccionado
  const isPermissionSelected = (permissionCodes: string[], permissionCode: string) => {
    return permissionCodes.includes(permissionCode)
  }

  // Función para togglear un permiso
  const togglePermission = (currentCodes: string[], permissionCode: string) => {
    if (currentCodes.includes(permissionCode)) {
      return currentCodes.filter(code => code !== permissionCode)
    } else {
      return [...currentCodes, permissionCode]
    }
  }

  const createRoleMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/v1/admin/roles', {
        method: 'POST',
        token: auth.accessToken!,
        body: JSON.stringify({
          code: createCode.trim(),
          name: createName.trim(),
          permissionCodes: createPermissionCodes,
        }),
      })
    },
    onSuccess: () => {
      setCreateOpen(false)
      setCreateCode('')
      setCreateName('')
      setCreatePermissionCodes([])
      qc.invalidateQueries({ queryKey: ['admin-roles'] })
    },
  })

  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ roleId, permissionCodes }: { roleId: string; permissionCodes: string[] }) => {
      return apiFetch(`/api/v1/admin/roles/${roleId}/permissions`, {
        method: 'PUT',
        token: auth.accessToken!,
        body: JSON.stringify({ permissionCodes }),
      })
    },
    onSuccess: () => {
      setEditOpen(null)
      setEditPermissionCodes([])
      qc.invalidateQueries({ queryKey: ['admin-roles'] })
    },
  })

  const handleEditPermissions = (role: AdminRoleListItem) => {
    const currentPermissionCodes = role.permissionCodes || []
    setEditPermissionCodes(currentPermissionCodes)
    setEditOpen({ open: true, role })
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer 
        title="Roles"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            + Nuevo Rol
          </Button>
        }
      >
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {rolesQuery.isLoading && <Loading />}
          {rolesQuery.error && <ErrorState message="Error al cargar roles" retry={rolesQuery.refetch} />}
          {rolesQuery.data && rolesQuery.data.items.length === 0 && <EmptyState message="No hay roles" />}
          {rolesQuery.data && rolesQuery.data.items.length > 0 && (
            <Table
              columns={[
                { header: 'Código', accessor: (r) => r.code },
                { header: 'Nombre', accessor: (r) => r.name },
                { header: 'Sistema', accessor: (r) => (r.isSystem ? 'Sí' : 'No') },
                {
                  header: 'Acciones',
                  accessor: (r) => (
                    <div className="flex gap-2">
                      {!r.isSystem && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleEditPermissions(r)}
                        >
                          Editar Permisos
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
              data={rolesQuery.data.items}
              keyExtractor={(r) => r.id}
            />
          )}
        </div>

        {/* Modal Crear Rol */}
        <Modal
          isOpen={createOpen}
          onClose={() => {
            setCreateOpen(false)
            setCreateCode('')
            setCreateName('')
            setCreatePermissionCodes([])
          }}
          title="Crear Nuevo Rol"
          maxWidth="lg"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createRoleMutation.mutate()
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Input
                  label="Código (automático)"
                  value={createCode}
                  readOnly
                  placeholder="Se genera automáticamente"
                  className="bg-slate-50 dark:bg-slate-800"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Identificador único generado desde el nombre
                </p>
              </div>
              <Input
                label="Nombre"
                value={createName}
                onChange={(e) => {
                  const newName = e.target.value
                  setCreateName(newName)
                  setCreateCode(generateCodeFromName(newName))
                }}
                placeholder="Ej: Gerente de Ventas"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Permisos
              </label>
              <div className="border border-slate-200 dark:border-slate-600 rounded max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                      <tr>
                        {features.map((feature) => (
                          <th key={feature.name} className="px-4 py-3 text-center font-medium text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-600">
                            {feature.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-100 dark:border-slate-700">
                        {features.map((feature) => (
                          <td key={feature.name} className="px-4 py-4 text-center">
                            <div className="flex flex-col gap-2 items-start">
                              {feature.permissions.map((perm) => (
                                <label key={perm.code} className="flex items-center gap-2 text-sm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isPermissionSelected(createPermissionCodes, perm.code)}
                                    onChange={() => {
                                      setCreatePermissionCodes(togglePermission(createPermissionCodes, perm.code))
                                    }}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span className="text-slate-700 dark:text-slate-300">{perm.label}</span>
                                </label>
                              ))}
                            </div>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
            </div>

            {createRoleMutation.error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                Error: {(createRoleMutation.error as any)?.response?.data?.message || 'Error al crear rol'}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCreateOpen(false)
                  setCreateCode('')
                  setCreateName('')
                  setCreatePermissionCodes([])
                }}
                disabled={createRoleMutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createRoleMutation.isPending || !createCode.trim() || !createName.trim()}>
                {createRoleMutation.isPending ? 'Creando...' : 'Crear Rol'}
              </Button>
            </div>
          </form>
        </Modal>

        {/* Modal Editar Permisos */}
        {editOpen && (
          <Modal
            isOpen={editOpen.open}
            onClose={() => {
              setEditOpen(null)
              setEditPermissionCodes([])
            }}
            title={`Editar Permisos: ${editOpen.role.name}`}
            maxWidth="lg"
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Permisos
                </label>
                <div className="border border-slate-200 dark:border-slate-600 rounded max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                      <tr>
                        {features.map((feature) => (
                          <th key={feature.name} className="px-4 py-3 text-center font-medium text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-600">
                            {feature.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-100 dark:border-slate-700">
                        {features.map((feature) => (
                          <td key={feature.name} className="px-4 py-4 text-center">
                            <div className="flex flex-col gap-2 items-start">
                              {feature.permissions.map((perm) => (
                                <label key={perm.code} className="flex items-center gap-2 text-sm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isPermissionSelected(editPermissionCodes, perm.code)}
                                    onChange={() => {
                                      setEditPermissionCodes(togglePermission(editPermissionCodes, perm.code))
                                    }}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span className="text-slate-700 dark:text-slate-300">{perm.label}</span>
                                </label>
                              ))}
                            </div>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {updatePermissionsMutation.error && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  Error: {(updatePermissionsMutation.error as any)?.response?.data?.message || 'Error al actualizar permisos'}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditOpen(null)
                    setEditPermissionCodes([])
                  }}
                  disabled={updatePermissionsMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={() => updatePermissionsMutation.mutate({
                    roleId: editOpen.role.id,
                    permissionCodes: editPermissionCodes
                  })}
                  disabled={updatePermissionsMutation.isPending}
                >
                  {updatePermissionsMutation.isPending ? 'Guardando...' : 'Guardar Permisos'}
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </PageContainer>
    </MainLayout>
  )
}
