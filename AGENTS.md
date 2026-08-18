# AGENTS.md — PharmaFlow Bolivia (farmaSNT)

> Instrucciones para agentes de IA. Carga este archivo como contexto inicial antes de trabajar en el repo.

## Resumen del proyecto
FarmaSNT es una plataforma de gestión farmacéutica multi-tenant (Bolivia) con backend Node.js + Fastify + Prisma (PostgreSQL) y frontend React + Vite + Tailwind.

- Base URL dev: `http://127.0.0.1:6000`
- Deploy manual via `deploy.sh` al servidor remoto `192.168.10.57`
- Documentación: `@ARCHITECTURE.md`, `@API_REFERENCE.md`, `@bitacora.md`

## Comandos esenciales

### Backend
```bash
cd backend
npm run build          # TypeScript → dist/
npm run dev            # modo desarrollo con nodemon
npx tsc --noEmit       # typecheck sin build
npx prisma generate    # regenerar cliente Prisma
npx prisma migrate deploy  # aplicar migraciones (usar en deploy)
npx prisma studio      # UI para inspeccionar DB
```

### Frontend
```bash
cd frontend
npm run build          # Vite build → dist/
npx tsc --noEmit       # typecheck
npm run dev            # servidor dev (Vite)
```

### Deploy
```bash
cd ..  # raíz del repo
bash deploy.sh
# - Build de imágenes Docker
# - Push a Docker Hub (gonmore14)
# - Pull en 192.168.10.57
# - npx prisma migrate deploy
# - docker compose up -d
```

## Estructura clave

### Backend (`backend/`)
- Rutas HTTP: `backend/src/adapters/http/routes/*.ts`
  - `products.ts`    — CRUD productos, batches, presentaciones, recipe, kardex
  - `stock.ts`       — Movimientos, balances, movement-requests, returns, repack
  - `reports.ts`     — Reportes read-only (sales, stock)
  - `warehouses.ts`  — CRUD warehouses/locations
  - `auth.ts`        — Login, refresh, switch-tenant, /me
  - `salesOrders.ts` — Quotes, Orders, Deliveries
  - `salesQuotes.ts` — Cotizaciones
  - `salesPayments.ts` — Pagos
  - `laboratory.ts`  — Módulo LABORATORY
  - `admin.ts`       — RBAC: usuarios, roles, permisos
  - `platform.ts`    — Provisioning de tenants
  - `tenant.ts`      — Branding + suscripción
  - `audit.ts`       — Read-side de auditoría
  - `notifications.ts`
  - `dashboards.ts`
- Servicios: `backend/src/application/stock/stockMovementService.ts` (transaccional IN/OUT/TRANSFER/ADJUSTMENT)
- Seguridad: `backend/src/application/security/rbac.ts`, `permissions.ts`
- Auditoría: `backend/src/application/audit/auditService.ts`

### Frontend (`frontend/src/`)
- Hooks: `usePermissions.ts` (→ `GET /api/v1/auth/me`), `useAuth.ts`, `useNavigation.ts`, `useTenant.ts`
- API: `lib/api.ts` (Axios instance + apiFetch)
- Componentes reutilizables: `components/common/` (Modal, Button, Input, etc.)
- Páginas clave:
  - `pages/stock/InventoryPage.tsx` — kardex, balances-expanded, vista "Por Producto" y "Por Sucursal"
  - `pages/stock/ReturnsPage.tsx` — Recepción/Devolución unificada
  - `pages/stock/MovementsPage.tsx` — Lista y creación de solicitudes
  - `pages/stock/CompletedMovementsPage.tsx` — Historial
  - `pages/stock/MovementRequestsTraceabilityPage.tsx` — Trazabilidad
  - `pages/reports/StockReportsPage.tsx` — Reportes de stock
  - `pages/reports/SalesReportsPage.tsx` — Reportes de ventas
  - `pages/catalog/ProductDetailPage.tsx` — Detalle/lotes de producto
  - `pages/sales/QuoteDetailPage.tsx` — Cotizaciones
  - `pages/sales/OrdersPage.tsx` — Órdenes de venta

## Convenciones

