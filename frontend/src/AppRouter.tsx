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
  BulkFulfillRequestsPage,
  BulkTransferPage,
  CompletedMovementsPage,
  MovementRequestsPage,
  MovementsPage,
  ReturnsPage,
  ExpiryPage,
  InventoryPage,
  CustomersPage,
  CustomerDetailPage,
  OrdersPage,
  OrderDetailPage,
  DeliveriesPage,
  QuotesPage,
  QuoteDetailPage,
  PaymentsPage,
  SalesReportsPage,
  StockReportsPage,
  AuditListPage,
  UsersPage,
  RolesPage,
  BrandingPage,
  TenantsPage,
  ContactSettingsPage,
  LaboratoriesPage,
  LabSuppliesPage,
  LabMaintenanceSuppliesPage,
  LabPurchaseListsPage,
  LabPurchaseListDetailPage,
  LabReceiptsPage,
  LabReceiptDetailPage,
  LabRecipesPage,
  LabRecipeDetailPage,
  LabProductionRequestsPage,
  LabProductionRequestDetailPage,
  LabProductionRunsPage,
  LabProductionRunDetailPage,
  LabWipPage,
  LabQCQuarantineBatchesPage,
} from './pages'
import { ButtonStylesDemo } from './pages/demo/ButtonStylesDemo'

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

        {/* Home (redirect handled inside DashboardPage for Ventas/Logistica/Platform) */}
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
            <ProtectedRoute requiredPermissions={['catalog:write']}>
              <ProductsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalog/products/:id"
          element={
            <ProtectedRoute requiredPermissions={['catalog:write']}>
              <ProductDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalog/commercial"
          element={
            <ProtectedRoute requiredPermissions={['catalog:write']}>
              <CommercialCatalogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalog/seller"
          element={
            <ProtectedRoute requiredPermissions={['catalog:read', 'sales:order:write']}>
              <SellerCatalogPage />
            </ProtectedRoute>
          }
        />

        {/* Warehouse routes */}
        <Route
          path="/warehouse/warehouses"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']} denyRoleCodes={['VENTAS']}>
              <WarehousesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/warehouse/warehouses/:warehouseId/locations"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']} denyRoleCodes={['VENTAS']}>
              <LocationsPage />
            </ProtectedRoute>
          }
        />

        {/* Stock routes */}
        <Route
          path="/stock/inventory"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/balances"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <BalancesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/movement-requests"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <MovementRequestsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/stock/bulk-transfer"
          element={
            <ProtectedRoute requiredPermissions={['stock:move', 'stock:manage']} requireAll={false}>
              <BulkTransferPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/stock/fulfill-requests"
          element={
            <ProtectedRoute requiredPermissions={['stock:move', 'stock:manage']} requireAll={false}>
              <BulkFulfillRequestsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/stock/completed-movements"
          element={
            <ProtectedRoute requiredPermissions={['stock:move', 'stock:manage']} requireAll={false}>
              <CompletedMovementsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/stock/returns"
          element={
            <ProtectedRoute requiredPermissions={['stock:move', 'stock:manage']} requireAll={false}>
              <ReturnsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/movements"
          element={
            <ProtectedRoute requiredPermissions={['stock:move', 'stock:manage']} requireAll={false}>
              <MovementsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/expiry"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <ExpiryPage />
            </ProtectedRoute>
          }
        />

        {/* Sales routes */}
        <Route
          path="/sales/customers"
          element={
            <ProtectedRoute requiredPermissions={['sales:order:read']}>
              <CustomersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/customers/new"
          element={
            <ProtectedRoute requiredPermissions={['sales:order:write']}>
              <CustomerDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/customers/:customerId"
          element={
            <ProtectedRoute requiredPermissions={['sales:order:read']}>
              <CustomerDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/quotes"
          element={
            <ProtectedRoute requiredPermissions={['sales:order:write']}>
              <QuotesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/quotes/:id"
          element={
            <ProtectedRoute requiredPermissions={['sales:order:write']}>
              <QuoteDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/orders"
          element={
            <ProtectedRoute requiredPermissions={['sales:order:read']}>
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/orders/:id"
          element={
            <ProtectedRoute requiredPermissions={['sales:order:read']}>
              <OrderDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/deliveries"
          element={
            <ProtectedRoute requiredPermissions={['sales:delivery:read']}>
              <DeliveriesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/payments"
          element={
            <ProtectedRoute requiredPermissions={['sales:order:read']}>
              <PaymentsPage />
            </ProtectedRoute>
          }
        />

        {/* Laboratory routes */}
        <Route
          path="/laboratory/labs"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LaboratoriesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/supplies"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabSuppliesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/maintenance-supplies"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabMaintenanceSuppliesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/purchase-lists"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabPurchaseListsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/purchase-lists/:id"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabPurchaseListDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/receipts"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabReceiptsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/receipts/:id"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabReceiptDetailPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/laboratory/recipes"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabRecipesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/recipes/:id"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabRecipeDetailPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/laboratory/production-requests"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabProductionRequestsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/production-requests/:id"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabProductionRequestDetailPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/laboratory/production-runs"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabProductionRunsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/wip"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabWipPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/laboratory/production-runs/:id"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabProductionRunDetailPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/laboratory/qc"
          element={
            <ProtectedRoute requiredPermissions={['stock:read']}>
              <LabQCQuarantineBatchesPage />
            </ProtectedRoute>
          }
        />

        {/* Reports routes */}
        <Route
          path="/reports/sales"
          element={
            <ProtectedRoute requiredPermissions={['report:sales:read']}>
              <SalesReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/stock"
          element={
            <ProtectedRoute requiredPermissions={['report:stock:read']}>
              <StockReportsPage />
            </ProtectedRoute>
          }
        />

        {/* Audit routes */}
        <Route
          path="/audit/events"
          element={
            <ProtectedRoute requiredPermissions={['audit:read']} denyPermissionCodes={['scope:branch']}>
              <AuditListPage />
            </ProtectedRoute>
          }
        />

        {/* Admin routes */}
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute requiredPermissions={['admin:users:manage']} denyPermissionCodes={['scope:branch']}>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/roles"
          element={
            <ProtectedRoute requiredPermissions={['admin:users:manage']} denyPermissionCodes={['scope:branch']}>
              <RolesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/branding"
          element={
            <ProtectedRoute requiredPermissions={['admin:users:manage']} denyPermissionCodes={['scope:branch']}>
              <BrandingPage />
            </ProtectedRoute>
          }
        />

        {/* Platform routes */}
        <Route
          path="/platform/tenants"
          element={
            <ProtectedRoute requiredPermissions={['platform:tenants:manage']}>
              <TenantsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/platform/contact"
          element={
            <ProtectedRoute requiredPermissions={['platform:tenants:manage']}>
              <ContactSettingsPage />
            </ProtectedRoute>
          }
        />

        {/* Demo routes (development only) */}
        <Route
          path="/demo/buttons"
          element={
            <ProtectedRoute>
              <ButtonStylesDemo />
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
