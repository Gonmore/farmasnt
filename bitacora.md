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

## **[10 Feb 2026] Stock: Envío y recepción de solicitudes (SENT → FULFILLED)**

### Estado intermedio `SENT`
- Se agregó el estado `SENT` para representar solicitudes **enviadas** pero aún **no recepcionadas** en destino.

### Backend (rutas + trazabilidad)
- `POST /api/v1/stock/movement-requests/bulk-fulfill` genera el **envío** creando movimientos `OUT` asociados a la solicitud (`referenceType: MOVEMENT_REQUEST`, `referenceId = requestId`) y marca la solicitud como `SENT`.
- `POST /api/v1/stock/movement-requests/:id/receive` confirma la **recepción**: crea movimientos `IN` hacia el `toLocationId` de los `OUT` enviados, marca la solicitud como `FULFILLED` y setea `confirmedAt/confirmedBy`.
- `GET /api/v1/stock/movement-requests` se amplió para exponer:
  - `originWarehouse` (derivado desde `OUT.fromLocationId → Location → Warehouse`, que representa el origen real del envío)
  - `fulfilledByName` / `confirmedByName`
  - `movements[]` con detalle por producto/lote/vencimiento y `fromLocation`
- Se agregó soporte de logs opcionales para depuración: `DEBUG_STOCK_MOVEMENT_REQUESTS=1`.
- Fix en “Movimientos realizados” (`/stock/completed-movements`): el almacén de origen se deriva del último movimiento `OUT` (el último movimiento global puede ser un `IN` de recepción con `fromLocationId=null`).

### Frontend (Recepciones)
- La pantalla `/stock/returns` ahora incluye pestaña **Recepciones** (solicitudes `SENT`) y muestra **origen real** + **persona que envía**, además del detalle por lote/vencimiento.
- Se ajustó el ordenamiento para mostrar lo más reciente primero en tablas relacionadas a solicitudes/recepciones.

## **[02 Feb 2026] Stock: Atender solicitudes + Reportes OPS (flujos y trazabilidad)**

### Operación: Atender solicitudes (1 solicitud, múltiples ítems)
- Se consolidó el flujo para atender **una** solicitud de movimiento con múltiples ítems (con autopick FEFO y soporte de atención parcial).
- Se incorporó documentación operativa (PDF):
  - Picking PDF.
  - Rótulo editable (PDF).

### Reportes > Stock > OPS: flujos completados + tiempo promedio + trazabilidad
- Se ampliaron los reportes de OPS para solicitudes de movimiento:
  - **Flujos** (origen → destino) de solicitudes atendidas y **tiempo promedio de atención** (`fulfilledAt - createdAt`).
  - **Listado** de solicitudes atendidas con métricas (tiempo, ítems, cantidades, movimientos) y acceso a drill-down.
  - **Trazabilidad** por solicitud: comparar **lo solicitado** vs **lo enviado** (movimientos/picking real).
- UX menor:
  - Filtro client-side en la lista de atendidas.
  - Botón "Exportar picking (PDF)" dentro del modal de trazabilidad.

### Endpoints (read-only)
- `GET /api/v1/reports/stock/movement-requests/flows`
- `GET /api/v1/reports/stock/movement-requests/fulfilled`
- `GET /api/v1/reports/stock/movement-requests/:id/trace`

## **[14 Ene 2026] Módulo Entregas + cierre de venta por reservas**

### Entregas (UI)
- Se agregó la pantalla **Entregas** en Ventas (`/sales/deliveries`) con lista de pendientes/entregadas.
- Se muestra **fecha relativa** ("en X días" / "hoy" / "ayer" / "hace X días"), lugar de entrega y acceso a Maps.
- Acciones:
  - **Ver OV** (navega al detalle de la orden).
  - **Marcar entregado**.

### Backend: listar entregas + marcar entregado
- Nuevo read-side: `GET /api/v1/sales/deliveries` (pendientes = `DRAFT|CONFIRMED`, entregadas = `FULFILLED`).
- Nueva acción: `POST /api/v1/sales/orders/:id/deliver`.
  - Si la orden tiene `SalesOrderReservation`, se consume stock desde los balances reservados: decrementa `quantity` y `reservedQuantity`, borra reservas y crea `StockMovement` `OUT`.
  - Si no hay reservas, permite fallback al flujo clásico (requiere `fromLocationId`, incluye FEFO + validación de lote vencido).
  - Emite eventos realtime (`sales.order.delivered`, `stock.movement.created`, `stock.balance.changed`) y registra auditoría.

