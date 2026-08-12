# API Reference — PharmaFlow Bolivia (MVP)

## Versión 2.2.1

Esta referencia contempla los cambios de las versiones **2.0** (multi-marca/multi-empresa), **2.0.1** (orden alfabético), **2.1.0** (branding numérico + existencias + salida de muestra), **2.1.1** (badges operativos + restricción de edición de lotes), **2.1.2** (historial de movimientos), **2.1.3** (advertencia de atención parcial), **2.1.4** (reportes de ventas: estado por defecto "Todos" y `take` elevado a 1000), **2.2.0** (kardex unificado AuditEvent-based, modal de entrega con devoluciones, sub-almacén en solicitudes, upload PDF de comprobantes) y **2.2.1** (rol `BRANCH_PROVIDER`, visibilidad total de transferencias para proveedor, y edición de inventario solo en almacén propio en ambas vistas).

## Cambios recientes (07 Ago 2026) — Kardex formato WAREHOUSE:Location + ventas con cliente

- `GET /api/v1/products/:id/kardex`: la respuesta `kardex[]` ahora incluye `fromWarehouseCode`, `toWarehouseCode`, `fromLocationCode`, `toLocationCode`. El saldo acumulado (`balance`) se calcula solo sobre movimientos que afectan la sucursal filtrada (`affectsWarehouse`). Para movimientos `OUT` con `referenceType: 'SALES_ORDER'`, el `toCode` contiene el número de orden y `toWarehouseCode` el nombre del cliente; el `detail` incluye `[SALES_ORDER] NRO - Cliente: Nombre`. Los ajustes (`ADJUSTMENT`) se incluyen correctamente cuando su location pertenece a la sucursal filtrada.
- `GET /api/v1/stock/completed-movements`: la columna "Origen → Destino" en el frontend muestra `WAREHOUSE:Location` (código de sucursal sin prefijo `SUC-` + código de ubicación).

### Cambios recientes (11 Ago 2026) — Recepción/Devolución unificada en /stock/returns

- `POST /api/v1/stock/movement-requests/:id/reception`: endpoint unificado que crea movimientos `IN` (`MOVEMENT_REQUEST_RECEIPT` y/o `MOVEMENT_REQUEST_RETURN`) por ítem, valida `receivedQuantity + returnedQuantity ≤ pending`, requiere `returnReason` cuando hay devolución, y cierra la solicitud si quedan 0 pendientes. Reemplaza a los endpoints separados `:id/receive` y `:id/return` en la UI de recepciones.
- Frontend `/stock/returns`: botón único "Recepción/Devolución" → modal unificado con "Recepción completa" por ítem, devolución parcial con motivo, upload de foto y nota general.
- Formato "ORG → DEST" en recepciones y modal "Ver" usa `Warehouse:location` (código sin prefijo `SUC-` + ubicación), igual que `/stock/completed-movements`.

### Cambios recientes (11 Ago 2026) — Trazabilidad: Warehouse:Location + timeline de recepción + exportar PDF

- `GET /api/v1/stock/movement-requests`: cada movimiento `OUT` en la respuesta `items[].movements[]` ahora incluye `receptions[]`, un arreglo de entradas de recepción/devolución con `type` (`RECEIPT` | `RETURN`), `quantity`, `note` (incluye URL de foto como `Foto: <url>`), `createdBy`, `createdByName`, `createdAt`. Permite mostrar quién y cuándo se recepcionó, con nota y preview de foto.
- Frontend `/stock/movement-requests-traceability`: la ruta origen/destino usa formato `Warehouse:Location` (código sin `SUC-` + ubicación), y en solicitudes ya atendidas/recepcionadas el origen usa el `fromWarehouse:fromLocation` real del envío. La sección "Envíos" muestra el lote enviado (`batch.batchNumber`) y la ruta por envío. El timeline indica fecha de atención (`fulfilledAt`) o atención parcial (fecha del primer envío). Nuevo botón "Exportar PDF" en el modal de detalle que genera una nota de recepción con logo, código de solicitud como marca de agua, "Atendida"/"Recepción" en líneas separadas, y firmas con el nombre de quien solicitó y quien atendió.
- `GET /api/v1/stock/movement-requests`: cada movimiento OUT en `items[].movements[]` ahora también expone `toLocationId` y `toLocation` (`{id, code, warehouse}`), usado por `/stock/returns` para mostrar el destino en formato `Warehouse:Location` cuando la solicitud no trae `toLocation`.
- Frontend `/stock/movements`: la lista de solicitudes y el modal "Detalle de solicitud" ahora muestran el destino en formato `Warehouse:Location` (código sin `SUC-` + ubicación), igual que `/stock/completed-movements` y `/stock/returns`.

### Cambios recientes (12 Ago 2026) — Rol BRANCH_PROVIDER y visibilidad total de transferencias

- Nuevo rol de sistema `BRANCH_PROVIDER` ("Administrador de Sucursal Proveedor") con permisos `scope:branch`, `catalog:read`, `catalog:write`, `stock:read`, `stock:manage`, `stock:move`, `stock:deliver`, `report:stock:read`. Pensado para almacenes tipo `PROVIDER` que crean/ajustan lotes y atienden solicitudes de transferencia.
- `GET /api/v1/stock/movement-requests` y `GET /api/v1/stock/returns`: cuando el almacén del usuario es de tipo `PROVIDER`, `branchCityOf` devuelve `null`, por lo que el backend no aplica filtro de ciudad y el usuario ve/atiene TODAS las solicitudes (lectura de almacenes tipo venta). Los almacenes `SALES` siguen restringidos a su ciudad.
- `AuthContext`/`request.auth` ahora incluye `warehouseType` (`PROVIDER` | `SALES` | null), derivado de `user.warehouse.type`.
- Frontend `/stock/inventory`: tanto la vista "Por Producto" como "Por Sucursal" aplican `canEditWarehouse(warehouseId)` — solo se habilitan el editor de ubicación (`TRANSFER` vía `POST /api/v1/stock/movements`) y el cambio de estado de lote (`PATCH /api/v1/products/:productId/batches/:batchId/status`) en el almacén propio del usuario con scope de sucursal; los demás almacenes quedan en solo lectura. El backend refuerza esto con `403` en ADJUSTMENT/IN hacia almacenes ajenos.
- **Reportes de stock (autonomía de sucursal)**: usuarios con `scope:branch` (BRANCH_ADMIN, BRANCH_PROVIDER) ven **solo su propia sucursal** en `/api/v1/reports/stock/*` (`balances-expanded`, `existencias`, `low-stock`, `expiry-alerts`, `rotation`, `transfers-between-warehouses`, `returns/summary`, `returns/by-warehouse`, `movements-expanded`). El backend fuerza el `warehouseId` al almacén propio del usuario (`resolveBranchWarehouseId`); un admin sin scope de sucursal conserva el selector "Sucursal" (valor vacío = todas las sucursales). Ya no se aplica el filtro "PROVIDER ve todas las ciudades" en reportes.

## Cambios recientes (10 Ago 2026) — Carga automática de precios en cotizaciones
- `GET /api/v1/sales/quotes/:id` y `POST/PUT /api/v1/sales/quotes/:id`: el `unitPrice` de cada línea se expresa en unidades base. Al crear o editar una cotización, si `unitPrice` no se envía, el backend resuelve el precio usando `priceOverride / unitsPerPresentation` de la presentación (si existe) o el `Product.price` como fallback. El frontend (`QuoteDetailPage`) replica esta lógica para previsualizar el precio al momento de seleccionar un producto o cambiar de presentación.

Cambios relevantes en 2.2.0:
- `GET /api/v1/products/:id/kardex` refactorizado para reconstruir el saldo línea a línea desde `AuditEvent` (`action = 'stock.movement.create'`), ordenado cronológicamente ASC. Muestra el kardex en unidades base (sin pestañas por presentación) con un resumen consolidado por lotes/presentaciones al final. El saldo actual proviene de `InventoryBalance` (fuente autoritativa).
- `POST /api/v1/sales/orders/:id/deliver-with-returns` permite registrar la entrega junto con devoluciones parciales en un solo request.
- Nuevo endpoint `POST /api/v1/sales/orders/:id/return` para devoluciones standalone.
- `POST /api/v1/stock/movement-requests` acepta `toLocationId` opcional para enrutar a un sub-almacén destino; `GET /api/v1/stock/movement-requests` y `POST /api/v1/stock/movement-requests/:id/plan` incluyen `toLocationId` + `toLocation`.
- `POST /api/v1/sales/payments/proof-upload` y `POST /api/v1/stock/returns/photo-upload` aceptan `application/pdf` en `contentType`.
- Se elevó el tope máximo de `take` en `GET /api/v1/reports/sales/by-month` a 1000 (antes 30) para consistencia con otros reportes.

Cambios relevantes en 2.0:
- `GET /api/v1/auth/me` devuelve `availableTenants` y `activeTenantId` cuando el usuario tiene acceso a más de una empresa.
- `POST /api/v1/auth/switch-tenant` permite cambiar el contexto activo del JWT a otra empresa autorizada, incluyendo retorno al tenant base.
- `GET /api/v1/admin/group-tenants` lista empresas hermanas del grupo actual.
- `GET /api/v1/admin/users/:userId/tenant-access` lista accesos cruzados por usuario.
- `PUT /api/v1/admin/users/:userId/tenant-access` reemplaza accesos cruzados por usuario.
- `GET|POST|DELETE /api/v1/platform/tenant-groups...` administra grupos de empresas desde plataforma.

Cambios recientes en catálogo y documentos:
- `Tenant` incorpora `thousandSeparator` para parametrizar el formato numérico visible por empresa.
- `GET /api/v1/tenant/current` y endpoints de branding exponen `thousandSeparator`.
- `Product` incorpora `baseUnitAbbreviation` para definir la abreviatura visible de unidad base por producto.
- `GET /api/v1/catalog/search` devuelve `baseUnitAbbreviation` en cada producto listado.
- Las respuestas de cotizaciones, órdenes y reservas que devuelven datos de producto incluyen `baseUnitAbbreviation` cuando corresponde.
- La representación PDF en frontend consume este campo para renderizar etiquetas de presentación y cantidad sin asumir `u`.
- Los PDFs de documentos y reportes mantienen el detalle sin separadores horizontales por fila, por una decisión visual del frontend de exportación.
- Los listados operativos del frontend consumen estas respuestas aplicando orden alfabético por nombre visible en catálogo e inventario, sin cambios de contrato API.

Cambios recientes en stock y reportes:
- `POST /api/v1/stock/movements` acepta `referenceType='PRODUCT_SAMPLE'` para salidas de muestra, validando nota obligatoria.
- `GET /api/v1/products/:id/batches` devuelve `warehouseCity` por ubicación para soportar reglas de cliente por ciudad en frontend.
- `GET /api/v1/products/:id/batches` también devuelve `originWarehouseId`, `originWarehouseCode`, `originWarehouseName`, `originLocationId` y `originLocationCode` para restringir ediciones del lote al almacén de ingreso original.
- `GET /api/v1/reports/stock/existencias` devuelve stock físico, reservado, disponible, entradas, salidas, bajas, muestras y traspasos para el período.
- `GET /api/v1/reports/stock/movement-requests/by-city` y `GET /api/v1/stock/movement-requests?status=OPEN|SENT` siguen siendo los endpoints base para los badges operativos del menú compartido de stock.
- El filtro por defecto de **Reportes > Ventas** en frontend pasó a `status=ALL` (antes solo `FULFILLED` por defecto, ocultando ventas en otros estados).
- El tope de `take` en `reports/sales/top-products`, `reports/sales/margins`, `reports/sales/by-customer`, `reports/sales/by-city` y `GET /api/v1/sales/orders` se elevó a 1000 para evitar que los reportes agregados y sus drill-down recorten filas. Es un límite fijo temporal; se recomienda migrar a paginación real (`cursor`) en una futura iteración en lugar de seguir subiendo el número.

Base URL (dev): `http://127.0.0.1:6000`

OpenAPI/Swagger:
- Swagger UI: `GET /api/v1/docs`
- OpenAPI JSON: `GET /api/v1/openapi.json`

## Autenticación
- Los endpoints protegidos esperan `Authorization: Bearer <accessToken>`.
- El access token es JWT.
- Refresh token es opaco y se rota en cada refresh.

### Errores comunes
- `401` Credenciales inválidas / token inválido.
- `403` Falta permiso.
- `409` Conflicto (ej. optimistic locking `version` o reglas de negocio).

## Paginación (keyset)
Varios listados usan keyset pagination:
- Request: `?take=<n>&cursor=<uuid>`
- Response: `{ items: [...], nextCursor: "<uuid>" | null }`

## Módulos por tenant
Algunos endpoints requieren módulo habilitado:
- `WAREHOUSE` para stock/warehouses (movimientos, balances, vencimientos, etc.).
- `SALES` para customers y sales orders.

Notas
- **Catálogo/Productos** no requiere módulo: se controla por permisos `catalog:*`.

