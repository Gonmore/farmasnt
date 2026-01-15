# API Reference — PharmaFlow Bolivia (MVP)

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
- `admin:users:manage`
- `audit:read`

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
  "description": "Opcional",
  "presentationWrapper": "caja",
  "presentationQuantity": 250,
  "presentationFormat": "comprimidos"
}
```

Response 201
```json
{
  "id": "...",
  "sku": "SKU-001",
  "name": "Paracetamol 500mg",
  "presentationWrapper": "caja",
  "presentationQuantity": "250",
  "presentationFormat": "comprimidos",
  "version": 1,
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

Notas
- `409` si el SKU ya existe (único por tenant).

### GET /api/v1/products
Requiere permiso: `catalog:read`.

Query
- `take` (1..50, default 20)
- `cursor` (uuid, opcional)

Response 200
```json
{
  "items": [{ "id": "...", "sku": "...", "name": "...", "presentationWrapper": "caja", "presentationQuantity": "250", "presentationFormat": "comprimidos", "photoUrl": "https://..." , "isActive": true, "version": 1, "updatedAt": "..." }],
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
  "presentationWrapper": "caja",
  "presentationQuantity": "250",
  "presentationFormat": "comprimidos",
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
- `presentationWrapper` (opcional, puede ser `null`)
- `presentationQuantity` (opcional, puede ser `null`)
- `presentationFormat` (opcional, puede ser `null`)
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

## Batches
Requiere permiso `catalog:write`.

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
      "status": "RELEASED",
      "version": 1,
      "createdAt": "2026-01-05T00:00:00.000Z",
      "updatedAt": "2026-01-05T00:00:00.000Z",
      "totalQuantity": "30",
      "locations": [
        {
          "warehouseId": "...",
          "warehouseCode": "WH-01",
          "warehouseName": "Almacén",
          "locationId": "...",
          "locationCode": "BIN-01",
          "quantity": "30"
        }
      ]
    }
  ]
}
```

Notas
- `hasStockRead=false` si el usuario no tiene `stock:read`; en ese caso `totalQuantity` es `null` y `locations` viene vacío.

### POST /api/v1/products/:id/batches
Body
```json
{
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
- El `batchNumber` se autogenera si no se envía.
- `409` si el `batchNumber` ya existe para el producto.
- Si se envía `initialStock`, se crea además un `StockMovement` tipo `IN` (numerado `MSYYYY-N`) y se actualiza `InventoryBalance`.
  - Si se envía `warehouseId`, el backend resuelve automáticamente una ubicación activa dentro del almacén.
  - También se acepta `toLocationId` (compatibilidad), pero la UI usa `warehouseId`.

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
  "items": [{ "id": "...", "code": "WH-01", "name": "Almacén", "city": "LA PAZ", "isActive": true, "version": 1, "updatedAt": "...", "totalQuantity": "10" }],
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
  "code": "WH-01",
  "name": "Sucursal Central",
  "city": "LA PAZ"
}
```

Response 201
```json
{
  "id": "...",
  "code": "WH-01",
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
  "code": "WH-01",
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

---

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
- `take` (1..50, default 20)
- `cursor` (uuid, opcional)
- `status` (DRAFT|CONFIRMED|FULFILLED|CANCELLED, opcional)

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
- `take` (1..50, default 10)

Response 200
```json
{
  "items": [
    { "productId": "...", "sku": "SKU-001", "name": "Producto", "quantity": "10", "amount": "350" }
  ]
}
```

### Stock

#### GET /api/v1/reports/stock/balances-expanded
Requiere: módulo `WAREHOUSE` + permiso `stock:read`.

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
Requiere: módulo `WAREHOUSE` + permiso `stock:read`.

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

