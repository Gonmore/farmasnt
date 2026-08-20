# Architecture — PharmaFlow Bolivia (farmaSNT)

> Fuente de verdad para la estructura del proyecto y el mapeo frontend ↔ backend.  
> Última actualización: 19 Ago 2026

---

## 1. Stack tecnológico

| Capa       | Tecnología                              |
|------------|-----------------------------------------|
| Backend    | Node.js + TypeScript (ESM), Fastify     |
| DB         | PostgreSQL (single DB, row-level `tenantId`) |
| ORM        | Prisma (schema en `backend/prisma/schema.prisma`) |
| Frontend   | React + Vite + TypeScript               |
| Styles     | Tailwind CSS v3 + CSS variables de branding |
| Fetching   | TanStack Query + Axios (`frontend/src/lib/api.ts`) |
| Realtime   | Socket.io (salas `tenant:<tenantId>`)   |
| Auth       | JWT (access token) + refresh token opaco hasheado |
| Auditoría  | `AuditEvent` append-only (GxP-friendly) |
| Storage    | S3-compatible (presigned URLs)          |
| Deploy     | Docker + `deploy.sh`                    |
| Base URL   | `http://127.0.0.1:6000` (dev)           |

---

## 2. Estructura de directorios

### 2.1 Backend (`backend/`)

```
backend/
├── prisma/
│   ├── schema.prisma          # Modelo de datos + enums
│   ├── seed.ts                # Seed idempotente (admin@demo.local)
│   └── migrations/
│       └── 20260803143835_add_kardex_and_movement_request_to_location/
│           └── migration.sql
├── src/
│   ├── application/
│   │   ├── security/
│   │   │   ├── rbac.ts        # Guards: requireAuth, requirePermission, requireModuleEnabled
│   │   │   └── permissions.ts # Enum de códigos de permiso
│   │   ├── audit/
│   │   │   └── auditService.ts# Append-only AuditEvent
│   │   ├── stock/
│   │   │   └── stockMovementService.ts  # Transaccional: IN/OUT/TRANSFER/ADJUSTMENT
│   │   └── shared/
│   │       ├── sequence.ts    # TenantSequence (MSYYYY-N, SOLYY####, COT-YYYY####)
│   │       └── productUnits.ts# formatPresentationLabel
│   ├── adapters/http/
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── catalog.ts     # GET /api/v1/catalog/search
│   │   │   ├── products.ts    # CRUD productos, batches, presentaciones, recipe, kardex
│   │   │   ├── warehouses.ts  # CRUD warehouses/locations
│   │   │   ├── stock.ts       # Movimientos, balances, movimientos-requests, returns, repack
│   │   │   ├── customers.ts   # CRUD customers
│   │   │   ├── salesOrders.ts # Quotes, Orders, Deliveries, reservas, pagos
│   │   │   ├── salesQuotes.ts # Cotizaciones + sub-warehouses + available-batches
│   │   │   ├── salesPayments.ts  # Pagos (proof-upload, lista, pay)
│   │   │   ├── reports.ts     # Reportes read-only (sales, stock)
│   │   │   ├── admin.ts       # RBAC: usuarios, roles, permisos
│   │   │   ├── audit.ts       # Read-side de auditoría
│   │   │   ├── notifications.ts
│   │   │   ├── dashboards.ts
│   │   │   ├── platform.ts    # Provisioning de tenants
│   │   │   ├── tenant.ts      # Branding + suscripción
│   │   │   ├── laboratory.ts  # Módulo LABORATORY
│   │   │   ├── contact.ts
│   │   │   └── wellKnown.ts
│   │   └── server.ts          # Registro de rutas + Socket.io
│   ├── db/
│   │   └── prisma.ts          # Cliente Prisma singleton
│   └── shared/
│       └── env.ts             # Validación de env vars
├── package.json
└── .env.example
```

### 2.2 Frontend (`frontend/`)

