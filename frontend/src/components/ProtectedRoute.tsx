import { Navigate } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  return <>{children}</>
}
