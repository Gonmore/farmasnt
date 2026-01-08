import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { AppRouter } from './AppRouter'
import { AuthProvider } from './providers/AuthProvider'
import { TenantProvider } from './providers/TenantProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import { CartProvider } from './providers/CartProvider'

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
            <CartProvider>
              <AppRouter />
            </CartProvider>
          </ThemeProvider>
        </TenantProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