```
frontend/src/
├── App.tsx                    # Router + providers
├── main.tsx                   # Render + ThemeProvider
├── lib/
│   ├── api.ts                 # Instancia Axios + apiFetch helper
│   ├── socket.ts              # Conexión Socket.io
│   ├── exportPdf.ts           # Exportaciones PDF (jsPDF + html2canvas)
│   ├── exportXlsx.ts          # Exportaciones Excel
│   ├── numberFormat.ts        # Formateo numérico con thousandSeparator
│   ├── productName.ts         # Formateo presentaciones/cantidades
│   ├── productSorting.ts      # Orden alfabético por nombre
│   └── catalogPdf.tsx         # Exportación PDF del catálogo comercial (brochure resumido/extendido, jsPDF)
├── hooks/
│   ├── usePermissions.ts      # usePermissions() → /api/v1/auth/me
│   ├── useNavigation.ts       # Navegación filtrada por permisos
│   ├── useAuth.ts             # AuthProvider context
│   └── useTenant.ts           # TenantProvider context
├── providers/
│   ├── AuthProvider.tsx       # JWT management
│   ├── TenantProvider.tsx     # Tenant + switch-tenant
│   └── ThemeProvider.tsx      # Dark/light mode
├── components/
│   ├── common/                # Reutilizables: MainLayout, PageContainer, Button, Modal, etc.
│   ├── reports/               # Componentes de reportes (KPICard, ReportSection, docs)
│   ├── ui/                    # Componentes base (Input, Select, Table)
│   └── index.ts               # Barrel exports
├── pages/
│   ├── auth/                  # Login, password-reset
│   ├── admin/                 # Usuarios, roles, permisos, branding
│   ├── platform/              # Tenants (provisioning)
│   ├── catalog/               # ProductsPage, ProductDetailPage, CommercialCatalogPage, SellerCatalogPage
│   ├── stock/                 # InventoryPage, MovementsPage, MovementRequestsPage, ReturnsPage, etc.
│   ├── sales/                 # QuotesPage, OrdersPage, DeliveriesPage, PaymentsPage
│   ├── reports/               # SalesReportsPage, StockReportsPage
│   ├── laboratory/            # Módulo LABORATORY (producción, insumos, etc.)
│   └── DashboardPage.tsx      # Dashboard con widget de suscripción
└── routes/                    # Definición de rutas (si existe separado)
```

---

## 3. Mapeo frontend ↔ backend

### 3.1 Auth & Multi-tenant

| Frontend (archivo:función/hook) | Backend endpoint | Notas |
|---|---|---|
| `hooks/usePermissions.ts:usePermissions()` | `GET /api/v1/auth/me` | Cache 5 min; expone `permissionCodes`, `isPlatformAdmin`, `isTenantAdmin` |
| `App.legacy.tsx` / providers | `POST /api/v1/auth/login` | Resuelve tenant por `Host` |
| `App.legacy.tsx` | `POST /api/v1/auth/refresh` | Refresh token rotation |
| `providers/TenantProvider.tsx` | `POST /api/v1/auth/switch-tenant` | Cambio de empresa activa |
| `components/Layout` / navbar | `GET /api/v1/public/tenant/branding` | Branding pre-login (sin JWT) |
| `providers/TenantProvider.tsx` | `GET /api/v1/tenant/branding` + `PATCH` | Branding con JWT |
| `pages/platform/TenantsPage.tsx` | `GET /api/v1/platform/tenants` + `POST` | Provisioning (platform admin) |
| `pages/admin/*` | `GET /api/v1/admin/users`, `POST`, `PATCH`, `PUT /roles`, etc. | Gestión multi-rol |

### 3.2 Catálogo & Productos

