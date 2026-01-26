import { Navigate } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider'
import { usePermissions } from '../hooks/usePermissions'

export function ProtectedRoute({
  children,
  requiredPermissions,
  requireAll = true,
  denyRoleCodes,
}: {
  children: React.ReactNode
  requiredPermissions?: string[]
  requireAll?: boolean
  denyRoleCodes?: string[]
}) {
  const auth = useAuth()
  const perms = usePermissions()
  
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // While permissions load, keep route blocked to avoid flicker/leaks
  if (perms.isLoading) {
    return null
  }

  if (denyRoleCodes && denyRoleCodes.length > 0) {
    const hasDeniedRole = perms.roles.some((r) => denyRoleCodes.includes(r.code))
    if (hasDeniedRole && !perms.isTenantAdmin) {
      return <Navigate to="/" replace />
    }
  }

  if (requiredPermissions && requiredPermissions.length > 0) {
    const ok = requireAll ? perms.hasAllPermissions(requiredPermissions) : perms.hasAnyPermission(requiredPermissions)
    if (!ok) {
      return <Navigate to="/" replace />
    }
  }
  
  return <>{children}</>
}