## Permissions (RBAC)
Códigos usados por los guards:
- `catalog:read`, `catalog:write`
- `stock:read`, `stock:move`
- `sales:order:read`, `sales:order:write`
- `sales:delivery:read`, `sales:delivery:write`
- `admin:users:manage`
- `audit:read`
- `report:sales:read`, `report:stock:read`
- `platform:tenants:manage`

---

## Cambios recientes (10 Ago 2026) — Reportes de actividad por tipo de sucursal

### Stock Reports: actividad de sucursales proveedor y venta
- Nuevos endpoints:
  - `GET /api/v1/reports/stock/provider-activity` — actividad de warehouses tipo `PROVIDER`: lotes creados, traspasos enviados (count + qty), ajustes (count + qty out).
  - `GET /api/v1/reports/stock/sales-branch-activity` — actividad de warehouses tipo `SALES`: lotes recibidos, solicitudes aceptadas/rechazadas/pendientes, cotizaciones creadas, órdenes creadas, monto de ventas.
- Ambas filtran por `WarehouseType` (`PROVIDER` / `SALES`) y aceptan query params `from` / `to` (date-time opcional).
- **Filtro de fechas**: `from` es inclusivo (`>=`), `to` es exclusivo (`<`). Para reportar un mes completo, usar `from=YYYY-MM-DD` (primer día) y `to=YYYY-MM-DD` (primer día del mes siguiente). Ej: `from=2026-07-01&to=2026-08-01` reporta todo julio.
- Si `from` o `to` no se envían, no se aplica filtro de fecha (todos los registros).
- La UI (`StockReportsPage.tsx`) agrega pestañas "Proveedor" y "Ventas Suc." con KPIs y tablas, usando queries react-query.

---

## Health

### GET /api/v1/health
Sin auth.

Response 200
```json
{
  "status": "ok",
  "service": "pharmaflow-backend",
  "time": "2025-01-01T00:00:00.000Z"
}
```

---

## Auth

### POST /api/v1/auth/switch-tenant
Requiere JWT.

Body
```json
{
  "targetTenantId": "<uuid>"
}
```

Response 200
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaque>"
}
```

Notas
- Si `targetTenantId` es el tenant activo actual, reemite tokens para el mismo contexto.
- Si `targetTenantId` es el tenant base del usuario, permite volver sin requerir grant adicional.
- Si `targetTenantId` es un tenant cruzado, exige registro en `UserTenantAccess`.

### POST /api/v1/auth/login
Sin JWT.

Body
```json
{
  "email": "admin@demo.local",
  "password": "Admin123!"
}
```

Response 200
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaque>"
}
```

Notas (multi-tenant + dominios)
- El backend intenta resolver el tenant por `Host`/`X-Forwarded-Host` usando `TenantDomain` (solo dominios verificados).
- `GET /api/v1/auth/me` puede incluir `availableTenants` y `activeTenantId` para el selector multi-empresa del frontend.
- Si no se puede resolver tenant por dominio y el email existe en múltiples tenants, el login responde `409` con un mensaje de ambigüedad.
- Si la tabla `TenantDomain` aún no existe (BD sin migrar), el login funciona en modo “legacy” (sin resolución por dominio).

### POST /api/v1/auth/refresh
Sin JWT.

Body
```json
{
  "refreshToken": "<opaque>"
}
```

Response 200
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaque>"
}
```

---

## Notifications (campana)
Notificaciones persistentes (server-side) con marca de lectura por usuario.

Notas
- Requiere JWT.
- Para usuarios con scope de sucursal (`ScopeBranch`), el backend filtra por la ciudad de la sucursal autenticada.
- Si el usuario está scopeado por sucursal pero no tiene sucursal seleccionada, puede responder `409`.

### GET /api/v1/notifications

Query
- `take` (1..100, default 50)

Response 200
```json
{
  "lastReadAt": "2026-03-05T12:34:56.000Z",
  "items": [
    {
      "id": "...",
      "createdAt": "2026-03-05T12:00:00.000Z",
      "type": "sales.order.confirmed",
      "title": "✅ Pedido confirmado",
      "body": "Orden: OV-000123",
      "kind": "success",
      "linkTo": "/sales/orders/...",
      "isRead": false
    }
  ]
}
```

### POST /api/v1/notifications/mark-all-read
Marca todas como leídas (setea `notificationsLastReadAt = now()` para el usuario autenticado).

Response 200
```json
{ "lastReadAt": "2026-03-05T12:34:56.000Z" }
```

### POST /api/v1/notifications/send-bulk-transfer
Endpoint utilitario para el flujo de transferencia masiva en UI (crea notificaciones best-effort).

Body
```json
{
  "referenceId": "...",
  "fromWarehouseId": "...",
  "toWarehouseId": "...",
  "items": [{ "productId": "...", "quantity": 10 }]
}
```

Response 200
```json
{ "ok": true }
```

---

## Tenant Branding
Branding del tenant (logo/colores/tema). Hay 2 variantes:
- Pública (sin JWT) para pintar la pantalla de login según el `Host`.
- Protegida (con JWT) para el tenant autenticado.

### GET /api/v1/public/tenant/branding
Sin JWT.

Notas
- El backend resuelve el tenant por `Host`/`X-Forwarded-Host` usando `TenantDomain` (solo dominios verificados).
- Si no puede resolver por `Host`, hace fallback **solo** si existe un único tenant activo.
- `404` si no se puede resolver el tenant.

Response 200
```json
{
  "tenantId": "00000000-0000-0000-0000-000000000001",
  "tenantName": "Supernovatel",
  "logoUrl": "https://.../tenant-logos/<tenantId>.png",
  "brandPrimary": "#0f172a",
  "brandSecondary": "#334155",
  "brandTertiary": "#64748b",
  "defaultTheme": "LIGHT",
  "currency": "BOB",
  "country": "BOLIVIA"
}
```

---

Requiere JWT (cualquier usuario autenticado del tenant).

### GET /api/v1/tenant/branding
Response 200
```json
{
  "tenantId": "00000000-0000-0000-0000-000000000001",
  "tenantName": "Supernovatel",
  "logoUrl": "https://.../tenant-logos/<tenantId>.png",
  "brandPrimary": "#0f172a",
  "brandSecondary": "#334155",
  "brandTertiary": "#64748b",
  "defaultTheme": "LIGHT",
  "currency": "BOB",
  "country": "BOLIVIA"
}
```

### PATCH /api/v1/tenant/branding
Requiere JWT.

Body (campos opcionales; enviar al menos 1)
```json
{
  "logoUrl": "https://.../tenant-logos/<tenantId>.png",
  "brandPrimary": "#0f172a",
  "brandSecondary": "#334155",
  "brandTertiary": "#64748b",
  "defaultTheme": "LIGHT",
  "currency": "BOB",
  "country": "BOLIVIA"
}
```

Response 200 (mismo shape que `GET /api/v1/tenant/branding`).

---

## Admin — Tenant Branding
Requiere JWT + permiso: `admin:users:manage`.

### GET /api/v1/admin/tenant/branding
Response 200 (mismo shape que `GET /tenant/branding`).

Nota
- Además incluye `version` y `updatedAt` (optimistic locking / auditoría de cambios del tenant).

### PUT /api/v1/admin/tenant/branding
Body
```json
{
  "logoUrl": "https://.../tenant-logos/<tenantId>.png",
  "brandPrimary": "#0f172a",
  "brandSecondary": "#334155",
  "brandTertiary": "#64748b",
  "defaultTheme": "LIGHT"
}
```

Response 200
```json
{
  "tenantId": "00000000-0000-0000-0000-000000000001",
  "version": 2,
  "updatedAt": "2025-12-19T00:00:00.000Z"
}
```

Notas
- `logoUrl` puede ser `null` para “sin logo”.
- Colores deben ser HEX (`#RRGGBB`).

### POST /api/v1/admin/tenant/branding/logo-upload
Genera una URL presignada para subir el logo a S3-compatible.

Body
```json
{
  "fileName": "logo.png",
  "contentType": "image/png"
}
```

Response 200
```json
{
  "uploadUrl": "https://...",
  "publicUrl": "https://...",
  "key": "tenant-logos/<tenantId>.png",
  "expiresInSeconds": 600,
  "method": "PUT"
}
```

Notas
- El cliente debe hacer `PUT uploadUrl` con el archivo (y `Content-Type` acorde).
- Luego guardar `publicUrl` en `PUT /api/v1/admin/tenant/branding`.
- Requiere configurar env vars S3 (ver `backend/.env.example`).
  - Si no se configura S3, el resto del sistema funciona; solo se deshabilita el upload de logos.

---

## Platform — Tenants (Provisioning)
Requiere JWT + permiso: `platform:tenants:manage`.

Uso típico:
- En `farmacia.supernovatel.com` un usuario “platform admin” crea nuevos tenants.
- Luego el admin del tenant entra por su dominio (ej. `farmacia.febsa.com`) y gestiona usuarios/branding.

### GET /api/v1/platform/tenants
Query
- `take` (1..50, default 20)
- `cursor` (uuid, opcional)
- `q` (string, opcional; filtra por nombre)

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "name": "Febsa",
      "isActive": true,
      "branchLimit": 4,
      "createdAt": "...",
      "updatedAt": "...",
      "domains": [{ "domain": "farmacia.febsa.com", "isPrimary": true, "verifiedAt": "..." }]
    }
  ],
  "nextCursor": null
}
```

### POST /api/v1/platform/tenants
Crea tenant + módulos default (`WAREHOUSE`,`SALES`) + rol `TENANT_ADMIN` + usuario admin inicial + `branchCount` warehouses (`BR-01..`) con `BIN-01`.

Body
```json
{
  "name": "Febsa",
  "branchCount": 4,
  "adminEmail": "admin@febsa.com",
  "adminPassword": "Admin123!",
  "primaryDomain": "farmacia.febsa.com"
}
```

Response 201
```json
{ "id": "...", "name": "Febsa" }
```

Notas
- `primaryDomain` es opcional; si se setea debe ser único.
- Para pruebas locales con múltiples tenants y mismo email, usar dominios/hosts para que el login resuelva el tenant.

### GET /.well-known/pharmaflow-domain-verification
Sin auth.

Descripción
- Endpoint público que devuelve el token de verificación (texto plano) para el `Host` actual.
- Solo responde si el dominio está registrado, **no verificado** y tiene token vigente.

Response
- `200 text/plain`: token
- `404 text/plain`: `not-found`

### GET /api/v1/platform/tenants/:tenantId/domains
Lista dominios asociados a un tenant.

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "domain": "farmacia.febsa.com",
      "isPrimary": true,
      "verifiedAt": null,
      "verificationTokenExpiresAt": "...",
      "createdAt": "..."
    }
  ]
}
```

### POST /api/v1/platform/tenants/:tenantId/domains
Registra un dominio (pendiente de verificación) y genera token temporal.

Body
```json
{
  "domain": "farmacia.febsa.com",
  "isPrimary": true
}
```

Response 201
```json
{
  "id": "...",
  "tenantId": "...",
  "domain": "farmacia.febsa.com",
  "isPrimary": true,
  "verifiedAt": null,
  "verificationTokenExpiresAt": "...",
  "verification": {
    "token": "<token>",
    "url": "https://farmacia.febsa.com/.well-known/pharmaflow-domain-verification",
    "expiresAt": "..."
  }
}
```

Notas
- La verificación se hace por archivo HTTP(s). El backend expone el token por dominio en:
  - `/.well-known/pharmaflow-domain-verification` (texto plano, según `Host`).

### POST /api/v1/platform/tenants/:tenantId/domains/:domain/verify
Verifica que el dominio apunte a este despliegue (y marca `verifiedAt`).

Body (opcional)
```json
{ "timeoutMs": 6000 }
```

Response 200
```json
{ "ok": true, "verifiedAt": "..." }
```

---

## Catalog / Search
Requiere permiso `catalog:read`.

### GET /api/v1/catalog/search
Query
- `q` (string, requerido)
- `take` (int, 1..50, default 20)

Response 200
```json
{
  "items": [{ "id": "...", "sku": "SKU-1", "name": "Producto" }]
}
```

---

## Products
Requiere permisos `catalog:*`.

### POST /api/v1/products
Requiere permiso: `catalog:write`.

Body
```json
{
  "sku": "SKU-001",
  "name": "Paracetamol 500mg",
  "description": "Opcional"
}
```