| Frontend | Backend | Archivo backend |
|---|---|---|
| `pages/catalog/ProductsPage.tsx` | `GET /api/v1/products` | `routes/products.ts:521` |
| `pages/catalog/ProductsPage.tsx` (crear) | `POST /api/v1/products` | `routes/products.ts:395` |
| `pages/catalog/ProductDetailPage.tsx` | `GET /api/v1/products/:id` | `routes/products.ts:767` |
| `pages/catalog/ProductDetailPage.tsx` (editar) | `PATCH /api/v1/products/:id` | `routes/products.ts:1010` |
| `pages/catalog/ProductDetailPage.tsx` (foto) | `POST /api/v1/products/:id/photo-upload` | `routes/products.ts:1097` |
| `components/CatalogSearch` | `GET /api/v1/catalog/search` | `routes/catalog.ts:21` |
| `pages/catalog/ProductDetailPage.tsx` (presentaciones) | `GET /api/v1/products/:productId/presentations` | `routes/products.ts:604` |
| | `POST /api/v1/products/:productId/presentations` | `routes/products.ts:635` |
| | `PATCH /api/v1/products/presentations/:id` | `routes/products.ts:686` |
| | `DELETE /api/v1/products/presentations/:id` | `routes/products.ts:743` |
| `pages/catalog/ProductDetailPage.tsx` (receta) | `GET /api/v1/products/:id/recipe` | `routes/products.ts:787` |
| | `PUT /api/v1/products/:id/recipe` | `routes/products.ts:831` |
| | `DELETE /api/v1/products/:id/recipe` | `routes/products.ts:977` |
| `pages/catalog/ProductDetailPage.tsx` (lotes) | `GET /api/v1/products/:id/batches` | `routes/products.ts:1149` |
| | `POST /api/v1/products/:id/batches` | `routes/products.ts:1589` |
| `pages/catalog/CommercialCatalogPage.tsx` (exportar PDF) | `GET /api/v1/products` (todos los activos, `includePresentations=true`) + `GET /api/v1/products/:id` (descripción, solo extendido) | `lib/catalogPdf.tsx:exportCommercialCatalogPdf` | Brochure PDF con jsPDF (sin html2canvas): resumido (3 col, foto+presentaciones+precio) y extendido (2 col, + descripción). Fondo gris, marco decorativo, logo sin redondear, sin "Powered by". Nombre centrado 11pt; descripción hasta 5 líneas con `...`; presentaciones con precio al lado; sin línea "P. unitario". |
| `hooks/useNavigation.ts` | — | — | `🛒 Comercial` visible para **todos** los roles con `catalog:read` (antes solo `isTenantAdmin`/`catalog:write`). |
| `pages/stock/MovementsPage.tsx` (lotes) | `GET /api/v1/products/:productId/batches/:batchId/movements` | `routes/products.ts:1305` |
| | `PATCH /api/v1/products/:productId/batches/:batchId/status` | `routes/products.ts:1758` |
| | `PATCH /api/v1/products/:productId/batches/:batchId` | `routes/products.ts:1807` |
| | `DELETE /api/v1/products/:productId/batches/:batchId` | `routes/products.ts:1901` |

### 3.3 Stock & Almacenes

