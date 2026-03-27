# Pruebas de flujo (V2 foundations)

Este documento está pensado para validar **end-to-end** (UI + API) y confirmar resultados **en base de datos**, porque algunos cambios no se ven mucho en frontend.

## Versión 2.0 — pruebas específicas de unidad base configurable y PDFs

### Flujo P — Producto con unidad base visible personalizada
- Ir a `Catálogo > Productos`.
- Crear o editar un producto y definir `Unidad base` con un valor como `lt`, `ml` o `gr`.
- Guardar.
- Verificar que el detalle del producto conserva la abreviatura y que las presentaciones muestran el nuevo sufijo visible, por ejemplo `Bidón (20lt)`.

### Flujo Q — Cotización PDF sin solapamientos
- Crear o editar una cotización con al menos una línea larga en nombre de producto y una cantidad con presentación no unitaria.
- Exportar la cotización a PDF.
- Verificar que las columnas `Cant.`, `Desc.%`, `Precio Unit.` y `Total` no se montan entre sí y que los renglones crecen cuando el contenido requiere más altura.

### Flujo R — Nota de entrega PDF con presentación correcta
- Abrir una orden con reservas o entregas para un producto cuya unidad base visible no sea `u`.
- Exportar la nota de entrega a PDF.
- Verificar que la columna `Presentación` use la abreviatura configurada del producto y que el nombre del producto no invada columnas vecinas.

## Versión 2.0 — pruebas específicas multi-empresa

### Flujo M — Configuración multi-marca
- Login como platform admin.
- Crear un grupo de empresas desde `Sistema > Grupos de Empresas` con al menos dos tenants.
- Verificar que el grupo aparece listado y que ambas empresas figuran como miembros.

### Flujo N — Grants por usuario
- Ingresar como tenant admin del tenant base.
- Ir a `Administración > Usuarios`.
- Abrir `Empresas` sobre un usuario del tenant.
- Otorgar acceso a una empresa hermana del grupo y guardar.
- Verificar que el guardado responde `200` y que al reabrir el modal persiste el check correcto.

### Flujo O — Cambio de empresa
- Iniciar sesión con un usuario que tenga acceso cruzado.
- Confirmar que el menú de cuenta muestra ambas empresas.
- Cambiar de empresa A a B.
- Confirmar que el tenant activo cambia y sigue apareciendo la opción de volver.
- Volver de B a A.
- Confirmar que no hay `400/401/403` y que el selector marca correctamente la empresa activa.

## Pre-requisitos

1) BD al día
- Backend: `npx prisma migrate status` → debe decir `Database schema is up to date!`
- Si usás Docker local: `docker compose -f docker-compose.local.yml --profile tools run --rm backend-migrate` no debe mostrar migraciones pendientes.

2) Backend y frontend levantados
- Backend: `npm --prefix backend run dev`
- Frontend: `npm --prefix frontend run dev`

Notas
- Si el backend falla con `EADDRINUSE :6000`, ya hay otro proceso usando el puerto. Cerrá ese proceso o cambiá el puerto.

3) (Opcional) S3/MinIO para fotos
- Si querés probar upload real de fotos (y logos), levantá MinIO:
  - `docker compose up -d minio minio-init` (o `docker-compose` si usás la versión legacy)
- Revisá que `backend/.env` tenga configuradas las variables S3 (ya están pre-configuradas para MinIO local):
  - S3_ENDPOINT=http://localhost:9000
  - S3_BUCKET=farmasnt-assets
  - S3_ACCESS_KEY_ID=minioadmin
  - S3_SECRET_ACCESS_KEY=minioadmin
  - S3_PUBLIC_BASE_URL=http://localhost:9000/farmasnt-assets/
- Reiniciá el backend después de levantar MinIO.

---

## Flujo A — Entrar a Productos (bugfix)

Objetivo: confirmar que la pantalla "Productos" carga y no devuelve `Module disabled`.

1) Login
- Entrá al frontend y logueate.

2) Ir a `Catálogo > Productos`
- Debe cargar el listado.

Si falla
- Si el mensaje es `Forbidden`: el usuario no tiene `catalog:read`.
- Si el mensaje es `Module disabled`: esto ya debería estar resuelto (Catálogo ya no depende del módulo WAREHOUSE).

---

## Flujo B — Crear producto y verificar en DB

1) UI
- `Productos` → `Crear Producto`
- Completar: SKU + Nombre (descripción opcional)
- Guardar

2) Verificar en DB

Reemplazá `<SKU>` por el SKU creado.

```sql
-- Producto
SELECT id, tenantId, sku, name, photoUrl, photoKey, isActive, version, createdAt, updatedAt
FROM "Product"
WHERE sku = '<SKU>'
ORDER BY createdAt DESC;
```

Esperado
- `version = 1`
- `photoUrl`/`photoKey` en NULL inicialmente

---

## Flujo C — Subir foto de producto (S3) + verificar en DB

Requiere S3 configurado.

1) UI
- Abrí el producto
- En "Foto del producto": elegir archivo (`png/jpg/webp`)
- Click `Subir foto`

2) Verificar en DB

```sql
SELECT sku, photoUrl, photoKey, version, updatedAt
FROM "Product"
WHERE sku = '<SKU>';
```

Esperado
- `photoUrl` no-null
- `photoKey` no-null
- `version` incrementa (+1)

3) Probar quitar foto
- Click `Quitar`

Esperado
- `photoUrl`/`photoKey` vuelven a NULL y `version` incrementa

---

## Flujo D — Crear lote con ingreso inicial (Batch + StockMovement IN)