Response 201
```json
{
  "id": "...",
  "sku": "SKU-001",
  "name": "Paracetamol 500mg",
  "version": 1,
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

Notas
- `409` si el SKU ya existe (único por tenant).

### GET /api/v1/products
Requiere permiso: `catalog:read`.

Query
- `take` (1..200, default 20)
- `cursor` (uuid, opcional)

Response 200
```json
{
  "items": [{ "id": "...", "sku": "...", "name": "...", "photoUrl": "https://..." , "isActive": true, "version": 1, "updatedAt": "..." }],
  "nextCursor": "..."
}
```

### GET /api/v1/products/:id
Requiere permiso: `catalog:read`.

Response 200
```json
{
  "id": "...",
  "sku": "...",
  "name": "...",
  "description": null,
  "photoUrl": "https://...",
  "isActive": true,
  "version": 1,
  "updatedAt": "..."
}
```

### PATCH /api/v1/products/:id
Requiere permiso: `catalog:write`.

Body
- `version` (int, requerido)
- `name` (opcional)
- `description` (opcional, puede ser `null`)
- `photoUrl` (opcional, puede ser `null`)
- `photoKey` (opcional, puede ser `null`)
- `isActive` (opcional)

Ejemplo
```json
{ "version": 1, "name": "Nuevo nombre" }
```

Notas
- `409` si `version` no coincide.
- `photoUrl` y `photoKey` deben enviarse **juntos**.

### POST /api/v1/products/:id/photo-upload
Requiere permiso: `catalog:write`.

Genera una URL presignada para subir la **foto del producto** a S3-compatible.

Body
```json
{
  "fileName": "foto.webp",
  "contentType": "image/webp"
}
```

Response 200
```json
{
  "uploadUrl": "https://...",
  "publicUrl": "https://...",
  "key": "tenants/<tenantId>/products/<productId>/photo-...webp",
  "expiresInSeconds": 300,
  "method": "PUT"
}
```

Notas
- El cliente debe hacer `PUT uploadUrl` con el archivo (y `Content-Type` acorde).
- Luego debe persistir `publicUrl` y `key` en `PATCH /api/v1/products/:id` (`photoUrl`/`photoKey`).
- Requiere configurar env vars S3 (ver README).

### GET /api/v1/products/:id/recipe
Requiere permiso: `catalog:read`.

Response 200
```json
{
  "id": "...",
  "productId": "...",
  "name": "Receta de Omeprazol 50 comprimidos",
  "outputQuantity": "50",
  "outputUnit": "comprimidos",
  "version": 1,
  "updatedAt": "...",
  "items": [
    {
      "id": "...",
      "ingredientProductId": null,
      "ingredientName": "Agua",
      "quantity": "10",
      "unit": "L",
      "sortOrder": 0,
      "note": null
    }
  ]
}
```

Notas
- `404` si el producto no tiene recetario.

### PUT /api/v1/products/:id/recipe
Requiere permiso: `catalog:write`.

Body
- `name` (requerido)
- `outputQuantity` (opcional, puede ser `null`)
- `outputUnit` (opcional, puede ser `null`)
- `items` (opcional) lista de insumos
  - `ingredientName` (string) **o** `ingredientProductId` (uuid)
  - `quantity` (number)
  - `unit` (string)
  - `sortOrder` (opcional)
  - `note` (opcional)
- `version` (int, requerido para updates)

Ejemplo (create)
```json
{
  "name": "Receta de Omeprazol 50 comprimidos",
  "outputQuantity": 50,
  "outputUnit": "comprimidos",
  "items": [
    { "ingredientName": "Agua", "quantity": 10, "unit": "L" },
    { "ingredientName": "Harina", "quantity": 2, "unit": "kg" }
  ]
}
```

Notas
- `409` si `version` no coincide.

### DELETE /api/v1/products/:id/recipe
Requiere permiso: `catalog:write`.

Response
- `204` si elimina.
- `404` si no existe.

---

## ProductPresentations
Requiere permisos `catalog:*`.

### POST /api/v1/products/:productId/presentations
Requiere permiso: `catalog:write`.

Notas
- La unicidad de la presentación es por combinación `name + unitsPerPresentation` dentro del producto y tenant.
- Se permite repetir el mismo formato si cambia la cantidad de unidades. Ejemplo válido: `Caja` de 20 unidades y `Caja` de 50 unidades.
- `409` si ya existe otra presentación con el mismo `name` y el mismo `unitsPerPresentation` para ese producto.

Body
```json
{
  "name": "Caja",
  "unitsPerPresentation": 200,
  "priceOverride": 50.00,
  "isDefault": true,
  "sortOrder": 1
}
```

Response 201
```json
{
  "id": "...",
  "tenantId": "...",
  "productId": "...",
  "name": "Caja",
  "unitsPerPresentation": 200,
  "priceOverride": 50.00,
  "isDefault": true,
  "sortOrder": 1,
  "isActive": true,
  "version": 1,
  "createdAt": "2026-01-27T00:00:00.000Z",
  "updatedAt": "2026-01-27T00:00:00.000Z"
}
```

### GET /api/v1/products/:productId/presentations
Requiere permiso: `catalog:read`.

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "name": "Caja",
      "unitsPerPresentation": 200,
      "priceOverride": 50.00,
      "isDefault": true,
      "sortOrder": 1,
      "isActive": true,
      "version": 1,
      "updatedAt": "..."
    }
  ]
}
```

### PATCH /api/v1/products/:productId/presentations/:id
Requiere permiso: `catalog:write`.

Notas
- Al editar, sigue aplicando la misma regla de unicidad por `name + unitsPerPresentation`.

Body
- `version` (int, requerido)
- `name` (opcional)
- `unitsPerPresentation` (opcional)
- `priceOverride` (opcional, puede ser `null`)
- `isDefault` (opcional)
- `sortOrder` (opcional)
- `isActive` (opcional)

### DELETE /api/v1/products/:productId/presentations/:id
Requiere permiso: `catalog:write`.

Response 204

---

## Batches
Requiere permiso: `catalog:read` (listar) y `catalog:write` (crear/editar/eliminar).

### GET /api/v1/products/:id/batches
Requiere permiso: `catalog:read`.

Query
- `take` (1..100, default 50)

Response 200
```json
{
  "hasStockRead": true,
  "items": [
    {
      "id": "...",
      "batchNumber": "LOT-2026-0001",
      "manufacturingDate": "2026-01-01T00:00:00.000Z",
      "expiresAt": "2027-01-01T00:00:00.000Z",
      "presentationId": "...",
      "status": "RELEASED",
      "version": 1,
      "createdAt": "2026-01-05T00:00:00.000Z",
      "updatedAt": "2026-01-05T00:00:00.000Z",
      "canManage": true,
      "totalQuantity": "30",
      "totalReservedQuantity": "0",
      "totalAvailableQuantity": "30",
      "locations": [
        {
          "warehouseId": "...",
          "warehouseCode": "WH-01",
          "warehouseName": "Almacén",
          "locationId": "...",
          "locationCode": "BIN-01",
          "quantity": "30",
          "reservedQuantity": "0",
          "availableQuantity": "30"
        }
      ]
    }
  ]
}
```

Notas
- `hasStockRead=false` si el usuario no tiene `stock:read`; en ese caso `totalQuantity` es `null` y `locations` viene vacío.
- `canManage=true` solo si el lote fue creado por el usuario actual (habilita editar/eliminar metadata).

### POST /api/v1/products/:id/batches
Body
```json
{
  "batchNumber": "LOT-2025-0001",
  "manufacturingDate": "2025-01-01T00:00:00.000Z",
  "expiresAt": "2026-01-01T00:00:00.000Z",
  "status": "RELEASED",
  "initialStock": {
    "warehouseId": "<uuid>",
    "quantity": 30,
    "note": "Ingreso inicial"
  }
}
```