| Frontend | Backend | Archivo backend |
|---|---|---|
| `pages/stock/InventoryPage.tsx` (stock) | `GET /api/v1/warehouses` | `routes/warehouses.ts:54` |
| `pages/stock/InventoryPage.tsx` (ver stock) | `GET /api/v1/reports/stock/balances-expanded` | `routes/reports.ts:1435` |
| `pages/stock/InventoryPage.tsx` (kardex — vista "Por Sucursal") | `GET /api/v1/products/:id/kardex` | `routes/products.ts:1391` | Filtra movimientos por `warehouseId`; muestra origen/destino como `WAREHOUSE:Location`; incluye `fromWarehouseCode`/`toWarehouseCode`; para ventas (`OUT+SALES_ORDER`) el destino muestra `NRO_ORDEN: NombreCliente`; saldo acumulado filtrado por `affectsWarehouse`. |
| `pages/stock/InventoryPage.tsx` (ediciones — vista "Por Sucursal") | `PATCH /api/v1/products/:productId/batches/:batchId/status`, `POST /api/v1/stock/movements` | `routes/products.ts:1758`, `routes/stock.ts:2506` | Ambas vistas ("Por Producto" y "Por Sucursal") aplican `canEditWarehouse(warehouseId)`: solo edita ubicación (TRANSFER) y estado de lote en el almacén propio del usuario con scope de sucursal (`scope:branch`); los demás almacenes quedan en solo lectura. |
| `pages/stock/InventoryPage.tsx` (kardex export) | `GET /api/v1/products/:id/kardex` | `routes/products.ts:1391` (datos para exportToXlsx) | Exporta origen/destino con formato `WAREHOUSE:Location`, filtrando solo movimientos `affectsWarehouse`. |
| `pages/stock/CompletedMovementsPage.tsx` (historial) | `GET /api/v1/stock/completed-movements` | `routes/stock.ts:4232` | Columna "Origen → Destino" muestra `WAREHOUSE:Location` (sin prefijo `SUC-`). El `receiptStatus` se recalcula verificando que `fromLocation.warehouseId !== toLocation.warehouseId`; transferencias entre ubicaciones del mismo warehouse se marcan `RECEIVED` (no `PENDING`). Orden descendente por `completedAt`. |
| `components/MovementHistoryTab.tsx` (historial) | `GET /api/v1/stock/completed-movements` | `routes/stock.ts:4232` | Columna "Origen → Destino" muestra `WAREHOUSE:Location` con `SUC-` removido. Orden descendente por `completedAt`. |
| `pages/stock/MovementsPage.tsx` | `POST /api/v1/stock/movements` | `routes/stock.ts:2506` | | Lista de solicitudes y modal "Detalle de solicitud" muestran destino como `Warehouse:Location` (sin `SUC-`)
| | `GET /api/v1/warehouses/:id/locations` | `routes/warehouses.ts:200` |
| `pages/stock/MovementRequestsPage.tsx` | `GET /api/v1/stock/movement-requests` | `routes/stock.ts:792` |
| | | | | Rol `BRANCH_PROVIDER` (12 Ago 2026): almacenes `PROVIDER` ven/atenden TODAS las solicitudes sin filtro de ciudad (`branchCityOf` devuelve null para `warehouseType=PROVIDER`).
| | `POST /api/v1/stock/movement-requests` | `routes/stock.ts:1117` |
| | `PUT /api/v1/stock/movement-requests/:id` | `routes/stock.ts:1323` |
| | `POST /api/v1/stock/movement-requests/:id/plan` | `routes/stock.ts:1574` |
| | `POST /api/v1/stock/movement-requests/:id/fulfill` | `routes/stock.ts:1824` |
| | `POST /api/v1/stock/movement-requests/:id/confirm` | `routes/stock.ts:2076` |
| | `POST /api/v1/stock/movement-requests/:id/cancel` | `routes/stock.ts:1490` |
| `pages/stock/BulkFulfillPage.tsx` | `POST /api/v1/stock/movement-requests/bulk-fulfill` | `routes/stock.ts:3047` |
| `pages/stock/ReturnsPage.tsx` | `GET /api/v1/stock/returns` | `routes/stock.ts:517` | Receptions tab: unified "Recepción/Devolución" modal (11 Ago 2026) |
| | | | `POST /api/v1/stock/returns` | `routes/stock.ts:670` |
| | | | `GET /api/v1/stock/returns/:id` | `routes/stock.ts:615` |
| | | | `POST /api/v1/stock/returns/photo-upload` | `routes/stock.ts:471` |
| | | | `GET /api/v1/stock/movement-requests?status=SENT` | `routes/stock.ts:792` | Receptions tab data source |
| | | | `GET /api/v1/stock/completed-movements?take=100&receiptStatus=PENDING` | `routes/stock.ts:4232` | Transferencias pendientes de recepción en la sucursal del usuario (13 Ago 2026). Frontend filtra `type !== FULFILL_REQUEST` y `fromWarehouseCode !== toWarehouseCode`; el backend recalcula `receiptStatus` para excluir inter-ubicación del mismo warehouse. |
| | | | `POST /api/v1/stock/transfers/:id/receive` | `routes/stock.ts:4073` | Confirma recepción de TRANSFER/BULK_TRANSFER pendiente (solo sucursal destino) |
| | | | `POST /api/v1/stock/movement-requests/:id/reception` | `routes/stock.ts:3737` | Unified reception + return endpoint |
| | `POST /api/v1/stock/movement-requests/:id/reception` | `routes/stock.ts:3737` | Unified reception + return endpoint (created 11 Ago 2026) |
| `pages/stock/MovementRequestsTraceabilityPage.tsx` | `GET /api/v1/stock/movement-requests` | `routes/stock.ts:792` | Traceability: Warehouse:Location route (origin `fromWarehouse:fromLocation` on attended/received), batch per shipment, PDF export with signature names (11 Ago 2026) |
| `pages/stock/MovementsPage.tsx` (historial) | `GET /api/v1/stock/completed-movements` | `routes/stock.ts:4232` |
| | `GET /api/v1/stock/completed-movements/:id/picking` | `routes/stock.ts:4792` | Picking enriquecido: `meta` trae `requestCode`, `movementCode`, `requestedByName`, `sentByName`; cada `sentLine` trae `movementNumber` (13 Ago 2026) |
| | `GET /api/v1/stock/completed-movements/:id/label` | `routes/stock.ts:5044` |
| | `POST /api/v1/stock/bulk-transfers` | `routes/stock.ts:2760` |
| | `POST /api/v1/stock/repack` | `routes/stock.ts:2872` |
| `pages/stock/ExpiryPage.tsx` | `GET /api/v1/stock/expiry/summary` | `routes/stock.ts:2200` |
| | `GET /api/v1/stock/fefo-suggestions` | `routes/stock.ts:2302` |
| | `GET /api/v1/stock/balances` | `routes/stock.ts:2393` |
| | `GET /api/v1/stock/reservations` | `routes/stock.ts:2428` |

