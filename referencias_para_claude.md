# Referencias para Claude Sonnet 4.5 — UI/UX PharmaFlow Bolivia (farmaSNT)

Este documento es un “handoff” para que Claude pueda construir **todas las interfaces visuales** del frontend **sin tocar la lógica del backend** ni romper multi‑tenant por dominio.

## 1) Objetivo

Construir una SPA completa (React/Vite/Tailwind) para operar el MVP:
- Multi‑tenant (single DB con `tenantId`), resolución por **dominio**.
- Módulos: **Almacén (WAREHOUSE)**, **Ventas B2B (SALES)**.
- Auditoría GxP-friendly (append‑only) + visor.
- Control de vencimientos por lote (semáforo) + FEFO.
- Administración: roles/usuarios/permisos, branding por tenant.
- Plataforma: provisioning de tenants y dominios.

**Restricción clave**: no inventar endpoints nuevos; la UI debe consumir los endpoints existentes.

---

## 2) Stack del repositorio (lo que ya existe)

### Backend
- Node.js + TypeScript (Fastify)
- Prisma + PostgreSQL
- Socket.io para eventos realtime
- RBAC por permisos

### Frontend
- React + Vite + TypeScript
- Tailwind
- TanStack Query
- React Router

### Puertos dev
- Backend: `http://127.0.0.1:6000`
- Frontend: `http://127.0.0.1:6001`

Vite hace proxy:
- `/api/*` → backend `:6000`
- `/socket.io/*` → backend `:6000`

---

## 3) Multi‑tenant por dominio (muy importante)

### Cómo se resuelve el tenant
- `POST /api/v1/auth/login` intenta resolver tenant por `Host`/`X-Forwarded-Host` usando `TenantDomain` **solo si está verificado**.
- Si un email existe en múltiples tenants y no hay dominio resoluble, responde `409` (ambigüedad).

### Branding antes del login
- Para que la pantalla de login “sea de Febsa” (logo/colores) antes de autenticar:
  - `GET /api/v1/public/tenant/branding` (sin JWT) resuelve branding por `Host`.

### Dev local con dominios
En Windows, editar `C:\Windows\System32\drivers\etc\hosts` (como admin), ejemplo:
```
127.0.0.1 farmacia.supernovatel.com
127.0.0.1 farmacia.febsa.com
```
Luego abrir:
- `http://farmacia.supernovatel.com:6001`
- `http://farmacia.febsa.com:6001`

---

## 4) Diseño/tema (no inventar colores)

- El tema se maneja con variables CSS:
  - `--pf-primary`, `--pf-secondary`, `--pf-tertiary`
- Modo oscuro: `dark` class (Tailwind `darkMode: 'class'`).
- El header ya muestra logo si hay `tenant.branding.logoUrl`.

**Regla**: usar Tailwind con tokens tipo `slate-*` y las vars `--pf-*` para acentos; evitar hardcodear paletas nuevas.

---

## 5) Arquitectura actual del frontend (para refactor)

Hoy el MVP está concentrado en `frontend/src/App.tsx` y se monta con rutas simples en `frontend/src/AppRouter.tsx`.

Providers ya existentes:
- `AuthProvider` (token JWT + refresh)
- `TenantProvider` (branding por host y por JWT)
- `ThemeProvider` (dark/light)

Helpers:
- `frontend/src/lib/api.ts` → `apiFetch()` + base URL (same-origin por defecto)
- `frontend/src/lib/socket.ts` → conecta Socket.io usando `auth: { token }`

Claude puede (recomendado) refactorizar a páginas/componentes:
- Crear `frontend/src/pages/*` y `frontend/src/components/*`
- Migrar el router a rutas reales (sin cambiar el backend)

---

## 6) Mapa de pantallas a construir (UI completa)

### 6.1 Autenticación
- **Login**
  - Branding visible (logo + nombre) por `GET /api/v1/public/tenant/branding`
  - Form email/password
  - Manejo de errores `401`, `409`
- **Logout**

### 6.2 Home / Dashboard
- Health status (`GET /api/v1/health`)
- Estado de socket y feed de eventos (mínimo)

### 6.3 Catálogo
- Buscador rápido (`GET /api/v1/catalog/search?q=...`)
- Productos
  - Lista con paginación
  - Crear/editar
  - Detalle