Response 201
```json
{
  "id": "...",
  "productId": "...",
  "batchNumber": "LOT-2025-0001",
  "expiresAt": "2026-01-01T00:00:00.000Z",
  "status": "RELEASED",
  "version": 1,
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

Notas
- `batchNumber` es requerido (en catálogo no se autogenera).
- `409` si el `batchNumber` ya existe para el producto.
- Si se envía `initialStock`, se crea además un `StockMovement` tipo `IN` (numerado `MSYYYY-N`) y se actualiza `InventoryBalance`.
  - Si se envía `warehouseId`, el backend resuelve automáticamente una ubicación activa dentro del almacén.
  - También se acepta `toLocationId` (compatibilidad), pero la UI usa `warehouseId`.
  - `initialStock` acepta **cantidad base** (`quantity`) o **cantidad por presentación** (`presentationId` + `presentationQuantity`).

Ejemplo: ingreso inicial por presentación
```json
{
  "batchNumber": "LOT-2025-0001",
  "initialStock": {
    "warehouseId": "<uuid>",
    "presentationId": "<uuid>",
    "presentationQuantity": 2,
    "note": "Ingreso inicial"
  }
}
```

### PATCH /api/v1/products/:productId/batches/:batchId/status
Requiere permiso: `catalog:write`.

Body
```json
{
  "status": "RELEASED" | "QUARANTINE",
  "version": 1
}
```

Response 200
```json
{
  "id": "...",
  "batchNumber": "LOT-2025-0001",
  "status": "QUARANTINE",
  "version": 2,
  "updatedAt": "2025-01-01T00:00:00.000Z"
}
```

Notas
- Usa control de concurrencia optimista con `version`.
- `409` si la versión no coincide.

### GET /api/v1/products/:productId/batches/:batchId/movements
Requiere permisos: `catalog:read` + `stock:read`.

Response 200
```json
{
  "batch": { "id": "...", "batchNumber": "LOT-2026-0001" },
  "items": [
    {
      "id": "...",
      "number": "MS2026-0001",
      "numberYear": 2026,
      "createdAt": "2026-01-05T00:00:00.000Z",
      "type": "IN",
      "quantity": "30",
      "presentationId": "...",
      "presentationQuantity": "2",
      "presentation": { "id": "...", "name": "Caja", "unitsPerPresentation": "15" },
      "referenceType": null,
      "referenceId": null,
      "note": "Ingreso inicial",
      "from": null,
      "to": {
        "id": "...",
        "code": "BIN-01",
        "warehouse": { "id": "...", "code": "WH-01", "name": "Almacén" }
      }
    }
  ]
}
```

### GET /api/v1/products/:productId/batches/:batchId/movements
Requiere permisos: `catalog:read` + `stock:read`.

Response 200
```json
{
  "batch": { "id": "...", "batchNumber": "LOT-2026-0001" },
  "items": [
    {
      "id": "...",
      "number": "MS2026-0001",
      "numberYear": 2026,
      "createdAt": "2026-01-05T00:00:00.000Z",
      "type": "IN",
      "quantity": "30",
      "presentationId": "...",
      "presentationQuantity": "2",
      "presentation": { "id": "...", "name": "Caja", "unitsPerPresentation": "15" },
      "referenceType": null,
      "referenceId": null,
      "note": "Ingreso inicial",
      "from": null,
      "to": {
        "id": "...",
        "code": "BIN-01",
        "warehouse": { "id": "...", "code": "WH-01", "name": "Almacén" }
      }
    }
  ]
}
```

### GET /api/v1/products/:id/kardex
Requiere permisos: `catalog:read` + (`stock:read` si se desea ver stock detallado).

Reconstruye el kardex del producto mediante `AuditEvent` (`action = 'stock.movement.create'`), ordenado cronológicamente ascendente. El flujo interno es: `warehouseId` → `Location` (ubicaciones de la sucursal) → `InventoryBalance` (IDs) → `AuditEvent` (movimientos cuyo `entityId` es un `StockMovement.id`). La tabla principal se muestra en **unidades base**, con un resumen consolidado al final.

Query (opcionales)
- `warehouseId` (uuid, opcional) — filtra movimientos que afectan a una sucursal específica. El balance acumulado solo incluye movimientos cuyo `fromLocationId` o `toLocationId` pertenecen a ubicaciones de esa sucursal. Las transferencias (`TRANSFER`) solo afectan si from o to están en la sucursal; movimientos `IN`/`OUT` sin ubicación se atribuyen a la sucursal consultada. Los ajustes (`ADJUSTMENT`) se incluyen cuando su `toLocationId` o `fromLocationId` pertenece a la sucursal; si el ajuste incrementa (`toLocationId`), suma al stock; si decrementa (`fromLocationId`), resta.
- `locationId` (uuid, opcional) — filtra movimientos que afectan a una ubicación específica.
- `from` (date-time, opcional) — fecha mínima.
- `to` (date-time, opcional) — fecha máxima (exclusivo).

Notas
- El saldo acumulado (`runningBalance` en `summary`) se toma del `AuditEvent.after.toBalance.quantity` (o `fromBalance` según el rol) cuando el evento está disponible; si no hay evento de auditoría, se cae al acumulado de `entry - exit`.
- El saldo actual (`currentStock`) proviene de la suma de `InventoryBalance.quantity` para la sucursal filtrada (fuente autoritativa), no del cálculo acumulado.
- Los movimientos que no afectan a la sucursal filtrada se marcan con `affectsWarehouse=false`.
- Para movimientos `OUT` con `referenceType: 'SALES_ORDER'`: `toCode` = número de orden de venta, `toWarehouseCode` = nombre del cliente. El `detail` incluye `[SALES_ORDER] NRO - Cliente: Nombre`.
- La respuesta incluye `fromWarehouseCode` y `toWarehouseCode` (códigos de sucursal de origen/destino) y `fromLocationCode`/`toLocationCode` (códigos de ubicación).

Response 200
```json
{
  "product": {
    "id": "...",
    "sku": "SKU-001",
    "name": "Paracetamol 500mg",
    "baseUnitAbbreviation": "u"
  },
  "hasStockRead": true,
  "currentStock": "210",
  "kardex": [
    {
      "date": "2026-03-01T00:00:00.000Z",
      "batchId": "...",
      "batchNumber": "LOT-2026-0001",
      "presentationId": "",
      "presentationLabel": "Caja (20u)",
      "presentationUnits": "1",
       "fromCode": null,
       "fromWarehouseCode": null,
       "fromLocationCode": null,
       "toCode": "BIN-01",
       "toWarehouseCode": "ALM-01",
       "toLocationCode": "BIN-01",
       "warehouseCode": "ALM-01",
       "warehouseName": "Almacén",
       "quantity": 20,
       "entry": 20,
       "exit": 0,
       "balance": 20,
       "affectsWarehouse": true,
       "movementId": "...",
       "movementType": "IN",
       "movementNumber": "M-0001",
       "detail": "Ingreso • Lote LOT-2026-0001 • Hacia BIN-01 (Almacén)",
      "fromBalanceQty": null,
      "toBalanceQty": 20
    }
  ],
  "summary": {
    "totalMovements": 5,
    "runningBalance": 210,
    "currentStock": 210,
    "totalBatches": 3,
    "byBatch": [
      {
        "batchId": "...",
        "batchNumber": "LOT-2026-0001",
        "presentationId": "...",
        "presentationName": "Caja",
        "unitsPerPresentation": 20,
        "quantity": 200,
        "presentationQuantity": 10,
        "expiresAt": "2027-03-01T00:00:00.000Z"
      }
    ],
    "byPresentation": [
      {
        "label": "Caja (20u)",
        "units": 20,
        "total": 200,
        "presentations": 10
      }
    ]
  }
}
```

Notas
- `fromCode` y `toCode` indican la ubicación de origen y destino del movimiento. Para movimientos `IN` (creación/ingreso), `fromCode` es `null`.
- `affectsWarehouse` indica si el movimiento afecta la sucursal filtrada. Transferencias inter-sucursales se muestran con `affectsWarehouse=false` y no incluyen en el saldo acumulado.
- `currentStock` y `totals.currentBalance` provienen de `InventoryBalance` (fuente autoritativa), garantizando que el saldo refleje el stock real. El `totals.balance` es el saldo acumulado sobre movimientos filtrados.

---

### PATCH /api/v1/products/:productId/batches/:batchId
Requiere permiso: `catalog:write`.

Notas
- **Solo el creador** del lote puede editar (`403` si no coincide).
- Usa control de concurrencia optimista con `version` (`409` si no coincide).
- `409` si el `batchNumber` ya existe para el producto.

Body
```json
{
  "version": 1,
  "batchNumber": "LOT-2026-0002",
  "manufacturingDate": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "presentationId": "<uuid>"
}
```

Response 200
```json
{
  "id": "...",
  "batchNumber": "LOT-2026-0002",
  "manufacturingDate": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "presentationId": "...",
  "status": "RELEASED",
  "version": 2,
  "updatedAt": "2026-01-05T00:00:00.000Z"
}
```

### DELETE /api/v1/products/:productId/batches/:batchId
Requiere permiso: `catalog:write`.

Notas
- **Solo el creador** del lote puede eliminar (`403` si no coincide).
- Usa control de concurrencia optimista con `version` (`409` si no coincide).
- `409` si el lote tiene referencias (stock/sales/devoluciones/lab).

Body
```json
{ "version": 1 }
```

Response 200
```json
{ "ok": true }
```

---

## Warehouses / Locations
Requiere: módulo `WAREHOUSE` + permiso `stock:read`.

### GET /api/v1/warehouses
Query
- `take` (1..100, default 50)
- `cursor` (uuid, opcional)

Response 200
```json
{
  "items": [{ "id": "...", "code": "SUC-01", "name": "Almacén", "city": "LA PAZ", "isActive": true, "version": 1, "updatedAt": "...", "totalQuantity": "10" }],
  "nextCursor": "..."
}
```

Notas
- `totalQuantity` es la suma de `InventoryBalance.quantity` de todas las ubicaciones del almacén.
- Para ver **qué productos/lotes** componen ese stock, usar el reporte `GET /api/v1/reports/stock/balances-expanded?warehouseId=...`.

### GET /api/v1/warehouses/:id/locations
Query
- `take` (1..100, default 50)
- `cursor` (uuid, opcional)

Response 200
```json
{
  "items": [{ "id": "...", "warehouseId": "...", "code": "BIN-01", "type": "BIN", "isActive": true, "version": 1, "updatedAt": "..." }],
  "nextCursor": "..."
}
```

### POST /api/v1/warehouses
Requiere permiso: `stock:manage`.

Body
```json
{
  "code": "SUC-01",
  "name": "Sucursal Central",
  "city": "LA PAZ"
}
```

Response 201
```json
{
  "id": "...",
  "code": "SUC-01",
  "name": "Sucursal Central",
  "city": "LA PAZ",
  "isActive": true,
  "version": 1,
  "updatedAt": "...",
  "totalQuantity": "0"
}
```

Notas
- Crea automáticamente una ubicación por defecto (`BIN-01`, tipo `BIN`) en la sucursal.
- `409` si el código ya existe (único por tenant).
- `409` si el tenant no tiene configurado `country` (ver `PATCH /api/v1/tenant/branding`).
- El código debe comenzar con "SUC-" y contener solo letras mayúsculas y números después del prefijo.

### PATCH /api/v1/warehouses/:id
Requiere permiso: `stock:manage`.

Body (campos opcionales; enviar al menos 1)
```json
{
  "name": "Sucursal Central",
  "city": "LA PAZ"
}
```

Response 200
```json
{
  "id": "...",
  "code": "SUC-01",
  "name": "Sucursal Central",
  "city": "LA PAZ",
  "isActive": true,
  "version": 2,
  "updatedAt": "...",
  "totalQuantity": "10"
}
```

### POST /api/v1/warehouses/:id/locations
Requiere permiso: `stock:manage`.

Body
```json
{
  "code": "BIN-02",
  "type": "BIN"
}
```

Response 201
```json
{
  "id": "...",
  "warehouseId": "...",
  "code": "BIN-02",
  "type": "BIN",
  "isActive": true,
  "version": 1,
  "updatedAt": "..."
}
```

Notas
- `type` puede ser `BIN`, `SHELF`, `FLOOR`.
- `409` si el código ya existe en esa sucursal.

---

## Stock
Requiere: módulo `WAREHOUSE`.

### GET /api/v1/stock/balances
Requiere permiso: `stock:read`.

Query (opcionales)
- `locationId` (uuid)
- `productId` (uuid)

Response 200
```json
{
  "items": [{
    "id": "...",
    "locationId": "...",
    "productId": "...",
    "batchId": null,
    "quantity": "10",
    "version": 1,
    "updatedAt": "..."
  }]
}
```

### GET /api/v1/stock/expiry/summary
Requiere permiso: `stock:read`.

Query (opcionales)
- `warehouseId` (uuid)
- `status` (EXPIRED|RED|YELLOW|GREEN)
- `daysToExpireMax` (int, opcional)
- `take` (1..200, default 100)
- `cursor` (uuid, opcional; paginación)

Regla de semáforo (según `daysToExpire`, usando inicio de día UTC)
- `EXPIRED`: < 0
- `RED`: 0..30
- `YELLOW`: 31..90
- `GREEN`: > 90

Response 200
```json
{
  "items": [{
    "balanceId": "...",
    "productId": "...",
    "sku": "...",
    "name": "...",
    "batchId": "...",
    "batchNumber": "...",
    "expiresAt": "2026-01-31T00:00:00.000Z",
    "daysToExpire": 12,
    "status": "YELLOW",
    "quantity": "10",
    "warehouseId": "...",
    "warehouseCode": "WH-01",
    "warehouseName": "Almacén",
    "locationId": "...",
    "locationCode": "BIN-01"
  }],
  "nextCursor": "...",
  "generatedAt": "..."
}
```

### GET /api/v1/stock/fefo-suggestions
Requiere permiso: `stock:read`.

Query
- `productId` (uuid)
- `locationId` (uuid, opcional)
- `warehouseId` (uuid, opcional)
- `take` (1..50, default 10)

Notas
- Debes enviar `locationId` o `warehouseId`.
- Si envías `warehouseId`, el stock se agrega a nivel de warehouse.

Notas
- Retorna lotes con stock disponible ordenados por `expiresAt` asc.
- Excluye lotes vencidos (y permite `expiresAt: null`).

Response 200
```json
{
  "items": [{
    "batchId": "...",
    "batchNumber": "...",
    "expiresAt": "2026-01-31T00:00:00.000Z",
    "status": "AVAILABLE",
    "quantity": "5"
  }]
}
```

### POST /api/v1/stock/movements
Requiere permiso: `stock:move`.

Body
```json
{
  "type": "IN",
  "productId": "...",
  "batchId": null,
  "fromLocationId": null,
  "toLocationId": "...",
  "quantity": 5,
  "referenceType": "MANUAL",
  "referenceId": "REF-1",
  "note": "Ingreso"
}
```

Notas de reglas
- `IN` requiere `toLocationId`.
- `OUT` requiere `fromLocationId`.
- `TRANSFER` requiere ambos.
- `ADJUSTMENT` requiere `fromLocationId` o `toLocationId`.
- `409` si stock insuficiente.
- `409` si intenta descontar stock de un lote vencido (`batch.expiresAt` < hoy UTC).

Nota de uso (operación por “existencias”)
- Para mover existencias reales (lote + ubicación), primero listar balances con `GET /api/v1/reports/stock/balances-expanded` (filtrando por `warehouseId`, `productId` o `locationId`).
- Luego usar `productId`, `batchId` y `locationId` del registro como origen (`fromLocationId`) y definir el destino (`toLocationId`) con `type: "TRANSFER"`.

Response 201 (estructura)
```json
{
  "createdMovement": { "id": "...", "number": "MS2025-1", "numberYear": 2025, "type": "IN", "productId": "...", "batchId": null, "fromLocationId": null, "toLocationId": "...", "quantity": "5", "createdAt": "...", "referenceType": "MANUAL", "referenceId": "REF-1" },
  "fromBalance": null,
  "toBalance": { "id": "...", "quantity": "5", "locationId": "...", "productId": "...", "batchId": null, "version": 1, "updatedAt": "..." }
}
```

Realtime emit (por tenant room `tenant:<tenantId>`)
- `stock.movement.created`
- `stock.balance.changed`
- `stock.alert.low` (regla simple: balance llega a 0)

### POST /api/v1/stock/bulk-transfers
Requiere permiso: `stock:move`.

Body
```json
{
  "fromWarehouseId": "...",
  "fromLocationId": "...",
  "toWarehouseId": "...",
  "toLocationId": "...",
  "note": "Envío semanal",
  "items": [
    {
      "productId": "...",
      "batchId": "...",
      "quantity": 10,
      "note": "opcional"
    }
  ]
}
```

Notas
- Crea múltiples movimientos `TRANSFER` con `referenceType: "BULK_TRANSFER"` y el mismo `referenceId`.
- Reutiliza las reglas de validación de `POST /api/v1/stock/movements` (stock insuficiente, lote vencido, etc).

Response 201
```json
{
  "referenceType": "BULK_TRANSFER",
  "referenceId": "...",
  "items": [{ "createdMovement": { "id": "..." }, "fromBalance": {"id":"..."}, "toBalance": {"id":"..."} }]
}
```

### GET /api/v1/stock/completed-movements
Requiere permiso: `stock:move`.

Lista "Movimientos realizados" para UI, unificando:
- Movimientos individuales (manuales) relevantes para operación.
- Transferencias masivas (`referenceType: BULK_TRANSFER`) agrupadas por `referenceId`.
- Atenciones/envíos de solicitudes (`referenceType: MOVEMENT_REQUEST`) agrupadas por solicitud (incluye atenciones parciales).
- Devoluciones.

Notes
- Si el usuario tiene scope de sucursal (`ScopeBranch`), el backend exige sucursal seleccionada; si falta, responde `409`.
- Los resultados se combinan y ordenan por `completedAt` desc, luego se paginan. Cada origen (movimientos individuales, transferencias masivas, atenciones de solicitud, devoluciones) se consulta con un `take` interno de 300, por lo que el listado combinado puede contener hasta ~1200 registros antes de quedarse sin más páginas.

Query (paginación cursor)
- `take` (1..100, default 50): tamaño de página.
- `cursor` (string opcional): offset entero no negativo devuelto como `nextCursor` en la página anterior. Es opaco para el cliente.

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "type": "FULFILL_REQUEST",
      "typeLabel": "Atención de solicitud - SOL260001",
      "createdAt": "2026-03-05T12:00:00.000Z",
      "completedAt": "2026-03-05T12:10:00.000Z",
      "fromWarehouseCode": "CEN",
      "toWarehouseCode": "SCZ",
      "requestedByName": "Juan Pérez",
      "fulfilledByName": "María López",
      "totalItems": 4,
      "totalQuantity": 120,
      "totalQuantityUnits": 120,
      "totalQuantityPresentations": 12,
      "canExportPicking": true,
      "canExportLabel": true
    }
  ],
  "nextCursor": "50" // string con el offset para la página siguiente, o null si no hay más
}
```

