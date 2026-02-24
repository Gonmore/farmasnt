import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MainLayout, PageContainer, Table, Button, IconButton, Loading, ErrorState, EmptyState, Badge, Input, Modal } from '../../components';
import { useNavigation } from '../../hooks';
import { api } from '../../lib/api';
import { formatDateOnlyUtc } from '../../lib/date';
import { ICON_EDIT } from '../../lib/actionIcons';

interface TenantDomain {
  domain: string;
  isPrimary: boolean;
  verifiedAt: string | null;
}

interface Tenant {
  id: string;
  name: string;
  isActive: boolean;
  branchLimit: number;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  subscriptionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  domains: TenantDomain[];
}

interface TenantsResponse {
  items: Tenant[];
  nextCursor: string | null;
}

interface PlatformUser {
  id: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  createdAt: string;
  tenant: { id: string; name: string };
  roles: Array<{ id: string; code: string; name: string }>;
}

interface PlatformUsersResponse {
  items: PlatformUser[];
  nextCursor: string | null;
}

interface CustomersImportPreviewRow {
  name: string;
  nit: string | null;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  zone: string | null;
  address: string | null;
}

interface CustomersImportPreviewResponse {
  schema: {
    entity: 'customers';
    required: string[];
    optional: string[];
    notes: string[];
  };
  tenant: { id: string; name: string };
  totalRows: number;
  parsedRows: number;
  candidateRows: number;
  toCreate: number;
  skippedExisting: number;
  errors: Array<{ row: number; message: string }>;
  preview: CustomersImportPreviewRow[];
}

interface CreateTenantData {
  name: string;
  branchCount: number;
  adminEmail: string;
  adminPassword: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  subscriptionMonths: number;
  primaryDomain?: string;
}

function getSubscriptionStatus(expiresAt: string | null): { status: 'active' | 'expiring' | 'expired'; label: string; variant: 'success' | 'warning' | 'danger' } {
  if (!expiresAt) return { status: 'active', label: 'Sin expiración', variant: 'success' };
  
  const now = new Date();
  const expires = new Date(expiresAt);
  const daysRemaining = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysRemaining < 0) return { status: 'expired', label: 'Expirado', variant: 'danger' };
  if (daysRemaining <= 30) return { status: 'expiring', label: `${daysRemaining}d restantes`, variant: 'danger' };
  if (daysRemaining <= 90) return { status: 'expiring', label: `${daysRemaining}d restantes`, variant: 'warning' };
  return { status: 'active', label: `${daysRemaining}d restantes`, variant: 'success' };
}