1) UI
- Abrí el producto
- `Crear Lote`
- Completar:
  - Fecha fabricación / vencimiento (opcional)
  - Estado
- Ingreso inicial (obligatorio)
  - Elegir `Sucursal/Almacén`
  - Cantidad inicial
  - Nota (opcional)
- Crear

Esperado (UI)
- El lote se crea con `batchNumber` autogenerado (formato `LOT-YYYY-NNNN`).
- En la lista de lotes se ve el total de existencias y el desglose por sucursal/ubicación (si el usuario tiene `stock:read`).
- Al expandir un lote, se listan sus movimientos (trazabilidad).

2) Verificar en DB

### 2.1 Batch creado
```sql
SELECT b.id, b.tenantId, b.productId, b.batchNumber, b.manufacturingDate, b.expiresAt, b.status, b.version, b.createdAt
FROM "Batch" b
JOIN "Product" p ON p.id = b.productId
WHERE p.sku = '<SKU>'
ORDER BY b.createdAt DESC
LIMIT 5;
```

### 2.2 Movimiento IN creado y numerado
```sql
SELECT m.id, m.tenantId, m.number, m.numberYear, m.type, m.productId, m.batchId, m.fromLocationId, m.toLocationId, m.quantity, m.referenceType, m.referenceId, m.createdAt
FROM "StockMovement" m
JOIN "Product" p ON p.id = m.productId
WHERE p.sku = '<SKU>'
ORDER BY m.createdAt DESC
LIMIT 10;
```

Esperado
- Último movimiento: `type = 'IN'`
- `number` con formato `MS2025-N` (año actual)
- `referenceType = 'BATCH'` y `referenceId = <batchId>`

### 2.3 Balance actualizado
```sql
SELECT ib.id, ib.tenantId, ib.locationId, ib.productId, ib.batchId, ib.quantity, ib.version, ib.updatedAt
FROM "InventoryBalance" ib
JOIN "Product" p ON p.id = ib.productId
WHERE p.sku = '<SKU>'
ORDER BY ib.updatedAt DESC
LIMIT 10;
```

Esperado
- Existe un balance con `batchId` del lote y `quantity` igual a la cantidad ingresada.

### 2.4 Secuencia por tenant/año
```sql
SELECT tenantId, year, key, currentValue, updatedAt
FROM "TenantSequence"
WHERE key = 'MS'
ORDER BY updatedAt DESC
LIMIT 10;
```

Esperado
- `currentValue` aumentó al crear el movimiento

---

## Flujo E — Movimiento manual (StockMovement) y reglas

1) Crear movimiento manual (si hay UI, o via API)

Ejemplo via API (requiere `stock:move`):
```bash
# Requiere tener un access token
# Ajustar productId/toLocationId
curl -X POST http://127.0.0.1:6000/api/v1/stock/movements \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "IN",
    "productId": "<productId>",
    "batchId": null,
    "fromLocationId": null,
    "toLocationId": "<toLocationId>",
    "quantity": 5,
    "referenceType": "MANUAL",
    "referenceId": "REF-1",
    "note": "Ingreso"
  }'
```

2) Verificar en DB
```sql
SELECT number, numberYear, type, quantity, createdAt
FROM "StockMovement"
WHERE tenantId = '<TENANT_ID>'
ORDER BY createdAt DESC
LIMIT 5;
```

Esperado
- `number` presente y único por tenant

---

## Flujo F — Recetario de elaboración (Recipe + RecipeItem)

1) UI
- Abrí un producto existente
- En "Recetario de elaboración" click `Generar recetario`
- Cargar:
  - Nombre (opcional; si lo dejás vacío toma un default)
  - (Opcional) Cantidad/Unidad de salida
  - Agregar 1+ insumos con cantidad y unidad
- Click `Guardar`

2) Verificar en DB

### 2.1 Recipe creado
```sql
SELECT r.id, r.tenantId, r.productId, r.name, r.outputQuantity, r.outputUnit, r.version, r.createdAt, r.updatedAt
FROM "Recipe" r
JOIN "Product" p ON p.id = r.productId
WHERE p.sku = '<SKU>'
ORDER BY r.createdAt DESC
LIMIT 5;
```

### 2.2 Items creados
```sql
SELECT ri.id, ri.tenantId, ri.recipeId, ri.ingredientProductId, ri.ingredientName, ri.quantity, ri.unit, ri.sortOrder, ri.note, ri.createdAt
FROM "RecipeItem" ri
JOIN "Recipe" r ON r.id = ri.recipeId
JOIN "Product" p ON p.id = r.productId
WHERE p.sku = '<SKU>'
ORDER BY ri.sortOrder ASC, ri.createdAt ASC;
```

Esperado
- Existe 1 `Recipe` por producto.
- Hay `RecipeItem` con `ingredientName` no-null (si los cargaste por texto).

3) Editar
- Click `Editar`
- Modificar algún item (o agregar/quitar)
- Click `Guardar`

Esperado
- `Recipe.version` incrementa.
- La lista de `RecipeItem` refleja los cambios.

4) Eliminar
- Click `Editar`
- Click `Eliminar`

Esperado
- Ya no existe `Recipe` (y se eliminan en cascada los `RecipeItem`).

---

## Checklist rápido (qué mirar)
- Pantalla Productos carga (sin bloqueo por módulo).
- Producto guarda `photoUrl/photoKey` al subir foto (si S3 habilitado).
- Crear lote con `initialStock` produce:
  - Batch
  - StockMovement `IN` numerado
  - InventoryBalance actualizado
  - TenantSequence incrementado
- Recetario permite guardar items por producto y verificar en DB.
