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
- Backend: endpoints operativos para auth, catálogo/búsqueda, productos, batches, stock, warehouses/locations, customers, sales orders, admin, audit, y read-sides de reportes.
- Frontend: UI operable para validación (home/login, administración, auditoría, reportes), conexión realtime, y dashboard de vencimientos.

## Reportes (Phase 1)
Se incorporaron endpoints read-only de reportes para acelerar dashboards y pantallas operativas sin exigir múltiples llamadas y joins en el frontend.
- Ventas: resumen diario y top productos.
- Stock: balances “expanded” (con joins a warehouse/location/product/batch) y movimientos “expanded” (con metadata de ubicaciones).
- Vencimientos: read-side de alertas por lote con semáforo (EXPIRED/RED/YELLOW/GREEN) y soporte de FEFO.

## Vencimientos (expiry) + FEFO (operación segura)
- Se incorporó control de vencimientos por lote (`Batch.expiresAt`) con semáforo de alertas (cálculo por inicio de día UTC).
- Se agregaron endpoints:
  - `GET /api/v1/stock/expiry/summary` (alertas + paginación + filtros).
  - `GET /api/v1/stock/fefo-suggestions` (sugerencias FEFO por ubicación o warehouse).
- Reglas de negocio (bloqueos):
  - Se bloquean movimientos de stock que reduzcan cantidad (`OUT/TRANSFER/ADJUSTMENT negativo`) si el lote está vencido.
  - Se bloquea fulfillment de ventas si el lote explícito está vencido.
  - Se registra auditoría `stock.expiry.blocked` cuando aplica.
- FEFO auto-pick en fulfillment:
  - Si una línea viene con `batchId: null`, el backend intenta auto-seleccionar (FEFO) un lote no vencido con stock suficiente en `fromLocationId`.

## Branding “pre-login” por dominio
- Para dominios por tenant, se habilitó cargar branding sin sesión (logo/colores/tema) en base al `Host`.
  - Endpoint: `GET /api/v1/public/tenant/branding`.
  - El frontend lo usa para pintar la pantalla de login con el logo/nombre del tenant.

## Handoff para UI completa
- Se dejó `referencias_para_claude.md` con el mapa de pantallas + endpoints + consideraciones multi-tenant, para acelerar la construcción de interfaces visuales.

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

---

## **[13 Ene 2026] Cotizaciones persistentes + lugar de entrega + órdenes solo desde cotización**

### Cotizaciones (Quotes) como origen obligatorio
- Se incorporó el flujo **cotización → procesar → orden** como regla de negocio.
- Backend:
  - Se agregó el modelo de **cotización** con correlativo `COT-YYYY####` generado en backend al guardar.
  - Se agregó estado de cotización: `CREATED` / `PROCESSED`.
  - Al procesar una cotización, se crea una orden y la cotización queda **read-only**.
  - Se bloqueó la creación directa de órdenes (`POST /api/v1/sales/orders` responde 400) para forzar el origen en cotización.

### Lugar de entrega (con mapa)
- Se añadieron campos de entrega en cotización:
  - `deliveryCity`, `deliveryZone`, `deliveryAddress`, `deliveryMapsUrl`.
- UX:
  - Por defecto toma la ubicación del cliente final.
  - Permite seleccionar otra ubicación en el mapa (click) y se completa dirección vía reverse geocoding.

### Autor y auditoría funcional
- Se incorporó `quotedBy` (displayName del usuario creador) y se muestra:
  - en la lista de cotizaciones,
  - en el detalle,
  - y en el PDF (“Cotizado por”).

### PDF (robustez)
- Se corrigieron caracteres extraños/corrupción en PDFs (jsPDF) sanitizando texto a ASCII al escribir.

### Frontend: UX y pantallas
- Catálogo vendedor:
  - Se mantiene el flujo de selección de productos y edición en modal.
  - Al guardar: se exporta PDF y se muestra feedback con `check.gif` / `dark_check.gif` según tema.
  - Luego se habilita el CTA verde **“Procesar pedido”** que llama al endpoint de procesamiento de cotización.
- Ventas:
  - Cotizaciones: lista con estado + autor; “Editar” deshabilitado si PROCESSED.
  - Detalle de cotización: muestra estado/autor/lugar de entrega y bloquea edición si PROCESSED.
  - Órdenes: se removió “Crear Orden” desde UI y se añadió **detalle de orden** para `/sales/orders/:id`.

---

## **[05 Ene 2026] Operación por existencias (stock por almacén) + mejoras UX**