### Ajuste de flujo cotización → orden
- Al procesar una cotización, la orden resultante se crea en estado `CONFIRMED` para que quede lista como "pendiente de entrega".

### Docs
- Se actualizó `API_REFERENCE.md` para incluir los endpoints de Entregas y la acción de entrega.

---

## **[14 Ene 2026] Productos: Presentación estructurada + SKU automático**

### Presentación = envoltorio + cantidad + formato
- Se agregó al modelo de producto una presentación estructurada:
  - `presentationWrapper` (ej. `caja`, `frasco`)
  - `presentationQuantity` (cantidad numérica)
  - `presentationFormat` (ej. `comprimidos`, `vial`)
- La UI de creación/edición se ajustó para capturar estos 3 valores y mostrar una vista previa tipo "Caja de 250 comprimidos".

### SKU automático (frontend)
- Al crear producto, el SKU se genera automáticamente combinando nombre + wrapper + cantidad + formato.
- Si el usuario edita el SKU manualmente, se desactiva la autogeneración para no pisar cambios.

### Seed actualizado
- Seed principal: `backend/prisma/seed.ts` (se ejecuta con `npm --prefix backend run seed`).
- Incluye ejemplos con presentación (Atrovastatina, Valganciclovir, Omeprazol) y mantiene idempotencia via `upsert`.

### Docker (backend)
- El backend corre migrations con `prisma migrate deploy` al iniciar.
- El seed se puede ejecutar al inicio seteando `RUN_SEED=1` (o dejándolo apagado para producción).

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

### **[14 Ene 2026]** — Mejoras UX en Entregas
- **Botón "Lugar" estilizado**: borde sólido azul, radius alto, background translúcido azul para destacar como botón interactivo.
- **Modal de dirección**: al presionar "Lugar", modal con dirección completa + botón "Ver en Maps" (abre Google Maps).
- **Filtro por ciudad**: chips de selección múltiple por ciudad de entrega, similar a Clientes.
- **Botón "Ver todas"**: reemplaza "Ir a Órdenes", muestra todas las entregas (pendientes + entregadas) combinando `DRAFT` + `CONFIRMED` + `FULFILLED`.
- **Backend**: endpoint `GET /api/v1/sales/deliveries` ahora soporta `status=ALL` y `cities` query param para filtrar.
- **Documentación**: actualizada API_REFERENCE.md con nuevos params `status=ALL` y `cities`.

### **[16 Ene 2026]** — Reportes renovados + Exportación PDF profesional + build prod estable
- **Reportes (Ventas/Stock)**: rediseño de UI con secciones, KPIs y gráficos (Recharts) con mejor legibilidad y estilo consistente.
- **Exportación PDF (carta vertical)**: header/footer con branding, captura con ancho fijo, paginación por “slicing” para respetar márgenes en páginas 2+ y evitar duplicado de contenido.
- **Fix NaN en tablas**: el componente de tabla genérico ahora pasa `rowIndex` al `accessor(item, index)` (evita `NaN` por índices indefinidos).
- **Fix build TypeScript en Docker/producción**: ajustes de tipos en reportes (`tenant.branding.tenantName`, `logoUrl` nullable, `percent` optional) y limpieza de imports/parámetros no usados.

### **[20 Ene 2026]** — Mejoras en UI: menú lateral y botones del catálogo comercial
- **Menú lateral**: agregado scroll automático al elemento activo seleccionado para mantener la visibilidad al navegar (especialmente en opciones inferiores como "Branding"). Ajuste de estilos para temas claro/oscuro: elemento activo en tema claro usa `bg-slate-100 text-slate-900`, en tema oscuro mantiene `bg-[var(--pf-primary)] text-white`.
- **Catálogo comercial**: actualización de botones en cada item del catálogo. Botón "Ver" cambiado a `variant="outline"` con ícono `EyeIcon` (removido emoji). Botón "Agregar" cambiado a `variant="success"` con ícono `ShoppingCartIcon` (removido emoji). Simplificación de clases CSS personalizadas para usar variants consistentes del sistema de diseño.
- **Compilación**: frontend y backend compilan exitosamente tras los cambios.

### **[20 Ene 2026]** — Alineación de botones en página de entregas
- **Botón "Marcar como entregado"**: cambiado a `variant="ghost"` con ícono `CheckCircleIcon` para mantener consistencia con otros botones de acción en tablas (como "Ver").