### 3.4 Ventas & Cobros

| Frontend | Backend | Archivo backend |
|---|---|---|
| `pages/sales/QuotesPage.tsx` | `GET /api/v1/sales/quotes` | `routes/salesQuotes.ts:584` |
| | `POST /api/v1/sales/quotes` | `routes/salesQuotes.ts:674` |
| | `GET /api/v1/sales/quotes/:id` | `routes/salesQuotes.ts:1435` |
| `pages/sales/QuoteDetailPage.tsx` (detalle + edición) | `GET /api/v1/sales/quotes/:id` | `routes/salesQuotes.ts:1435` | El frontend calcula `unitPriceBase` desde `Product.price` o `priceOverride / unitsPerPresentation` al seleccionar producto o cambiar presentación. |
| | `PUT /api/v1/sales/quotes/:id` | `routes/salesQuotes.ts:1544` | El `unitPrice` se envía en unidades base; backend aplica `priceOverride` si no se envía. |
| | `POST /api/v1/sales/quotes/:id/process` | `routes/salesQuotes.ts:959` |
| | `GET /api/v1/sales/quotes/next-number` | `routes/salesOrders.ts:668` |
| | `GET /api/v1/sales/quotes/sub-warehouses` | `routes/salesQuotes.ts:431` |
| | `GET /api/v1/sales/quotes/:id/available-batches` | `routes/salesQuotes.ts:477` |
| | `POST /api/v1/sales/quotes/:id/request-stock` | `routes/salesQuotes.ts:1270` |
| | `GET /api/v1/products/:id/presentations` | `routes/products.ts:604` | Incluye `priceOverride` para cálculo de precios por presentación. |
| | `GET /api/v1/catalog/search` | `routes/catalog.ts:21` | Con `includePresentations=true` devuelve `price` del producto y `priceOverride` de cada presentación. |
| `pages/sales/OrdersPage.tsx` | `GET /api/v1/sales/orders` | `routes/salesOrders.ts:697` |
| | `GET /api/v1/sales/orders/:id` | `routes/salesOrders.ts:852` |
| | `POST /api/v1/sales/orders/:id/cancel` | `routes/salesOrders.ts:954` |
| | `GET /api/v1/sales/orders/:id/reservations` | `routes/salesOrders.ts:1076` |
| | `POST /api/v1/sales/orders/:id/confirm` | `routes/salesOrders.ts:1807` |
| | `POST /api/v1/sales/orders/:id/fulfill` | `routes/salesOrders.ts:1866` |
| | `POST /api/v1/sales/orders/:id/deliver` | `routes/salesOrders.ts:1961` |
| | `POST /api/v1/sales/orders/:id/deliver-with-returns` | `routes/salesOrders.ts:1333` |
| | `POST /api/v1/sales/orders/:id/return` | `routes/salesOrders.ts:1656` |
| `pages/sales/DeliveriesPage.tsx` | `GET /api/v1/sales/deliveries` | `routes/salesOrders.ts:583` |
| `pages/sales/PaymentsPage.tsx` | `POST /api/v1/sales/payments/proof-upload` | `routes/salesPayments.ts:91` |
| | `GET /api/v1/sales/payments` | `routes/salesPayments.ts:137` |
| | `POST /api/v1/sales/payments/:id/pay` | `routes/salesPayments.ts:219` |
| `pages/customers/CustomersPage.tsx` | `GET /api/v1/customers` | `routes/customers.ts:278` |
| | `GET /api/v1/customers/:id` | `routes/customers.ts:342` |
| | `POST /api/v1/customers` | `routes/customers.ts:178` |
| | `PATCH /api/v1/customers/:id` | `routes/customers.ts:392` |
| | `GET /api/v1/customers/branch-cities` | `routes/customers.ts:147` |

