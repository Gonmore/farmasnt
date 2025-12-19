# Bitácora de desarrollo — PharmaFlow Bolivia (farmaSNT)

Este documento resume (a alto nivel) decisiones, hitos y cambios relevantes que se fueron incorporando al repositorio para llegar al estado actual del MVP.

## Objetivo del producto
SaaS **multi-tenant** con **single DB** (row-level `tenantId`), backend Node.js/TypeScript (estilo Clean/Hex), frontend React/Vite/Tailwind/TanStack Query, PostgreSQL, **auditoría GxP-friendly inmutable** (append-only), **Socket.io** para eventos en tiempo real, **RBAC** estricto por permisos, y búsqueda rápida.

## Hitos principales

### 1) Base técnica y estructura
- Backend en `backend/`:
  - Fastify + TypeScript (ESM).
  - Prisma + PostgreSQL.
  - Organización por adaptadores: HTTP, DB, realtime; y lógica de aplicación en `src/application/*`.
- Frontend en `frontend/`:
  - React + Vite + TS.
  - Tailwind v3.
  - TanStack Query para fetching y cache.

### 2) Multi-tenant
- Todas las entidades operativas se diseñaron para operar con `tenantId` (aislamiento lógico por fila).
- La autenticación adjunta `request.auth` con `tenantId` + `userId` + `permissions`, y se aplica como base para guards.

### 3) Seguridad: Auth + RBAC
- Auth JWT (access token) + refresh token rotativo (refresh opaco hasheado en DB).
- RBAC por permisos (ej.: `catalog:read`, `stock:move`, etc.).
- Guard adicional por **módulo habilitado** para el tenant (ej.: `WAREHOUSE`, `SALES`) donde aplica.

### 4) Dominio MVP: Almacén + Ventas B2B
- Catálogo y productos:
  - ABM de productos (create/list/get/update) y batches (create).
  - Optimistic locking por `version` en updates.
- Stock:
  - Balances por `(tenantId, locationId, productId, batchId)`.
  - Movimientos `IN/OUT/TRANSFER/ADJUSTMENT` con transacción y locks para evitar carreras.
  - Emisión de eventos realtime (movement created, balance changed, low-stock simple).
- Warehouses/Locations:
  - Listado de warehouses.
  - Listado de locations por warehouse.
- Customers:
  - ABM (create/list/get/update) con optimistic locking.
- Sales Orders:
  - Create draft con líneas.
  - Confirm.
  - Fulfill (descuenta stock + genera movimientos OUT por línea y emite eventos).

### 5) Auditoría GxP-friendly (append-only)
- Tabla `AuditEvent` para registrar eventos relevantes (actor, acción, entidad, before/after/metadata).
- Se incorporó endurecimiento para bloquear `UPDATE/DELETE` y mantener la auditoría como **append-only**.
- Se expuso un read-side de auditoría con filtros y paginación para navegación operativa.

### 6) Administración (multirol)
- Endpoints protegidos para:
  - Listar permisos.
  - Listar/crear roles.
  - Reemplazar permisos de un rol.
  - Listar/crear usuarios.
  - Reemplazar roles de un usuario.

### 7) Contratos / OpenAPI
- Swagger UI y OpenAPI JSON:
  - Swagger UI en `/api/v1/docs`.
  - OpenAPI JSON en `/api/v1/openapi.json`.
  - Bearer auth documentado en `components.securitySchemes`.

### 8) Conectividad y ergonomía local
- Se incorporó `docker-compose.yml` para Postgres local.
- Se ajustó CORS para tolerar `localhost` y `127.0.0.1` (mitiga problemas típicos IPv6/localhost en Windows).
- El frontend se alineó para usar `127.0.0.1` como default de API/WS en desarrollo.

## Estado actual del MVP
- Backend: endpoints operativos para auth, catálogo/búsqueda, productos, stock, warehouses/locations, customers, sales orders, admin y audit.
- Frontend: UI operable de validación (incluye administración y auditoría), y conexión realtime.