### **[20 Ene 2026]** — Optimización de logos en navbar según dimensiones
- **Detección automática de dimensiones**: agregado código para detectar si el logo del tenant es cuadrado (aspect ratio entre 0.9 y 1.1) y aplicar clases CSS apropiadas.
- **Logos cuadrados**: usan `h-10 w-10 object-contain` para mantener proporciones sin distorsión.
- **Logos rectangulares**: mantienen `h-10 w-auto` como antes.
- **Logos por defecto**: sin cambios (Supernovatel logos son rectangulares).

### **[20 Ene 2026]** — Mejora de logos en navbar y cotizaciones PDF
- **Navbar logos cuadrados**: aumentado tamaño de `h-10 w-10` a `h-12 w-12` para mejor visibilidad.
- **Cotizaciones PDF**: agregado logo del tenant en la exportación PDF cuando existe. Logo posicionado arriba del nombre de la empresa con altura máxima de 30mm manteniendo proporciones.

### **[20 Ene 2026]** — Mejoras en logos navbar y cotizaciones PDF
- **Navbar logos**: ampliado rango de detección de logos cuadrados (0.8-1.2 aspect ratio) y aumentado tamaño base a h-12 para mejor visibilidad.
- **Cotizaciones PDF**: logo reposicionado a la derecha en la fila del título "COTIZACIÓN". Agregada marca de agua diagonal con número de cotización usando color primario del branding (transparente 10%).

### **[20 Ene 2026]** — Ajustes finales en cotizaciones PDF
- **Logo en PDF**: reposicionado a la izquierda del header, aumentado tamaño a 40mm de altura (doble del anterior).
- **Marca de agua**: cambiada a color celeste (sky blue) con mayor transparencia (3%) para mejor legibilidad del contenido.

### **[20 Ene 2026]** — Reorganización completa del PDF de cotizaciones
- **Layout profesional**: Título "COTIZACIÓN" centrado arriba, seguido de dos columnas en la sección de detalles.
- **Columna izquierda**: Nombre de la empresa y detalles (número cotización, fecha, cliente, cotizado por, validez).
- **Columna derecha**: Logo de la empresa (35mm altura) alineado a la derecha en la misma sección.
- **Tabla de productos**: Ubicada en el body con columnas optimizadas.
- **Footer**: Forma de pago, tiempo de entrega y lugar de entrega debajo de los totales.
- **Marca de agua**: Número de cotización en diagonal de fondo con color celeste translúcido (5% transparencia).

### **[20 Ene 2026]** — Ajustes de espaciado y marca de agua en PDF cotizaciones
- **Espaciado**: Aumentado espacio entre header y tabla de productos de 10mm a 18mm para mejor legibilidad.
- **Marca de agua**: Ajustada transparencia a 8%, movida hacia abajo (+20mm), y corregido color celeste (RGB: 135, 206, 235).

### **[20 Ene 2026]** — Corrección de error PDF y actualización de botones en cotizaciones
- **Error PDF**: Corregido error `setGState` usando color más claro (RGB: 200, 220, 235) para marca de agua en lugar de transparencia compleja.
- **Botones actualizados**:
  - "Volver": Cambiado a variant `outline`
  - "Exportar PDF": Cambiado a variant `primary` con estado de carga ("Exportando..." mientras genera)
  - "WhatsApp PDF": Cambiado a variant `success`, ahora exporta el PDF en lugar de enviar link
- **Manejo de errores**: Agregado try/catch en exportación PDF con mensajes de error claros.

### **[20 Ene 2026]** — Optimizaciones para vista móvil
- **Catálogo Comercial**: Botón "Agregar" muestra solo icono en móvil (oculta texto con `hidden sm:inline`)
- **Inventario**: 
  - Botones de filtro movidos a segunda fila (fuera de PageContainer actions)
  - Texto reducido en móvil con clase `text-xs sm:text-sm`
  - Mantiene funcionalidad completa: Por Producto, Por Sucursal, Actualizar, Exportar Excel
- **Sucursales**: Botones "Editar" y "Ubicaciones" muestran solo iconos en móvil
- **Pagos**: Botones de filtro (Por cobrar, Cobradas, Ver todas) movidos a segunda fila
- **Entregas**: Botones de filtro (Pendientes, Entregadas, Ver todas) movidos a segunda fila
- **Movimientos - Transferencias**: 
  - Corregido bug crítico: botón "Realizar Transferencia" no tenía funcionalidad
  - Agregada función `createTransferMovement` y mutation `transferMutation`
  - Ahora valida stock disponible y ejecuta transferencias correctamente entre ubicaciones
  - Agregado estado de carga y mensajes de éxito/error

