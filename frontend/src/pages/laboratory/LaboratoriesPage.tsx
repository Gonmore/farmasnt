import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { usePermissions } from '../../hooks'
import { MainLayout, PageContainer, Table, Loading, ErrorState, Button, Modal, Input, Select } from '../../components'
import { useNavigation } from '../../hooks'
import { CogIcon } from '@heroicons/react/24/outline'

type WarehouseListItem = { id: string; code: string; name: string; city: string | null; isActive: boolean }

type LocationListItem = { id: string; warehouseId: string; code: string; isActive: boolean }

type LaboratoryItem = {
  id: string
  name: string
  city: string | null
  isActive: boolean
  warehouseId: string
  defaultLocationId: string | null
  rawMaterialsLocationId: string | null
  wipLocationId: string | null
  maintenanceLocationId: string | null
  outputWarehouseId: string | null
  quarantineLocationId: string | null
  updatedAt: string
  warehouse: { id: string; code: string; name: string; city: string | null }
  defaultLocation: { id: string; code: string; warehouseId: string } | null
  rawMaterialsLocation: { id: string; code: string; warehouseId: string } | null
  wipLocation: { id: string; code: string; warehouseId: string } | null
  maintenanceLocation: { id: string; code: string; warehouseId: string } | null
  outputWarehouse: { id: string; code: string; name: string; city: string | null } | null
  quarantineLocation: { id: string; code: string; warehouseId: string } | null
}

type LaboratoriesResponse = { items: LaboratoryItem[] }

async function listLaboratories(token: string): Promise<LaboratoriesResponse> {
  return apiFetch('/api/v1/laboratories', { token })
}

async function listWarehouses(token: string): Promise<{ items: WarehouseListItem[] }> {
  return apiFetch('/api/v1/warehouses?take=100', { token })
}

async function listWarehouseLocations(token: string, warehouseId: string): Promise<{ items: LocationListItem[] }> {
  return apiFetch(`/api/v1/warehouses/${encodeURIComponent(warehouseId)}/locations?take=100`, { token })
}