Notas de cantidades
- `totalQuantity` y `totalQuantityUnits` representan unidades base (tal como se persisten en movimientos).
- `totalQuantityPresentations` representa la cantidad expresada en presentación (ej. cajas), calculada como `quantityUnits / unitsPerPresentation` según la presentación del lote. Puede ser decimal.

### GET /api/v1/stock/completed-movements/:id/picking
Requiere permiso: `stock:move`.

Params
- `id` (uuid)

Query
- `type`: `MOVEMENT` | `BULK_TRANSFER` | `FULFILL_REQUEST` | `RETURN`

Notas
- `409` si `type=RETURN` (picking no disponible).
- Si `type=MOVEMENT`, solo aplica para movimientos `OUT` o `TRANSFER`.
- Para `FULFILL_REQUEST` se usan los movimientos `OUT` de embarque (`referenceType: MOVEMENT_REQUEST`).

Response 200
```json
{
  "meta": {
    "requestId": "...",
    "requestCode": "SOL260001",
    "generatedAtIso": "2026-03-05T12:34:56.000Z",
    "fromWarehouseLabel": "CEN - Central (SANTA CRUZ)",
    "fromLocationCode": "A1",
    "toWarehouseLabel": "SCZ - Sucursal SCZ (SANTA CRUZ)",
    "toLocationCode": "BIN-01",
    "requestedByName": "Juan Pérez"
  },
  "requestedItems": [
    {
      "productLabel": "SKU - Producto (Genérico)",
      "quantityUnits": 100,
      "quantityPresentations": 10,
      "unitsPerPresentation": 10,
      "presentationLabel": "Caja (10u)"
    }
  ],
  "sentLines": [
    {
      "locationCode": "A1",
      "productLabel": "SKU - Producto (Genérico)",
      "batchNumber": "L-0001",
      "expiresAt": "2026-06-01T00:00:00.000Z",
      "quantityUnits": 100,
      "quantityPresentations": 10,
      "unitsPerPresentation": 10,
      "presentationLabel": "Caja (10u)"
    }
  ]
}
```

Notas
- `meta.requestCode` se devuelve cuando `type=FULFILL_REQUEST` (código humano `SOLYY####`). En los demás tipos puede venir `null`.
- `quantityPresentations` puede ser decimal (no se redondea hacia arriba).

### GET /api/v1/stock/completed-movements/:id/label
Requiere permiso: `stock:move`.

Params
- `id` (uuid)

Query
- `type`: `MOVEMENT` | `BULK_TRANSFER` | `FULFILL_REQUEST` | `RETURN`

Notas
- `409` si `type=RETURN` (rótulo no disponible).
- Si `type=MOVEMENT`, solo aplica para movimientos `OUT` o `TRANSFER`.

Response 200
```json
{
  "requestId": "...",
  "generatedAtIso": "2026-03-05T12:34:56.000Z",
  "fromWarehouseLabel": "SANTA CRUZ, BOLIVIA",
  "fromLocationCode": "A1",
  "toWarehouseLabel": "SANTA CRUZ, BOLIVIA",
  "toLocationCode": "BIN-01",
  "requestedByName": "Juan Pérez",
  "bultos": "—",
  "responsable": "María López",
  "observaciones": "—"
}
```

### GET /api/v1/stock/movement-requests
Requiere permiso: `stock:read`.

Query
- `take` (1..100, default 50)
- `status` (opcional): `OPEN` | `SENT` | `FULFILLED` | `CANCELLED`
- `city` (opcional): ciudad (string)
- `warehouseId` (opcional): id de sucursal/almacén destino

Notas
- Si el usuario tiene scope de sucursal (`ScopeBranch`), el backend filtra por la ciudad de la sucursal autenticada y no permite operar sin sucursal seleccionada.
- `code` es un identificador humano tipo `SOLYY####`, secuencial por tenant+año.
- La respuesta incluye `toLocationId` y `toLocation` (con warehouse anidado) cuando la solicitud tiene un sub-almacén destino.

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "code": "SOL260001",
      "status": "OPEN",
      "confirmationStatus": "PENDING",
      "warehouseId": "...",
      "warehouse": { "id": "...", "code": "SCZ", "name": "Sucursal SCZ", "city": "SANTA CRUZ" },
      "originWarehouse": { "id": "...", "code": "CEN", "name": "Central", "city": "SANTA CRUZ" },
      "toLocationId": "...",
      "toLocation": { "id": "...", "code": "SUB-01", "warehouse": { "id": "...", "code": "SCZ", "name": "Sucursal SCZ", "city": "SANTA CRUZ" } },
      "requestedCity": "SANTA CRUZ",
      "quoteId": null,
      "note": null,
      "requestedBy": "...",
      "requestedByName": "Juan Pérez",
      "fulfilledAt": null,
      "fulfilledBy": null,
      "fulfilledByName": null,
      "confirmedAt": null,
      "confirmedBy": null,
      "confirmedByName": null,
      "confirmationNote": null,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "items": [
        {
          "id": "...",
          "productId": "...",
          "productSku": "...",
          "productName": "...",
          "genericName": "...",
          "requestedQuantity": 100,
          "remainingQuantity": 100,
          "presentationId": "...",
          "presentationQuantity": 10,
          "presentation": { "id": "...", "name": "Caja", "unitsPerPresentation": "10" },
          "presentationName": "Caja",
          "unitsPerPresentation": "10"
        }
      ],
      "movements": [
        {
          "id": "...",
          "type": "OUT",
          "quantity": 100,
          "presentationQuantity": 10,
          "productId": "...",
          "productSku": "...",
          "productName": "...",
          "genericName": "...",
          "presentationId": "...",
          "presentation": { "id": "...", "name": "Caja", "unitsPerPresentation": 10 },
          "batchId": "...",
          "batch": { "id": "...", "batchNumber": "L-0001", "expiresAt": "2026-06-01T00:00:00.000Z" },
          "fromLocationId": "...",
          "fromLocation": {
            "id": "...",
            "code": "A1",
            "warehouse": { "id": "...", "code": "CEN", "name": "Central", "city": "SANTA CRUZ" }
          },
          "createdAt": "2026-01-01T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

Nota
- `presentation` es el campo recomendado (metadata completa). `presentationName` y `unitsPerPresentation` se mantienen por compatibilidad.

### POST /api/v1/stock/movement-requests
Requiere permiso: `stock:read`.

Body
```json
{
  "warehouseId": "...",
  "toLocationId": "... (opcional, sub-almacén destino)",
  "items": [
    { "productId": "...", "presentationId": "...", "quantity": 10 },
    { "productId": "...", "presentationId": "...", "quantity": 30 }
  ],
  "note": "opcional"
}
```

Notas
- `quantity` está expresado en cantidad de presentaciones (no en unidades base).
- El backend calcula `requestedQuantity`/`remainingQuantity` en unidades base usando `presentation.unitsPerPresentation`.
- `requestedByName` se determina automáticamente desde el usuario autenticado (nombre o email).
- `code` se asigna automáticamente al crear la solicitud.
- `toLocationId` es opcional: si se envía, debe pertenecer al `warehouseId` destino y representa el sub-almacén destino de la solicitud.

Response 201 (resumen)
```json
{
  "id": "...",
  "code": "SOL260002",
  "status": "OPEN",
  "confirmationStatus": "PENDING",
  "warehouseId": "...",
  "toLocationId": "..."
  "toLocation": { "id": "...", "code": "SUB-01", "warehouse": { "id": "...", "code": "...", "name": "...", "city": "..." } }
  "requestedCity": "SANTA CRUZ",
  "requestedByName": "Juan Pérez",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "items": [
    {
      "id": "...",
      "productId": "...",
      "requestedQuantity": 100,
      "remainingQuantity": 100,
      "presentationId": "...",
      "presentationQuantity": 10,
      "presentation": { "id": "...", "name": "Caja", "unitsPerPresentation": "10" },
      "presentationName": "Caja",
      "unitsPerPresentation": "10"
    }
  ]
}
```

### POST /api/v1/stock/movement-requests/:id/plan
Requiere permiso: `stock:move`.

Body
```json
{
  "fromWarehouseId": "...",
  "fromLocationId": "...",
  "takePerItem": 50,
  "allowExpired": false
}
```

### POST /api/v1/stock/movement-requests/:id/fulfill
Requiere permiso: `stock:move`.

Body
```json
{
  "fromLocationId": "...",
  "toLocationId": "...",
  "note": "opcional",
  "lines": [
    {
      "requestItemId": "...",
      "productId": "...",
      "batchId": "...",
      "quantity": 100,
      "note": "opcional"
    }
  ]
}
```

Notas
- Permite atención parcial: decrementa `remainingQuantity` por ítem y solo marca `FULFILLED` cuando el total restante llega a 0.
- Cada línea crea un movimiento `TRANSFER` con `referenceType: "REQUEST_FULFILL"` y `referenceId = requestId`.
- `quantity` está en unidades base. Alternativamente se puede enviar `presentationId + presentationQuantity` (debe coincidir con la presentación del ítem).

Response 201 (resumen)
```json
{
  "request": {
    "id": "...",
    "status": "OPEN"
  },
  "movements": [{ "id": "..." }],
  "balances": [{ "id": "..." }]
}
```

Notas
- Requiere `fromWarehouseId` o `fromLocationId`.
- Devuelve sugerencias de picking por ítem usando FEFO (vence primero) y priorizando lotes abiertos (`batch.openedAt != null`).
- `suggestedQuantityUnits` está en unidades base.

Response 200 (resumen)
```json
{
  "requestId": "...",
  "status": "OPEN",
  "warehouseId": "...",
  "warehouse": { "id": "...", "code": "SCZ", "name": "Sucursal SCZ", "city": "SANTA CRUZ" },
  "requestedCity": "SANTA CRUZ",
  "fromWarehouseId": "...",
  "fromWarehouse": { "id": "...", "code": "CEN", "name": "Central", "city": "SANTA CRUZ" },
  "fromLocationId": null,
  "generatedAt": "2026-02-02T00:00:00.000Z",
  "items": [
    {
      "requestItemId": "...",
      "productId": "...",
      "productSku": "...",
      "productName": "...",
      "remainingQuantityUnits": 100,
      "presentation": { "id": "...", "name": "Caja", "unitsPerPresentation": "10" },
      "suggestions": [
        {
          "inventoryBalanceId": "...",
          "locationId": "...",
          "locationCode": "A1",
          "batchId": "...",
          "batchNumber": "L-0001",
          "expiresAt": "2026-06-01T00:00:00.000Z",
          "openedAt": "2026-01-15T00:00:00.000Z",
          "availableQuantityUnits": 200,
          "suggestedQuantityUnits": 100,
          "suggestedPresentationQuantity": 10
        }
      ],
      "suggestedTotalUnits": 100,
      "shortageUnits": 0
    }
  ]
}
```

### POST /api/v1/stock/movement-requests/bulk-fulfill
Requiere permiso: `stock:move`.

Body
```json
{
  "requestIds": ["..."],
  "fromLocationId": "...",
  "toLocationId": "...",
  "note": "Atención SCZ",
  "lines": [
    {
      "productId": "...",
      "batchId": "...",
      "quantity": 10
    }
  ]
}
```

Notas
- Solo permite atender solicitudes `OPEN` de la ciudad de la sucursal destino.
- Crea movimientos `OUT` con `referenceType: "MOVEMENT_REQUEST"` y `referenceId = <requestId>` (envío/embarque hacia la sucursal destino).
- Cuando una solicitud queda con `remainingQuantity` total = 0, se marca `SENT` (pendiente de recepción en destino).
- La recepción se confirma vía `POST /api/v1/stock/movement-requests/:id/receive` (crea `IN` y marca `FULFILLED`).

Response 201
```json
{
  "referenceType": "REQUEST_BULK_FULFILL",
  "referenceId": "...",
  "destinationCity": "SANTA CRUZ",
  "createdMovements": [{ "createdMovement": { "id": "..." } }],
  "sentRequestIds": ["..."]
}
```

### POST /api/v1/stock/movement-requests/:id/receive
Requiere permiso: `stock:move`.

Confirma la **recepción** de un envío de una solicitud en estado `SENT`.

Notas
- Busca los movimientos `OUT` con `referenceType: "MOVEMENT_REQUEST"` y `referenceId = <requestId>`.
- Por cada `OUT` crea el movimiento `IN` correspondiente hacia el `toLocationId` del `OUT`.
- Marca la solicitud como `FULFILLED` y setea `confirmedAt/confirmedBy`.

Response 200
```json
{ "message": "Recepción confirmada exitosamente" }
```

### POST /api/v1/stock/movement-requests/:id/reception
Requiere permiso: `stock:move`.

Endpoint unificado para **recepcionar y devolver** parcialmente los productos de un envío en un solo request. Reemplaza a los botones separados de "recepcionar" y "devolver" en la UI de `/stock/returns`.

Body
```json
{
  "items": [
    {
      "outMovementId": "<uuid del movimiento OUT enviado>",
      "receivedQuantity": 95,
      "returnedQuantity": 5,
      "returnReason": "Producto dañado en el envío"
    }
  ],
  "note": "observaciones generales (opcional)",
  "photoUrl": "https://... (opcional)",
  "photoKey": "tenants/.../stock-returns/photo-...jpg (opcional)"
}
```

Notas
- Cada `item` corresponde a un movimiento `OUT` con `pendingQuantity > 0`.
- `receivedQuantity + returnedQuantity <= pendingQuantity` (el resto sigue pendiente).
- Si `returnedQuantity > 0`, se requiere `returnReason` (mínimo 1 carácter).
- Para "recepción completa" de un ítem: `receivedQuantity = pending`, `returnedQuantity = 0`.
- Crea movimientos `IN` con `referenceType: "MOVEMENT_REQUEST_RECEIPT"` (recepción) y/o `MOVEMENT_REQUEST_RETURN` (devolución, hacia `fromLocationId` del `OUT`).
- Si la solicitud estaba en `SENT` y quedan 0 cantidades pendientes después de la operación, se marca `FULFILLED` con `confirmedAt/confirmedBy`.
- `photoUrl` / `photoKey` se almacenan en las notas de los movimientos `IN` creados (el modelo `StockMovement` no tiene campos de foto; la foto se sube con antelación vía `POST /api/v1/stock/returns/photo-upload`).
- El usuario scope-branch debe tener la sucursal seleccionada (`409` si falta) y solo puede operar envíos cuyo `toLocationId` pertenece a su sucursal (`403` si no).

Response 200
```json
{ "message": "Recepción registrada (5 recibidos, 1 devueltos)" }
```
Requiere permiso: `stock:move`.

Genera una URL presignada para subir la foto de evidencia (S3/MinIO compatible).

Body
```json
{
  "fileName": "evidencia.jpg",
  "contentType": "image/jpeg"
}
```

Notas
- `contentType` permitido: `image/png`, `image/jpeg`, `image/webp`.
- Requiere configuración S3 en backend (S3_* y S3_PUBLIC_BASE_URL).

Response 200
```json
{
  "uploadUrl": "https://...",
  "publicUrl": "https://...",
  "key": "tenants/<tenantId>/stock-returns/photo-...jpg",
  "expiresInSeconds": 300,
  "method": "PUT"
}
```

### POST /api/v1/stock/returns
Requiere permiso: `stock:move`.

Registra una devolución y crea movimientos `IN` por ítem con `referenceType: "RETURN"` y `referenceId = <returnId>`.

Body
```json
{
  "toLocationId": "...",
  "reason": "Producto dañado",
  "note": "Caja golpeada",
  "photoKey": "tenants/.../stock-returns/photo-...jpg",
  "photoUrl": "https://.../tenants/.../stock-returns/photo-...jpg",
  "sourceType": "SALES_ORDER",
  "sourceId": "...",
  "items": [
    {
      "productId": "...",
      "batchId": "...",
      "quantity": 5,
      "presentationId": null,
      "presentationQuantity": null,
      "note": "opcional"
    }
  ]
}
```

Notas
- En modo `scope:branch` (usuarios branch-scoped): `409` si el usuario no seleccionó sucursal; `403` si `toLocationId` no pertenece a la ciudad de su sucursal.
- `TENANT_ADMIN` (y platform admin) no requiere seleccionar sucursal y no queda sujeto al filtro por ciudad.

Response 201
```json
{ "id": "...", "createdAt": "2026-01-29T00:00:00.000Z" }
```

### GET /api/v1/stock/returns
Requiere permiso: `stock:read`.

Query (opcionales)
- `from` (date-time)
- `to` (date-time)
- `warehouseId` (uuid)
- `take` (1..200, default 50)

Response 200 (estructura)
```json
{ "items": [ { "id": "...", "reason": "...", "toLocation": { "id": "...", "code": "BIN-03", "warehouse": { "id": "...", "code": "WH-03", "name": "Sucursal", "city": "Santa Cruz" } }, "items": [ { "id": "...", "productId": "...", "quantity": "5" } ] } ] }
```

### GET /api/v1/stock/returns/:id
Requiere permiso: `stock:read`.

Response 200
```json
{ "item": { "id": "...", "reason": "...", "toLocationId": "...", "items": [] } }
```

## Customers
Requiere: módulo `SALES`.

### POST /api/v1/customers
Requiere permiso: `sales:order:write`.

Body
```json
{
  "name": "Cliente",
  "nit": "123",
  "email": "c@c.com",
  "phone": "...",
  "address": "...",
  "city": "LA PAZ",
  "zone": "ZONA SUR",
  "mapsUrl": "https://maps.google.com/?q=...",
  "creditDays7Enabled": false,
  "creditDays14Enabled": false
}
```

Response 201
```json
{
  "id": "...",
  "name": "Cliente",
  "nit": "123",
  "email": "c@c.com",
  "phone": "...",
  "address": "...",
  "city": "LA PAZ",
  "zone": "ZONA SUR",
  "mapsUrl": "https://maps.google.com/?q=...",
  "creditDays7Enabled": false,
  "creditDays14Enabled": false,
  "isActive": true,
  "version": 1,
  "createdAt": "..."
}
```

### GET /api/v1/customers
Requiere permiso: `sales:order:read`.

Query
- `take` (1..50, default 20)
- `cursor` (uuid, opcional)
- `q` (string, opcional; filtra por name)

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "name": "...",
      "nit": null,
      "email": null,
      "phone": null,
      "city": "LA PAZ",
      "zone": "ZONA SUR",
      "mapsUrl": null,
      "isActive": true,
      "creditDays7Enabled": false,
      "creditDays14Enabled": false,
      "version": 1,
      "updatedAt": "..."
    }
  ],
  "nextCursor": "..."
}
```

### GET /api/v1/customers/:id
Requiere permiso: `sales:order:read`.

### PATCH /api/v1/customers/:id
Requiere permiso: `sales:order:write`.

Body
- `version` requerido
- campos opcionales: `name`, `nit`, `email`, `phone`, `address`, `city`, `zone`, `mapsUrl`, `isActive`, `creditDays7Enabled`, `creditDays14Enabled`

Notas
- `409` si `version` no coincide.

---

## Sales Quotes (Cotizaciones)
Requiere: módulo `SALES`.

### GET /api/v1/sales/quotes/next-number
Requiere permiso: `sales:order:write`.

Response 200
```json
{ "number": "COT-YYYY0001" }
```

### GET /api/v1/sales/quotes
Requiere permiso: `sales:order:read`.

Query
- `take` (1..50, default 20)
- `cursor` (uuid, opcional)
- `customerSearch` (string, opcional; filtra por customer.name)

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "number": "COT-20260001",
      "customerId": "...",
      "customerName": "...",
      "status": "CREATED",
      "quotedBy": "Usuario ...",
      "total": 123.45,
      "createdAt": "...",
      "itemsCount": 3
    }
  ],
  "nextCursor": "..."
}
```

