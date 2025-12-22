import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl, api } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { useAuth } from '../providers/AuthProvider';
import { MainLayout } from '../components/layout';
import { PageContainer, Loading, ErrorState, Badge, Button } from '../components';
import { useNavigation, usePermissions } from '../hooks';

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

export function DashboardPage() {
  const auth = useAuth();
  const navGroups = useNavigation();
  const queryClient = useQueryClient();
  const { isPlatformAdmin, isTenantAdmin } = usePermissions();
  const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [events, setEvents] = useState<Array<{ at: string; type: string; payload: unknown }>>([]);
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false);

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