### Backend
- Fastify con Zod para validación de schemas
- Prisma como ORM (singleton `backend/src/db/prisma.ts`)
- Multi-tenant: todas las queries filtran por `tenantId`
- JWT access token + refresh token opaco hasheado
- AuditEvent append-only (GxP-friendly) — `action: 'stock.movement.create'`
- Secuencias por tenant+año: `TenantSequence` (MSYYYY-N, SOLYY####, COT-YYYY####)
- Control de concurrencia optimista con `version` → `409` si no coincide
- FEFO: prioriza lotes con `expiresAt` más próximo; bloquea movimientos de lotes vencidos
- `request.auth` incluye: `tenantId`, `userId`, `permissions`, `isTenantAdmin`, `warehouseId`, `warehouseCity`, `warehouseType`

### Frontend
- React + TypeScript + TanStack Query + Axios
- Tailwind CSS v3 + CSS variables de branding
- Formateo numérico con `thousandSeparator` por tenant
- Orden alfabético por nombre en catálogo e inventario
- Formato `Warehouse:Location` (código sin prefijo `SUC-` + ubicación) en origen/destino
- Fechas: `from` inclusivo, `to` exclusivo (para reportar un mes completo usar primer día del mes siguiente)

## Reglas de negocio críticas
1. **Multi-tenant**: todas las queries filtran por `tenantId`
2. **ScopeBranch**: usuarios con `scope:branch` ven/editan solo su propia sucursal en reportes; `resolveBranchWarehouseId` fuerza el `warehouseId`
3. **BRANCH_PROVIDER** (almacén tipo `PROVIDER`): ve todas las solicitudes sin filtro de ciudad a nivel operativo, pero en reportes solo su propio almacén
4. **WarehouseType**: solo warehouses tipo `PROVIDER` pueden crear lotes y ajustar stock; `SALES` solo recibe por transferencias
5. **Optimistic locking**: `version` en entidades clave → `409`
6. **FEFO**: lotes con `expiresAt` más próximo primero
7. **S3 opcional**: si no está configurado, el sistema funciona excepto uploads

## Debug rápido
- Swagger UI: `GET /api/v1/docs` (Base URL: `http://127.0.0.1:6000`)
- OpenAPI JSON: `GET /api/v1/openapi.json`
- Health: `GET /api/v1/health`
- Login: `admin@demo.local` / `Admin123!`

## Flujo de trabajo y convenciones de edición

### Entorno de desarrollo
- **Editor**: VS Code en Windows
- **Docker local**: `docker-compose.local.yml` para desarrollo
- **Producción**: servidor `192.168.10.57` via `deploy.sh`
- **Build de deploy**: `bash deploy.sh` (raíz del repo) — construye Docker images, push a Docker Hub (`gonmore14`), pull en servidor, corre `prisma migrate deploy`, reinicia con `docker compose up -d`

### Convenciones de edición de código
- **Usar herramientas de edición estructurada** (edit/grep/read), no reescribir archivos completos a menos que sea estrictamente necesario
- **Ediciones focalizadas**: realizar `diffs/edits` objetivo, nunca reescribir archivos grandes sin necesidad
- **TypeScript estricto**: siempre verificar `npx tsc --noEmit` en backend y frontend después de cambios
- **Docker build**: verificar que compila con `docker build` tras cambios significativos
- **Migraciones**: crear migración Prisma solo si hay cambios en el schema (`backend/prisma/schema.prisma`); `deploy.sh` aplica migraciones vía `prisma migrate deploy`
- **Testing**: no usar comandos de test a menos que el repo los defina; este proyecto no tiene suite de tests automatizados

### Reglas críticas de negocio
1. **Multi-tenant**: todas las queries filtran por `tenantId`
2. **ScopeBranch**: usuarios con `scope:branch` ven/editan solo su propia sucursal en reportes; `resolveBranchWarehouseId` fuerza el `warehouseId`
3. **BRANCH_PROVIDER** (almacén tipo `PROVIDER`): ve todas las solicitudes sin filtro de ciudad a nivel operativo, pero en reportes solo su propio almacén
4. **WarehouseType**: solo warehouses tipo `PROVIDER` pueden crear lotes y ajustar stock; `SALES` solo recibe por transferencias
5. **Optimistic locking**: `version` en entidades clave → `409`
6. **FEFO**: lotes con `expiresAt` más próximo primero
7. **S3 opcional**: si no está configurado, el sistema funciona excepto uploads