### 3.5 Reportes

| Frontend | Backend | Archivo backend |
|---|---|---|
| `pages/reports/SalesReportsPage.tsx` | `GET /api/v1/reports/sales/summary` | `routes/reports.ts:353` |
| | `GET /api/v1/reports/sales/by-customer` | `routes/reports.ts:423` |
| | `GET /api/v1/reports/sales/by-city` | `routes/reports.ts:497` |
| | `GET /api/v1/reports/sales/funnel` | `routes/reports.ts:569` |
| | `GET /api/v1/reports/sales/by-month` | `routes/reports.ts:695` |
| | `GET /api/v1/reports/sales/margins` | `routes/reports.ts:766` |
| | `GET /api/v1/reports/sales/top-products` | `routes/reports.ts:1295` |
| | `GET /api/v1/reports/sales/top-products-by-presentation` | `routes/reports.ts:1367` |
| | `POST /api/v1/reports/sales/email` | `routes/reports.ts:1104` |
| | `GET /api/v1/reports/sales/schedules` | `routes/reports.ts:1131` |
| | `POST /api/v1/reports/sales/schedules` | `routes/reports.ts:1162` |
| | `PATCH /api/v1/reports/sales/schedules/:id` | `routes/reports.ts:1218` |
| | `DELETE /api/v1/reports/sales/schedules/:id` | `routes/reports.ts:1280` |
| `pages/reports/StockReportsPage.tsx` | `GET /api/v1/reports/stock/balances-expanded` | `routes/reports.ts:1436` |
| | `GET /api/v1/reports/stock/inputs-by-product` | `routes/reports.ts:1527` |
| | `GET /api/v1/reports/stock/existencias` | `routes/reports.ts:1570` |
| | `GET /api/v1/reports/stock/transfers-between-warehouses` | `routes/reports.ts:1851` |
| | `GET /api/v1/reports/stock/low-stock` | `routes/reports.ts:863` |
| | `GET /api/v1/reports/stock/expiry-alerts` | `routes/reports.ts:938` |
| | `GET /api/v1/reports/stock/rotation` | `routes/reports.ts:1005` |
| | `GET /api/v1/reports/stock/movements-expanded` | `routes/reports.ts:2672` |
| | `GET /api/v1/reports/stock/movement-requests/by-city` | `routes/reports.ts:1954` |
| | `GET /api/v1/reports/stock/movement-requests/flows` | `routes/reports.ts:2004` |
| | `GET /api/v1/reports/stock/movement-requests/fulfilled` | `routes/reports.ts:2121` |
| | `GET /api/v1/reports/stock/movement-requests/:id/trace` | `routes/reports.ts:2227` |
| | `GET /api/v1/reports/stock/movement-requests/summary` | `routes/reports.ts:1901` |
| | `GET /api/v1/reports/stock/returns/summary` | `routes/reports.ts:2396` |
| | `GET /api/v1/reports/stock/returns/by-warehouse` | `routes/reports.ts:2434` |
| | `POST /api/v1/reports/stock/email` | `routes/reports.ts:2481` |
| | `GET /api/v1/reports/stock/schedules` | `routes/reports.ts:2508` |
| | `POST /api/v1/reports/stock/schedules` | `routes/reports.ts:2539` |
| | `PATCH /api/v1/reports/stock/schedules/:id` | `routes/reports.ts:2596` |
| | `DELETE /api/v1/reports/stock/schedules/:id` | `routes/reports.ts:2658` |
| | `GET /api/v1/reports/stock/provider-activity` | `routes/reports.ts:2774` |
| | `GET /api/v1/reports/stock/sales-branch-activity` | `routes/reports.ts:2866` |
| `pages/DashboardPage.tsx` | `GET /api/v1/dashboards/executive-summary` | `routes/dashboards.ts:10` |

