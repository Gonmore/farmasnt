import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { AppRouter } from './AppRouter'
import { AuthProvider } from './providers/AuthProvider'
import { TenantProvider } from './providers/TenantProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import { CartProvider } from './providers/CartProvider'
import { NotificationsProvider } from './providers/NotificationsProvider'

// FORZAR RECARGA - STOCK ORIGEN ELIMINADO - TIMESTAMP: 2026-02-02T13:00:00.000Z
console.log('🚀 MAIN.TSX CARGADO - STOCK ORIGEN ELIMINADO - VERSION:', new Date().toISOString())
import { ScrollProvider } from './contexts/ScrollContext'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TenantProvider>
          <ThemeProvider>
            <NotificationsProvider>
              <CartProvider>
                <ScrollProvider>
                  <AppRouter />
                </ScrollProvider>
              </CartProvider>
            </NotificationsProvider>
          </ThemeProvider>
        </TenantProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