### POST /api/v1/sales/quotes
Requiere permiso: `sales:order:write`.

Body
```json
{
  "customerId": "...",
  "validityDays": 7,
  "paymentMode": "CASH",
  "deliveryDays": 1,
  "deliveryCity": "SANTA CRUZ",
  "deliveryZone": "ZONA ...",
  "deliveryAddress": "Av ...",
  "deliveryMapsUrl": "https://www.google.com/maps/@...",
  "globalDiscountPct": 0,
  "proposalValue": "Opcional",
  "note": "Opcional",
  "lines": [
    { "productId": "...", "quantity": 2, "unitPrice": 10, "discountPct": 5 }
  ]
}
```

Notas
- Si no se envían `delivery*`, el backend hace fallback a la ubicación del cliente (`Customer.city/zone/address/mapsUrl`).

Response 201 (resumen)
```json
{
  "id": "...",
  "number": "COT-20260001",
  "customerId": "...",
  "customerName": "...",
  "status": "CREATED",
  "quotedBy": "Usuario ...",
  "validityDays": 7,
  "paymentMode": "CASH",
  "deliveryDays": 1,
  "deliveryCity": "SANTA CRUZ",
  "deliveryZone": "...",
  "deliveryAddress": "...",
  "deliveryMapsUrl": "...",
  "globalDiscountPct": 0,
  "proposalValue": null,
  "note": null,
  "subtotal": 19,
  "globalDiscountAmount": 0,
  "total": 19,
  "lines": [
    {
      "id": "...",
      "productId": "...",
      "productSku": "SKU...",
      "productName": "Producto ...",
      "quantity": 2,
      "unitPrice": 10,
      "discountPct": 5
    }
  ],
  "createdAt": "..."
}
```

### GET /api/v1/sales/quotes/:id
Requiere permiso: `sales:order:read`.

Response 200 (incluye status, quotedBy, delivery*, líneas con total y timestamps)

### PUT /api/v1/sales/quotes/:id
Requiere permiso: `sales:order:write`.

Notas
- `409` si la cotización ya fue procesada (`status = PROCESSED`).
- El `unitPrice` de cada línea se expresa en **unidades base** (precio por unidad individual del producto).
- Si `unitPrice` no se envía, el backend lo resuelve:
  - Si la presentación tiene `priceOverride`: `unitPrice = priceOverride / unitsPerPresentation`.
  - Si no: `unitPrice = Product.price`.
- El frontend (`QuoteDetailPage`) replica esta lógica para previsualizar el precio en tiempo real al seleccionar un producto o cambiar de presentación.

### POST /api/v1/sales/quotes/:id/process
Requiere permiso: `sales:order:write`.

Acción
- Crea una Orden de Venta desde la cotización.
- Marca la cotización como `PROCESSED` (read-only).

Errores
- `404` si no existe.
- `409` si ya estaba procesada.

Response 201
```json
{ "id": "...", "number": "SO-YYYYMMDD-0000", "status": "CONFIRMED", "version": 1, "createdAt": "..." }
```

---
## Deliveries (Entregas)
Requiere: módulo `SALES`.

Nota
- "Pendientes" mapea a órdenes `DRAFT` + `CONFIRMED` (compatibilidad con órdenes antiguas).
- "Entregadas" mapea a órdenes `FULFILLED`.
- "Todas" mapea a órdenes `DRAFT` + `CONFIRMED` + `FULFILLED`.

### GET /api/v1/sales/deliveries
Requiere permiso: `sales:order:read`.

Query
- `take` (1..100, default 50)
- `cursor` (uuid, opcional)
- `status` (PENDING|DELIVERED|ALL, default PENDING)
- `cities` (string, opcional: ciudades separadas por coma, case-insensitive)

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "number": "SO-YYYYMMDD-0000",
      "status": "CONFIRMED",
      "version": 2,
      "updatedAt": "...",
      "customerId": "...",
      "customerName": "...",
      "processedBy": "Usuario ...",
      "deliveryDate": "...",
      "deliveryCity": "...",
      "deliveryZone": "...",
      "deliveryAddress": "...",
      "deliveryMapsUrl": "..."
    }
  ],
  "nextCursor": "..."
}
```

---

## Sales Orders
Requiere: módulo `SALES`.

### POST /api/v1/sales/orders
Requiere permiso: `sales:order:write`.

Nota
- Por regla de negocio, **toda orden debe originarse en una cotización**.
- Este endpoint responde `400` y la alternativa soportada es `POST /api/v1/sales/quotes/:id/process`.

Response 400
```json
{ "message": "Orders must be created from a quote. Use /api/v1/sales/quotes/:id/process" }
```

### GET /api/v1/sales/orders
Requiere permiso: `sales:order:read`.

Query
- `take` (1..1000, default 20)
- `cursor` (uuid, opcional)
- `status` (DRAFT|CONFIRMED|FULFILLED|CANCELLED, opcional)

Nota
- El tope de `take` se elevó a 1000 (antes 100) para que los drill-down de reportes de ventas puedan traer todas las órdenes de una ciudad/cliente/producto en un solo llamado. Es un límite fijo temporal; a futuro se recomienda reemplazarlo por paginación real (`cursor`) en vez de seguir subiendo el número.

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "number": "SO-YYYYMMDD-0000",
      "status": "DRAFT",
      "updatedAt": "...",
      "customerId": "...",
      "customerName": "...",
      "quoteId": "...",
      "quoteNumber": "COT-20260001",
      "processedBy": "Usuario ...",
      "deliveryDate": "...",
      "deliveryCity": "...",
      "deliveryZone": "...",
      "deliveryAddress": "...",
      "deliveryMapsUrl": "..."
    }
  ],
  "nextCursor": "..."
}
```

### GET /api/v1/sales/orders/:id
Requiere permiso: `sales:order:read`.