### Almacenes: ver stock y mover
- Se ajustó la UI de Almacenes para priorizar el stock real por producto/lote/ubicación.
- Se agregó acción **"Ver stock"** por almacén para listar existencias usando el reporte `GET /api/v1/reports/stock/balances-expanded?warehouseId=...`.
- Desde cada registro de stock se habilitó **"Mover"** (TRANSFER) solicitando solo cantidad y destino (almacén/ubicación), tomando el origen desde la existencia seleccionada.

### UX: selects con una sola opción
- Se agregó auto-selección cuando solo existe una opción disponible (ej. un único producto o un único almacén), evitando que la UI quede bloqueada esperando un `onChange` que nunca ocurrirá.

---

## **[19 Dic 2025] Sistema de Administración Multi-nivel + Gestión de Suscripciones**

### **Contexto**
Se implementó un sistema completo de administración de dos niveles con gestión de suscripciones para el modelo SaaS:
- **Platform Admin (Supernovatel)**: Gestiona múltiples tenants desde un panel administrativo central
- **Tenant Admin (Clientes)**: Gestiona su propio tenant con personalización completa

### **Backend - Base de Datos y Permisos**

#### Schema Prisma ([backend/prisma/schema.prisma](backend/prisma/schema.prisma))
- Añadidos campos de gestión de suscripciones en modelo `Tenant`:
  - `contactName`, `contactEmail`, `contactPhone`: Datos de contacto para notificaciones
  - `subscriptionExpiresAt`: Fecha de expiración de suscripción (con índice)
  - `branchLimit`: Cantidad de sucursales contratadas (ya existía)

#### Seed Actualizado ([backend/prisma/seed.ts](backend/prisma/seed.ts))
- **Platform Tenant (Supernovatel)**:
  - ID: `00000000-0000-0000-0000-000000000001`
  - Rol: `PLATFORM_ADMIN` con TODOS los permisos (incluye `platform:tenants:manage`)
  - Usuarios: `admin@supernovatel.com`, `usuario1@supernovatel.com` / `Admin123!`
  - Dominio: `farmacia.supernovatel.com` (verificado)
  - Sin fecha de expiración (tenant especial)

- **Demo Tenant**:
  - ID: `00000000-0000-0000-0000-000000000002`
  - Rol: `TENANT_ADMIN` con todos los permisos EXCEPTO `platform:tenants:manage`
  - Usuario: `admin@demo.local` / `Admin123!`
  - Dominio: `demo.localhost`
  - Suscripción: 5 sucursales, expira en 1 año
  - Contacto: Administrador Demo (+591 71111111, admin@demo.local)

#### Endpoints Platform Admin ([backend/src/adapters/http/routes/platform.ts](backend/src/adapters/http/routes/platform.ts))
- `GET /api/v1/platform/tenants`: Listar todos los tenants con información de suscripción
  - Retorna: name, branchLimit, contactName, contactEmail, contactPhone, subscriptionExpiresAt, domains
  - Solo accesible con permiso `platform:tenants:manage`

- `POST /api/v1/platform/tenants`: Crear nuevo tenant
  - Campos requeridos: name, branchCount, adminEmail, adminPassword
  - Campos de contacto: contactName, contactEmail, contactPhone
  - Suscripción: subscriptionMonths (calcula expirationDate automáticamente)
  - Opcional: primaryDomain
  - Crea automáticamente: rol TENANT_ADMIN, usuario admin, warehouses por sucursal

#### Endpoints Tenant Subscription ([backend/src/adapters/http/routes/tenant.ts](backend/src/adapters/http/routes/tenant.ts))
- `GET /api/v1/tenant/subscription`: Ver información de suscripción propia
  - Retorna: branchLimit, activeBranches, subscriptionExpiresAt, status, daysRemaining
  - Status: 'active' (>90d), 'expiring_soon' (≤90d), 'expired' (<0d)
  - Accesible por cualquier usuario autenticado del tenant

- `POST /api/v1/tenant/subscription/request-extension`: Solicitar extensión de suscripción
  - Params: branchLimit (mantener/aumentar/reducir), subscriptionMonths
  - Genera mensaje para WhatsApp + Email al Platform Admin
  - TODO: Integrar envío real (actualmente retorna preview)

#### Endpoint Auth Me ([backend/src/adapters/http/routes/auth.ts](backend/src/adapters/http/routes/auth.ts))
- `GET /api/v1/auth/me`: Información completa del usuario autenticado
  - Retorna: user, tenant, roles[], permissions[], permissionCodes[]
  - Flag: isPlatformAdmin (true si tiene `platform:tenants:manage`)
  - Usado por frontend para filtrar navegación y permisos

