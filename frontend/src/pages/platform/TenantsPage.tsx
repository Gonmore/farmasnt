import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MainLayout, PageContainer, Table, Button, Loading, ErrorState, EmptyState, Badge, Input, Modal } from '../../components';
import { useNavigation } from '../../hooks';
import { api } from '../../lib/api';

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
    createMutation.mutate(formData);
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
                          {new Date(tenant.subscriptionExpiresAt).toLocaleDateString('es-BO')}
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
                accessor: (tenant: Tenant) => (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleEditBranches(tenant)}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setUsersTenant(tenant);
                        setTempPassword(null);
                      }}
                    >
                      Usuarios
                    </Button>
                    <Button
                      size="sm"
                      variant={tenant.isActive ? 'danger' : 'primary'}
                      onClick={() => toggleActiveMutation.mutate({ 
                        tenantId: tenant.id, 
                        isActive: !tenant.isActive 
                      })}
                      disabled={toggleActiveMutation.isPending}
                    >
                      {tenant.isActive ? 'Desactivar' : 'Activar'}
                    </Button>
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
              <p>Expira actualmente: {editingTenant.subscriptionExpiresAt ? new Date(editingTenant.subscriptionExpiresAt).toLocaleDateString('es-BO') : 'Sin expiración'}</p>
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
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => updateUserStatusMutation.mutate({ userId: u.id, isActive: !u.isActive })}
                          disabled={updateUserStatusMutation.isPending}
                        >
                          {u.isActive ? 'Desactivar' : 'Activar'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setTempPassword(null);
                            resetUserPasswordMutation.mutate(u.id);
                          }}
                          disabled={resetUserPasswordMutation.isPending}
                        >
                          Reset clave
                        </Button>
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
    </MainLayout>
  );
}