Response 200 (incluye customer, quote, delivery* y lines con product)
```json
{
  "id": "...",
  "number": "SO-YYYYMMDD-0000",
  "customerId": "...",
  "quoteId": "...",
  "status": "DRAFT",
  "note": "Desde cotización COT-...",
  "version": 1,
  "createdAt": "...",
  "updatedAt": "...",
  "processedBy": "Usuario ...",
  "deliveryDate": "...",
  "deliveryCity": "...",
  "deliveryZone": "...",
  "deliveryAddress": "...",
  "deliveryMapsUrl": "...",
  "customer": { "id": "...", "name": "...", "nit": null },
  "quote": { "id": "...", "number": "COT-..." },
  "lines": [
    {
      "id": "...",
      "productId": "...",
      "batchId": null,
      "quantity": "2",
      "unitPrice": "10",
      "product": { "sku": "SKU...", "name": "Producto ..." }
    }
  ]
}
```

### POST /api/v1/sales/orders/:id/confirm
Requiere permiso: `sales:order:write`.

Body
```json
{ "version": 1 }
```

Notas
- Solo permite confirmar si `status` es `DRAFT`.
- `409` si `version` no coincide.

Realtime emit
- `sales.order.created`
- `sales.order.confirmed`

### POST /api/v1/sales/orders/:id/fulfill
Requiere: módulos `SALES` y `WAREHOUSE` + permisos `sales:order:write` y `stock:move`.

Body
```json
{ "version": 2, "fromLocationId": "...", "note": "Opcional" }
```

Notas
- Solo permite fulfill si `status` es `CONFIRMED`.
- Descuenta stock en `fromLocationId` para cada línea.
- Genera movimientos `OUT` por línea con `referenceType: SALES_ORDER`.
- `409` si stock insuficiente o `version` no coincide.
- `409` si alguna línea especifica `batchId` y el lote está vencido (`Batch.expiresAt` < hoy UTC).
- Si una línea viene con `batchId: null`, el backend intentará **auto-seleccionar** un lote (FEFO) en `fromLocationId` con stock suficiente y no vencido; si no existe, cae al stock “sin lote” (`batchId: null`).

Realtime emit
- `sales.order.fulfilled`
- `stock.movement.created`
- `stock.balance.changed`
- `stock.alert.low` (si algún balance queda en 0)

Response 200 (estructura)
```json
{
  "order": { "id": "...", "number": "...", "status": "FULFILLED", "version": 3, "updatedAt": "..." },
  "movements": [ ... ],
  "balances": [ ... ]
}
```

### POST /api/v1/sales/orders/:id/deliver
Requiere: módulos `SALES` y `WAREHOUSE` + permisos `sales:order:write` y `stock:move`.

Body
```json
{ "version": 2, "fromLocationId": "... (opcional)", "note": "Opcional" }
```

Notas
- Marca la orden como **entregada** (set `status: FULFILLED`) y genera `StockMovement` `OUT`.
- Si la orden tiene `SalesOrderReservation`:
  - Consume desde los `InventoryBalance` reservados (decrementa `quantity` y `reservedQuantity`).
  - Borra las reservas (`SalesOrderReservation.deleteMany`).
- Si la orden **no** tiene reservas:
  - Requiere `fromLocationId` y ejecuta el mismo flujo que `/fulfill` (incluye FEFO y validación de vencimiento).
  - En este modo, la orden debe estar en `CONFIRMED`.
- `409` si stock insuficiente, `version` no coincide, o lote vencido (`Batch.expiresAt` < hoy UTC).

Realtime emit
- `sales.order.delivered`
- `stock.movement.created`
- `stock.balance.changed`

Response 200
```json
{ "order": { "id": "...", "number": "...", "status": "FULFILLED", "version": 3, "updatedAt": "..." } }
```

### POST /api/v1/sales/orders/:id/deliver-with-returns
Requiere: módulos `SALES` y `WAREHOUSE` + permisos `sales:order:write` (entrega) y `stock:move` (devoluciones).

Alternativa a `POST /api/v1/sales/orders/:id/deliver` que permite registrar la entrega **junto con devoluciones parciales** en un solo request.

Body
```json
{
  "version": 2,
  "fromLocationId": "... (opcional, fallback al flujo clásico)",
  "note": "Opcional",
  "returns": [
    {
      "lineId": "...",
      "productId": "...",
      "batchId": "... (opcional)",
      "quantity": 2,
      "reason": "Producto dañado",
      "note": "Caja golpeada",
      "locationId": "..."
    }
  ]
}
```

Notas
- Registra la entrega como `FULFILLED` con movimientos `OUT` (igual que `/deliver`).
- Para cada item en `returns`, crea un movimiento `IN` con `referenceType: RETURN` y `referenceId` vinculado a la orden.
- `locationId` en cada return es obligatorio y debe pertenecer a la ciudad del usuario (si está scopeado por sucursal).
- `409` si `version` no coincide, la orden ya está `FULFILLED`, o stock insuficiente / lote vencido.

Response 200
```json
{ "order": { "id": "...", "number": "...", "status": "FULFILLED", "version": 3, "updatedAt": "..." } }
```

Realtime emit
- `sales.order.delivered`
- `stock.movement.created`
- `stock.balance.changed`

### POST /api/v1/sales/orders/:id/return
Requiere: módulos `SALES` y `WAREHOUSE` + permisos `sales:order:write` y `stock:move`.

Registra devoluciones **standalone** (sin delivery) para órdenes ya entregadas o canceladas.

Body
```json
{
  "version": 2,
  "items": [
    {
      "lineId": "... (opcional)",
      "productId": "...",
      "batchId": "... (opcional)",
      "quantity": 2,
      "reason": "Producto dañado",
      "note": "Opcional",
      "locationId": "..."
    }
  ]
}
```

Notas
- Crea movimientos `IN` con `referenceType: RETURN` y `referenceId` vinculado al id de la devolución.
- `locationId` es obligatorio por item.
- `409` si `version` no coincide o la orden no existe.

Response 200
```json
{ "id": "...", "createdAt": "2026-03-01T00:00:00.000Z" }
```

---

## Sales Payments (Cobros)
Requiere: módulo `SALES`.

### POST /api/v1/sales/payments/proof-upload
Requiere permiso: `sales:order:write`.

Genera una URL presignada para subir el comprobante de pago a S3-compatible.

Body
```json
{ "fileName": "comprobante.jpg", "contentType": "image/jpeg" }
```