### **Frontend - Hooks y Navegación**

#### Hook de Permisos ([frontend/src/hooks/usePermissions.ts](frontend/src/hooks/usePermissions.ts))
- Hook `usePermissions()` que consulta `/api/v1/auth/me` con cache de 5 minutos
- Expone:
  - `user`, `roles[]`, `permissions[]`, `permissionCodes[]`
  - Flags: `isPlatformAdmin`, `isTenantAdmin`
  - Helpers: `hasPermission(code)`, `hasAnyPermission(codes[])`, `hasAllPermissions(codes[])`

#### Navegación Filtrada ([frontend/src/hooks/useNavigation.ts](frontend/src/hooks/useNavigation.ts))
- Navegación dinámica según permisos del usuario:
  - **Platform Admin**: Solo ve Dashboard + "Plataforma > Tenants"
  - **Tenant Admin/Users**: Ven módulos según permisos:
    - Catálogo (si `catalog:read`)
    - Almacén (si `stock:read`)
    - Ventas (si `sales:order:read`)
    - Reportes (todos)
    - Sistema: Auditoría (si `audit:read`), Usuarios/Roles (si `admin:users:manage`), Branding (solo Tenant Admin)

### **Frontend - Páginas UI**

#### Platform Tenants Page ([frontend/src/pages/platform/TenantsPage.tsx](frontend/src/pages/platform/TenantsPage.tsx))
- Tabla completa de tenants con columnas:
  - Tenant (nombre + dominio)
  - Contacto (nombre, email, teléfono)
  - Sucursales (branchLimit)
  - Suscripción (badge de estado + fecha expiración + días restantes)
  - Estado (activo/inactivo)

- Modal "Crear Tenant" con form completo:
  - Información básica: nombre del tenant
  - Contacto: nombre, email, teléfono (WhatsApp)
  - Admin inicial: email, contraseña
  - Suscripción: cantidad sucursales (1-50), duración (3/6/12/24/36 meses)
  - Opcional: dominio principal

- Badges de estado suscripción:
  - Verde (success): >90 días restantes
  - Amarillo (warning): 30-90 días restantes
  - Rojo (danger): <30 días o expirado

#### Dashboard Tenant ([frontend/src/pages/DashboardPage.tsx](frontend/src/pages/DashboardPage.tsx))
- Widget de suscripción (solo visible para Tenant Admin/Users, NO Platform Admin):
  - Muestra sucursales usadas vs contratadas
  - Badge de estado (activo/por vencer/expirado)
  - Fecha de expiración + días restantes
  - Información de contacto de soporte
  - Botón "Solicitar Extensión" (solo Tenant Admin)

- Modal "Solicitar Extensión":
  - Selector: cantidad de sucursales (mantener/aumentar/reducir)

---

## **[22 Dic 2025] Fundaciones V2: numeración operativa + foto de producto + ingreso inicial de lote**

### **Numeración operativa (StockMovement)**
- Se añadió numeración por tenant+año para movimientos de stock:
  - Formato: `MSYYYY-N` (ej. `MS2025-251`).
  - Campos en `StockMovement`: `number`, `numberYear` (único por tenant).
- Se incorporó `TenantSequence` como contador atómico por `{ tenantId, year, key }`.
- Se refactorizó la creación de movimientos a un servicio transaccional para centralizar reglas y evitar duplicación.

### **Catálogo/Productos**
- Se agregó soporte de foto de producto (`photoUrl`, `photoKey`) en `Product`.
- Se implementó presign S3-compatible para subir foto de producto (PUT directo al storage) y persistir la URL en `Product`.
- Se desacopló Catálogo (search/productos/lotes) del “módulo `WAREHOUSE`” para evitar bloqueos por suscripción:
  - Catálogo se controla por permisos `catalog:*`.
  - `WAREHOUSE` queda para stock/warehouses/locations.

### **Lotes (Batch) con ingreso inicial**
- `POST /api/v1/products/:id/batches` soporta `initialStock` opcional.
- Si se envía, el backend crea un movimiento `IN` numerado y actualiza balances dentro de la misma transacción.

### **Frontend**
- Se añadió UI mínima para:
  - Subir/quitar foto de producto.
  - Crear lote con ingreso inicial (seleccionando warehouse + location).
  - Selector: tiempo de extensión (3/6/12/24/36 meses)
  - Preview del mensaje generado para Platform Admin
  - Envío de solicitud con confirmación visual

### **Infraestructura**