function CreateTenantModal({ isOpen, onClose, onSuccess }: { isOpen: boolean; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState<CreateTenantData>({
    name: '',
    branchCount: 1,
    adminEmail: '',
    adminPassword: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    subscriptionMonths: 12,
    primaryDomain: '',
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateTenantData) => {
      const response = await api.post('/api/v1/platform/tenants', data);
      return response.data;
    },
    onSuccess: () => {
      onSuccess();
      onClose();
      setFormData({
        name: '',
        branchCount: 1,
        adminEmail: '',
        adminPassword: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        subscriptionMonths: 12,
        primaryDomain: '',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CreateTenantData = { ...formData };
    if (typeof payload.primaryDomain === 'string' && payload.primaryDomain.trim() === '') {
      delete (payload as any).primaryDomain;
    }
    createMutation.mutate(payload);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Crear Nuevo Tenant" maxWidth="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Información Básica */}
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Nombre del Tenant *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>

          {/* Contacto */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Nombre de Contacto *
            </label>
            <input
              type="text"
              required
              value={formData.contactName}
              onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email de Contacto *
            </label>
            <input
              type="email"
              required
              value={formData.contactEmail}
              onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Teléfono (WhatsApp) *
            </label>
            <input
              type="tel"
              required
              placeholder="+591 70000000"
              value={formData.contactPhone}
              onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>

          {/* Admin del Tenant */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email Admin Tenant *
            </label>
            <input
              type="email"
              required
              value={formData.adminEmail}
              onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Contraseña Admin *
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={formData.adminPassword}
              onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>

          {/* Suscripción */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Cantidad de Sucursales *
            </label>
            <input
              type="number"
              required
              min={1}
              max={50}
              value={formData.branchCount}
              onChange={(e) => setFormData({ ...formData, branchCount: parseInt(e.target.value) })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Duración (meses) *
            </label>
            <select
              value={formData.subscriptionMonths}
              onChange={(e) => setFormData({ ...formData, subscriptionMonths: parseInt(e.target.value) })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            >
              <option value={3}>3 meses</option>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
              <option value={24}>24 meses</option>
              <option value={36}>36 meses</option>
            </select>
          </div>

          {/* Dominio */}
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Dominio Principal (opcional)
            </label>
            <input
              type="text"
              placeholder="ejemplo.com"
              value={formData.primaryDomain}
              onChange={(e) => setFormData({ ...formData, primaryDomain: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
            />
          </div>
        </div>

        {createMutation.error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            Error: {(createMutation.error as any)?.response?.data?.message || 'Error al crear tenant'}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={createMutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creando...' : 'Crear Tenant'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TenantsPage() {
  const navGroups = useNavigation();
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [branchLimit, setBranchLimit] = useState(1);
  const [extensionMonths, setExtensionMonths] = useState(12);

  const [usersTenant, setUsersTenant] = useState<Tenant | null>(null);
  const [createAdminEmail, setCreateAdminEmail] = useState('');
  const [createAdminPassword, setCreateAdminPassword] = useState('');
  const [createAdminFullName, setCreateAdminFullName] = useState('');
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [importTenant, setImportTenant] = useState<Tenant | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importEncoding, setImportEncoding] = useState<'utf-8' | 'iso-8859-1'>('iso-8859-1');
  const [importCsvText, setImportCsvText] = useState('');
  const [importPreview, setImportPreview] = useState<CustomersImportPreviewResponse | null>(null);

  const { data, isLoading, error } = useQuery<TenantsResponse>({
    queryKey: ['platform', 'tenants'],
    queryFn: async () => {
      const response = await api.get<TenantsResponse>('/api/v1/platform/tenants?take=50');
      return response.data;
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ tenantId, isActive }: { tenantId: string; isActive: boolean }) => {
      // TODO: Implementar endpoint PATCH /api/v1/platform/tenants/:id
      await api.patch(`/api/v1/platform/tenants/${tenantId}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    },
  });

  const updateBranchesMutation = useMutation({
    mutationFn: async ({ tenantId, branchLimit }: { tenantId: string; branchLimit: number }) => {
      await api.patch(`/api/v1/platform/tenants/${tenantId}`, { branchLimit });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
      setEditingTenant(null);
    },
  });

  const extendSubscriptionMutation = useMutation({
    mutationFn: async ({ tenantId, months }: { tenantId: string; months: number }) => {
      await api.patch(`/api/v1/platform/tenants/${tenantId}/subscription`, { extensionMonths: months });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
      setEditingTenant(null);
    },
  });

  const handleCreateSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
  };

  const handleEditBranches = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setBranchLimit(tenant.branchLimit);
  };

  const handleSaveBranches = async () => {
    if (!editingTenant) return;
    await updateBranchesMutation.mutateAsync({ 
      tenantId: editingTenant.id, 
      branchLimit 
    });
  };

  const usersQuery = useQuery<PlatformUsersResponse>({
    queryKey: ['platform', 'users', usersTenant?.id],
    queryFn: async () => {
      const response = await api.get<PlatformUsersResponse>(`/api/v1/platform/users?take=50&tenantId=${encodeURIComponent(usersTenant!.id)}`);
      return response.data;
    },
    enabled: !!usersTenant?.id,
  });

  const createTenantAdminMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/api/v1/platform/tenant-admins', {
        tenantId: usersTenant!.id,
        email: createAdminEmail,
        password: createAdminPassword,
        fullName: createAdminFullName.trim() ? createAdminFullName.trim() : undefined,
      });
      return response.data as { id: string; email: string };
    },
    onSuccess: async () => {
      setCreateAdminEmail('');
      setCreateAdminPassword('');
      setCreateAdminFullName('');
      await queryClient.invalidateQueries({ queryKey: ['platform', 'users', usersTenant?.id] });
    },
  });

  const updateUserStatusMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const response = await api.patch(`/api/v1/platform/users/${userId}/status`, { isActive });
      return response.data as { id: string; isActive: boolean };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'users', usersTenant?.id] });
    },
  });

  const resetUserPasswordMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await api.post(`/api/v1/platform/users/${userId}/reset-password`, {});
      return response.data as { userId: string; temporaryPassword: string };
    },
    onSuccess: (data) => {
      setTempPassword(data.temporaryPassword);
    },
  });

  const previewCustomersImportMutation = useMutation({
    mutationFn: async ({ tenantId, csv }: { tenantId: string; csv: string }) => {
      const response = await api.post<CustomersImportPreviewResponse>(
        `/api/v1/platform/tenants/${tenantId}/import/customers`,
        { csv, dryRun: true },
      );
      return response.data;
    },
    onSuccess: (data) => {
      setImportPreview(data);
    },
  });

  const executeCustomersImportMutation = useMutation({
    mutationFn: async ({ tenantId, csv }: { tenantId: string; csv: string }) => {
      const response = await api.post(
        `/api/v1/platform/tenants/${tenantId}/import/customers`,
        { csv, dryRun: false },
      );
      return response.data as { createdCount: number; skippedExisting: number; totalRows: number };
    },
    onSuccess: async (data) => {
      alert(`Importación completada. Creados: ${data.createdCount}. Omitidos existentes: ${data.skippedExisting}.`);
      setImportTenant(null);
      setImportPreview(null);
      setImportCsvText('');
      setImportFileName('');
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    },
  });

  const tenantAdmins = usersQuery.data?.items.filter((u) => u.roles.some((r) => r.code === 'TENANT_ADMIN')) ?? [];

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer 
        title="Gestión de Tenants"
        actions={
          <Button onClick={() => setIsCreateModalOpen(true)}>
            + Nuevo Tenant
          </Button>
        }
      >
        {isLoading && <Loading />}
        {error && <ErrorState message="Error al cargar tenants" />}
        {data && data.items.length === 0 && <EmptyState message="No hay tenants registrados" />}
        
        {data && data.items.length > 0 && (
          <Table
            data={data.items}
            keyExtractor={(tenant) => tenant.id}
            columns={[
              { 
                header: 'Tenant',
                accessor: (tenant: Tenant) => (
                  <div>
                    <div className="font-medium">{tenant.name}</div>
                    {tenant.domains.length > 0 && (
                      <div className="text-xs text-slate-500">{tenant.domains[0].domain}</div>
                    )}
                  </div>
                ),
              },
              { 
                header: 'Contacto',
                accessor: (tenant: Tenant) => tenant.contactName ? (
                  <div>
                    <div className="text-sm">{tenant.contactName}</div>
                    <div className="text-xs text-slate-500">{tenant.contactEmail}</div>
                    <div className="text-xs text-slate-500">{tenant.contactPhone}</div>
                  </div>
                ) : (
                  <span className="text-slate-400">—</span>
                ),
              },
              { 
                header: 'Sucursales',
                accessor: (tenant: Tenant) => (
                  <span className="font-mono text-sm">{tenant.branchLimit}</span>
                ),
              },
              { 
                header: 'Suscripción',
                accessor: (tenant: Tenant) => {
                  const { label, variant } = getSubscriptionStatus(tenant.subscriptionExpiresAt);
                  return (
                    <div>
                      <Badge variant={variant}>{label}</Badge>
                      {tenant.subscriptionExpiresAt && (
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateOnlyUtc(tenant.subscriptionExpiresAt, 'es-BO')}
                        </div>
                      )}
                    </div>
                  );
                },
              },
              { 
                header: 'Estado',
                accessor: (tenant: Tenant) => (
                  <Badge variant={tenant.isActive ? 'success' : 'danger'}>
                    {tenant.isActive ? 'Activo' : 'Inactivo'}
                  </Badge>
                ),
              },
              {
                header: 'Acciones',
                className: 'text-center w-auto',
                accessor: (tenant: Tenant) => (
                  <div className="flex items-center justify-center gap-1">
                    <IconButton label="Editar" icon={ICON_EDIT} onClick={() => handleEditBranches(tenant)} />
                    <IconButton
                      label="Usuarios"
                      icon={'👥'}
                      onClick={() => {
                        setUsersTenant(tenant);
                        setTempPassword(null);
                      }}
                    />
                    <IconButton
                      label="Importar"
                      icon={'📥'}
                      onClick={() => {
                        setImportTenant(tenant);
                        setImportPreview(null);
                        setImportCsvText('');
                        setImportFileName('');
                      }}
                    />
                    <IconButton
                      label={tenant.isActive ? 'Desactivar' : 'Activar'}
                      icon={'⏻'}
                      onClick={() =>
                        toggleActiveMutation.mutate({
                          tenantId: tenant.id,
                          isActive: !tenant.isActive,
                        })
                      }
                      disabled={toggleActiveMutation.isPending}
                      className={tenant.isActive ? 'text-red-600 dark:text-red-300' : ''}
                    />
                  </div>
                ),
              },
            ]}
          />
        )}
      </PageContainer>

      <CreateTenantModal 
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />

      {/* Modal Editar Sucursales y Suscripción */}
      {editingTenant && (
        <Modal
          isOpen={!!editingTenant}
          onClose={() => setEditingTenant(null)}
          title={`Editar: ${editingTenant.name}`}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Sucursales</label>
              <Input
                type="number"
                min="1"
                max="100"
                value={branchLimit}
                onChange={(e) => setBranchLimit(parseInt(e.target.value) || 1)}
              />
              <Button
                className="mt-2"
                size="sm"
                onClick={handleSaveBranches}
                disabled={updateBranchesMutation.isPending}
              >
                {updateBranchesMutation.isPending ? 'Guardando...' : 'Guardar Sucursales'}
              </Button>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              <label className="block text-sm font-medium mb-2">Extender Suscripción</label>
              <select
                value={extensionMonths}
                onChange={(e) => setExtensionMonths(parseInt(e.target.value))}
                className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="3">3 meses</option>
                <option value="6">6 meses</option>
                <option value="12">1 año</option>
                <option value="24">2 años</option>
                <option value="36">3 años</option>
              </select>
              <Button
                className="mt-2"
                size="sm"
                onClick={() => extendSubscriptionMutation.mutate({ 
                  tenantId: editingTenant.id, 
                  months: extensionMonths 
                })}
                disabled={extendSubscriptionMutation.isPending}
              >
                {extendSubscriptionMutation.isPending ? 'Extendiendo...' : 'Extender Suscripción'}
              </Button>
            </div>

            <div className="text-xs text-slate-500">
              <p>Expira actualmente: {editingTenant.subscriptionExpiresAt ? formatDateOnlyUtc(editingTenant.subscriptionExpiresAt, 'es-BO') : 'Sin expiración'}</p>
            </div>
          </div>
        </Modal>
      )}


      {/* Modal Usuarios (Tenant Admins) */}
      {usersTenant && (
        <Modal
          isOpen={!!usersTenant}
          onClose={() => {
            setUsersTenant(null);
            setTempPassword(null);
          }}
          title={`Usuarios: ${usersTenant.name}`}
          maxWidth="xl"
        >
          <div className="space-y-4">
            <div className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Crear Tenant Admin</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Input label="Email" type="email" value={createAdminEmail} onChange={(e) => setCreateAdminEmail(e.target.value)} />
                <Input
                  label="Contraseña"
                  type="password"
                  minLength={6}
                  value={createAdminPassword}
                  onChange={(e) => setCreateAdminPassword(e.target.value)}
                />
                <Input label="Nombre (opcional)" type="text" value={createAdminFullName} onChange={(e) => setCreateAdminFullName(e.target.value)} />
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => createTenantAdminMutation.mutate()}
                  disabled={createTenantAdminMutation.isPending || !createAdminEmail.trim() || !createAdminPassword}
                >
                  {createTenantAdminMutation.isPending ? 'Creando...' : 'Crear'}
                </Button>
              </div>

              {createTenantAdminMutation.error && (
                <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  Error: {(createTenantAdminMutation.error as any)?.response?.data?.message || 'No se pudo crear'}
                </div>
              )}
            </div>

            {usersQuery.isLoading && <Loading />}
            {usersQuery.error && <ErrorState message="Error al cargar usuarios" retry={() => usersQuery.refetch()} />}
            {usersQuery.data && tenantAdmins.length === 0 && <EmptyState message="No hay Tenant Admins" />}

            {usersQuery.data && tenantAdmins.length > 0 && (
              <Table
                data={tenantAdmins}
                keyExtractor={(u) => u.id}
                columns={[
                  { header: 'Email', accessor: (u: PlatformUser) => u.email },
                  { header: 'Nombre', accessor: (u: PlatformUser) => u.fullName || '—' },
                  { header: 'Roles', accessor: (u: PlatformUser) => (u.roles?.map((r) => r.code).join(', ') || '—') },
                  {
                    header: 'Estado',
                    accessor: (u: PlatformUser) => (
                      <Badge variant={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Activo' : 'Inactivo'}</Badge>
                    ),
                  },
                  {
                    header: 'Acciones',
                    accessor: (u: PlatformUser) => (
                      <div className="flex flex-wrap gap-2">
                        <IconButton
                          label={u.isActive ? 'Desactivar' : 'Activar'}
                          icon={'⏻'}
                          onClick={() => updateUserStatusMutation.mutate({ userId: u.id, isActive: !u.isActive })}
                          disabled={updateUserStatusMutation.isPending}
                          className={u.isActive ? 'text-red-600 dark:text-red-300' : ''}
                        />
                        <IconButton
                          label="Reset clave"
                          icon={'🔑'}
                          onClick={() => {
                            setTempPassword(null);
                            resetUserPasswordMutation.mutate(u.id);
                          }}
                          disabled={resetUserPasswordMutation.isPending}
                        />
                      </div>
                    ),
                  },
                ]}
              />
            )}

            {tempPassword && (
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                Contraseña temporal: <span className="font-mono">{tempPassword}</span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Modal Importación masiva */}
      {importTenant && (
        <Modal
          isOpen={!!importTenant}
          onClose={() => {
            setImportTenant(null);
            setImportPreview(null);
            setImportCsvText('');
            setImportFileName('');
          }}
          title={`Importación: ${importTenant.name}`}
          maxWidth="xl"
        >
          <div className="space-y-4">
            <div className="rounded border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="font-semibold text-slate-900 dark:text-slate-100">Clientes (CSV)</div>
              <div className="mt-1 text-slate-700 dark:text-slate-300">
                Requerido: <span className="font-mono">name</span>. Mapeo: “Nombre” → name, “Nombre de contacto” → contactName (antes de “-”).
              </div>
            </div>

            <div className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Archivo CSV</label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="block w-full text-sm text-slate-700 dark:text-slate-300"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      setImportPreview(null);
                      if (!file) {
                        setImportCsvText('');
                        setImportFileName('');
                        return;
                      }
                      setImportFileName(file.name);
                      const reader = new FileReader();
                      reader.onload = () => {
                        setImportCsvText(String(reader.result ?? ''));
                      };
                      reader.readAsText(file, importEncoding);
                    }}
                  />
                  {importFileName && <div className="mt-1 text-xs text-slate-500">{importFileName}</div>}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Codificación</label>
                  <select
                    value={importEncoding}
                    onChange={(e) => {
                      setImportEncoding(e.target.value as any);
                      setImportPreview(null);
                    }}
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="iso-8859-1">ISO-8859-1 (recomendado)</option>
                    <option value="utf-8">UTF-8</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setImportPreview(null);
                    setImportCsvText('');
                    setImportFileName('');
                  }}
                  disabled={previewCustomersImportMutation.isPending || executeCustomersImportMutation.isPending}
                >
                  Limpiar
                </Button>
                <Button
                  size="sm"
                  onClick={() => previewCustomersImportMutation.mutate({ tenantId: importTenant.id, csv: importCsvText })}
                  disabled={previewCustomersImportMutation.isPending || !importCsvText.trim()}
                >
                  {previewCustomersImportMutation.isPending ? 'Previsualizando...' : 'Previsualizar'}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!confirm('¿Importar clientes para este tenant? No se elimina nada: solo se crean clientes nuevos; los existentes (por NIT o nombre) se omiten.')) return;
                    executeCustomersImportMutation.mutate({ tenantId: importTenant.id, csv: importCsvText });
                  }}
                  disabled={executeCustomersImportMutation.isPending || !importCsvText.trim() || !importPreview}
                >
                  {executeCustomersImportMutation.isPending ? 'Importando...' : 'Importar'}
                </Button>
              </div>

              {previewCustomersImportMutation.error && (
                <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  Error: {(previewCustomersImportMutation.error as any)?.response?.data?.message || 'No se pudo previsualizar'}
                </div>
              )}

              {executeCustomersImportMutation.error && (
                <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  Error: {(executeCustomersImportMutation.error as any)?.response?.data?.message || 'No se pudo importar'}
                </div>
              )}
            </div>

            {importPreview && (
              <div className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <div>
                    <div className="text-slate-500">Filas CSV</div>
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{importPreview.totalRows}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">A crear</div>
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{importPreview.toCreate}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Omitidos</div>
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{importPreview.skippedExisting}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Errores</div>
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{importPreview.errors.length}</div>
                  </div>
                </div>

                {importPreview.errors.length > 0 && (
                  <div className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                    <div className="font-semibold">Ejemplos de errores</div>
                    <ul className="mt-1 list-disc pl-5">
                      {importPreview.errors.slice(0, 8).map((e, idx) => (
                        <li key={idx}>Fila {e.row}: {e.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4">
                  <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Preview (primeras 10)</div>
                  <div className="overflow-auto rounded border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Nombre</th>
                          <th className="px-3 py-2">NIT</th>
                          <th className="px-3 py-2">Contacto</th>
                          <th className="px-3 py-2">Teléfono</th>
                          <th className="px-3 py-2">Ciudad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.preview.map((r, idx) => (
                          <tr key={idx} className="border-t border-slate-100 dark:border-slate-700">
                            <td className="px-3 py-2">{r.name}</td>
                            <td className="px-3 py-2">{r.nit || '—'}</td>
                            <td className="px-3 py-2">{r.contactName || '—'}</td>
                            <td className="px-3 py-2">{r.phone || '—'}</td>
                            <td className="px-3 py-2">{r.city || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </MainLayout>
  );
}