> **Nota de filtrado de fechas**: los reportes que aceptan `from` / `to` usan semántica de rango hábil: `from` es inclusive (`>=`), `to` es exclusivo (`<`). Para reportar un mes completo (ej. julio), enviar `from=2026-07-01` y `to=2026-08-01`. Si `from`/`to` son omáltos (null), no se filtra por fecha.
| `pages/stock/InventoryPage.tsx` (ver stock) | `GET /api/v1/reports/stock/balances-expanded?warehouseId=...` | `routes/reports.ts:1436` |

### 3.6 Auditoría

| Frontend | Backend | Archivo backend |
|---|---|---|
| `pages/admin/AuditPage.tsx` | `GET /api/v1/audit/events` | `routes/audit.ts:56` |
| | `GET /api/v1/audit/events/:id` | `routes/audit.ts:140` |

### 3.7 Notificaciones

| Frontend | Backend | Archivo backend |
|---|---|---|
| `components/NotificationsBell` | `GET /api/v1/notifications` | `routes/notifications.ts:37` |
| | `POST /api/v1/notifications/mark-all-read` | `routes/notifications.ts:103` |

### 3.8 Subida de archivos (S3 presigned)

| Frontend | Backend | Archivo backend |
|---|---|---|
| `components/ProductPhotoUploader` | `POST /api/v1/products/:id/photo-upload` | `routes/products.ts:1098` |
| `components/ImageUpload.tsx` (pago) | `POST /api/v1/sales/payments/proof-upload` | `routes/salesPayments.ts:91` |
| `components/ImageUpload.tsx` (devolución) | `POST /api/v1/stock/returns/photo-upload` | `routes/stock.ts:471` |
| `admin/BrandingPage.tsx` | `POST /api/v1/admin/tenant/branding/logo-upload` | `routes/tenant.ts:298` |

### 3.9 Laboratorio

| Frontend | Backend | Archivo backend |
|---|---|---|
| `pages/laboratory/*` | `/api/v1/laboratories`, `/api/v1/laboratory/supplies`, `/api/v1/laboratory/receipts`, `/api/v1/laboratory/production-requests`, `/api/v1/laboratory/production-runs`, `/api/v1/laboratory/batches/:batchId/release`, etc. | `routes/laboratory.ts` |

---

## 4. Modelos de datos clave (Prisma)