## Reportes (Phase 1)
Se incorporaron endpoints read-only de reportes para acelerar dashboards y pantallas operativas sin exigir múltiples llamadas y joins en el frontend.
- Ventas: resumen diario y top productos.
- Stock: balances “expanded” (con joins a warehouse/location/product/batch) y movimientos “expanded” (con metadata de ubicaciones).

## Tenant Branding (logos + colores + tema)
- Se decidió usar **object storage S3-compatible** para logos (y futuros adjuntos/exportaciones), evitando acoplarse a AWS.
- Flujo: el backend genera **presigned URL** (PUT) y el frontend sube directo al storage; luego se guarda `logoUrl` en `Tenant`.
- Los logos pueden ser **públicos** (URL directa) usando `S3_PUBLIC_BASE_URL`.
- Para dev/local se añadió soporte de MinIO en `docker-compose.yml` (si Docker está disponible).

## Branding por tenant + tema (Steps 3 y 4)
- Se añadieron campos de branding al modelo `Tenant`:
  - `logoUrl`, `brandPrimary`, `brandSecondary`, `brandTertiary`, `defaultTheme`.
- Se implementó soporte de upload de logo vía S3-compatible usando URL presignada (flujo: `POST presign` → `PUT uploadUrl` → `PUT branding`).
- El frontend carga branding del tenant y aplica variables CSS (`--pf-primary/secondary/tertiary`) para que el tema sea configurable.
- Se habilitó modo oscuro/claro con `darkMode: 'class'` y un toggle persistido en `localStorage`, con fallback al `defaultTheme` del tenant.

## Rutas reales (Step 5)
- Se migró el panel de Administración a rutas reales sin cambiar la UX base:
  - Home: `/`
  - Admin: `/admin/:tab` (roles/users/permissions/audit/reports/branding)

## Provisioning real (Platform → Tenant)
- Se incorporó un flujo para que un usuario “platform admin” cree tenants desde la plataforma:
  - Crea `Tenant` + módulos default + rol `TENANT_ADMIN` + usuario admin inicial.
  - Modela “sucursales” iniciales como `Warehouse` (`BR-01..`) con `BIN-01`.
- Se añadió `branchLimit` en `Tenant` como base de monetización por cantidad de sucursales.

## Dominios por tenant (futuro habilitado, seguro)
- Se añadió el modelo `TenantDomain` para mapear `domain -> tenantId`.
- Login por `Host`:
  - El backend puede inferir el tenant en `/auth/login` por `Host`/`X-Forwarded-Host`.
  - Para seguridad, solo se aceptan dominios **verificados**.
  - Si un email existe en múltiples tenants y no hay dominio resoluble, el login responde conflicto (evita seleccionar tenant incorrecto).

## Verificación de dominio (base HTTP-file)
- Para habilitar dominios de clientes de forma controlada, se preparó un mecanismo de verificación por token:
  - La plataforma registra un dominio y genera token temporal.
  - El backend expone el token por `/.well-known/pharmaflow-domain-verification` (según `Host`).
  - La plataforma puede verificar automáticamente (server-side) y marcar `verifiedAt`.

## Ergonomía de entorno (dev)
- Se ajustó la validación de variables de entorno para que S3 sea verdaderamente opcional:
  - Valores vacíos se tratan como “no configurado” (evita bloquear el arranque del backend).
- En el frontend, se favoreció “same-origin” para facilitar pruebas con dominios via `hosts` usando el proxy de Vite.

## Próximos pasos sugeridos (roadmap corto)
- Completar contratos OpenAPI para todas las rutas (hoy Admin/Audit están más completos).
- Agregar read-sides/reportes (agregaciones) típicos: ventas por período, kardex, stock por almacén/ubicación, top productos/clientes, etc.
- Exportaciones (CSV) y/o endpoints de descarga para auditoría/reportes (si se necesita).