async function createLaboratory(
  token: string,
  body: {
    warehouseId: string
    name: string
    city: string | null
    isActive?: boolean
    rawMaterialsLocationId?: string | null
    wipLocationId?: string | null
    maintenanceLocationId?: string | null
    quarantineLocationId?: string | null
    outputWarehouseId?: string | null
  },
): Promise<{ id: string }> {
  return apiFetch('/api/v1/laboratories', {
    token,
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function LaboratoriesPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const perms = usePermissions()
  const queryClient = useQueryClient()

  const canWrite = perms.hasPermission('stock:manage')

  const labsQuery = useQuery({
    queryKey: ['laboratory', 'labs'],
    queryFn: () => listLaboratories(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'forLaboratoryConfig'],
    queryFn: () => listWarehouses(auth.accessToken!),
    enabled: !!auth.accessToken && canWrite,
  })

  const [editing, setEditing] = useState<LaboratoryItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editCity, setEditCity] = useState('')
  const [editIsActive, setEditIsActive] = useState(true)
  const [editRawMaterialsLocationId, setEditRawMaterialsLocationId] = useState('')
  const [editWipLocationId, setEditWipLocationId] = useState('')
  const [editMaintenanceLocationId, setEditMaintenanceLocationId] = useState('')
  const [editQuarantineLocationId, setEditQuarantineLocationId] = useState('')
  const [editOutputWarehouseId, setEditOutputWarehouseId] = useState('')

  const [creating, setCreating] = useState(false)
  const [createWarehouseId, setCreateWarehouseId] = useState('')
  const [createName, setCreateName] = useState('')
  const [createCity, setCreateCity] = useState('')
  const [createIsActive, setCreateIsActive] = useState(true)
  const [createRawMaterialsLocationId, setCreateRawMaterialsLocationId] = useState('')
  const [createWipLocationId, setCreateWipLocationId] = useState('')
  const [createMaintenanceLocationId, setCreateMaintenanceLocationId] = useState('')
  const [createQuarantineLocationId, setCreateQuarantineLocationId] = useState('')
  const [createOutputWarehouseId, setCreateOutputWarehouseId] = useState('')

  const createLocationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'forLaboratoryCreate', createWarehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, createWarehouseId),
    enabled: !!auth.accessToken && canWrite && !!createWarehouseId.trim(),
  })

  const locationsQuery = useQuery({
    queryKey: ['warehouseLocations', 'forLaboratoryEdit', editing?.warehouseId],
    queryFn: () => listWarehouseLocations(auth.accessToken!, editing!.warehouseId),
    enabled: !!auth.accessToken && canWrite && !!editing?.warehouseId,
  })

  const activeWarehouses = useMemo(
    () => (warehousesQuery.data?.items ?? []).filter((w) => w.isActive),
    [warehousesQuery.data],
  )

  const warehouseCities = useMemo(() => {
    const cities = activeWarehouses
      .map((w) => w.city)
      .filter((city): city is string => city !== null && city.trim() !== '')
    return [...new Set(cities)].sort()
  }, [activeWarehouses])

  const locations = useMemo(
    () => (locationsQuery.data?.items ?? []).filter((l) => l.isActive),
    [locationsQuery.data],
  )

  const createLocations = useMemo(
    () => (createLocationsQuery.data?.items ?? []).filter((l) => l.isActive),
    [createLocationsQuery.data],
  )

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('Seleccioná un laboratorio')
      return apiFetch(`/api/v1/laboratories/${encodeURIComponent(editing.id)}`, {
        token: auth.accessToken!,
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim() || undefined,
          city: editCity.trim() ? editCity.trim() : null,
          isActive: editIsActive,
          defaultLocationId: editRawMaterialsLocationId.trim() ? editRawMaterialsLocationId.trim() : null,
          rawMaterialsLocationId: editRawMaterialsLocationId.trim() ? editRawMaterialsLocationId.trim() : null,
          wipLocationId: editWipLocationId.trim() ? editWipLocationId.trim() : null,
          maintenanceLocationId: editMaintenanceLocationId.trim() ? editMaintenanceLocationId.trim() : null,
          quarantineLocationId: editQuarantineLocationId.trim() ? editQuarantineLocationId.trim() : null,
          outputWarehouseId: editOutputWarehouseId.trim() ? editOutputWarehouseId.trim() : null,
        }),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'labs'] })
      setEditing(null)
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!createWarehouseId.trim()) throw new Error('Seleccioná un almacén')
      if (!createName.trim()) throw new Error('Ingresá un nombre')
      return createLaboratory(auth.accessToken!, {
        warehouseId: createWarehouseId.trim(),
        name: createName.trim(),
        city: createCity.trim() ? createCity.trim() : null,
        isActive: createIsActive,
        rawMaterialsLocationId: createRawMaterialsLocationId.trim() ? createRawMaterialsLocationId.trim() : null,
        wipLocationId: createWipLocationId.trim() ? createWipLocationId.trim() : null,
        maintenanceLocationId: createMaintenanceLocationId.trim() ? createMaintenanceLocationId.trim() : null,
        quarantineLocationId: createQuarantineLocationId.trim() ? createQuarantineLocationId.trim() : null,
        outputWarehouseId: createOutputWarehouseId.trim() ? createOutputWarehouseId.trim() : null,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['laboratory', 'labs'] })
      setCreating(false)
      setCreateWarehouseId('')
      setCreateName('')
      setCreateCity('')
      setCreateIsActive(true)
      setCreateRawMaterialsLocationId('')
      setCreateWipLocationId('')
      setCreateMaintenanceLocationId('')
      setCreateQuarantineLocationId('')
      setCreateOutputWarehouseId('')
    },
  })

  const openEdit = (lab: LaboratoryItem) => {
    setEditing(lab)
    setEditName(lab.name)
    setEditCity((lab.city ?? lab.warehouse.city ?? '') || '')
    setEditIsActive(lab.isActive)
    setEditRawMaterialsLocationId(lab.rawMaterialsLocationId ?? lab.defaultLocationId ?? '')
    setEditWipLocationId(lab.wipLocationId ?? '')
    setEditMaintenanceLocationId(lab.maintenanceLocationId ?? '')
    setEditQuarantineLocationId(lab.quarantineLocationId ?? '')
    setEditOutputWarehouseId(lab.outputWarehouseId ?? '')
  }

  const columns = useMemo(
    () => [
      { header: 'Nombre', accessor: (l: LaboratoryItem) => l.name, className: 'wrap' },
      { header: 'Ciudad', accessor: (l: LaboratoryItem) => l.city ?? l.warehouse.city ?? '—' },
      { header: 'Almacén', accessor: (l: LaboratoryItem) => `${l.warehouse.code} — ${l.warehouse.name}`, className: 'wrap' },
      { header: 'Materia prima', accessor: (l: LaboratoryItem) => l.rawMaterialsLocation?.code ?? l.defaultLocation?.code ?? '—' },
      { header: 'En proceso', accessor: (l: LaboratoryItem) => l.wipLocation?.code ?? '—' },
      { header: 'Repuestos', accessor: (l: LaboratoryItem) => l.maintenanceLocation?.code ?? '—' },
      { header: 'Ubic. cuarentena', accessor: (l: LaboratoryItem) => l.quarantineLocation?.code ?? '—' },
      { header: 'WH salida', accessor: (l: LaboratoryItem) => l.outputWarehouse?.code ?? '—' },
      { header: 'Activo', accessor: (l: LaboratoryItem) => (l.isActive ? 'Sí' : 'No') },
      {
        header: 'Acciones',
        accessor: (l: LaboratoryItem) => (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" icon={<CogIcon className="w-4 h-4" />} onClick={() => openEdit(l)} disabled={!canWrite}>
              Configurar
            </Button>
          </div>
        ),
      },
    ],
    [canWrite],
  )

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="🧪 Laboratorio — Configuración"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)} disabled={!canWrite}>
            ➕ Nuevo laboratorio
          </Button>
        }
      >
        {!perms.isLoading && !canWrite && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
            Tenés acceso de lectura. Para editar configuraciones necesitás permiso `stock:manage`.
          </div>
        )}

        {labsQuery.isLoading ? (
          <Loading />
        ) : labsQuery.error ? (
          <ErrorState message={(labsQuery.error as any)?.message ?? 'Error al cargar laboratorios'} />
        ) : (
          <Table columns={columns as any} data={labsQuery.data?.items ?? []} keyExtractor={(l: LaboratoryItem) => l.id} />
        )}

        <Modal
          isOpen={creating}
          onClose={() => setCreating(false)}
          title="Nuevo laboratorio"
          maxWidth="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                label="Almacén (warehouse)"
                value={createWarehouseId}
                onChange={(e) => setCreateWarehouseId(e.target.value)}
                options={[
                  { value: '', label: 'Seleccioná un almacén…' },
                  ...activeWarehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}${w.city ? ` (${w.city})` : ''}` })),
                ]}
              />
              <Input label="Nombre" value={createName} onChange={(e) => setCreateName(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Ciudad</label>
                <Select
                  value={createCity}
                  onChange={(e) => setCreateCity(e.target.value)}
                  options={[
                    { value: '', label: 'Seleccioná una ciudad…' },
                    ...warehouseCities.map((city) => ({ value: city, label: city })),
                  ]}
                />
              </div>

              <Select
                label="Activo"
                value={createIsActive ? 'YES' : 'NO'}
                onChange={(e) => setCreateIsActive(e.target.value === 'YES')}
                options={[
                  { value: 'YES', label: 'Sí' },
                  { value: 'NO', label: 'No' },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                label="Warehouse de salida (producto terminado)"
                value={createOutputWarehouseId}
                onChange={(e) => setCreateOutputWarehouseId(e.target.value)}
                options={[
                  { value: '', label: '— (sin configurar)' },
                  ...activeWarehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}${w.city ? ` (${w.city})` : ''}` })),
                ]}
              />

              <Select
                label={`Materia prima — ${activeWarehouses.find(w => w.id === createWarehouseId)?.code || '...'}`}
                value={createRawMaterialsLocationId}
                onChange={(e) => setCreateRawMaterialsLocationId(e.target.value)}
                options={[
                  { value: '', label: '— (sin configurar)' },
                  ...createLocations.map((loc) => ({ value: loc.id, label: loc.code })),
                ]}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                label={`Producto en proceso — ${activeWarehouses.find(w => w.id === createWarehouseId)?.code || '...'}`}
                value={createWipLocationId}
                onChange={(e) => setCreateWipLocationId(e.target.value)}
                options={[
                  { value: '', label: '— (sin configurar)' },
                  ...createLocations.map((loc) => ({ value: loc.id, label: loc.code })),
                ]}
              />

              <Select
                label={`Repuestos y materiales — ${activeWarehouses.find(w => w.id === createWarehouseId)?.code || '...'}`}
                value={createMaintenanceLocationId}
                onChange={(e) => setCreateMaintenanceLocationId(e.target.value)}
                options={[
                  { value: '', label: '— (sin configurar)' },
                  ...createLocations.map((loc) => ({ value: loc.id, label: loc.code })),
                ]}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                label={`Ubicación cuarentena (producto terminado) — ${activeWarehouses.find(w => w.id === createWarehouseId)?.code || '...'}`}
                value={createQuarantineLocationId}
                onChange={(e) => setCreateQuarantineLocationId(e.target.value)}
                options={[
                  { value: '', label: '— (sin configurar)' },
                  ...createLocations.map((loc) => ({ value: loc.id, label: loc.code })),
                ]}
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button onClick={() => createMutation.mutate()} disabled={!canWrite || createMutation.isPending || !createWarehouseId.trim() || !createName.trim()}>
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

        <Modal
          isOpen={!!editing}
          onClose={() => setEditing(null)}
          title={editing ? `Configurar: ${editing.name}` : 'Configurar'}
          maxWidth="lg"
        >
          {!editing ? null : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input label="Nombre" value={editName} onChange={(e) => setEditName(e.target.value)} />
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Ciudad</label>
                  <Select
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    options={[
                      { value: '', label: 'Seleccioná una ciudad…' },
                      ...warehouseCities.map((city) => ({ value: city, label: city })),
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Select
                  label="Activo"
                  value={editIsActive ? 'YES' : 'NO'}
                  onChange={(e) => setEditIsActive(e.target.value === 'YES')}
                  options={[
                    { value: 'YES', label: 'Sí' },
                    { value: 'NO', label: 'No' },
                  ]}
                />

                <Select
                  label="Warehouse de salida (producto terminado)"
                  value={editOutputWarehouseId}
                  onChange={(e) => setEditOutputWarehouseId(e.target.value)}
                  options={[
                    { value: '', label: '— (sin configurar)' },
                    ...activeWarehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}${w.city ? ` (${w.city})` : ''}` })),
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Select
                  label={`Materia prima — ${editing.warehouse.code}`}
                  value={editRawMaterialsLocationId}
                  onChange={(e) => setEditRawMaterialsLocationId(e.target.value)}
                  options={[
                    { value: '', label: '— (sin configurar)' },
                    ...locations.map((loc) => ({ value: loc.id, label: loc.code })),
                  ]}
                />

                <Select
                  label={`Ubicación cuarentena (producto terminado) — ${editing.warehouse.code}`}
                  value={editQuarantineLocationId}
                  onChange={(e) => setEditQuarantineLocationId(e.target.value)}
                  options={[
                    { value: '', label: '— (sin configurar)' },
                    ...locations.map((loc) => ({ value: loc.id, label: loc.code })),
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Select
                  label={`Producto en proceso — ${editing.warehouse.code}`}
                  value={editWipLocationId}
                  onChange={(e) => setEditWipLocationId(e.target.value)}
                  options={[
                    { value: '', label: '— (sin configurar)' },
                    ...locations.map((loc) => ({ value: loc.id, label: loc.code })),
                  ]}
                />

                <Select
                  label={`Repuestos y materiales — ${editing.warehouse.code}`}
                  value={editMaintenanceLocationId}
                  onChange={(e) => setEditMaintenanceLocationId(e.target.value)}
                  options={[
                    { value: '', label: '— (sin configurar)' },
                    ...locations.map((loc) => ({ value: loc.id, label: loc.code })),
                  ]}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => updateMutation.mutate()}
                  disabled={!canWrite || updateMutation.isPending || !editName.trim()}
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