| Modelo | Relación clave | Uso principal |
|---|---|---|
| `Tenant` | `users`, `roles`, `modules`, `domains` | Aislamiento multi-tenant + branding + suscripción |
| `User` | `tenant`, `roles (UserRole)`, `warehouse` | RBAC + scope branch |
| `Role` / `Permission` / `RolePermission` | N:M | Sistema de permisos |
| `Product` | `batches`, `presentations`, `recipe`, `balances` | Catálogo |
| `ProductPresentation` | `product` | Unidad de medida estructurada (unique: tenantId+productId+name+unitsPerPresentation) |
| `Batch` | `product`, `presentation`, `balances` | Lotes con vencimiento (FEFO) |
| `Warehouse` | `locations`, `users` | Almacén/sucursal |
| `Location` | `warehouse`, `balances` | Ubicación física (BIN/SHELF/FLOOR/SUB_ALMACEN) |
| `InventoryBalance` | `location`, `product`, `batch` | Stock por ubicación-lote |
| `StockMovement` | `product`, `batch`, `presentation`, `from/toLocation` | IN/OUT/TRANSFER/ADJUSTMENT (numerado MSYYYY-N) |
| `StockMovementRequest` | `warehouse`, `toLocation`, `items` | Solicitudes con código SOLYY#### + estado OPEN/SENT/FULFILLED/CANCELLED |
| `StockReturn` | `toLocation`, `items` | Devoluciones + IN movimientos |
| `SalesOrder` | `customer`, `quote`, `lines`, `reservations` | Órdenes de venta (DRAFT/CONFIRMED/FULFILLED/CANCELLED) |
| `SalesOrderLine` | `salesOrder`, `product`, `batch`, `presentation` | Líneas de orden |
| `SalesOrderReservation` | `balance` | Stock reservado |
| `Quote` | `customer`, `lines` | Cotizaciones (CREATED/PROCESSED) |
| `AuditEvent` | — | Append-only auditoría GxP |
| `TenantSequence` | — | Secuenciación por tenant+año |
| `Notification` | — | Campana de notificaciones |

---

## 5. Reglas de negocio críticas

1. **Multi-tenant**: todas las queries filtran por `tenantId`. El `request.auth` incluye `tenantId`, `userId`, `permissions`, `isTenantAdmin`, `warehouseId`, `warehouseCity`.
2. **ScopeBranch**: usuarios con `Permissions.ScopeBranch` solo pueden ver/editar **su propia sucursal**. En reportes de stock (`/api/v1/reports/stock/*`) el backend fuerza el `warehouseId` al almacén propio del usuario (`resolveBranchWarehouseId`); los admins sin scope de sucursal conservan el selector "Sucursal" (vacío = todas). `TENANT_ADMIN` y platform admin no se ven afectados. En inventario, un usuario con scope de sucursal solo puede **editar** (ubicación/estado de lote) su propio almacén (`canEditWarehouse`); el resto de almacenes se muestra en solo lectura (UI) y el backend rechaza `403` ADJUSTMENT/IN hacia almacenes ajenos. El rol `BRANCH_PROVIDER` (almacén tipo `PROVIDER`) ve TODAS las solicitudes de transferencia sin filtro de ciudad (operación) pero solo edita/solo ve su propio almacén en reportes.
3. **Optimistic locking**: `version` en `Product`, `Batch`, `Tenant`, `TenantModule`, `Role`, `User`, etc. Retorna `409` si no coincide.
4. **FEFO**: los movimientos `OUT`/`TRANSFER` priorizan lotes con `expiresAt` más próximo. Se bloquean movimientos de lotes vencidos.
5. **Presentaciones**: las cantidades en UI se expresan en presentación (cajas); el backend convierte a unidades base usando `unitsPerPresentation`.
6. **S3 opcional**: si no se configuran las env vars S3, el sistema funciona excepto uploads de fotos/logos.
7. **Estado `SENT`**: las solicitudes de movimiento pasan por `SENT` (enviado) antes de `FULFILLED` (recibido).

---

## 6. Eventos realtime (Socket.io)

| Evento | Condición |
|---|---|
| `stock.movement.created` | Nuevo movimiento de stock |
| `stock.balance.changed` | Balance actualizado |
| `stock.alert.low` | Balance llega a 0 |
| `sales.order.confirmed` | Orden confirmada |
| `sales.order.delivered` | Orden marcada como entregada |
| `sales.order.paid` | Orden totalmente pagada |