### **[22 Feb 2025]** — Corrección y documentación del Database Seed
- **Problemas corregidos en seed.ts**:
  - Cambiado `SalesOrderStatus.COMPLETED` por `FULFILLED` (valor válido del enum)
  - Agregados campos requeridos `number` y `numberYear` a `StockMovement`
  - Corregida lógica de ubicaciones: `fromLocationId` para ventas (OUT), `toLocationId` para compras (IN)
  - Cambiado tipos de movimiento: `SALE`/`PURCHASE` por `OUT`/`IN` (valores válidos del enum `StockMovementType`)
  - Corregido campo `reason` por `note` en `StockMovement`
  - Cambiado tipos de datos: `quantity` de string a número/Decimal
  - Agregada limpieza de `Quote` y `QuoteLine` antes de eliminar productos (evita errores de foreign key)
  - Removida creación de `SalesOrderPayment` (modelo inexistente, pagos integrados en `SalesOrder`)
- **Datos generados por seed funcional**:
  - 43 productos con precios, costos y márgenes
  - 315 órdenes de venta históricas (Bs 169,169 total)
  - Movimientos de stock completos (ventas OUT y reposiciones IN)
  - 3 clientes, 3 almacenes, productos con stock bajo y próximos a vencer
- **Documentación actualizada**:
  - Agregada sección "Database Seeding" en `API_REFERENCE.md` con comandos e instrucciones Docker
  - Actualizada bitácora con detalles de correcciones realizadas

### 6) Presentaciones de Productos
- **Nueva tabla `ProductPresentation`**:
  - Permite definir múltiples presentaciones por producto (ej. "Caja de 200 unidades", "Frasco de 100 ml").
  - Campos: `name`, `unitsPerPresentation`, `priceOverride`, `isDefault`, `sortOrder`.
  - Relación con `Product` por `productId` y `tenantId`.
- **Migración de campos**:
  - Movidos `presentationWrapper`, `presentationQuantity`, `presentationFormat` de `Product` a la nueva tabla.
  - Agregados `presentationId` y `presentationQuantity` a `QuoteLine`, `SalesOrderLine`, `StockMovement`.
- **Actualizaciones en backend**:
  - Endpoint `/api/v1/sales/orders/:id/reservations` incluye datos de presentación desde líneas de orden.
  - Validaciones actualizadas para permitir múltiples presentaciones del mismo producto en cotizaciones y órdenes.
- **Mejoras en frontend**:
  - PDF de nota de entrega muestra cantidades y presentaciones correctas (ej. "1 caja de 200u", "30 Unidades").
  - Tabla de entregas optimizada para presentaciones.
- **Migración de base de datos**:
  - Ejecutada migración `20260127140000_product_presentations` para crear tabla y agregar campos.
  - Compatibilidad hacia atrás mantenida para datos existentes.

## Mejoras de UI/UX (Enero 2026)
- **Catálogo de productos**:
  - Ajustado ancho mínimo de tarjetas de productos de 140px a 180px para mejor legibilidad y consistencia visual.
- **Gestión de warehouses**:
  - Enforced validación de códigos en mayúsculas con prefijo "SUC-".
  - Agregado ícono de ojo al botón de stock para mejor UX.
  - Validación backend actualizada para asegurar formato consistente.
- **Creación de productos**:
  - Corregido botón de regreso faltante en página de detalle de productos.
- **Creación de lotes**:
  - Deshabilitada selección automática de sucursal, ahora requiere selección manual con placeholder "Elegir sucursal".

---

### **[29 Ene 2026]** — Transferencias (solicitudes + masivo), devoluciones con evidencia y reportes OPS

- **Solicitudes de movimiento con confirmación (Sucursal destino)**:
  - Flujo `PENDING/ACCEPTED/REJECTED` para que la sucursal destino confirme recepción.
  - Se incorporó resumen operativo por sucursal/ciudad (totales/abiertas/atendidas/canceladas y estado de confirmación).

- **Traspasos masivos (dos variantes)**:
  - A) **Movimiento masivo multi-línea** (`bulk transfer`) para crear múltiples `TRANSFER` en un solo envío.
  - B) **Atender múltiples solicitudes seleccionadas** (`bulk fulfill`) asignando cantidades a requests específicos, evitando doble auto-aplicación.