Notas
- `contentType` soportado: `image/png`, `image/jpeg`, `image/webp`, **`application/pdf`**.
- Requiere S3-compatible configurado (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`).

Response 200
```json
{
  "uploadUrl": "https://...",
  "publicUrl": "https://...",
  "key": "tenants/.../sales-payments/proof-...jpg",
  "expiresInSeconds": 300,
  "method": "PUT"
}
```

### GET /api/v1/sales/payments
Requiere permiso: `sales:order:read`.

Query
- `status` (`DUE`|`PAID`|`ALL`, default `DUE`)
- `take` (1..200, default 100)

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "number": "SO-YYYYMMDD-0000",
      "version": 3,
      "customerId": "...",
      "customerName": "Cliente ...",
      "paymentMode": "CASH",
      "deliveryDate": "2026-02-20T00:00:00.000Z",
      "deliveredAt": "2026-02-20T12:00:00.000Z",
      "dueAt": "2026-02-20T12:00:00.000Z",
      "total": 150.5,
      "paidAmount": 50,
      "remaining": 100.5,
      "paidAt": null
    }
  ]
}
```

Notas
- Solo incluye órdenes `FULFILLED`.
- Si el usuario está scopeado por sucursal y no tiene sucursal seleccionada, responde `409`.

### POST /api/v1/sales/payments/:id/pay
Requiere permiso: `sales:order:write`.

Body
```json
{
  "version": 3,
  "paymentAmountType": "PARTIAL",
  "amount": 50,
  "paymentReceiptType": "TRANSFER_QR",
  "paymentReceiptRef": "TRX-123",
  "paymentReceiptPhotoUrl": "https://...",
  "paymentReceiptPhotoKey": "tenants/.../sales-payments/proof-...jpg"
}
```

Notas
- `paymentAmountType`: `TOTAL` (default) paga el **restante**; `PARTIAL` requiere `amount`.
- `amount` no puede exceder el saldo restante.
- Solo puede pagarse si la orden está `FULFILLED` y **no** está totalmente pagada (`paidAt=null`).
- Para `TRANSFER_QR` se requiere `paymentReceiptRef` o `paymentReceiptPhotoUrl`.
- `paymentReceiptPhotoUrl` y `paymentReceiptPhotoKey` deben enviarse juntos.

Response 200
```json
{ "order": { "id": "...", "number": "...", "status": "FULFILLED", "version": 4, "paidAt": null } }
```

Realtime emit
- `sales.order.paid` **solo** cuando el pago completa el total (cuando se setea `paidAt`).

---

## Admin (multirol)
Requiere permiso: `admin:users:manage`.

### GET /api/v1/admin/permissions
Lista el catálogo de permisos.

### GET /api/v1/admin/roles
Query: `take`, `cursor`, `q`.

### POST /api/v1/admin/roles
Body
```json
{ "code": "TENANT_MANAGER", "name": "Tenant Manager", "permissionCodes": ["catalog:read"] }
```

Notas
- `400` si hay códigos de permiso desconocidos.
- `409` si `code` ya existe.

### PUT /api/v1/admin/roles/:id/permissions
Body
```json
{ "permissionCodes": ["catalog:read", "stock:read"] }
```

### GET /api/v1/admin/users
Query: `take`, `cursor`, `q` (filtra por email).

### POST /api/v1/admin/users
Body
```json
{ "email": "user@demo.local", "password": "Secret123!", "fullName": "User", "roleIds": ["..."] }
```

Notas
- `409` si el email ya existe.

### PUT /api/v1/admin/users/:id/roles
Body
```json
{ "roleIds": ["..."] }
```

---

## Audit (GxP read-side)
Requiere permiso: `audit:read`.

### GET /api/v1/audit/events
Query
- `take` (1..100, default 50)
- `cursor` (uuid, opcional)
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `actorUserId` (uuid, opcional)
- `action` (string, opcional; contains, case-insensitive)
- `entityType` (string, opcional)
- `entityId` (string, opcional)
- `includePayload` (boolean, default false)

Response 200
```json
{
  "items": [{
    "id": "...",
    "createdAt": "...",
    "actorUserId": "...",
    "action": "product.create",
    "entityType": "Product",
    "entityId": "...",
    "actor": { "id": "...", "email": "...", "fullName": null }
  }],
  "nextCursor": "..."
}
```

### GET /api/v1/audit/events/:id
Response 200 incluye `before`, `after`, `metadata`.

---

## Reports

### Ventas

#### GET /api/v1/reports/sales/summary
Requiere: módulo `SALES` + permiso `sales:order:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `status` (DRAFT|CONFIRMED|FULFILLED|CANCELLED, opcional)

Response 200
```json
{
  "items": [
    { "day": "2025-12-18", "ordersCount": 3, "linesCount": 5, "quantity": "12", "amount": "450" }
  ]
}
```

#### GET /api/v1/reports/sales/top-products
Requiere: módulo `SALES` + permiso `sales:order:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `status` (opcional)
- `take` (1..1000, default 10)

Nota
- Mismo esquema de `take` usado por `GET /api/v1/reports/sales/margins`. El tope se elevó de 50 a 1000 para evitar que el reporte recorte productos; a futuro conviene reemplazarlo por paginación real.

Response 200
```json
{
  "items": [
    { "productId": "...", "sku": "SKU-001", "name": "Producto", "quantity": "10", "amount": "350" }
  ]
}
```

#### GET /api/v1/reports/sales/by-customer
Requiere: módulo `SALES` + permiso `sales:order:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `status` (opcional)
- `take` (1..1000, default 15)

Nota
- El tope se elevó de 200 a 1000 para evitar que el reporte recorte clientes; a futuro conviene reemplazarlo por paginación real.

Response 200
```json
{
  "items": [
    { "customerId": "...", "customerName": "Cliente", "city": "La Paz", "ordersCount": 3, "quantity": "12", "amount": "450" }
  ]
}
```

#### GET /api/v1/reports/sales/by-city
Requiere: módulo `SALES` + permiso `sales:order:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `status` (opcional)
- `take` (1..1000, default 20)

Nota
- El tope se elevó de 200 a 1000 para evitar que el reporte recorte ciudades; a futuro conviene reemplazarlo por paginación real.

Response 200
```json
{
  "items": [
    { "city": "La Paz", "ordersCount": 3, "quantity": "12", "amount": "450" }
  ]
}
```

#### GET /api/v1/reports/sales/funnel
Requiere: módulo `SALES` + permiso `sales:order:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)

Response 200
```json
{
  "items": [
    { "key": "quotes", "label": "Cotizaciones", "value": 10 },
    { "key": "orders", "label": "Órdenes", "value": 7 },
    { "key": "fulfilled", "label": "Entregadas", "value": 5 },
    { "key": "paid", "label": "Cobradas", "value": 4 }
  ],
  "totals": { "amountFulfilled": "123.45", "amountPaid": "100.00" }
}
```

#### POST /api/v1/reports/sales/email
Requiere: módulo `SALES` + permiso `sales:order:read`.

Body
```json
{
  "to": "destino@correo.com",
  "subject": "Reporte de ventas",
  "filename": "Reporte_Ventas.pdf",
  "pdfBase64": "JVBERi0xLjcK...",
  "message": "(opcional)"
}
```

Response 200 sin body.

#### Schedules — /api/v1/reports/sales/schedules
Requiere: módulo `SALES` + permiso `sales:order:read`.

##### GET /api/v1/reports/sales/schedules
Response 200
```json
{
  "items": [
    {
      "id": "...",
      "reportKey": "sales",
      "frequency": "DAILY",
      "hour": 8,
      "minute": 0,
      "dayOfWeek": null,
      "dayOfMonth": null,
      "recipients": ["a@b.com"],
      "enabled": true,
      "lastRunAt": null,
      "nextRunAt": "2026-01-16T08:00:00.000Z"
    }
  ]
}
```

##### POST /api/v1/reports/sales/schedules
Body
```json
{
  "reportKey": "sales",
  "frequency": "DAILY",
  "hour": 8,
  "minute": 0,
  "dayOfWeek": 1,
  "dayOfMonth": 1,
  "recipients": ["a@b.com"],
  "enabled": true
}
```

Response 200 sin body.

##### PATCH /api/v1/reports/sales/schedules/:id
Body
```json
{ "enabled": false }
```

Response 200 sin body.

##### DELETE /api/v1/reports/sales/schedules/:id
Response 200 sin body.

### Stock

#### GET /api/v1/reports/stock/balances-expanded
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Query
- `warehouseId` (uuid, opcional)
- `locationId` (uuid, opcional)
- `productId` (uuid, opcional)
- `take` (1..200, default 100)

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "quantity": "15",
      "reservedQuantity": "2",
      "updatedAt": "...",
      "productId": "...",
      "batchId": null,
      "locationId": "...",
      "product": { "sku": "SKU-001", "name": "Producto" },
      "batch": null,
      "location": { "id": "...", "code": "BIN-01", "warehouse": { "id": "...", "code": "WH-01", "name": "Almacén" } }
    }
  ]
}
```

#### GET /api/v1/reports/stock/movements-expanded
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `productId` (uuid, opcional)
- `locationId` (uuid, opcional; filtra por from/to)
- `take` (1..200, default 100)

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "createdAt": "...",
      "type": "IN",
      "productId": "...",
      "batchId": null,
      "fromLocationId": null,
      "toLocationId": "...",
      "quantity": "5",
      "referenceType": "MANUAL",
      "referenceId": "REF-1",
      "note": "Ingreso",
      "product": { "sku": "SKU-001", "name": "Producto" },
      "batch": null,
      "fromLocation": null,
      "toLocation": { "id": "...", "code": "BIN-01", "warehouse": { "id": "...", "code": "WH-01", "name": "Almacén" } }
    }
  ]
}
```

#### GET /api/v1/reports/stock/inputs-by-product
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `take` (1..50, default 15)

Response 200
```json
{
  "items": [
    { "productId": "...", "sku": "SKU-001", "name": "Producto", "movementsCount": 2, "quantity": "10" }
  ]
}
```

#### GET /api/v1/reports/stock/transfers-between-warehouses
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `take` (1..50, default 10)

Response 200
```json
{
  "items": [
    {
      "fromWarehouse": { "id": "...", "code": "WH-01", "name": "Almacén 1" },
      "toWarehouse": { "id": "...", "code": "WH-02", "name": "Almacén 2" },
      "movementsCount": 3,
      "quantity": "25"
    }
  ]
}
```

#### Ops — Solicitudes y devoluciones

#### GET /api/v1/reports/stock/movement-requests/summary
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)

Response 200
```json
{ "total": 10, "open": 2, "fulfilled": 6, "cancelled": 2, "pending": 3, "accepted": 2, "rejected": 1 }
```

#### GET /api/v1/reports/stock/movement-requests/by-city
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `take` (1..500, default 200)

Response 200
```json
{
  "items": [
    { "city": "Santa Cruz", "total": 5, "open": 1, "fulfilled": 3, "cancelled": 1, "pending": 2, "accepted": 2, "rejected": 1 }
  ]
}
```

#### GET /api/v1/reports/stock/movement-requests/flows
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Objetivo
- Mostrar rutas (origen → destino) de solicitudes **atendidas** (`FULFILLED`) y el **tiempo promedio de atención** (minutos) medido como `fulfilledAt - createdAt`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `take` (1..500, default 200)

Response 200
```json
{
  "items": [
    {
      "fromWarehouse": { "id": "...", "code": "WH-01", "name": "Sucursal Centro" },
      "toWarehouse": { "id": "...", "code": "WH-02", "name": "Sucursal Norte" },
      "requestsCount": 12,
      "avgMinutes": 18.5
    }
  ]
}
```

Notas
- El origen/destino se deduce desde los movimientos `TRANSFER` creados al atender la solicitud (`referenceType='REQUEST_FULFILL'`).
- Si una solicitud tuvo múltiples orígenes/destinos, el backend puede reportar “mixto” (depende del agregado usado por el read-side).

#### GET /api/v1/reports/stock/movement-requests/fulfilled
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Objetivo
- Listar solicitudes **atendidas** con métricas de operación (tiempo, cantidades) y “rutas” agregadas para permitir drill-down.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `take` (1..500, default 200)

Response 200
```json
{
  "items": [
    {
      "id": "...",
      "requestedCity": "Santa Cruz",
      "destinationWarehouse": { "id": "...", "code": "WH-02", "name": "Sucursal Norte" },
      "requestedByName": "Juan Perez",
      "createdAt": "2026-02-02T10:00:00.000Z",
      "fulfilledAt": "2026-02-02T10:20:00.000Z",
      "minutesToFulfill": 20,
      "itemsCount": 4,
      "requestedQuantity": "40",
      "movementsCount": 6,
      "sentQuantity": "40",
      "fromWarehouseCodes": "WH-01",
      "fromLocationCodes": "BIN-01",
      "toWarehouseCodes": "WH-02",
      "toLocationCodes": "BIN-01"
    }
  ]
}
```

#### GET /api/v1/reports/stock/movement-requests/:id/trace
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Objetivo
- Trazabilidad de una solicitud: comparar **lo solicitado** vs **lo enviado** (movimientos/picking real).

Params
- `id` (uuid)

Response 200
```json
{
  "request": {
    "id": "...",
    "status": "FULFILLED",
    "confirmationStatus": "ACCEPTED",
    "requestedCity": "Santa Cruz",
    "warehouseId": "...",
    "warehouse": { "id": "...", "code": "WH-02", "name": "Sucursal Norte", "city": "Santa Cruz" },
    "note": null,
    "createdAt": "2026-02-02T10:00:00.000Z",
    "requestedBy": "...",
    "requestedByName": "Juan Perez",
    "fulfilledAt": "2026-02-02T10:20:00.000Z",
    "fulfilledBy": "...",
    "fulfilledByName": "Maria Lopez"
  },
  "requestedItems": [
    {
      "id": "...",
      "productId": "...",
      "productSku": "SKU-001",
      "productName": "Producto",
      "genericName": "Genérico",
      "requestedQuantity": 10,
      "presentation": { "id": "...", "name": "Caja", "unitsPerPresentation": 10 },
      "unitsPerPresentation": 10
    }
  ],
  "sentLines": [
    {
      "id": "...",
      "createdAt": "2026-02-02T10:05:00.000Z",
      "productId": "...",
      "productSku": "SKU-001",
      "productName": "Producto",
      "genericName": "Genérico",
      "batchId": "...",
      "batchNumber": "L-001",
      "expiresAt": "2026-12-31T00:00:00.000Z",
      "quantity": 10,
      "presentation": { "id": "...", "name": "Caja", "unitsPerPresentation": 10 },
      "presentationQuantity": 1,
      "fromLocation": { "id": "...", "code": "BIN-01", "warehouse": { "id": "...", "code": "WH-01", "name": "Sucursal Centro", "city": "Santa Cruz" } },
      "toLocation": { "id": "...", "code": "BIN-01", "warehouse": { "id": "...", "code": "WH-02", "name": "Sucursal Norte", "city": "Santa Cruz" } }
    }
  ]
}
```

#### GET /api/v1/reports/stock/returns/summary
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)

Response 200
```json
{ "returnsCount": 3, "itemsCount": 7, "quantity": "35" }
```

#### GET /api/v1/reports/stock/returns/by-warehouse
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)
- `take` (1..500, default 200)

Response 200
```json
{
  "items": [
    { "warehouse": { "id": "...", "code": "WH-03", "name": "Sucursal Santa Cruz", "city": "Santa Cruz" }, "returnsCount": 2, "itemsCount": 4, "quantity": "20" }
  ]
}
```

#### GET /api/v1/reports/stock/provider-activity
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Filtra actividad de warehouses tipo `PROVIDER`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)

Response 200
```json
{
  "items": [
    {
      "warehouseId": "wh-1",
      "warehouseCode": "WH-01",
      "warehouseName": "Sucursal Proveedor",
      "warehouseCity": "La Paz",
      "batchesCreated": 5,
      "transfersSent": 3,
      "transfersSentQty": "150",
      "adjustments": 2,
      "adjustmentsOutQty": "30"
    }
  ]
}
```

#### GET /api/v1/reports/stock/sales-branch-activity
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Filtra actividad de warehouses tipo `SALES`.

Query
- `from` (date-time, opcional)
- `to` (date-time, opcional)

Response 200
```json
{
  "items": [
    {
      "warehouseId": "wh-2",
      "warehouseCode": "WH-02",
      "warehouseName": "Sucursal Venta",
      "warehouseCity": "Santa Cruz",
      "batchesReceived": 8,
      "requestsAccepted": 5,
      "requestsRejected": 1,
      "requestsPending": 2,
      "quotesCreated": 12,
      "ordersCreated": 10,
      "salesAmount": "5200.00"
    }
  ]
}
```

---

#### POST /api/v1/reports/stock/email
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Body (mismo contrato que `POST /api/v1/reports/sales/email`)

Response 200 sin body.

#### Schedules — /api/v1/reports/stock/schedules
Requiere: módulo `WAREHOUSE` + permiso `report:stock:read`.

Operaciones:
- `GET /api/v1/reports/stock/schedules`
- `POST /api/v1/reports/stock/schedules`
- `PATCH /api/v1/reports/stock/schedules/:id` (por ahora solo `enabled`)
- `DELETE /api/v1/reports/stock/schedules/:id`

---

## Database Seeding

### Seed Command
Para poblar la base de datos con datos de prueba:

```bash
# Desde el directorio backend/
npx prisma db seed
```

### Datos generados por el seed:
- **Platform Tenant**: Supernovatel (admin@supernovatel.com / Admin123!)
- **Demo Tenant**: Demo Pharma (admin@demo.local / Admin123!)
- **Productos**: 43 productos con precios, costos y stock distribuido
- **Órdenes de venta**: 315 órdenes históricas con valor total de Bs 169,169
- **Movimientos de stock**: Registros de ventas (OUT) y reposiciones (IN)
- **Solicitudes de movimientos**: dataset para flujo `OPEN/FULFILLED/CANCELLED` + confirmación `PENDING/ACCEPTED/REJECTED`
- **Devoluciones**: dataset de `StockReturn/StockReturnItem` para validar evidencia + reportes OPS
- **Clientes**: 3 clientes de prueba
- **Almacenes**: 3 almacenes con ubicaciones
- **Productos con stock bajo**: 5 productos
- **Productos próximos a vencer**: 6 productos

### Variables de entorno para seed:
- `SEED_TENANT_NAME`: Nombre del tenant demo (default: "Demo Pharma")
- `SEED_ADMIN_EMAIL`: Email del admin (default: "admin@demo.local")
- `SEED_ADMIN_PASSWORD`: Password del admin (default: "Admin123!")
- `SEED_PLATFORM_DOMAIN`: Dominio de la plataforma (default: "farmacia.supernovatel.com")

### Docker - Local Development
```bash
# Construir y ejecutar servicios
docker-compose -f docker-compose.local.yml up --build

# Ejecutar seed dentro del contenedor
docker-compose -f docker-compose.local.yml exec backend npx prisma db seed
```

### Docker - Production
```bash
# Construir imagen de producción
docker build -f backend/Dockerfile -t pharmaflow-backend:latest backend/

# Ejecutar seed en producción (requiere variables de entorno)
docker run --rm \
  --env-file .env.production \
  --network pharmaflow_network \
  pharmaflow-backend:latest \
  npx prisma db seed
```

**Nota**: Asegurarse de que la base de datos esté accesible y las migraciones aplicadas antes de ejecutar el seed.

