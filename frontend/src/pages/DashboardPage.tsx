import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl, api } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { useAuth } from '../providers/AuthProvider';
import { MainLayout } from '../components/layout';
import { PageContainer, Loading, ErrorState, Badge, Button, Modal } from '../components';
import { useNavigation, usePermissions } from '../hooks';
import { Navigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { CubeIcon, UsersIcon, DocumentTextIcon, ShoppingCartIcon } from '@heroicons/react/24/outline';

type HealthResponse = {
  status: 'ok';
  service: string;
  time: string;
};

interface SubscriptionInfo {
  id: string;
  name: string;
  branchLimit: number;
  activeBranches: number;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  subscriptionExpiresAt: string | null;
  status: 'active' | 'expiring_soon' | 'expired';
  daysRemaining: number | null;
}

interface ExtensionRequest {
  branchLimit: number;
  subscriptionMonths: number;
}

interface ExecutiveSummary {
  products: {
    withStock: number;
    total: number;
    byCity: Array<{ city: string; count: number }>;
  };
  customers: {
    total: number;
    byCity: Array<{ city: string; count: number }>;
  };
  quotes: {
    thisMonth: number;
    byCity: Array<{ city: string; count: number }>;
  };
  orders: {
    thisMonth: number;
    pending: number;
    fulfilled: number;
    paid: number;
    byCity: Array<{ city: string; pending: number; fulfilled: number; paid: number }>;
  };
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/health`);
  if (!response.ok) throw new Error('Health check failed');
  return response.json();
}

function ExtensionModal({ 
  isOpen, 
  onClose, 
  subscription,
  onSuccess,
}: { 
  isOpen: boolean; 
  onClose: () => void;
  subscription: SubscriptionInfo;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<ExtensionRequest>({
    branchLimit: subscription.branchLimit,
    subscriptionMonths: 12,
  });
  const [preview, setPreview] = useState<any>(null);

  const requestMutation = useMutation({
    mutationFn: async (data: ExtensionRequest) => {
      const response = await api.post('/api/v1/tenant/subscription/request-extension', data);
      return response.data;
    },
    onSuccess: (data) => {
      setPreview(data.preview);
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    requestMutation.mutate(formData);
  };

  const handleClose = () => {
    setPreview(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800">
        <h2 className="mb-4 text-xl font-semibold text-slate-900 dark:text-white">
          Solicitar Extensión de Suscripción
        </h2>
        
        {!preview ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Cantidad de Sucursales
              </label>
              <input
                type="number"
                required
                min={1}
                max={50}
                value={formData.branchLimit}
                onChange={(e) => setFormData({ ...formData, branchLimit: parseInt(e.target.value) })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
              />
              <p className="mt-1 text-xs text-slate-500">
                Actual: {subscription.branchLimit} sucursales
                {formData.branchLimit > subscription.branchLimit && ' → Aumentar'}
                {formData.branchLimit < subscription.branchLimit && ' → Reducir'}
                {formData.branchLimit === subscription.branchLimit && ' → Mantener'}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Tiempo de Extensión
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

            {requestMutation.error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                Error: {(requestMutation.error as any)?.response?.data?.message || 'Error al solicitar extensión'}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={handleClose} disabled={requestMutation.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={requestMutation.isPending}>
                {requestMutation.isPending ? 'Enviando...' : 'Enviar Solicitud'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20">
              <p className="text-sm text-green-600 dark:text-green-400">
                ✓ Solicitud enviada exitosamente
              </p>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Preview del mensaje:</h3>
              <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-900">
                <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Para: {preview.to}
                </p>
                <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Asunto: {preview.subject}
                </p>
                <pre className="whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300">
                  {preview.body}
                </pre>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleClose}>Cerrar</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutiveSummaryBlock() {
  const { isPlatformAdmin } = usePermissions();
  const [chartModal, setChartModal] = useState<'products' | 'customers' | 'quotes' | 'orders' | null>(null);

  const summaryQuery = useQuery<ExecutiveSummary>({
    queryKey: ['dashboard', 'executive-summary'],
    queryFn: async () => {
      const response = await api.get<ExecutiveSummary>('/api/v1/dashboards/executive-summary');
      return response.data;
    },
    enabled: !isPlatformAdmin,
  });

  if (isPlatformAdmin) return null;
  if (summaryQuery.isLoading) return <Loading />;
  if (summaryQuery.error || !summaryQuery.data) return null;

  const data = summaryQuery.data;
  const currentMonth = new Date().toLocaleDateString('es-BO', { month: 'long' });

  return (
    <>
      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
          <ShoppingCartIcon className="h-6 w-6" />
          Resumen Ejecutivo
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Productos */}
          <div
            onClick={() => setChartModal('products')}
            className="cursor-pointer rounded-lg border border-blue-200 bg-blue-50 p-4 transition-all hover:border-blue-400 hover:shadow-md dark:border-blue-800 dark:bg-blue-900/20"
          >
            <div className="mb-2 flex items-center gap-2">
              <CubeIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <p className="text-sm text-slate-600 dark:text-slate-400">Productos con stock</p>
            </div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
              {data.products.withStock}/{data.products.total}
            </p>
          </div>

          {/* Clientes */}
          <div
            onClick={() => setChartModal('customers')}
            className="cursor-pointer rounded-lg border border-green-200 bg-green-50 p-4 transition-all hover:border-green-400 hover:shadow-md dark:border-green-800 dark:bg-green-900/20"
          >
            <div className="mb-2 flex items-center gap-2">
              <UsersIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
              <p className="text-sm text-slate-600 dark:text-slate-400">Clientes</p>
            </div>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">
              {data.customers.total}
            </p>
          </div>

          {/* Cotizaciones */}
          <div
            onClick={() => setChartModal('quotes')}
            className="cursor-pointer rounded-lg border border-orange-200 bg-orange-50 p-4 transition-all hover:border-orange-400 hover:shadow-md dark:border-orange-800 dark:bg-orange-900/20"
          >
            <div className="mb-2 flex items-center gap-2">
              <DocumentTextIcon className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Cotizaciones {currentMonth}
              </p>
            </div>
            <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">
              {data.quotes.thisMonth}
            </p>
          </div>

          {/* Ventas */}
          <div
            onClick={() => setChartModal('orders')}
            className="cursor-pointer rounded-lg border border-purple-200 bg-purple-50 p-4 transition-all hover:border-purple-400 hover:shadow-md dark:border-purple-800 dark:bg-purple-900/20"
          >
            <div className="mb-2 flex items-center gap-2">
              <ShoppingCartIcon className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Órdenes {currentMonth}
              </p>
            </div>
            <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
              {data.orders.thisMonth}
            </p>
          </div>
        </div>
      </div>

      {/* Modales de gráficos */}
      {chartModal === 'products' && data.products.byCity.length > 0 && (
        <Modal isOpen onClose={() => setChartModal(null)} title="Productos con Stock por Ciudad">
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={data.products.byCity}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="city" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="count" fill="#3b82f6" name="Productos con Stock" />
            </BarChart>
          </ResponsiveContainer>
        </Modal>
      )}

      {chartModal === 'customers' && data.customers.byCity.length > 0 && (
        <Modal isOpen onClose={() => setChartModal(null)} title="Clientes por Ciudad">
          <ResponsiveContainer width="100%" height={400}>
            <PieChart>
              <Pie
                data={data.customers.byCity}
                dataKey="count"
                nameKey="city"
                cx="50%"
                cy="50%"
                outerRadius={120}
                label
              >
                {data.customers.byCity.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Modal>
      )}

      {chartModal === 'quotes' && data.quotes.byCity.length > 0 && (
        <Modal isOpen onClose={() => setChartModal(null)} title={`Cotizaciones de ${currentMonth} por Ciudad`}>
          <ResponsiveContainer width="100%" height={400}>
            <PieChart>
              <Pie
                data={data.quotes.byCity}
                dataKey="count"
                nameKey="city"
                cx="50%"
                cy="50%"
                outerRadius={120}
                label
              >
                {data.quotes.byCity.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Modal>
      )}

      {chartModal === 'orders' && data.orders.byCity.length > 0 && (
        <Modal isOpen onClose={() => setChartModal(null)} title={`Órdenes de Venta de ${currentMonth} por Ciudad`}>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={data.orders.byCity}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="city" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="pending" fill="#f59e0b" name="Pendientes de Entrega" />
              <Bar dataKey="fulfilled" fill="#10b981" name="Entregadas" />
              <Bar dataKey="paid" fill="#3b82f6" name="Cobradas" />
            </BarChart>
          </ResponsiveContainer>
        </Modal>
      )}
    </>
  );
}

export function DashboardPage() {
  const auth = useAuth();
  const navGroups = useNavigation();
  const queryClient = useQueryClient();
  const { isPlatformAdmin, isTenantAdmin, roles, isLoading } = usePermissions();
  const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [events, setEvents] = useState<Array<{ at: string; type: string; payload: unknown }>>([]);
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false);

  if (!isLoading) {
    if (isPlatformAdmin) return <Navigate to="/platform/tenants" replace />
    if (!isTenantAdmin) {
      if (roles.some((r) => r.code === 'LOGISTICA')) return <Navigate to="/sales/deliveries" replace />
      if (roles.some((r) => r.code === 'BRANCH_ADMIN')) return <Navigate to="/sales/deliveries" replace />
      if (roles.some((r) => r.code === 'VENTAS')) return <Navigate to="/catalog/seller" replace />
    }
  }

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30000,
  });

  const subscriptionQuery = useQuery<SubscriptionInfo>({
    queryKey: ['tenant', 'subscription'],
    queryFn: async () => {
      const response = await api.get<SubscriptionInfo>('/api/v1/tenant/subscription');
      return response.data;
    },
    enabled: !isPlatformAdmin, // Solo para Tenant Admin/Users
  });

  const handleExtensionSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['tenant', 'subscription'] });
  };

  // Socket connection
  useEffect(() => {
    if (!auth.accessToken) return

    setSocketStatus('connecting')
    const socket = connectSocket()
    
    if (!socket) {
      setSocketStatus('disconnected')
      return
    }

    socket.on('connect', () => {
      setSocketStatus('connected')
    })

    socket.on('disconnect', () => {
      setSocketStatus('disconnected')
    })

    // Listen to all events for demo
    socket.onAny((type, payload) => {
      setEvents((prev) => [{ at: new Date().toISOString(), type, payload }, ...prev].slice(0, 20))
    })

    return () => {
      disconnectSocket();
      setSocketStatus('disconnected');
    };
  }, [auth.accessToken]);

  const getSubscriptionBadgeVariant = (status: string): 'success' | 'warning' | 'danger' => {
    if (status === 'expired') return 'danger';
    if (status === 'expiring_soon') return 'warning';
    return 'success';
  };

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="FarmaSNT - Dashboard">
        {/* Subscription Widget - Solo para Tenant Admin/Users */}
        {!isPlatformAdmin && subscriptionQuery.data && (
          <div className="mb-6 rounded-lg border-2 border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-900/20">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  📦 Información de Suscripción
                </h3>
                
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Sucursales</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {subscriptionQuery.data.activeBranches} / {subscriptionQuery.data.branchLimit}
                    </p>
                    <p className="text-xs text-slate-500">
                      {subscriptionQuery.data.branchLimit - subscriptionQuery.data.activeBranches} disponibles
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Estado</p>
                    <div className="mt-1">
                      <Badge variant={getSubscriptionBadgeVariant(subscriptionQuery.data.status)}>
                        {subscriptionQuery.data.status === 'expired' && 'Expirado'}
                        {subscriptionQuery.data.status === 'expiring_soon' && 'Por Vencer'}
                        {subscriptionQuery.data.status === 'active' && 'Activo'}
                      </Badge>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Fecha de Expiración</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {subscriptionQuery.data.subscriptionExpiresAt
                        ? new Date(subscriptionQuery.data.subscriptionExpiresAt).toLocaleDateString('es-BO')
                        : 'Sin fecha'}
                    </p>
                    {subscriptionQuery.data.daysRemaining !== null && (
                      <p className="text-xs text-slate-500">
                        {subscriptionQuery.data.daysRemaining} días restantes
                      </p>
                    )}
                  </div>

                  <div className="flex items-center">
                    {isTenantAdmin && (
                      <Button 
                        size="sm" 
                        onClick={() => setIsExtensionModalOpen(true)}
                        variant={subscriptionQuery.data.status === 'expired' ? 'primary' : 'secondary'}
                      >
                        {subscriptionQuery.data.status === 'expired' ? 'Renovar Ahora' : 'Solicitar Extensión'}
                      </Button>
                    )}
                  </div>
                </div>

                {subscriptionQuery.data.contactName && (
                  <div className="mt-4 border-t border-blue-200 pt-3 dark:border-blue-800">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Contacto de Soporte</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {subscriptionQuery.data.contactName} • {subscriptionQuery.data.contactEmail} • {subscriptionQuery.data.contactPhone}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Executive Summary - Solo para Tenant Admin/Users */}
        <ExecutiveSummaryBlock />

        <div className="grid gap-6 md:grid-cols-2">
          {/* Health Status */}
          <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              Estado del Sistema
            </h3>
            {healthQuery.isLoading && <Loading />}
            {healthQuery.error && <ErrorState message="Error al cargar estado" retry={healthQuery.refetch} />}
            {healthQuery.data && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Estado:</span>
                  <Badge variant="success">{healthQuery.data.status}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Servicio:</span>
                  <span className="text-slate-900 dark:text-slate-100">{healthQuery.data.service}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Última verificación:</span>
                  <span className="text-slate-900 dark:text-slate-100">
                    {new Date(healthQuery.data.time).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Realtime Connection */}
          <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              Conexión en Tiempo Real
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Estado:</span>
                <Badge
                  variant={
                    socketStatus === 'connected' ? 'success' : socketStatus === 'connecting' ? 'warning' : 'default'
                  }
                >
                  {socketStatus === 'connected' ? 'Conectado' : socketStatus === 'connecting' ? 'Conectando...' : 'Desconectado'}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Eventos recibidos:</span>
                <span className="text-slate-900 dark:text-slate-100">{events.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Events */}
        {events.length > 0 && (
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              Eventos Recientes
            </h3>
            <div className="space-y-2">
              {events.slice(0, 10).map((evt, idx) => (
                <div
                  key={idx}
                  className="rounded border border-slate-100 p-3 text-sm dark:border-slate-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900 dark:text-slate-100">{evt.type}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-500">
                      {new Date(evt.at).toLocaleTimeString()}
                    </span>
                  </div>
                  <pre className="mt-1 overflow-x-auto text-xs text-slate-600 dark:text-slate-400">
                    {JSON.stringify(evt.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </PageContainer>

      {subscriptionQuery.data && (
        <ExtensionModal
          isOpen={isExtensionModalOpen}
          onClose={() => setIsExtensionModalOpen(false)}
          subscription={subscriptionQuery.data}
          onSuccess={handleExtensionSuccess}
        />
      )}
    </MainLayout>
  );
}
