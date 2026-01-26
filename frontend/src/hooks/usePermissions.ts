import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';

export interface Permission {
  id: string;
  code: string;
  description: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
}

export interface UserInfo {
  id: string;
  email: string;
  tenantId: string;
  fullName?: string | null;
  photoUrl?: string | null;
  version?: number;
  tenant: {
    id: string;
    name: string;
    isActive: boolean;
  };
}

export interface AuthMeResponse {
  user: UserInfo;
  roles: Role[];
  permissions: Permission[];
  permissionCodes: string[];
  isPlatformAdmin: boolean;
}

export function usePermissions() {
  const auth = useAuth();
  const { data, isLoading, error } = useQuery<AuthMeResponse>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const response = await api.get<AuthMeResponse>('/api/v1/auth/me');
      return response.data;
    },
    enabled: auth.isAuthenticated,
    retry: (failureCount, err: any) => {
      const status = err?.response?.status;
      if (status === 401 || status === 403) return false;
      return failureCount < 2;
    },
    staleTime: 5 * 60 * 1000, // 5 minutos
    gcTime: 10 * 60 * 1000, // 10 minutos
    placeholderData: (previousData) => previousData, // Mantener datos anteriores durante refetch
  });

  const hasPermission = (permissionCode: string): boolean => {
    return data?.permissionCodes.includes(permissionCode) ?? false;
  };

  const hasAnyPermission = (permissionCodes: string[]): boolean => {
    return permissionCodes.some((code) => hasPermission(code));
  };

  const hasAllPermissions = (permissionCodes: string[]): boolean => {
    return permissionCodes.every((code) => hasPermission(code));
  };

  const isPlatformAdmin = data?.isPlatformAdmin ?? false;
  const isTenantAdmin = !isPlatformAdmin && (data?.roles.some((r) => r.code === 'TENANT_ADMIN') ?? false);

  return {
    // Data
    user: data?.user,
    roles: data?.roles ?? [],
    permissions: data?.permissions ?? [],
    permissionCodes: data?.permissionCodes ?? [],
    
    // Helpers
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    
    // Flags
    isPlatformAdmin,
    isTenantAdmin,
    
    // State
    isLoading,
    error,
  };
}
