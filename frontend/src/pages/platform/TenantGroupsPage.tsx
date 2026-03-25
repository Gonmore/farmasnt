import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MainLayout, PageContainer, Button, Table, Loading, ErrorState, EmptyState, Modal } from '../../components'
import { useNavigation } from '../../hooks'
import { api } from '../../lib/api'
import { PlusIcon, TrashIcon, UserPlusIcon } from '@heroicons/react/24/outline'

interface GroupTenant {
  id: string
  name: string
  isActive: boolean
  logoUrl: string | null
}

interface TenantGroup {
  id: string
  name: string
  createdAt: string
  tenants: GroupTenant[]
}

interface TenantOption {
  id: string
  name: string
  isActive: boolean
}

export function TenantGroupsPage() {
  const navGroups = useNavigation()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([])

  const [addMemberGroup, setAddMemberGroup] = useState<TenantGroup | null>(null)
  const [addMemberTenantId, setAddMemberTenantId] = useState('')

  const groupsQuery = useQuery<{ items: TenantGroup[] }>({
    queryKey: ['platform', 'tenant-groups'],
    queryFn: async () => {
      const r = await api.get('/api/v1/platform/tenant-groups')
      return r.data
    },
  })

  const tenantsQuery = useQuery<{ items: TenantOption[]; nextCursor: string | null }>({
    queryKey: ['platform', 'tenants-mini'],
    queryFn: async () => {
      const r = await api.get('/api/v1/platform/tenants?take=50')
      return r.data
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; tenantIds: string[] }) => {
      const r = await api.post('/api/v1/platform/tenant-groups', data)
      return r.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'tenant-groups'] })
      setCreateOpen(false)
      setCreateName('')
      setSelectedTenantIds([])
    },
  })

  const addMemberMutation = useMutation({
    mutationFn: async ({ groupId, tenantId }: { groupId: string; tenantId: string }) => {
      const r = await api.post(`/api/v1/platform/tenant-groups/${encodeURIComponent(groupId)}/members`, { tenantId })
      return r.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'tenant-groups'] })
      setAddMemberGroup(null)
      setAddMemberTenantId('')
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: async ({ groupId, tenantId }: { groupId: string; tenantId: string }) => {
      await api.delete(`/api/v1/platform/tenant-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(tenantId)}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'tenant-groups'] })
    },
  })

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      await api.delete(`/api/v1/platform/tenant-groups/${encodeURIComponent(groupId)}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'tenant-groups'] })
    },
  })

  // Tenants already assigned to any group
  const assignedTenantIds = new Set(
    (groupsQuery.data?.items ?? []).flatMap((g) => g.tenants.map((t) => t.id)),
  )

  // Available tenants for creation (not yet in a group)
  const availableForCreate = (tenantsQuery.data?.items ?? []).filter((t) => !assignedTenantIds.has(t.id))

  // Available tenants for adding to a specific group
  const availableForAdd = (tenantsQuery.data?.items ?? []).filter((t) => !assignedTenantIds.has(t.id))

  const toggleTenantSelection = (id: string) => {
    setSelectedTenantIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="Grupos de Empresas (Multi-Marca)"
        actions={
          <Button icon={<PlusIcon />} onClick={() => setCreateOpen(true)}>
            Nuevo Grupo
          </Button>
        }
      >
        {groupsQuery.isLoading && <Loading />}
        {groupsQuery.error && <ErrorState message="Error al cargar grupos" />}
        {groupsQuery.data && groupsQuery.data.items.length === 0 && (
          <EmptyState message="No hay grupos de empresas configurados" />
        )}

        {groupsQuery.data && groupsQuery.data.items.length > 0 && (
          <Table
            data={groupsQuery.data.items}
            keyExtractor={(g) => g.id}
            columns={[
              {
                header: 'Grupo',
                accessor: (g: TenantGroup) => <span className="font-medium">{g.name}</span>,
              },
              {
                header: 'Empresas',
                accessor: (g: TenantGroup) => (
                  <div className="space-y-1">
                    {g.tenants.map((t) => (
                      <div key={t.id} className="flex items-center gap-2">
                        {t.logoUrl ? (
                          <img src={t.logoUrl} alt="" className="h-5 w-5 rounded object-contain" />
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-200 text-[10px] font-bold dark:bg-slate-700">
                            {t.name.charAt(0)}
                          </span>
                        )}
                        <span className="text-sm">{t.name}</span>
                        {!t.isActive && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            Inactivo
                          </span>
                        )}
                        <button
                          type="button"
                          title="Quitar del grupo"
                          className="ml-auto text-slate-400 hover:text-red-500"
                          onClick={() => {
                            if (confirm(`¿Quitar "${t.name}" del grupo "${g.name}"? Se revocarán los accesos cruzados.`))
                              removeMemberMutation.mutate({ groupId: g.id, tenantId: t.id })
                          }}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                header: 'Acciones',
                className: 'text-center w-48',
                accessor: (g: TenantGroup) => (
                  <div className="flex items-center justify-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<UserPlusIcon className="h-4 w-4" />}
                      onClick={() => {
                        setAddMemberGroup(g)
                        setAddMemberTenantId('')
                      }}
                    >
                      Agregar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<TrashIcon className="h-4 w-4" />}
                      onClick={() => {
                        if (confirm(`¿Eliminar el grupo "${g.name}"? Se revocarán todos los accesos cruzados.`))
                          deleteGroupMutation.mutate(g.id)
                      }}
                    >
                      Eliminar
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}

        {/* Create Group Modal */}
        <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="Crear Grupo de Empresas" maxWidth="lg">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Nombre del Grupo *
              </label>
              <input
                type="text"
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Ej: Grupo Farmacéutico XYZ"
                className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Seleccionar Empresas (mínimo 2) *
              </label>
              {tenantsQuery.isLoading && <div className="text-sm text-slate-500">Cargando tenants...</div>}
              {availableForCreate.length === 0 && !tenantsQuery.isLoading && (
                <div className="text-sm text-slate-500">No hay empresas disponibles (todas ya están en un grupo)</div>
              )}
              <div className="mt-1 max-h-60 overflow-auto rounded border border-slate-200 p-2 dark:border-slate-700">
                {availableForCreate.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={selectedTenantIds.includes(t.id)}
                      onChange={() => toggleTenantSelection(t.id)}
                    />
                    <span>{t.name}</span>
                    {!t.isActive && <span className="text-xs text-red-500">(inactivo)</span>}
                  </label>
                ))}
              </div>
            </div>

            {createMutation.error && (
              <div className="rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {(createMutation.error as any)?.response?.data?.message || 'Error al crear grupo'}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
                Cancelar
              </Button>
              <Button
                onClick={() => createMutation.mutate({ name: createName, tenantIds: selectedTenantIds })}
                disabled={createMutation.isPending || selectedTenantIds.length < 2 || !createName.trim()}
              >
                {createMutation.isPending ? 'Creando...' : 'Crear Grupo'}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Add Member Modal */}
        <Modal
          isOpen={!!addMemberGroup}
          onClose={() => setAddMemberGroup(null)}
          title={addMemberGroup ? `Agregar empresa a "${addMemberGroup.name}"` : 'Agregar empresa'}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Seleccionar Empresa
              </label>
              {availableForAdd.length === 0 ? (
                <div className="text-sm text-slate-500">No hay empresas disponibles</div>
              ) : (
                <select
                  value={addMemberTenantId}
                  onChange={(e) => setAddMemberTenantId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
                >
                  <option value="">-- Seleccionar --</option>
                  {availableForAdd.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {!t.isActive ? '(inactivo)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {addMemberMutation.error && (
              <div className="rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {(addMemberMutation.error as any)?.response?.data?.message || 'Error al agregar empresa'}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAddMemberGroup(null)} disabled={addMemberMutation.isPending}>
                Cancelar
              </Button>
              <Button
                onClick={() =>
                  addMemberGroup &&
                  addMemberTenantId &&
                  addMemberMutation.mutate({ groupId: addMemberGroup.id, tenantId: addMemberTenantId })
                }
                disabled={addMemberMutation.isPending || !addMemberTenantId}
              >
                {addMemberMutation.isPending ? 'Agregando...' : 'Agregar'}
              </Button>
            </div>
          </div>
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