#### Axios Client ([frontend/src/lib/api.ts](frontend/src/lib/api.ts))
- Instancia de axios configurada con:
  - BaseURL automático (same-origin o VITE_API_BASE_URL)
  - Interceptor que inyecta token JWT automáticamente desde localStorage
  - Headers Content-Type application/json por defecto

### **Credenciales de Prueba**

```bash
# Platform Admin (Supernovatel)
Domain: farmacia.supernovatel.com:6001 o localhost:6001
Users:
  - admin@supernovatel.com / Admin123!
  - usuario1@supernovatel.com / Admin123!

# Demo Tenant
Domain: demo.localhost:6001 o localhost:6001
User: admin@demo.local / Admin123!
Subscription: 5 branches until Dec 18, 2026
Contact: Administrador Demo (+591 71111111)
```

### **Flujo de Uso**

#### Como Platform Admin:
1. Login en `farmacia.supernovatel.com:6001` o `localhost:6001`
2. Acceso a Dashboard + "Plataforma > Tenants"
3. Listar todos los tenants con estado de suscripción
4. Crear nuevo tenant con información completa (contacto + suscripción)
5. Ver notificaciones de solicitudes de extensión (futuro: integrar WhatsApp/Email)

#### Como Tenant Admin:
1. Login en `demo.localhost:6001` o dominio propio
2. Dashboard muestra widget destacado con estado de suscripción
3. Alerta visual si faltan <90 días para vencer (badge amarillo/rojo)
4. Acceso a todos los módulos operativos (catálogo, stock, ventas, reportes)
5. Botón "Solicitar Extensión" para renovar o modificar suscripción
6. Gestión de usuarios, roles y branding de su tenant

### **Pendientes Identificados**
- ✅ Backend seed con Platform Admin + Demo Tenant
- ✅ Endpoints CRUD de tenants con suscripción
- ✅ Endpoints consulta y solicitud extensión
- ✅ Hook usePermissions con flags isPlatformAdmin/isTenantAdmin
- ✅ Navegación filtrada por permisos
- ✅ UI Platform Tenants con CRUD completo
- ✅ Widget Dashboard suscripción con modal extensión

---

## **[23 Dic 2025] Recetario de elaboración por producto (V2)**

### **Backend (Prisma + API)**
- Se incorporaron modelos:
  - `Recipe` (1:1 con `Product`, multi-tenant)
  - `RecipeItem` (insumos por receta)
- Endpoints:
  - `GET /api/v1/products/:id/recipe`
  - `PUT /api/v1/products/:id/recipe` (create/update con optimistic locking por `version`)
  - `DELETE /api/v1/products/:id/recipe`
- Se añadieron eventos de auditoría: `recipe.create`, `recipe.update`, `recipe.delete`.

### **Frontend**
- En el detalle de producto se añadió sección "Recetario de elaboración":
  - Generar/editar recetario.
  - Listado simple de insumos (nombre, cantidad, unidad, nota) con agregar/quitar.
- 🔲 Integración real de envío WhatsApp/Email (actualmente solo preview)
- 🔲 Cron job para notificaciones automáticas (3 meses y 1 mes antes de vencer)
- 🔲 Página Branding funcional con upload S3 y color pickers
- 🔲 Personalización de vistas/columnas por rol (feature complejo, Fase 4)

### **Arquitectura de Permisos**

```
Platform Admin (Supernovatel)
├── platform:tenants:manage ✓
├── catalog:read/write ✓
├── stock:read/move ✓
├── sales:order:read/write ✓
├── admin:users:manage ✓
└── audit:read ✓

Tenant Admin (Clientes)
├── platform:tenants:manage ✗
├── catalog:read/write ✓
├── stock:read/move ✓
├── sales:order:read/write ✓
├── admin:users:manage ✓
└── audit:read ✓
```

### **Monetización**
- Modelo: **Sucursales × Tiempo**
  - Cada sucursal = 1 warehouse con ubicaciones
  - Cliente contrata N sucursales por M meses
  - Notificaciones automáticas 3 meses y 1 mes antes de vencer
  - Cliente puede solicitar extensión (aumentar/reducir sucursales + renovar tiempo)
  - Platform Admin aprueba/procesa solicitudes

### **Notas Técnicas**
- TenantId `00000000-0000-0000-0000-000000000001` reservado para Platform (Supernovatel)
- Dominios verificados requeridos para login por host
- Permisos cacheados en frontend (5 min) para performance
- Navegación renderizada dinámicamente según permisos
- Badges de estado calculados en tiempo real (días restantes)
- Modal extension genera preview antes de enviar (UX transparente)

