import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { usePermissions, useNavigation } from '../../hooks'
import { MainLayout, PageContainer, Table, Loading, ErrorState, PaginationCursor, Button, Modal, Input, Select } from '../../components'

type SupplyItem = {
  id: string
  code: string | null
  name: string
  baseUnit: string
  isActive: boolean
  version: number
  updatedAt: string
}

type ListResponse = { items: SupplyItem[]; nextCursor: string | null }

const CATEGORY = 'MAINTENANCE' as const

async function listSupplies(token: string, take: number, cursor?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ take: String(take) })
  params.set('category', CATEGORY)
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/api/v1/laboratory/supplies?${params}`, { token })
}

async function createSupply(
  token: string,
  body: { code?: string; name: string; baseUnit: string; category?: 'RAW_MATERIAL' | 'MAINTENANCE' },
): Promise<{ id: string }> {
  return apiFetch('/api/v1/laboratory/supplies', { token, method: 'POST', body: JSON.stringify(body) })
}

async function updateSupply(
  token: string,
  id: string,
  body: { code?: string | null; name?: string; baseUnit?: string; isActive?: boolean },
): Promise<{ ok: true }> {
  return apiFetch(`/api/v1/laboratory/supplies/${encodeURIComponent(id)}`, { token, method: 'PATCH', body: JSON.stringify(body) })
}

export function LabMaintenanceSuppliesPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const queryClient = useQueryClient()

  const canWrite = perms.hasPermission('stock:manage')

  const [cursor, setCursor] = useState<string | undefined>()
  const take = 50

  const suppliesQuery = useQuery({
    queryKey: ['laboratory', 'supplies', CATEGORY, { take, cursor }],
    queryFn: () => listSupplies(auth.accessToken!, take, cursor),
    enabled: !!auth.accessToken,
  })

  const [showCreate, setShowCreate] = useState(false)
  const [createCode, setCreateCode] = useState('')
  const [createName, setCreateName] = useState('')
  const [createBaseUnit, setCreateBaseUnit] = useState('UN')

  const createMutation = useMutation({
    mutationFn: () =>
      createSupply(auth.accessToken!, {
        code: createCode.trim() || undefined,
        name: createName.trim(),
        category: CATEGORY,
        baseUnit: createBaseUnit.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'supplies'] })
      setShowCreate(false)
      setCreateCode('')
      setCreateName('')
      setCreateBaseUnit('UN')
    },
  })

  const [editing, setEditing] = useState<SupplyItem | null>(null)
  const [editCode, setEditCode] = useState('')
  const [editName, setEditName] = useState('')
  const [editBaseUnit, setEditBaseUnit] = useState('')
  const [editIsActive, setEditIsActive] = useState(true)

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Seleccioná un item')
      return updateSupply(auth.accessToken!, editing.id, {
        code: editCode.trim() ? editCode.trim() : null,
        name: editName.trim(),
        baseUnit: editBaseUnit.trim(),
        isActive: editIsActive,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'supplies'] })
      setEditing(null)
    },
  })

  const openEdit = (s: SupplyItem) => {
    setEditing(s)
    setEditCode(s.code ?? '')
    setEditName(s.name)
    setEditBaseUnit(s.baseUnit)
    setEditIsActive(s.isActive)
  }

  const columns = useMemo(
    () => [
      { header: 'Código', accessor: (s: SupplyItem) => s.code ?? '—' },
      { header: 'Nombre', accessor: (s: SupplyItem) => s.name, className: 'wrap' },
      { header: 'Unidad base', accessor: (s: SupplyItem) => s.baseUnit },
      { header: 'Activo', accessor: (s: SupplyItem) => (s.isActive ? 'Sí' : 'No') },
      {
        header: 'Acciones',
        accessor: (s: SupplyItem) => (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => openEdit(s)} disabled={!canWrite}>
              Editar
            </Button>
          </div>
        ),
      },
    ],
    [canWrite],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="🧪 Laboratorio — Repuestos y materiales">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm text-slate-600 dark:text-slate-300">Catálogo de repuestos y materiales de mantenimiento.</div>
          <Button onClick={() => setShowCreate(true)} disabled={!canWrite}>
            Nuevo repuesto/material
          </Button>
        </div>

        {suppliesQuery.isLoading ? (
          <Loading />
        ) : suppliesQuery.error ? (
          <ErrorState message={(suppliesQuery.error as any)?.message ?? 'Error al cargar repuestos/materiales'} />
        ) : (
          <>
            <Table columns={columns as any} data={suppliesQuery.data?.items ?? []} keyExtractor={(s: SupplyItem) => s.id} />
            <div className="mt-3">
              <PaginationCursor
                hasMore={!!suppliesQuery.data?.nextCursor}
                onLoadMore={() => setCursor(suppliesQuery.data!.nextCursor!)}
                loading={suppliesQuery.isFetching}
              />
            </div>
          </>
        )}

        <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nuevo repuesto/material" maxWidth="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Input label="Código (opcional)" value={createCode} onChange={(e) => setCreateCode(e.target.value)} />
              <Input label="Nombre" value={createName} onChange={(e) => setCreateName(e.target.value)} />
              <Input label="Unidad base" value={createBaseUnit} onChange={(e) => setCreateBaseUnit(e.target.value)} />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!canWrite || createMutation.isPending || !createName.trim() || !createBaseUnit.trim()}
              >
                {createMutation.isPending ? 'Creando…' : 'Crear'}
              </Button>
            </div>

            {createMutation.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {(createMutation.error as any)?.message ?? 'Error al crear'}
              </div>
            ) : null}
          </div>
        </Modal>

        <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing ? `Editar: ${editing.name}` : 'Editar'} maxWidth="lg">
          {!editing ? null : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input label="Código" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                <Select
                  label="Activo"
                  value={editIsActive ? 'YES' : 'NO'}
                  onChange={(e) => setEditIsActive(e.target.value === 'YES')}
                  options={[
                    { value: 'YES', label: 'Sí' },
                    { value: 'NO', label: 'No' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input label="Nombre" value={editName} onChange={(e) => setEditName(e.target.value)} />
                <Input label="Unidad base" value={editBaseUnit} onChange={(e) => setEditBaseUnit(e.target.value)} />
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => updateMutation.mutate()}
                  disabled={!canWrite || updateMutation.isPending || !editName.trim() || !editBaseUnit.trim()}
                >
                  {updateMutation.isPending ? 'Guardando…' : 'Guardar'}
                </Button>
              </div>

              {updateMutation.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                  {(updateMutation.error as any)?.message ?? 'Error al guardar'}
                </div>
              ) : null}
            </div>
          )}
        </Modal>
      </PageContainer>
    </MainLayout>
  )
}