- Lotes (batches)
  - Crear lote para producto (`POST /api/v1/products/:id/batches`)
  - Mostrar `expiresAt` y status

### 6.4 Almacén
- Warehouses
  - Lista (`GET /api/v1/warehouses`)
  - Ver locations por warehouse (`GET /api/v1/warehouses/:id/locations`)
- Stock
  - Balances (básico) `GET /api/v1/stock/balances`
  - Movimientos:
    - Crear movimiento `POST /api/v1/stock/movements`
    - Listados “expanded” vía reportes (ver 6.7)

### 6.5 Vencimientos (Expiry)
- Dashboard semáforo por lote:
  - `GET /api/v1/stock/expiry/summary` con filtros (warehouse/status/take/cursor)
- FEFO suggestions:
  - `GET /api/v1/stock/fefo-suggestions?productId=...&locationId=...` (o `warehouseId`)

### 6.6 Ventas B2B
- Customers (CRUD mínimo)
- Sales Orders
  - Lista
  - Crear draft con líneas
  - Confirm
  - Fulfill

Notas FEFO en fulfill:
- Si una línea viene con `batchId: null`, el backend intenta **auto‑seleccionar** lote por FEFO en `fromLocationId` con stock suficiente y no vencido.
- UI recomendada:
  - Permitir “Auto (FEFO)” como opción por defecto
  - Mostrar el batch finalmente usado (el backend devuelve movimientos y balances)

### 6.7 Reportes
- Ventas:
  - Resumen diario
  - Top productos
- Stock:
  - Balances expanded
  - Movimientos expanded

### 6.8 Auditoría
- Lista + filtros (`GET /api/v1/audit/events`)
- Detalle (`GET /api/v1/audit/events/:id`)

### 6.9 Administración (Tenant)
- Permissions (solo lectura)
- Roles
- Users
- Branding
  - Ver branding
  - Subir logo (presigned PUT)

### 6.10 Plataforma (Platform Admin)
- Tenants provisioning
- Dominios por tenant
  - Registrar
  - Verificar (flow de token en `/.well-known/pharmaflow-domain-verification`)

---

## 7) Endpoints (resumen práctico)

### Sin auth
- `GET /api/v1/health`
- `GET /api/v1/public/tenant/branding`
- `GET /.well-known/pharmaflow-domain-verification`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`

### Con JWT (tenant)
- Branding tenant: `GET /api/v1/tenant/branding`
- Catálogo: `GET /api/v1/catalog/search`
- Productos: `POST/GET/PATCH /api/v1/products*`
- Batches: `POST /api/v1/products/:id/batches`
- Warehouses/Locations: `GET /api/v1/warehouses*`
- Stock: `GET /api/v1/stock/balances`, `POST /api/v1/stock/movements`
- Vencimientos/FEFO: `GET /api/v1/stock/expiry/summary`, `GET /api/v1/stock/fefo-suggestions`
- Customers: `/api/v1/customers*`
- Sales Orders: `/api/v1/sales/orders*` (+ `/confirm`, `/fulfill`)
- Auditoría: `GET /api/v1/audit/events*`
- Admin (tenant): `/api/v1/admin/*`
- Platform: `/api/v1/platform/*` (solo platform admins)

Referencia completa: ver `API_REFERENCE.md` y Swagger `GET /api/v1/docs`.

---

## 8) Convenciones de UX (recomendadas)

- Estados consistentes:
  - Loading, Empty, Error (con copy breve)
- Tablas:
  - Columnas clave, acciones por fila, paginación por cursor
- Formularios:
  - Validación básica, mostrar mensaje del backend (`data.message`)
- Permisos:
  - Si `403`, mostrar “No tienes permisos para esta acción” y ocultar botones de acción cuando falten permisos (si la UI tiene el set de permisos del token).

---

## 9) Datos seed útiles para probar

Credenciales (seed):
- `admin@demo.local` / `Admin123!`

Dataset vencimientos:
- Producto seed: `PARA-500TAB`
- Lotes: `LOT-EXPIRED` (vencido) y `LOT-YELLOW` (vence en ~60 días)

---

## 10) No romper

- No cambiar contratos de endpoints ni shapes sin coordinar.
- No romper el proxy/puertos dev.
- Respetar multi‑tenant por dominio: siempre probar en `farmacia.<tenant>.com:6001` con `hosts`.
