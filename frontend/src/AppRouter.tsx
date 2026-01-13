import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import {
  LoginPage,
  ResetPasswordPage,
  DashboardPage,
  ProductsListPage,
  ProductDetailPage,
  CommercialCatalogPage,
  SellerCatalogPage,
  WarehousesPage,
  LocationsPage,
  BalancesPage,
  MovementsPage,
  ExpiryPage,
  InventoryPage,
  CustomersPage,
  CustomerDetailPage,
  OrdersPage,
  QuotesPage,
  QuoteDetailPage,
  SalesReportsPage,
  StockReportsPage,
  AuditListPage,
  UsersPage,
  RolesPage,
  BrandingPage,
  TenantsPage,
  ContactSettingsPage,
} from './pages'

/**
 * Main application router with all routes
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Protected routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Catalog routes */}
        <Route
          path="/catalog/products"
          element={
            <ProtectedRoute>
              <ProductsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalog/products/:id"
          element={
            <ProtectedRoute>
              <ProductDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalog/commercial"
          element={
            <ProtectedRoute>
              <CommercialCatalogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalog/seller"
          element={
            <ProtectedRoute>
              <SellerCatalogPage />
            </ProtectedRoute>
          }
        />

        {/* Warehouse routes */}
        <Route
          path="/warehouse/warehouses"
          element={
            <ProtectedRoute>
              <WarehousesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/warehouse/warehouses/:warehouseId/locations"
          element={
            <ProtectedRoute>
              <LocationsPage />
            </ProtectedRoute>
          }
        />

        {/* Stock routes */}
        <Route
          path="/stock/inventory"
          element={
            <ProtectedRoute>
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/balances"
          element={
            <ProtectedRoute>
              <BalancesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/movements"
          element={
            <ProtectedRoute>
              <MovementsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/expiry"
          element={
            <ProtectedRoute>
              <ExpiryPage />
            </ProtectedRoute>
          }
        />

        {/* Sales routes */}
        <Route
          path="/sales/customers"
          element={
            <ProtectedRoute>
              <CustomersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/customers/new"
          element={
            <ProtectedRoute>
              <CustomerDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/customers/:customerId"
          element={
            <ProtectedRoute>
              <CustomerDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/orders"
          element={
            <ProtectedRoute>
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/quotes"
          element={
            <ProtectedRoute>
              <QuotesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/quotes/:id"
          element={
            <ProtectedRoute>
              <QuoteDetailPage />
            </ProtectedRoute>
          }
        />

        {/* Reports routes */}
        <Route
          path="/reports/sales"
          element={
            <ProtectedRoute>
              <SalesReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/stock"
          element={
            <ProtectedRoute>
              <StockReportsPage />
            </ProtectedRoute>
          }
        />

        {/* Audit routes */}
        <Route
          path="/audit/events"
          element={
            <ProtectedRoute>
              <AuditListPage />
            </ProtectedRoute>
          }
        />

        {/* Admin routes */}
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/roles"
          element={
            <ProtectedRoute>
              <RolesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/branding"
          element={
            <ProtectedRoute>
              <BrandingPage />
            </ProtectedRoute>
          }
        />

        {/* Platform routes */}
        <Route
          path="/platform/tenants"
          element={
            <ProtectedRoute>
              <TenantsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/platform/contact"
          element={
            <ProtectedRoute>
              <ContactSettingsPage />
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