- **Devoluciones con evidencia (motivo + foto)**:
  - Modelo `StockReturn/StockReturnItem` + endpoints para presign de foto y creación/listado/detalle.
  - Al crear una devolución se generan movimientos `IN` por ítem con `referenceType='RETURN'`.

- **Reportes OPS (StockReportsPage)**:
  - Nueva pestaña OPS con KPIs y tablas: solicitudes por ciudad y devoluciones por sucursal.

- **Infra Docker/Prisma (fix build)**:
  - Se corrigió validación Prisma agregando los campos inversos de relaciones para `StockReturn*`.
  - Con eso `docker compose -f docker-compose.local.yml build` y `up -d` vuelven a quedar OK.

### **[29 Ene 2026]** — Estabilización de vistas + Hub de Movimientos + RBAC por sucursal (sin afectar Tenant Admin)

- **Fix de errores masivos en UI**:
  - Se mitigaron `409 Conflict` por usuarios con `scope:branch` sin sucursal seleccionada.
  - En frontend se fuerza selección de sucursal **solo** para branch-scoped que no sean `TENANT_ADMIN`/platform admin.
  - En backend se agregó `isTenantAdmin` al contexto auth para que el guard por ciudad (scope branch) no se aplique a tenant admins.

- **UX: Movimientos como hub**:
  - Menú tipo grilla de accesos rápidos (Movimientos, Transferencia masiva, Atender solicitudes, Devoluciones).
  - La lista de **Solicitudes de movimiento** se muestra inmediatamente debajo del menú.
  - Se removieron accesos redundantes del menú lateral para simplificar navegación.

- **Fix validación de productos**:
  - Se alineó el límite de `take` en `GET /api/v1/products` para soportar selects/listados del frontend y evitar `400`.

- **Docker build**:
  - Se corrigió un error de build del backend en Docker por un `select` inválido sobre `UserRole` (tabla con clave compuesta).

### **[02 Feb 2026]** — Mejora de flujo "Atender solicitudes" + Reportes OPS enriquecidos + UX en creación de solicitudes

- **Rediseño de "Atender solicitudes"**:
  - Se cambió de bulk a atender **una solicitud multi-ítem** con selección previa.
  - **Autopick FEFO**: prioriza lotes abiertos, asigna automáticamente cantidades/orígenes a ítems pendientes.
  - **Atención parcial**: permite enviar menos de lo solicitado, actualizando `remainingQuantity` en `StockMovementRequestItem`.
  - **Documentos**: generación de PDF picking (lista de líneas con ubicación/lote/vence) y rótulo editable (100x150mm con campos como bultos/responsable/observaciones).
  - **UX sugeridos**: badges ⭐ en stock y resumen por ítem para destacar asignaciones automáticas.
  - **Validaciones visuales**: colores y "Falta (u)" para ítems no cubiertos; filtros por "solo productos requeridos".

- **Enriquecimiento de Reportes > Stock > OPS**:
  - **Flujos completados**: tabla con rutas (origen → destino) de solicitudes FULFILLED + promedio minutos de atención (fulfilledAt - createdAt).
  - **Trazabilidad**: lista de solicitudes atendidas con métricas (tiempo, cantidades, rutas agregadas); modal con comparación solicitado vs enviado (picking real) + botón "Exportar picking PDF".
  - **Backend**: nuevos endpoints `/api/v1/reports/stock/movement-requests/flows`, `/fulfilled`, `/:id/trace` con queries SQL para deducir rutas desde movimientos TRANSFER.

- **UX en "Crear solicitud" (MovementsPage)**:
  - Se ajustó la condición del botón "Crear solicitud" para habilitarse una vez que hay ítems agregados, sin requerir llenar el formulario de producto individual (evita confusión en usuarios que agregan ítems pero no entienden por qué no se habilita).
  - Campo "Producto" deja de mostrar * (requerido) cuando ya hay ítems agregados.
  - Campo "Producto" deja de ser `required` en HTML cuando hay ítems agregados, evitando mensaje "rellena este campo" al enviar el formulario.

- **Docs actualizadas**:
  - API_REFERENCE.md: documentación de nuevos endpoints de reportes OPS.
  - bitacora.md: log de cambios en esta sesión.

- **Mejoras en vista "Atender solicitudes"**:
  - Agregada columna "Presentación" en tabla de stock origen para mostrar la presentación del lote.
  - Modificada columna "Lote" para mostrar fecha de vencimiento debajo en formato pill (rectángulo curvo con background sólido, letra pequeña).

