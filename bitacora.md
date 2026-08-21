# Bitácora de desarrollo — PharmaFlow Bolivia (farmaSNT)

> Última actualización: 21 Ago 2026

Este documento suma (a alto nivel) decisiones, hitos y cambios relevantes que se fueron incorporando al repositorio para llegar al estado actual del MVP.

## **[21 Ago 2026] Optimización móvil de /catalog/products (listado y edición)**

### Objetivo alcanzado
- Los usuarios reportan uso frecuente de `/catalog/products` desde el navegador del teléfono móvil, donde la vista de escritorio no se leía bien. Se introducen ajustes de responsividad (Tailwind, breakpoint `md`) sin cambiar lógica ni endpoints.

### `ProductsListPage.tsx`
- El listado inicial ahora tiene una **vista móvil compacta** (`block md:hidden`): una sola fila por producto con `Nombre comercial · stock (fuente pequeña) · botón "Ver"`. La tabla completa de escritorio queda solo en `md+`. La paginación (`PaginationCursor`) se mantiene debajo de ambas vistas cuando aplica.

### `ProductDetailPage.tsx`
- **Formulario "Editar producto"**: Nombre comercial, Nombre genérico y Descripción conservan fila completa; SKU, Costo, Precio unitario, Unidad base, Formato y Estado pasan a un grid compacto (`grid-cols-2` en móvil / `md:grid-cols-4`), dejando de ocupar una fila cada uno.
- **Botones Guardar Cambios / Eliminar (Reactivar)**: ya no son gigantes en móvil — se apilan (`flex-col` ? `md:flex-row`) y reducen a `py-2.5 text-base` (`md:py-3 md:text-lg`), `w-full md:w-auto`.
- **Presentaciones** (producto existente): se elimina la descripción explicativa; cada presentación se muestra como tarjeta de 2 filas (`nombre` / `unidades + acción`). El alta de presentación ahora abre un **`Modal`** mediante el botón "Agregar presentación" en la cabecera (antes era un bloque inline siempre visible).
- **Lotes**: los botones de acción (`Adicionar` / `Editar` / `Eliminar`) muestran **solo el emoji en móvil** (`hidden md:inline` en el texto), liberando espacio para ver el número de lote cuando hay varias acciones.

### Operación
- TypeScript check OK en frontend (`npx tsc --noEmit`).
- Sin cambios de backend ni migraciones Prisma nuevas.

---

## **[20 Ago 2026] Ajustes de cabecera/pie en el catálogo comercial PDF**

- Título único **"Catálogo Comercial"** en ambos modos; subtítulo diferenciado: *"Ficha completa de productos con descripción"* (extendido) y *"Brochure de productos y precios"* (resumido).
- Cabecera (derecha): se re-agregó la **fecha de generación** del documento.
- Pie (izquierda): **nombre de empresa**, **nombre** y **correo** de la persona que genera el documento (vía `usePermissions`).
- Pie (derecha): numeración en formato **"Página X de Y"** (calculado en dos pasadas para conocer el total).
- Espacio ligeramente mayor entre la foto del producto y su nombre (ambos catálogos).

## **[19 Ago 2026] Catálogo Comercial: exportación a PDF (brochure resumido / extendido)**

### Objetivo alcanzado
- `/catalog/commercial` ahora es **visible para todos los roles** con `catalog:read` (antes solo `isTenantAdmin` / `catalog:write`).
- Se agregaron dos botones de exportación PDF en la página: **"Exportar catálogo resumido"** y **"Exportar catálogo extendido"**, que generan un brochure distribuible para clientes.

### Frontend
- **Nuevo archivo `frontend/src/lib/catalogPdf.tsx`** con `exportCommercialCatalogPdf(opts)`:
  - Obtiene **todos** los productos activos (`GET /api/v1/products?includePresentations=true&take=200` con paginación por cursor).
  - La **descripción** no viene en el listado; para el catálogo extendido se hace `GET /api/v1/products/:id` por producto (concurrencia 10) para poblarla.
  - Precarga fotos y logo a **data URL**; las fotos se recortan a un **rectángulo con esquinas redondeadas** (`buildRoundedCanvas` usa `ctx.clip()` + `roundRectPath`), sin círculos blancos en las esquinas. El **logo NO se redondea** (se dibuja tal cual).
  - El PDF se dibuja **directamente con jsPDF** (sin html2canvas), lo que evita problemas de CORS/taint y da control total de layout y contraste.
  - **Resumido**: 3 columnas, foto + presentaciones con su precio al lado; **Extendido**: 2 columnas, además de la descripción del producto.
  - Estética: fondo gris claro (no página blanca), marco decorativo tipo brochure, encabezado con logo + nombre de empresa, **sin "Powered by"** en el pie.
  - Nombre del producto **centrado** y 1pt más grande (11pt).
  - Descripción: hasta **5 líneas**, agregando `...` si se trunca.
  - Cada presentación muestra su nombre (izq.) y precio (der.); **se eliminó la línea "P. unitario"** repetida. Para productos sin presentaciones se muestra `Unidad` + precio base.
- **`pages/catalog/CommercialCatalogPage.tsx`**: se agregan los dos botones (con estado de carga) que invocan `exportCommercialCatalogPdf` usando token, moneda, nombre y logo del tenant.
- **`hooks/useNavigation.ts`**: el enlace `?? Comercial` se mueve fuera del bloque admin/write y se muestra siempre que haya `catalog:read`.

### Operación
- TypeScript check OK en frontend (`npx tsc --noEmit`).
- Sin cambios de backend ni migraciones Prisma nuevas.
- Documentado en `ARCHITECTURE.md` (sección 2.2 lib + mapeo en 3.2 Catálogo & Productos).

---

### Objetivo alcanzado
- Corregido doble conteo de saldo en el kardex para transferencias inter-sucursales.
- Agregada columna "Movimiento" (código del movimiento `MSYYYY-N`) en la tabla y exportación Excel.
- Ampliado el modal de kardex de `5xl` a `6xl` para acomodar la nueva columna.

### Backend (`backend/src/adapters/http/routes/products.ts`)

**Bug 1 — Balance tomado del almacén equivocado:** El cálculo de saldo acumulado usaba `toBalQty ?? fromBalQty`, siempre prefiriendo el balance del **destino** del movimiento. Para una `TRANSFER` hacia otra sucursal, al ver la **sucursal origen** el saldo se establecía al balance del destino (incorrecto), produciendo la apariencia de doble conteo. Se elevaron `fromAffects`/`toAffects` al scope del loop y se usa el balance (`fromBalQty` o `toBalQty`) de la ubicación que realmente pertenece al almacén filtrado.

**Bug 2 — OUT de `MOVEMENT_REQUEST` tratado como TRANSFER:** Los movimientos `OUT` con `referenceType: 'MOVEMENT_REQUEST'` (envíos de solicitudes) eran tratados como `TRANSFER` (afectaban origen y destino simultáneamente), sumando `+qty` tanto en el movimiento de envío como en el movimiento `IN` de recepción (`MOVEMENT_REQUEST_RECEIPT`), duplicando el stock en el destino. Se eliminó `OUT + MOVEMENT_REQUEST` de la condición `TRANSFER` en ambos branches (`warehouseLocationIds` y `locationId`), dejando que los `OUT` solo afecten el origen (el destino lo maneja el movimiento `IN` de recepción).

**Sin migraciones Prisma nuevas** (solo cambios en lógica de query).

### Frontend (`frontend/src/pages/stock/InventoryPage.tsx`)
- El modal de kardex cambia `maxWidth` de `"5xl"` a `"6xl"`.
- Nueva columna "Movimiento" en la tabla del kardex (`m.movementNumber`) y en la exportación a Excel (`'Movimiento'` field). El campo `movementNumber` ya existía en la respuesta del backend (`KardexItem`).

### Operación
- TypeScript check OK en backend y frontend.
- Docker build OK para backend y frontend.
- No se requieren migraciones Prisma nuevas.

---

## **[13 Ago 2026] Modal de recepción de transferencias con devolución parcial por ítem (igual que solicitudes)**

### Objetivo alcanzado
- El botón "Recepcionar" de la sección **"Transferencias pendientes de recepción"** en `/stock/returns` (pestaña Recepción/Devolución) ahora abre un **modal** —en lugar de recepcionar directo— que permite, por cada ítem de la transferencia:
  - Marcar **recepción completa** (por defecto), o
  - Indicar **cantidad a devolver** + **motivo** (obligatorio si hay devolución), igual que el modal de recepción de solicitudes.
- El modal también admite **foto de evidencia** (upload presigned S3, `POST /api/v1/stock/returns/photo-upload`) y una **nota general**.
- Al confirmar, el backend (`POST /api/v1/stock/transfers/:id/receive`) marca la transferencia como `RECEIVED` y, si hubo devoluciones, crea un **TRANSFER inverso** (destino ? origen) por la cantidad devuelta, manteniendo el stock consistente. La foto y la nota se registran en el movimiento.

### Backend (`backend/src/adapters/http/routes/stock.ts`)
- El endpoint `POST /api/v1/stock/transfers/:id/receive` ahora acepta `note`, `photoUrl` y `items: [{ movementId, returnedQuantity, returnReason }]`.
  - `movementId` es el **id** del movimiento (UUID), no el código; el endpoint de picking ahora incluye `movementId` en cada `sentLine`.
  - Por cada ítem con `returnedQuantity > 0` y `returnReason` válido crea un TRANSFER inverso vía `createStockMovementTx` (origen = `toLocationId` original, destino = `fromLocationId` original) con `referenceType: null` (aparece en "Movimientos Realizados" como trazabilidad) y nota `Devolución de transferencia: <motivo>`.
  - Validaciones: la devolución no puede exceder lo enviado, el motivo es obligatorio, y la sucursal destino debe coincidir con la del usuario (ya existente).
- `GET /api/v1/stock/completed-movements/:id/picking`: cada `sentLine` ahora incluye `movementId` (UUID) además de `movementNumber`.

### Frontend (`frontend/src/pages/stock/ReturnsPage.tsx`)
- Se agregó el estado y la mutación `transferReceptionMutation` + `openTransferReceptionModal(m)` que carga las líneas vía el endpoint de picking y pre-carga "recepción completa" por ítem.
- Nuevo `transferReceptionModal`: lista ítems con checkbox "Recepción completa", campos "Cantidad a devolver" y "Motivo de devolución" (cuando no es completa), input de foto (`presignReturnPhoto`/`uploadToPresignedUrl`) y nota general; botón "Confirmar recepción".
- El botón "Recepcionar" de la tabla de transferencias pendientes ahora llama a `openTransferReceptionModal(m)` (antes recepcionaba directo).

### Operación
- `tsc` limpio en backend y frontend; `npm run build` (frontend) y build de Docker OK.
- Verificado end-to-end con un almacén PROVEEDOR ? SALES: transferencia creada queda `PENDING`; recepción completa devuelve `{ok:true, received:1, returns:0}`; recepción con devolución parcial (3 de 10) devuelve `{ok:true, received:1, returns:1}` (TRANSFER inverso creado); re-recepcionar devuelve `409`.

---

## **[13 Ago 2026] Picking con código de solicitud + código de movimiento + solicitante/enviado, y corrección de recepción de transferencias en /stock/returns**

### Objetivo alcanzado
- El documento **Picking** (PDF y modal de detalle en "Movimientos Realizados") ahora muestra siempre:
  - **Código de solicitud** (`requestCode`, p.ej. `SOL260004`) cuando el movimiento corresponde a una atención de solicitud; `null` para transferencias/movimientos sin solicitud.
  - **Código de movimiento** (movementCode): para un movimiento individual es su 
umber (MS2026-N); para una transferencia masiva es el eferenceId del grupo; para FULFILL_REQUEST es el 
umber del primer movimiento de envío (OUT) (puede ser 
ull si la solicitud no ha sido enviada todavía).
  - **Solicitante** (`requestedByName`): quien pidió la solicitud; `—` cuando el movimiento no deriva de una solicitud (siempre hay "quien envió", pero no siempre "quien solicitó").
  - **Enviado por** (`sentByName`): siempre presente (usuario que creó/atendió el envío).
  - Cada línea enviada del picking incluye ahora **`movementNumber`** (código del movimiento de esa línea), de modo que una solicitud atendida con varios movimientos queda trazada línea a línea.
- Corrección de un bug que impedía ver las **transferencias pendientes de recepción** en la pestaña "Recepción/Devolución" de `/stock/returns`: la consulta usaba `take=200`, pero el esquema del endpoint limita `take` a 100, por lo que devolvía `400` y la sección nunca se renderizaba. Ahora usa `take=100` y además el backend acepta el filtro server-side `receiptStatus=PENDING`, garantizando que la transferencia pendiente aparezca aunque haya mucho historial.

### Backend (`backend/src/adapters/http/routes/stock.ts`)
- **`GET /api/v1/stock/completed-movements`**: `completedMovementsQuerySchema` agrega `receiptStatus: enum(['PENDING','RECEIVED']).optional()`; el handler filtra la lista combinada por `receiptStatus` antes de paginar.
- **`GET /api/v1/stock/completed-movements/:id/picking`**: la respuesta `meta` ahora incluye `movementCode` y `sentByName`; `requestedByName` solo se asigna para `FULFILL_REQUEST` (antes se reusaba el creador como "solicitante" en movimientos sin solicitud). Cada `sentLine` incluye `movementNumber`.

### Frontend
- **`lib/movementRequestDocsPdf.ts`**: `PickingPdfMeta` agrega `movementCode` y `sentByName`; `PickingPdfSentLine` agrega `movementNumber`. El PDF "PICKING" muestra en el encabezado `Solicitud`, `Movimiento`, `Solicitante` y `Enviado por`, y la tabla "ENVIADO" suma la columna "Mov" (código de movimiento por línea).
- **`pages/stock/CompletedMovementsPage.tsx`**: `handleExportPicking` mapea los nuevos campos; el modal de detalle muestra "Código de solicitud" (cuando existe), "Solicitante" y "Enviado por" por separado, y la tabla de líneas enviadas incluye la columna "Mov".
- **`pages/stock/ReturnsPage.tsx`**: `pendingTransfersQuery` usa `take=100&receiptStatus=PENDING` (antes `take=200`), corrigiendo la sección "Transferencias pendientes de recepción".

### Operación
- `tsc` limpio en backend y frontend.
- Verificado con `admin@demo.local`: el picking de una `FULFILL_REQUEST` devuelve `requestCode=SOL260004`, `requestedByName`/`sentByName` correctos y `movementNumber` por línea; el picking de un `TRANSFER` devuelve `movementCode=MS2026-14`, `requestedByName=null` y `sentByName` poblado. El filtro `receiptStatus=PENDING` responde `200`.
- No se requieren migraciones Prisma nuevas.

---

## **[11 Ago 2026] Trazabilidad: lote en envíos, firmas con nombre, atención en líneas separadas + ruta Warehouse:Location en atendidas**

### Objetivo alcanzado
- En `/stock/movement-requests-traceability` (modal "Detalle de solicitud" y PDF "Exportar PDF") ahora se muestra el **lote** enviado en cada envío (solo aplica a solicitudes ya atendidas/recepcionadas que tienen `batch` en el movimiento `OUT`).
- El cuadro de **firmas** del PDF ahora incluye directamente el **nombre de quien solicitó** (`requestedByName`) y el **nombre de quien atendió** (`fulfilledByName`), además de la línea de fecha.
- En el PDF, **"Atendida:"** y **"Recepción/confirmación:"** se imprimen en **líneas separadas** (antes compartían la misma línea).
- La **ruta** en formato `Warehouse:Location` ahora se aplica también a solicitudes ya enviadas/recepcionadas usando el `fromLocation` real del primer envío (`fromWarehouse:fromLocation ? toWarehouse:toLocation`); para solicitudes solo creadas el destino puede mostrar solo el warehouse o `warehouse:location`.

### Frontend
- **`MovementRequestsTraceabilityPage.tsx`**:
  - `TraceMovement` ahora incluye `batchNumber`, `fromWarehouseCode` y `fromLocationCode` (mapeados desde `batch.batchNumber` y `fromLocation` del movimiento `OUT`).
  - Helper `buildRoute()` centraliza el formato: origen `warehouse:location` cuando hay envíos (origen real), destino siempre `warehouse:location`; para creadas sin envío usa `warehouse` (o `warehouse:location`) en destino.
  - La sección "Envíos" del modal ahora muestra **Lote** y la ruta `fromWarehouse:fromLocation ? toWarehouse:toLocation` por envío.
  - `handleExportPdf` usa `buildRoute()` y pasa `batchNumber` por envío.
- **`traceabilityPdf.ts`**:
  - `TraceabilityPdfShipment` incluye `batchNumber`; la tabla "Envíos" agrega columna **Lote**.
  - "Atendida:" y "Recepción/confirmación:" en líneas separadas.
  - Firmas: "Solicita / Recibe" con `Nombre: <requestedByName>` y "Atiende / Envía" con `Nombre: <fulfilledByName>`.

### Operación
- TypeScript check OK en frontend.
- No se requieren migraciones Prisma nuevas.

## **[11 Ago 2026] /stock/movements — destino en formato Warehouse:Location (vista y modal)**

- En `/stock/movements`, la lista de solicitudes (columna "Destino") y el modal "Detalle de solicitud" ahora muestran el destino en formato `Warehouse:Location` (`codigoSucursal:codigoUbicacion`, sin prefijo `SUC-`), consistente con `/stock/completed-movements`, `/stock/returns` y la trazabilidad.
- Para solicitudes antiguas que no incluyen `toLocation`, el destino queda como `warehouse` (o `warehouse:—`) sin romper la vista; el formato completo se aplica cuando la ubicación destino existe.

### Frontend
- **`MovementsPage.tsx`**:
  - `MovementRequest` ahora tipa `toLocation` (ya venía en el spread de la API).
  - Helpers `cleanCode()` (quita `SUC-`), `locLabel()` y `destLabel(r)` producen `warehouse:location`.
  - Columna "Destino" de la tabla y campo "Destino" del modal usan `destLabel(r)`.

### Operación
- TypeScript check OK en frontend.

## **[12 Ago 2026] /stock/returns — destino en formato Warehouse:Location (ORG ? DEST) en Recepciones**

- En la pestaña "Recepciones" de `/stock/returns`, la columna "ORG ? DEST" (tabla) y el bloque "ORG ? DEST" del modal "Ver" ahora muestran el **destino** en formato `Warehouse:Location` (`codigoSucursal:codigoUbicacion`, sin prefijo `SUC-`), igual que el origen. Antes el destino solo mostraba el warehouse porque para algunas solicitudes `toLocation.code` venía nulo en la solicitud, aunque el envío (movimiento OUT) sí apuntaba a una ubicación destino concreta.
- El destino se resuelve con `destLocCodeOf(r)` / `destWarehouseCodeOf(r)`: usa `toLocation` de la solicitud si existe, si no la `toLocation` del primer movimiento OUT del envío.

### Backend
- **`stock.ts` (`GET /api/v1/stock/movement-requests`)**: la consulta de movimientos ahora también recolecta `toLocationId` y construye `toLocationMap`; cada movimiento OUT expone `toLocationId` y `toLocation` (`{id, code, warehouse}`). Sin cambios de contrato para campos ya existentes.

### Frontend
- **`ReturnsPage.tsx`**: helpers `firstOutMovement(r)`, `destLocCodeOf(r)`, `destWarehouseCodeOf(r)`; la columna "ORG ? DEST" y el modal usan `whLocLabel` para ambos extremos.

### Operación
- TypeScript check OK en frontend y backend.

## **[12 Ago 2026] Nuevo rol BRANCH_PROVIDER + visibilidad total de transferencias para sucursales proveedor**

- Se creó el rol de sistema **`BRANCH_PROVIDER`** ("Administrador de Sucursal Proveedor") para usuarios de almacenes tipo `PROVIDER`, cuya labor es crear/ajustar lotes y atender solicitudes de transferencia de cualquier sucursal de venta.
- Permisos del rol: `scope:branch`, `catalog:read`, `catalog:write`, `stock:read`, `stock:manage`, `stock:move`, `stock:deliver`, `report:stock:read`.
- Backend: `branchCityOf()` en `stock.ts` y `reports.ts` ahora devuelve `null` (sin filtro de ciudad) cuando el almacén del usuario es de tipo `PROVIDER`. Esto permite que `/api/v1/stock/movement-requests`, `/stock/returns` y `/reports/stock/balances-expanded` (inventario) devuelvan TODOS los datos (lectura de sucursales tipo venta), sin restricción de ciudad. Los almacenes tipo `SALES` siguen restringidos a su ciudad.
- Corrección crítica: `request.auth.warehouseType` no se cargaba (el `user.include` en `server.ts` solo traía `city` de `warehouse`); ahora se selecciona `type` y se propaga a `AuthContext`/`request.auth`. Sin esto, la relajación de PROVIDER nunca se activaba.
- La edición de stock sigue restringida por backend: `POST /api/v1/stock/movements` rechaza (`403`) ADJUSTMENT/IN hacia almacenes `SALES`, por lo que el proveedor solo edita su propio almacén.

### Frontend
- `usePermissions.ts`: expone `isBranchProvider` y `warehouseType`.
- `useNavigation.ts`: el grupo "Catálogo ? Productos" aparece con `catalog:write`; se excluye al proveedor de "Laboratorio".
- `BulkFulfillRequestsPageSimple.tsx`: si `isBranchProvider`, lista TODAS las solicitudes de movimiento (sin filtro por ciudad de destino).
- `InventoryPage.tsx`: banner "Modo sucursal" y acciones (cambio de estado, editor de ubicación inline) deshabilitadas para almacenes que no son el propio del usuario (solo lectura en los demás).

### Operación
- `ensureSystemRoles` siembra el rol en todos los tenants al arrancar. Los usuarios proveedor existentes deben asignárselo manualmente (rol de sistema).
- TypeScript check OK en frontend y backend.

## **[12 Ago 2026] Autonomía de sucursales en reportes de stock**

- Por criterio de autonomía, los usuarios con `scope:branch` (BRANCH_ADMIN y BRANCH_PROVIDER) solo pueden ver reportes de **su propia sucursal**; los administradores sin scope de sucursal (Tenant Admin / roles globales) mantienen el selector "Sucursal" para elegir un almacén concreto o "Todas las sucursales".
- Antes, los usuarios de sucursal tipo `SALES` se filtraban por ciudad (`branchCityOf`) y los `PROVIDER` veían inventario de todas las ciudades. Ahora el filtro se basa en el `warehouseId` propio del usuario autenticado para todos los tipos de sucursal.

### Backend (`backend/src/adapters/http/routes/reports.ts`)
- Nuevos helpers `branchOwnWarehouseIdOf(request)` y `resolveBranchWarehouseId(request, requestedWarehouseId)`: para usuarios con `scope:branch` (no Tenant Admin) fuerzan el `warehouseId` efectivo a su almacén propio (rechazan con `409` si no tiene sucursal seleccionada). Para admins devuelven el `warehouseId` recibido (o `null` = todas).
- Aplicado a: `balances-expanded`, `existencias`, `low-stock`, `expiry-alerts`, `rotation`, `transfers-between-warehouses`, `returns/summary`, `returns/by-warehouse` y `movements-expanded`. Los reportes de ciudad (`movement-requests/by-city`) y de actividad por tipo (`provider-activity`, `sales-branch-activity`) mantienen su lógica por tipo de almacén.
- `WarehouseType.PROVIDER` ya no implica "ver todas las sucursales" en reportes de stock; la visibilidad total de transferencias (movement-requests) se mantiene solo a nivel operativo de atención.

### Frontend (`frontend/src/pages/reports/StockReportsPage.tsx`)
- Se agrega `usePermissions`; `isBranchScoped` oculta el `Select` "Sucursal" y muestra un indicador de solo lectura ("Mi sucursal"). `effectiveWarehouseId` fija el almacén propio en todas las queries (`existencias`, `balancesExpanded`, ubicaciones) y habilita el selector de Sub almacén.

### Operación
- TypeScript check OK en frontend y backend.

---

## **[12 Ago 2026] Inventario "Por Sucursal": mismo modo solo-lectura que "Por Producto"**

- En `/stock/inventory`, la vista **"Por Sucursal"** ahora aplica las mismas reglas de solo-lectura que la vista "Por Producto" para usuarios con scope de sucursal (`scope:branch`): la edición solo está habilitada en el almacén propio del usuario; los demás almacenes quedan en solo lectura (backend ya lo refuerza).
- Antes, la columna "Ubicación" pasaba `InlineLocationEditor` sin `disabled` en la vista por sucursal, y la columna "Acción" solo mostraba "Ver flujo" (sin botón "Estado"), por lo que el editor de ubicación permitía mover stock de cualquier almacén y el cambio de estado de lote estaba ausente en esta vista.

### Frontend (`frontend/src/pages/stock/InventoryPage.tsx`)
- `warehouseColumns` ("Por Sucursal"):
  - Columna "?? Ubicación": `InlineLocationEditor` ahora recibe `disabled={!canEditWarehouse(b.warehouseId)}`.
  - Columna "?? Acción": ahora es condicional (`canSeeBatchFlow || canChangeBatchStatus`) e incluye el botón "Estado" con `disabled={!canEditWarehouse(b.warehouseId)}` y tooltip "Solo lectura: no es tu almacén", idéntico a la vista "Por Producto".
- El banner "Modo sucursal" (líneas superiores) ya advertía esta restricción; ahora la UI la respeta en ambas vistas.

### Operación
- TypeScript check OK en frontend.

---

## **[12 Ago 2026] Ajustes BRANCH_PROVIDER: edición solo del creador, atención por almacén destino, recepciones propias**

- **/stock/movements**: el botón "Editar"/"Cancelar" de una solicitud OPEN ahora solo es visible para quien la creó (`requestedBy === usuario`) o Tenant Admin; antes aparecía para cualquiera.
- **/stock/fulfill-requests**: para `BRANCH_PROVIDER` el Almacén Origen se auto-selecciona (su warehouse) y se deshabilita; la "Ubicación origen" ya no se elige arriba. Al elegir Almacén Destino, la lista de solicitudes se filtra por `warehouseId === destino`. El modal de atención carga los lotes de **todo el almacén origen** (todas sus ubicaciones) y cada lote seleccionado conserva su `fromLocationId`.
- **Backend `bulk-fulfill`**: `fromLocationId` ahora es opcional a nivel global y se acepta **por ítem** (`items[].fromLocationId`), cayendo al global si no se indica. El stock se valida y el OUT se crea por la ubicación de cada lote.
- **/stock/returns**: se revierte la visibilidad total para PROVIDER; ahora las devoluciones y el contador "Recepción/Devolución" (menú rápido) se filtran por el `warehouseId` propio del usuario de sucursal (no por ciudad), mostrando solo lo enviado a su almacén.

### Operación
- TypeScript check OK en frontend y backend.

---

## **[11 Ago 2026] Recepción/Devolución unificada + formato Warehouse:Location en /stock/returns**

### Objetivo alcanzado
- Flujo unificado de recepción y devolución parcial en `/stock/returns`: un solo botón "Recepción/Devolución" que abre un modal con recepción completa por ítem, devolución parcial con motivo, upload de foto y nota general.
- Consistencia de formato: la columna "ORG ? DEST" en la tabla de recepciones y el header del modal "Ver" ahora usan el formato `Warehouse:location` (código de sucursal sin prefijo `SUC-` + código de ubicación), igual que `/stock/completed-movements`.

### Backend
- **Nuevo endpoint**: `POST /api/v1/stock/movement-requests/:id/reception` (`backend/src/adapters/http/routes/stock.ts:3734`) que crea movimientos `IN` con `referenceType: "MOVEMENT_REQUEST_RECEIPT"` (recepción) y/o `"MOVEMENT_REQUEST_RETURN"` (devolución) por ítem, valida `receivedQuantity + returnedQuantity = pending`, requiere `returnReason` cuando hay devolución, cierra la solicitud si quedan 0 pendientes, y emite eventos socket.
- Schemas: `movementRequestReceptionParamsSchema`, `movementRequestReceptionBodySchema`, `confirmReceptionUnifiedResponseSchema`.

### Frontend
- **`ReturnsPage.tsx`**: reescritura completa — eliminados botones "Nueva devolución", crear modal y modal de devolución antiguos. Único botón "Recepción/Devolución" ? modal unificado con tabla de ítems enviados (lote, producto, presentación, cant. enviada, cant. solicitada, pendiente), checkbox "Recepción completa" por ítem (default checked), cuando se desmarca muestra "Cant. a devolver" + "Motivo" con resumen "Recibirán/Devolverán", upload de foto (presigned S3 via `POST /api/v1/stock/returns/photo-upload`) y nota general.
- Helpers `cleanCode()`, `locLabel()`, `whLocLabel()` agregados mirror a `CompletedMovementsPage`.
- La columna "ORG ? DEST" en la tabla de recepciones y el header del modal "Ver" usan `whLocLabel(warehouseCode, locationCode)` ? `WAREHOUSE:LOCATION` format (quitando `SUC-`).
- El buscador client-side incluye ahora códigos de ubicación (`fromLocation?.code`).
- Types: `ReceptionItemState`, `ReceptionItemInput`, `ReceptionInput` agregados; funciones API `confirmReceptionUnified()` y `presignReturnPhoto()`.

### Operación
- TypeScript check OK en frontend y backend.
- No se requieren migraciones Prisma nuevas.

---

## **[11 Ago 2026] Trazabilidad de solicitudes: formato Warehouse:Location + timeline de atención/recepción + exportar PDF**

### Objetivo alcanzado
- `/stock/movement-requests-traceability` ahora muestra origen/destino en formato `Warehouse:location` (código sin prefijo `SUC-` + ubicación), consistente con `/stock/completed-movements` y `/stock/returns`.
- El timeline y el detalle de envíos muestran fecha de atención (fulfillment) o atención parcial (fecha del primer envío), y registran quién y cuándo se recepcionó, incluyendo nota y preview de foto.
- Nuevo botón "Exportar PDF" en el modal de detalle, que genera una nota de recepción con logo, código de solicitud como marca de agua, y campos para firmar por quien solicita/envía y quien recibe/atiende.

### Backend (`backend/src/adapters/http/routes/stock.ts`)
- **Endpoint `GET /api/v1/stock/movement-requests`**: extendido para incluir `receptions` en cada movimiento (`OUT`). Cada entrada `reception` contiene: `type` (RECEIPT o RETURN), `quantity`, `note` (incluye URL de foto como `Foto: <url>`), `createdBy`, `createdByName`, `createdAt`.
- La consulta de movimientos `IN` (`MOVEMENT_REQUEST_RECEIPT` / `MOVEMENT_REQUEST_RETURN`) ahora selecciona `note`, `createdBy`, `createdAt` además de `referenceId`, `referenceType`, `quantity`.
- Los usuarios de recepción se resuelven a `createdByName` using el `userMap` existente.

### Frontend
- **`MovementRequestsTraceabilityPage.tsx`**:
  - Reemplazados helpers `abbreviateCity()` por `cleanCode()`, `locLabel()`, `whLocLabel()` importados de la misma lógica que `ReturnsPage.tsx` y `CompletedMovementsPage.tsx`.
  - La columna "Ruta" en la tabla y el header del modal "Detalle de solicitud" usan formato `Warehouse:Location` (ej: `ALM:BIN-01 ? SCZ:BIN-02`).
  - Timeline actualizado: 1) Creada, 2) Atendida (usa `fulfilledAt` o fecha del primer envío si es parcial), 3) Envíos, 4) Recepción (quién, cuándo, nota, foto), 5) Estado actual.
  - La sección "Envíos" muestra detalle de recepción por envío: quién recibió, cuándo, cantidades recibidas/devueltas, nota con preview de foto si existe.
  - Filtro de búsqueda incluye ahora códigos de origen/destino y la ruta formateada.
  - Nuevo botón "Exportar PDF" en el modal de detalle.
- **`Modal.tsx`**: agregado prop `actions?: ReactNode` para renderizar botones de acción en el header del modal.
- **`movementRequestDocsPdf.ts`**: función `exportMovementRequestTraceabilityToPdf()` — nota de trazabilidad con marca de agua (código de solicitud únicamente), logo del tenant, tres secciones tabulares (Solicitud / Atención / Recepción), preview de foto de recepción, y firmas sin caja para "Solicitante / Recibe" y "Atendido por / Envía".

### Operación
- TypeScript check OK en frontend y backend.
- Vite build OK.
- No se requieren migraciones Prisma nuevas.

---

## **[10 Ago 2026] Cotizaciones: carga automática de precio de producto al editar/agregar líneas**

### Objetivo alcanzado
- Al editar una cotización o agregar una nueva fila de producto, el precio unitario ahora se carga automáticamente desde el producto (`price`) y se recalcula al cambiar de presentación (considerando `priceOverride` de la presentación).

### Frontend (`frontend/src/pages/sales/QuoteDetailPage.tsx`)
- **Bug**: Al seleccionar un producto o agregar una fila nueva, `unitPriceBase` se inicializaba a `0`, no tomando el `price` del producto ni el `priceOverride` de la presentación por defecto. Al cambiar de presentación, el precio tampoco se recalculaba.
- **Fix**:
  - Nueva función `resolveUnitPriceBaseForPresentation`: si la presentación tiene `priceOverride`, devuelve `priceOverride / unitsPerPresentation` (precio base por unidad); si no, devuelve el `price` del producto.
  - `ProductPresentation` type: añadido `priceOverride`.
  - `DraftLine` type: añadido `productPrice` para conservar el precio del producto independientemente de la presentación.
  - `buildDraftFromQuote`: inicializa `productPrice` y `unitPriceBase` desde `l.unitPrice`.
  - `ProductSelector` onChange: inicializa `unitPriceBase` y `productPrice` usando `p.price` y la presentación por defecto.
  - Select de presentación onChange: recalcula `unitPriceBase` usando `resolveUnitPriceBaseForPresentation` con `productPrice`.
  - Creación de filas nuevas: inicializa `productPrice: 0`.

### Backend
- Sin cambios. El backend (`salesQuotes.ts`) ya resolvía correctamente el precio al crear/actualizar cotizaciones: usaba `line.unitPrice` si venía definido, o `product.price` / `priceOverride / unitsPerPresentation` si no. El problema era únicamente frontend.

### Operación
- TypeScript check OK en frontend y backend.
- Sin migraciones Prisma nuevas.

---

## **[10 Ago 2026] Reportes: actividad de sucursales por tipo (Proveedor / Venta)**

### Objetivo alcanzado
- Nuevas pestañas en `StockReportsPage.tsx`: **Proveedor** y **Ventas Sucursal**, que muestran KPIs y tablas de actividad filtrada por `WarehouseType`.

### API
- `GET /api/v1/reports/stock/provider-activity`: para warehouses tipo `PROVIDER`. KPIs y tabla con lotes creados, transferencias enviadas (y qty), ajustes (y qty de salida).
- `GET /api/v1/reports/stock/sales-branch-activity`: para warehouses tipo `SALES`. KPIs y tabla con lotes recibidos, solicitudes aceptadas/rechazadas/pendientes, cotizaciones creadas, órdenes creadas y monto de ventas.

### Frontend
- Tipos `ProviderActivityItem` y `SalesBranchActivityItem` agregados.
- Queries `providerActivityQuery` y `salesBranchActivityQuery` (enabled solo en sus pestañas).
- KPIs y tables con columnas adaptadas a cada tipo de sucursal.

### Backend (`backend/src/adapters/http/routes/reports.ts`)
- `ProviderActivityRow` y `SalesBranchActivityRow` types agregados.
- Consultas SQL con CTE `provider_warehouses` / `sales_warehouses` filtrando por `WarehouseType`.
- Los queries usan `db.$queryRaw<ProviderActivityRow[]>` y `db.$queryRaw<SalesBranchActivityRow[]>` para correctos tipos.
- **Corrección de filtrado de fechas**: las consultas SQL usaban `BETWEEN ${from}::timestamptz AND ${to}::timestamptz`, pero cuando `from`/`to` son `null` (sin filtro) `BETWEEN NULL` devuelve 0 resultados. Reemplazado por patrón `(${from ?? null}::timestamptz IS NULL OR col >= ${from}) AND (${to ?? null}::timestamptz IS NULL OR col < ${to})` (to exclusivo), igual que el resto del archivo. Esto asegura que `from=2026-07-01&to=2026-08-01` reporte todo julio completo.
- **Corrección `quotesCreated`**: ahora filtra por `Location.warehouseId = sw.id` (coteo previo a `Quote.locationId ? Location.warehouseId`), no devolvía el total del tenant.

### Frontend
- El selector de fechas default: primer día del mes actual a primer día del mes siguiente (`startOfMonth` / `startOfNextMonth`), compatible con el filtro `to` exclusivo del backend.
- Query params `from` / `to` en formato ISO date (`YYYY-MM-DD`), parseados por `z.coerce.date()` en el backend.

### Verificación
- Reporte de julio (`from=2026-07-01&to=2026-08-01`) validado contra endpoint `/api/v1/reports/stock/provider-activity` ? 401 (auth correcto, ruta registrada sin duplicados).
- Docker build OK (frontend y backend).
- Container backend healthy en puerto 6000.

---

### Objetivo alcanzado
- Las sucursales (warehouses) ahora tienen un **tipo** (`PROVIDER`/`SALES`). Solo los warehouses tipo **Proveedor** pueden crear lotes y ajustar stock (ingresos `IN`/`ADJUSTMENT`); los warehouses tipo **Venta** ingresan stock únicamente por transferencias (`TRANSFER`) o recepción de solicitudes (`MOVEMENT_REQUEST_RECEIPT`).

### Backend
- **Prisma** (`schema.prisma`): nuevo enum `WarehouseType { PROVIDER SALES }` y campo `type: WarehouseType @default(SALES)` en el modelo `Warehouse`.
- **Migración** `20260809120000_add_warehouse_type/migration.sql`: `CREATE TYPE "WarehouseType"` + `ALTER TABLE "Warehouse" ADD COLUMN "type" "WarehouseType" NOT NULL DEFAULT 'SALES'` (warehouses existentes pasan a Venta).
- **`warehouses.ts`**: `GET /warehouses` incluye `type`; `POST/ PATCH /warehouses` aceptan/actualizan `type` (default `SALES`).
- **`products.ts`** (`POST /api/v1/products/:id/batches`): el `initialStock.warehouseId` (o el warehouse del `toLocationId`) debe ser `PROVIDER`, sino 403.
- **`stock.ts`** (`POST /api/v1/stock/movements`):
  - `ADJUSTMENT` sobre un warehouse `SALES` ? 403 (bloqueado para ambos locations: `toLocationId`/`fromLocationId`).
  - `IN` con `referenceType` distinto de `MOVEMENT_REQUEST_RECEIPT` sobre un warehouse `SALES` ? 403. Las recepciones de transferencias (`MOVEMENT_REQUEST_RECEIPT`) siguen permitidas en warehouses Venta.
- **`auth.ts`** (`GET /api/v1/auth/me`): incluye `warehouse.type` en la respuesta para que el cliente conozca el tipo del warehouse activo del usuario.

### Frontend
- **`useNavigation.ts`**: la entrada **"?? Sucursales"** pasó del grupo **Almacén** al grupo **Sistema** (solo `TenantAdmin` ve el menú Sistema); así solo los administradores acceden a la gestión de sucursales.
- **`WarehousesPage.tsx`**: columna "Tipo" en la tabla; selector de tipo (Proveedor/Venta) en crear y editar; el `type` viaja en los payloads `POST/PATCH`.
- **`ProductDetailPage.tsx`**: el selector de "Sucursal/Almacén (ingreso inicial)" al crear lotes se filtra a warehouses tipo **Proveedor**; se muestra aviso informativo cuando la sucursal activa del usuario es Venta o no hay Proveedores activos. El ajuste de lotes ya se restringe al warehouse de ingreso original (Proveedor) por la validación existente y el backend.

### Operación
- Nueva migración Prisma: `20260809120000_add_warehouse_type/migration.sql` — aplicar antes del deploy (`prisma migrate deploy`).
- `npm --prefix backend run prisma:generate` ejecutado.
- Typecheck OK en backend y frontend.

---

## **[08 Ago 2026] Ergonomía: deshabilitar scroll de rueda en inputs numéricos**

### Objetivo alcanzado
- Prevenir que la rueda del mouse cambie accidentalmente valores en inputs numéricos (`type="number"`) al hacer scroll sobre ellos, un problema frecuente al seleccionar productos y cantidades (100 ? 101/99).

### Frontend (`frontend/src/components/common/Input.tsx` + `frontend/src/main.tsx`)
- `Input` component: agrega `onWheel` que cancela `preventDefault()` cuando `type === 'number'`, preservando el `onWheel` del consumidor (combinado) y no afectando inputs no numéricos.
- `main.tsx`: hook `useEffect` global que registra un listener de `wheel` en fase de captura (`{ capture: true, passive: false }`) que cancela el scroll sobre cualquier `input[type=number"]` que no pase por el componente `Input` (cobertura completa).
- Inputs nativos `<XAxis type="number">` de recharts no se ven afectados (no son `input`).

### Operación
- Frontend compilado correctamente (`npm --prefix frontend run build`).
- Sin migraciones Prisma ni cambios de backend.

---

## **[07 Ago 2026] Kardex de inventario — formato WAREHOUSE:Location, filtrado por sucursal, ajustes y ventas**

### Objetivo alcanzado
- Refinamiento del kardex de inventario para mostrar Origen y Destino con el formato `WAREHOUSE:Location` (código de sucursal sin prefijo `SUC-` + código de ubicación), filtrar movimientos por la sucursal consultada, incluir ajustes de stock, y mostrar órdenes de venta con nombre del cliente en la columna Destino.

### Backend (`backend/src/adapters/http/routes/products.ts`)
- `GET /api/v1/products/:id/kardex`: agrega `fromWarehouseCode`, `toWarehouseCode`, `fromLocationCode`, `toLocationCode` a la respuesta (`KardexRow` y `KardexItem`).
- Para movimientos `OUT` + `SALES_ORDER`: el `toCode` se muestra como el número de orden y `toWarehouseCode` como el nombre del cliente. La columna "Detalle" incluye el nombre del cliente para estas ventas.
- Nueva query secundaria extrae `customer.name` desde `salesOrder` (lookup por `referenceId = order.number`) para enriquecer el kardex.
- El `runningBalance` (Saldo acumulado) se calcula solo sobre movimientos que afectan la sucursal filtrada (`affectsWarehouse`), respetando `entry`/`exit` por tipo (IN/OUT/TRANSFER/ADJUSTMENT).
- La lógica de `affectsWarehouse` incluye correctamente `type: 'ADJUSTMENT'` (tanto para `warehouseLocationIds` como para `locationId`).

### Frontend (`frontend/src/pages/stock/InventoryPage.tsx`)
- Header del kardex muestra la sucursal a la derecha (`Sucursal: LPZ`).
- Columnas "Origen" y "Destino" usan el formato `WAREHOUSE:Location` (ej: `LPZ:Privado ? SCZ:Público`), sin prefijo `SUC-` en el código de sucursal.
- El kardex filtra y muestra solo movimientos con `affectsWarehouse === true` (transferencias, ingresos, salidas, ajustes, recepciones y devoluciones que impactan la sucursal).
- El saldo acumulado (`Saldo` columna) se calcula sobre movimientos filtrados, mostrando el saldo total del producto en la sucursal en cada paso (ej: 2000 ? 1960 tras una venta de 40).
- Exportación a Excel refleja el mismo formato y filtrado.
- Los ajustes (`ADJUSTMENT`) aparecen correctamente cuando su `fromLocationId`/`toLocationId` pertenece a la sucursal filtrada.
- Las ventas (`OUT` + `SALES_ORDER`) muestran `NRO_ORDEN: NombreCliente` en la columna "Destino".

### Frontend (`frontend/src/pages/stock/CompletedMovementsPage.tsx`)
- Columna "Origen ? Destino" usa el formato `WAREHOUSE:Location` (sin prefijo `SUC-`) para movimientos completados.

### Frontend (`frontend/src/components/MovementHistoryTab.tsx`)
- Columna "Origen ? Destino" usa el formato `WAREHOUSE:Location` con `SUC-` removido de los códigos de sucursal.

### Operación
- Backend y frontend compilados correctamente sin errores de tipado.
- No se requieren migraciones Prisma nuevas para estos cambios (solo cambios en queries y rendering).

---

### Objetivo alcanzado
- Se implementaron 4 features: Kardex por presentación con exportación Excel, modal de entrega con manejo de devoluciones parciales, enrutamiento a sub-almacén en solicitudes de movimiento, y soporte de upload de comprobantes en PDF.

### Frontend
- **Kardex (`InventoryPage.tsx`)**: el botón "Kardex" se movió de la vista "Por Producto" a la vista "Por Sucursal", donde aparece en el header de cada producto. El `KardexModalContent` ahora acepta `warehouseId` y pasa `warehouseId` como query param al endpoint, filtrando movimientos por la sucursal. El kardex muestra todos los movimientos del producto (no solo los de la sucursal) con un badge "Sí/Otra sucursal" indicando si cada movimiento afecta a la sucursal filtrada. El balance acumulado solo incluye movimientos que afectan a la sucursal. La tabla incluye columnas de "Origen", "Destino" y "Sucursal". Exportación a Excel actualizada.
- **`ImageUpload.tsx`**: omite compresión para archivos PDF (contentType `application/pdf`); preview muestra ícono ?? en lugar de imagen roto.
- **`DeliveriesPage.tsx`**: botón "Marcar como entregado" abre `DeliveryModal` (reemplaza `window.confirm`) con modos NORMAL/PARCIAL, editor de líneas de devolución (cantidad, motivo, nota por línea) y exportación Excel; `deliverOrder()` envía el endpoint `deliver-with-returns`.
- **`MovementRequestsPage.tsx`**: modal de creación agrega "Sub-Almacén destino" (`Select` poblado desde locations del warehouse destino); envía `toLocationId` en `createMovementRequest`; el detalle muestra `toLocation.code`.
- **`PaymentsPage.tsx`**: el `accept` del `ImageUpload` incluye `application/pdf`.

### Backend
- **`Product` kardex**: `GET /api/v1/products/:id/kardex` (routes/products.ts:1391) devuelve movimientos agrupados por presentación con saldos acumulados, datos de lote/ubicación y saldos finales por presentación. Acepta query params `presentationId`, `warehouseId`, `locationId`, `from`, `to`. Los movimientos sin `presentationId` (ej. ingresos iniciales de lote) se atribuyen a la presentación default en el balance. El `presById` ahora incluye todas las presentaciones activas del producto, no solo las presentes en movimientos.
- **Kardex general unificado (AuditEvent-based)**: el endpoint `GET /api/v1/products/:id/kardex` fue refactorizado para reconstruir el saldo línea a línea desde `AuditEvent` (`action = 'stock.movement.create'`), ordenado cronológicamente ASC. El flujo: Sucursal ? Locations ? InventoryBalance IDs ? AuditEvents. El kardex muestra todo en unidades base con columnas: Fecha, Lote, Presentación, Origen, Destino, Entrada, Salida, Saldo, Sucursal. Transferencias (`TRANSFER`) solo afectan si from/to están en la sucursal; movimientos `IN`/`OUT` sin ubicación se atribuyen a la sucursal. El `AuditEvent.after` contiene `{ movement, fromBalance, toBalance }`; el saldo se toma del `fromBalance`/`toBalance` cuando está disponible (respaldo autoritativo), cayendo al acumulado si no hay evento. El saldo actual proviene de `InventoryBalance` (fuente autoritativa). Se eliminaron las pestañas por presentación en el frontend; el modal ahora muestra una tabla unificada + resumen consolidado por lotes/presentaciones al pie (ej: "Total: 4,550 unidades distribuidas en 5 lotes: - 2,550 en unidades sueltas - 1,000 en 100 cajas de 10u"). La columna "Detalle" se reemplazó por tooltip.
- **`StockMovementRequest` + `Location`**: migración `20260803143835_add_kardex_and_movement_request_to_location` agrega `toLocationId` (UUID) a `StockMovementRequest` y relación `Location.movementRequestDestinations`; listado/plan incluyen `toLocationId` + `toLocation` con warehouse anidado.
- **Entregas con devoluciones**: `POST /api/v1/sales/orders/:id/deliver-with-returns` (routes/salesOrders.ts:1333) con `orderDeliverWithReturnsSchema` acepta `returns[]`; `POST /api/v1/sales/orders/:id/return` para devoluciones standalone.
- **Upload de comprobantes PDF**: `POST /api/v1/sales/payments/proof-upload` (routes/salesPayments.ts:91) acepta `application/pdf` en `allowedContentTypes`; `POST /api/v1/stock/returns/photo-upload` también acepta `application/pdf`.

### Operación
- Nueva migración Prisma: `20260803143835_add_kardex_and_movement_request_to_location/migration.sql`.
- `npm run prisma:generate --prefix backend` ejecutado.
- Backend compilado correctamente con `npm --prefix backend run build`.
- Frontend compilado correctamente con `npm --prefix frontend run build`.
- Deploy manual con `deploy.sh` requiere aplicar la nueva migración antes de reiniciar servicios.

---

## **[08 Jul 2026] Versión 2.1.4 — Reportes de ventas: estado por defecto "Todos" y sin recorte de filas**

### Objetivo alcanzado
- Se corrigió que **Reportes > Ventas** mostrara por defecto solo órdenes `FULFILLED`, ocultando `DRAFT`/`CONFIRMED`/`CANCELLED` salvo que el usuario cambiara manualmente el filtro de estado.
- Se corrigió que los reportes agregados (por cliente, por ciudad, top productos, márgenes) y los drill-down de órdenes recortaran silenciosamente filas más allá de un límite fijo bajo (15/20/25/30/100), dando la impresión de que faltaban ventas.

### Frontend
- `SalesReportsPage.tsx`: el estado inicial del filtro de estado pasa de `'FULFILLED'` a `'ALL'` ("TODOS"), consistente en todas las pestañas (Mes, Clientes, Ciudades, Top Productos, Comparación, Márgenes).
- Se subieron los `take` hardcodeados de las consultas agregadas (clientes, ciudades, top productos, márgenes) y de los drill-down por ciudad/cliente/producto de 15–100 a 1000, para que el reporte muestre todas las filas disponibles en un solo llamado.

### Backend
- Se elevó el tope máximo permitido de `take` en los endpoints `reports/sales/top-products`, `reports/sales/margins`, `reports/sales/by-customer` y `reports/sales/by-city` de 50/200 a 1000.
- Se elevó el tope máximo de `take` en `GET /api/v1/sales/orders` (usado por los drill-down) de 100 a 1000. El valor por defecto no cambió, por lo que otros consumidores del endpoint (ej. entregas) no se ven afectados.
- **Pendiente/mejora futura**: el límite de 1000 sigue siendo un tope fijo; si un tenant llega a superar esa cantidad de filas en un reporte agregado o de drill-down, se recomienda reemplazarlo por paginación real (cursor) en vez de seguir subiendo el número.

### Operación
- Sin migraciones Prisma nuevas.
- Backend compilado correctamente con `npm --prefix backend run build`.
- Frontend compilado correctamente con `npm --prefix frontend run build`.
- Deploy manual con `deploy.sh` no requiere pasos adicionales.

## **[14 May 2026] Versión 2.1.3 — Advertencia de atención parcial en solicitudes**

### Objetivo alcanzado
- En la pantalla **Atender solicitudes** (`/stock/fulfill-requests`), al seleccionar lotes que no cubren todos los ítems solicitados, el flujo de confirmación muestra al operador un resumen visual antes de proceder.

### Frontend
- El botón *Confirmar Transferencia* detecta si algún ítem queda sin cobertura completa (`isPartialFulfillment`) y cambia a amarillo.
- Al pulsarlo, se abre un modal intermedio con la lista de ítems clasificados: **Completo** (verde ?), **Parcial** (amarillo ?) y **No atendido** (rojo ?), indicando las cantidades enviadas vs. requeridas.
- El modal ofrece dos acciones: *Volver a revisar* (cierra el modal) y *Confirmar atención parcial* (procede con el envío).
- La lógica de construcción del payload (`performFulfillment`) fue extraída del `onClick` inline a una función reutilizable compartida por ambos caminos de confirmación.

### Backend
- Sin cambios. El endpoint `POST /api/v1/stock/movement-requests/bulk-fulfill` acepta atenciones parciales desde antes.

### Operación
- Sin migraciones Prisma nuevas.
- Frontend compilable sin errores (`npm --prefix frontend run build`).
- Deploy manual con `deploy.sh` no requiere pasos adicionales.

## **[13 May 2026] Versión 2.1.2 — Historial de movimientos con búsqueda por lote, producto y usuario**

### Objetivo alcanzado
- Se añadió la vista **Hist. Movimientos** en `/stock/movements` como pestaña adicional junto al formulario existente.
- Permite consultar el historial completo de movimientos realizados con cuatro modos de filtrado interactivos, sin requerir cambios en backend.

### Frontend
- `/stock/movements` incorpora una segunda pestaña `?? Hist. Movimientos` (componente `MovementHistoryTab`).
- **Por fecha**: ordena ascendente o descendente; opcionalmente filtra por una fecha específica.
- **Por lote**: buscador con autocompletado — al seleccionar un lote muestra todos los movimientos (ingresos, transferencias, ajustes, salidas, etc.) que contienen ese lote en cualquiera de sus líneas.
- **Por producto**: buscador con autocompletado — muestra todos los movimientos asociados al producto elegido.
- **Por usuario**: buscador con autocompletado — muestra todos los movimientos realizados o solicitados por ese usuario.
- En modos lote/producto, el componente precarga en segundo plano el detalle de picking de cada movimiento para construir el índice de búsqueda. El índice almacena **todas las líneas** del picking (no solo la primera), garantizando trazabilidad completa en movimientos con múltiples ítems.
- El dropdown de sugerencias filtra conforme el usuario escribe y desaparece al confirmar la selección, que se muestra como chip con opción de cambio.

### Backend
- Sin cambios. La vista consume endpoints ya existentes: `GET /api/v1/stock/completed-movements` y `GET /api/v1/stock/completed-movements/:id/picking`.

### Operación
- Sin migraciones Prisma nuevas.
- Frontend compilable sin errores (`npm --prefix frontend run build`).
- Deploy manual con `deploy.sh` no requiere pasos adicionales.

## **[02 Abr 2026] Versión 2.1.1 — badges operativos + restricción de edición de lotes**

### Objetivo alcanzado
- Se cerró la entrega `2.1.1` para reforzar visibilidad operativa en stock y endurecer el control funcional sobre la edición manual de lotes ya distribuidos.
- La release mantiene el mismo esquema de despliegue manual vía `deploy.sh` y no introduce migraciones Prisma nuevas.

### Backend
- `GET /api/v1/products/:id/batches` ahora deriva y devuelve `originWarehouseId`, `originWarehouseCode`, `originWarehouseName`, `originLocationId` y `originLocationCode` según el primer ingreso del lote.
- Esa metadata se calcula a partir del movimiento inbound más antiguo con `toLocationId`, manteniendo el contrato suficiente para que frontend limite ajustes al almacén de origen.

### Frontend
- El menú compartido `Accesos rápidos` en stock ahora muestra badges persistentes para `Atender solicitudes` y `Recepción/Devolución` en todas las vistas que reutilizan el componente.
- El badge de solicitudes pendientes muestra desglose por sucursal en hover y el de recepción/devolución respeta el scope del usuario autenticado.
- El modal de edición de lotes en `/catalog/products/:id` ya no permite editar fechas de fabricación o vencimiento.
- La edición de cantidades queda acotada al remanente todavía existente en el almacén del primer ingreso del lote, evitando saltarse el flujo normal de solicitud, atención, envío y recepción.

### Operación
- Frontend compilado correctamente con `npm --prefix frontend run build`.
- Backend compilado correctamente con `npm --prefix backend run build`.
- El estado del repo queda listo para deploy manual usando `deploy.sh`.

## **[01 Abr 2026] Versión 2.1.0 — branding numérico + existencias + salida de muestra**

### Objetivo alcanzado
- Se consolidó una entrega operativa `2.1.0` enfocada en consistencia numérica, trazabilidad de stock y mejora del flujo manual de movimientos.
- La release incorpora cambios funcionales visibles para branding, reportes y salidas de stock sin alterar el mecanismo de despliegue manual basado en `deploy.sh`.

### Backend
- `Tenant` ahora persiste `thousandSeparator` y se incluye la migración `20260331110000_tenant_thousand_separator`.
- Los endpoints de branding/admin/tenant exponen y toleran correctamente el nuevo campo incluso frente a entornos que aún no migraron.
- `POST /api/v1/stock/movements` valida `MANUAL_SALE`, `MANUAL_DISCARD` y `PRODUCT_SAMPLE` con sus reglas de negocio.
- `GET /api/v1/products/:id/batches` expone `warehouseCity` por ubicación para habilitar restricciones por ciudad en frontend.
- Se agregó `GET /api/v1/reports/stock/existencias` para consolidar stock actual y movimientos del período.

### Frontend
- Branding por tenant permite elegir separador de miles y el formato se reutiliza en reportes, ventas, catálogo y documentos PDF.
- `Reportes > Stock` agrega la pestaña `Existencias` con KPIs, tablas por sucursal y exportación PDF/XLSX.
- `/stock/movements` agrega `Salida producto de muestra` como flujo independiente, con selección de cliente final y restricción a clientes de Cochabamba cuando el lote pertenece a esa ciudad.
- Se redujo el retardo al seleccionar lote memoizando el armado de filas de stock y evitando consultas de clientes prematuras.

### Operación
- Frontend compilado correctamente con `npm --prefix frontend run build`.
- Backend compilado correctamente con `npm --prefix backend run build`.
- La entrega queda lista para deploy manual; al ejecutarse `deploy.sh` debe aplicar la nueva migración antes de reiniciar servicios.

## **[31 Mar 2026] Versión 2.0.1 — orden alfabético en catálogo e inventario**

### Objetivo alcanzado
- Se homogenizó el orden visual de productos en pantallas operativas clave para que el usuario vea los listados en orden alfabético por nombre.
- La entrega se considera versión `2.0.1` por tratarse de un ajuste funcional y de usabilidad sin cambios de esquema.

### Frontend
- `/catalog/products` ordena alfabéticamente tanto el listado normal como los resultados de búsqueda.
- `/catalog/commercial` y `/catalog/seller` ordenan alfabéticamente los productos visibles antes de renderizarlos.
- `/stock/inventory` ordena alfabéticamente la vista por producto y también los productos dentro de cada sucursal en la vista por sucursal.
- Se centralizó el criterio en un helper compartido de ordenamiento para evitar divergencias entre pantallas.

### Operación
- No se agregaron migraciones Prisma ni cambios de despliegue.
- El estado del repo queda listo para deploy manual usando `deploy.sh`.

## **[27 Mar 2026] Catálogo y ventas: unidad base configurable + PDFs autoajustables**

### Objetivo alcanzado
- Se resolvió el solapamiento en PDFs de cotización y nota de entrega reemplazando el render fijo por filas con altura variable y textos envueltos.
- Se incorporó una abreviatura de unidad base configurable por producto para que la UI y los documentos ya no dependan de `u` como sufijo fijo.

### Backend
- Se agregó `Product.baseUnitAbbreviation` con default `u` en Prisma.
- Se incorporó la migración `20260327120000_product_base_unit_abbreviation`.
- Se normalizó la abreviatura en altas y ediciones de productos.
- Se expuso el nuevo campo en respuestas de catálogo, productos, cotizaciones, órdenes y stock donde aplica.

### Frontend
- `/catalog/products` permite editar la abreviatura de unidad base del producto.
- Se centralizó el formateo de presentaciones y cantidades para reutilizarlo en catálogo, carrito, cotizaciones, entregas, stock y laboratorio.
- La exportación PDF ahora distribuye mejor columnas y calcula la altura real de cada fila antes de dibujarla.
- Se eliminó el trazado de líneas horizontales entre registros en los PDFs exportados, tanto en documentos manuales con jsPDF como en reportes capturados desde HTML.

### Operación
- La migración quedó aplicada y validada en el entorno Docker local.
- El estado del repo quedó listo para deploy manual usando `deploy.sh`.

## **[25 Mar 2026] Versión 2.0 — Multi-marca / multi-empresa**

### Objetivo alcanzado
- Se cerró la primera versión operativa del flujo multi-marca con cambio de empresa desde sesión autenticada.
- La versión objetivo de esta entrega pasa a ser `2.0`.

### Backend
- Se agregaron `TenantGroup`, `TenantGroupMember` y `UserTenantAccess` al esquema Prisma.
- Se incorporó la migración `20260324120000_tenant_groups_multi_brand`.
- Se sumaron endpoints platform para crear/listar/eliminar grupos y administrar miembros.
- Se sumaron endpoints admin para listar y guardar accesos cruzados por usuario.
- Se agregó `POST /api/v1/auth/switch-tenant`.
- Se corrigió el auth hook para aceptar JWTs cuyo tenant activo difiere del tenant base del usuario.
- Se corrigió el retorno al tenant principal para que no requiera grant explícito en `UserTenantAccess`.

### Frontend
- Se agregó pantalla de grupos de empresas para platform admin.
- Se agregó modal de empresas por usuario en administración.
- Se agregó selector de empresa en el menú del usuario.
- Se corrigió el marcado de tenant activo para usar el contexto actual y no siempre el tenant base.

### Operación
- La base local quedó migrada y validada.
- `deploy.sh` permanece como flujo manual previsto para subir la versión 2.0 a producción.

## Objetivo del producto
SaaS **multi-tenant** con **single DB** (row-level `tenantId`), backend Node.js/TypeScript (estilo Clean/Hex), frontend React/Vite/Tailwind/TanStack Query, PostgreSQL, **auditoría GxP-friendly inmutable** (append-only), **Socket.io** para eventos en tiempo real, **RBAC** estricto por permisos, y búsqueda rápida.

## Hitos principales

## **[20 Mar 2026] Catálogo: unicidad de presentaciones por formato + unidades**

### Presentaciones de producto
- Se cambió la regla de negocio de `ProductPresentation`: la unicidad ya no depende solo del formato/nombre.
- Desde este ajuste, la combinación única es `tenantId + productId + name + unitsPerPresentation`.
- Resultado esperado en catálogo: ahora se permiten múltiples presentaciones `Caja` para el mismo producto siempre que cambie la cantidad de unidades que contiene cada caja.
- Ejemplos válidos: `Caja` de 20 unidades y `Caja` de 50 unidades para el mismo producto.
- Sigue bloqueado el duplicado exacto de formato con la misma cantidad de unidades.

### Backend y frontend alineados
- Backend: se actualizó la validación y el mapeo de conflictos únicos para devolver un `409` específico cuando se repite la combinación `formato + unidades`.
- Frontend: se ajustaron las validaciones del detalle de producto para permitir formatos repetidos con diferente `unitsPerPresentation` y bloquear solo duplicados exactos.

### Persistencia y operación
- Se agregó la migración `20260320120000_product_presentation_name_units_unique` para reemplazar el índice único anterior por uno compuesto con `unitsPerPresentation`.
- La migración fue aplicada y validada en el entorno local Docker contra `postgres-local`.

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
- Se implementó soporte de upload de logo vía S3-compatible usando URL presignada (flujo: `POST presign` ? `PUT uploadUrl` ? `PUT branding`).
- El frontend carga branding del tenant y aplica variables CSS (`--pf-primary/secondary/tertiary`) para que el tema sea configurable.
- Se habilitó modo oscuro/claro con `darkMode: 'class'` y un toggle persistido en `localStorage`, con fallback al `defaultTheme` del tenant.

## Rutas reales (Step 5)
- Se migró el panel de Administración a rutas reales sin cambiar la UX base:
  - Home: `/`
  - Admin: `/admin/:tab` (roles/users/permissions/audit/reports/branding)

## Provisioning real (Platform ? Tenant)
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

## **[12 Mar 2026] Stock: Movimientos realizados por presentación + Picking PDF (SOL + logo)**

### Stock — Movimientos realizados (`/stock/completed-movements`)
- Se ajustó la UI para mostrar **Cantidad** en base a **presentación** (ej. cajas) en la tabla y en el modal de detalle.
- Backend: el listado agrega `totalQuantityUnits` + `totalQuantityPresentations` para soportar el cálculo sin perder la unidad base.

### Stock — Picking PDF (export)
- El endpoint de picking ahora incluye `meta.requestCode` y cantidades por presentación (`quantityPresentations`, `unitsPerPresentation`) en ítems solicitados y líneas enviadas.
- El PDF de picking muestra `Solicitud: SOL...` en el encabezado y renderiza el **logo del tenant** (best-effort en B/N) a la derecha.
- Fix: el picking ya no falla si `requestedBy` no es UUID (en ese caso se usa el string directo como nombre).

## **[05 Mar 2026] Stock: códigos SOL en solicitudes + Notificaciones persistentes (campana)**

### Stock — Solicitudes con código `SOLYY####`
- Se agregaron campos `StockMovementRequest.code`, `codeYear`, `codeSeq`.
- Se implementó secuenciación por `tenantId + año` usando `TenantSequence` (clave `SOL`).
- Migración incluye backfill para solicitudes existentes y crea índices/unique (`tenantId + code`).
- Frontend: se muestra `code` en pantallas de movimientos, recepciones y atención masiva.

### Notificaciones persistentes (campana)
- Backend: nueva tabla `Notification` y `User.notificationsLastReadAt`.
- API:
  - `GET /api/v1/notifications`
  - `POST /api/v1/notifications/mark-all-read`
  - `POST /api/v1/notifications/send-bulk-transfer` (utilitario)
- Inserción de notificaciones “best-effort” (try/catch) para no romper flujos principales (stock/ventas).
- Frontend: `NotificationsProvider` carga desde API y persiste “marcar todo leído”; sockets quedan para toast/sonido + refresco.

### Stock — Buscador unificado (mismo campo)
- Se unificó el patrón de búsqueda client-side en pantallas operativas de Stock para que el usuario pueda buscar por cualquier texto relevante (código, producto, lote, origen/destino, solicitante, etc.) desde un único campo.
- Cobertura en UI (Stock): Solicitudes, Atender masivo, Recepciones/Devoluciones, Movimientos y Movimientos realizados.

### Stock — Vista "Trazabilidad de solicitudes" (UI)
- Nueva vista para revisar el estado de una solicitud de movimiento y su avance: **creada**, **atendida (parcial)**, **envíos** y **recepción**.
- Incluye modal de detalle con métricas por ítem (solicitado / enviado / pendiente) respetando **presentación** (ej. caja vs unidad) y estado de envíos (pendiente de recepción / recibido / devuelto).
- Se mejoró la ergonomía de modales con scroll vertical interno para soportar contenido largo sin cortar acciones/título.

### Operación / despliegue
- Requiere aplicar migraciones Prisma antes de ejecutar la nueva versión (en local y producción) para evitar errores por columnas faltantes.

## **[20 Feb 2026] Ventas: pagos parciales + Lotes: gobernanza + UX en detalle de producto**

### Ventas: Cuentas por cobrar (Pago TOTAL vs PARCIAL)
- Se incorporó soporte de **pago total o parcial** en el flujo de cobros.
- Persistencia: nuevo acumulador `SalesOrder.paidAmount` (migración Prisma) para reflejar pagos parciales.
- Regla de negocio: `paidAt` se setea **solo** cuando la orden queda totalmente pagada; el evento realtime `sales.order.paid` se emite únicamente al completarse el total.
- Frontend:
  - Modal de pago pregunta **TOTAL/PARCIAL**; parcial requiere monto.
  - Tabla de cobros muestra **Pagado / Debe** e indicador de pago parcial.

### Lotes (Batches): reglas + permisos
- Catálogo (no laboratorio): el `batchNumber` **ya no se autogenera**; el usuario debe ingresarlo al crear un lote.
- Laboratorio: cuando se generan lotes desde producción, el `batchNumber` puede quedar vacío y el backend lo autogenera (si aplica), manteniéndolo **editable**.
- Se reforzó unicidad: el código de lote es único por producto (`tenantId + productId + batchNumber`).
- Seguridad: **solo el creador** del lote puede editar/eliminar metadata; el backend expone `canManage` para habilitar/deshabilitar acciones en UI.

### Catálogo: detalle de producto (lotes)
- La lista de lotes muestra también la **presentación** asociada.
- La edición permite cambiar `presentationId` del lote y ajustar cantidad por ubicación usando movimientos `ADJUSTMENT` (delta hacia el total deseado).

### Operación / despliegue
- Se verificó que el despliegue contemple aplicar migraciones Prisma (necesario para cambios como `paidAmount`).

## **[12 Feb 2026] Laboratorio: módulo completo + RBAC provisioning + fix roles de usuario**

### Módulo Laboratorio (UI completa)
- Se integró el módulo completo de **Laboratorio** en el frontend (rutas `/laboratory/*` + navegación).
- Acceso controlado por permisos existentes: lectura por `stock:read` y acciones de escritura por `stock:manage`.

### Backend: habilitación por módulo + compatibilidad Prisma
- Se habilitó el módulo `LABORATORY` a nivel tenant (guard por módulo) y se incluyó como módulo default al crear nuevos tenants.
- Se corrigieron inconsistencias con el schema actual de Prisma en rutas de laboratorio:
  - Eliminado uso de `Location.isDefault` (no existe en el modelo).
  - Movimientos de insumos usan `fromLocationId/toLocationId` (en vez de `locationId`) y se apoyan en el service transaccional para numeración/balances.

### RBAC: roles del sistema por tenant (incluye nuevos roles)
- Se refactorizó el provisioning para soportar **provisión por tenant** y reutilizarlo durante la creación de tenants (transacción segura).
- Se aseguraron roles/módulos para tenants existentes y nuevos, incluyendo:
  - `BRANCH_ADMIN` y `BRANCH_SELLER` (sucursal)
  - `LABORATORIO` (laboratorio)

### Admin: reemplazo de roles de usuario
- Fix del endpoint `PUT /api/v1/admin/users/:id/roles` que devolvía `500` por desalineación con el schema de respuesta.
- La respuesta ahora vuelve a un shape consistente para el listado de usuarios (incluye `roleIds` y `roles` en formato plano).

## **[10 Feb 2026] Stock: Envío y recepción de solicitudes (SENT ? FULFILLED)**

### Estado intermedio `SENT`
- Se agregó el estado `SENT` para representar solicitudes **enviadas** pero aún **no recepcionadas** en destino.

### Backend (rutas + trazabilidad)
- `POST /api/v1/stock/movement-requests/bulk-fulfill` genera el **envío** creando movimientos `OUT` asociados a la solicitud (`referenceType: MOVEMENT_REQUEST`, `referenceId = requestId`) y marca la solicitud como `SENT`.
- `POST /api/v1/stock/movement-requests/:id/receive` confirma la **recepción**: crea movimientos `IN` hacia el `toLocationId` de los `OUT` enviados, marca la solicitud como `FULFILLED` y setea `confirmedAt/confirmedBy`.
- `GET /api/v1/stock/movement-requests` se amplió para exponer:
  - `originWarehouse` (derivado desde `OUT.fromLocationId ? Location ? Warehouse`, que representa el origen real del envío)
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
  - **Flujos** (origen ? destino) de solicitudes atendidas y **tiempo promedio de atención** (`fulfilledAt - createdAt`).
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

### Ajuste de flujo cotización ? orden
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
- Se incorporó el flujo **cotización ? procesar ? orden** como regla de negocio.
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
  - Status: 'active' (>90d), 'expiring_soon' (=90d), 'expired' (<0d)
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
- ? Backend seed con Platform Admin + Demo Tenant
- ? Endpoints CRUD de tenants con suscripción
- ? Endpoints consulta y solicitud extensión
- ? Hook usePermissions con flags isPlatformAdmin/isTenantAdmin
- ? Navegación filtrada por permisos
- ? UI Platform Tenants con CRUD completo
- ? Widget Dashboard suscripción con modal extensión

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
- ?? Integración real de envío WhatsApp/Email (actualmente solo preview)
- ?? Cron job para notificaciones automáticas (3 meses y 1 mes antes de vencer)
- ?? Página Branding funcional con upload S3 y color pickers
- ?? Personalización de vistas/columnas por rol (feature complejo, Fase 4)

### **Arquitectura de Permisos**

```
Platform Admin (Supernovatel)
+-- platform:tenants:manage ?
+-- catalog:read/write ?
+-- stock:read/move ?
+-- sales:order:read/write ?
+-- admin:users:manage ?
+-- audit:read ?

Tenant Admin (Clientes)
+-- platform:tenants:manage ?
+-- catalog:read/write ?
+-- stock:read/move ?
+-- sales:order:read/write ?
+-- admin:users:manage ?
+-- audit:read ?
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
  - **UX sugeridos**: badges ? en stock y resumen por ítem para destacar asignaciones automáticas.
  - **Validaciones visuales**: colores y "Falta (u)" para ítems no cubiertos; filtros por "solo productos requeridos".

- **Enriquecimiento de Reportes > Stock > OPS**:
  - **Flujos completados**: tabla con rutas (origen ? destino) de solicitudes FULFILLED + promedio minutos de atención (fulfilledAt - createdAt).
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

### **[12 Feb 2026]** — UI Admin Users + Backdated OUT Movements + RBAC Origin Selection

- **UI Admin Users**:
  - Se reemplazó la columna "Creado" por "Rol" en `/admin/users` para mostrar el rol actual del usuario (primero de la lista o "Asignado" si tiene roles asignados).

- **Backdated OUT Movements (Tenant Admin only)**:
  - Tenant admins pueden registrar movimientos de salida (ventas/desechos) con fecha pasada en `/stock/movements`.
  - Campo "Fecha del movimiento" (date picker nativo) solo visible para tenant admin.
  - Backend valida que solo tenant admin puede setear `createdAt`, y que no sea futuro.
  - Afecta cálculo de expiración (relativo a fecha backdated), secuencia de numeración (año de fecha backdated), y timestamps de movimiento/batch.

- **RBAC Origin Selection in Bulk Flows**:
  - Branch admins (con `scope:branch`) no pueden elegir warehouse/location de origen en transferencias masivas y atención de solicitudes.
  - Tenant admin mantiene control total sobre origen (no restringido por scope branch).
  - Aplicado en `BulkTransferPage` y `BulkFulfillRequestsPageSimple`.

- **Fix Client Dropdown in OUT Movements**:
  - Corregido endpoint de API: `/api/v1/clients` ? `/api/v1/customers`.
  - Ajustado parámetro `take=100` ? `take=50` (límite backend).
  - Actualizado tipo `ClientListItem` para usar `name` en lugar de `commercialName/fiscalName`.

### **[18 Feb 2026]** — Fix Branch Admin Access to Inventory Reports

- **Stock Reports Access**:
  - Branch admins ahora pueden acceder a `/stock/inventory` (balances-expanded endpoint).
  - Agregado guard personalizado `requireStockReportAccess()` que permite acceso con `ReportStockRead` O (`ScopeBranch` + `StockRead`).
  - Agregado filtrado por sucursal: usuarios con scope branch solo ven inventario de warehouses de su ciudad.

### **[18 Feb 2026]** — Branch Admin Access Control: Stock Reports vs LABORATORY Module

- **Stock Reports Access for Branch Admins**:
  - Branch admins ahora pueden acceder a reportes de stock (`/reports/stock`) manteniendo el filtrado por sucursal.
  - Backend: Guard personalizado `requireStockReportOrBranchAccess()` permite acceso con `ReportStockRead` O (`ScopeBranch` + `StockRead`).
  - Frontend: Actualizada navegación para mostrar "?? Stock" en reportes cuando branch admin tiene `stock:read`.
  - Frontend: Modificada ruta `/reports/stock` para permitir acceso con `report:stock:read` O `stock:read`.

- **LABORATORY Module Restriction for Branch Admins**:
  - Branch admins completamente excluidos del módulo LABORATORY.
  - Backend: Nuevo guard `requireNotBranchAdmin()` bloquea acceso a todas las rutas de laboratory para usuarios con rol BRANCH_ADMIN.
  - Frontend: Ocultado módulo "?? Laboratorio" del menú lateral para branch admins.
  - Mantiene acceso para usuarios con roles superiores (TENANT_ADMIN, etc.).

- **Navigation & Permissions Alignment**:
  - Sincronizada lógica de permisos entre backend guards, frontend navigation, y frontend routing.
  - Branch admins ven reportes de stock pero no el módulo laboratory completo.

### **[18 Feb 2026]** — Branch Seller Access Control: LABORATORY Module & Inventory Actions

- **LABORATORY Module Restriction for Branch Sellers**:
  - Branch sellers (BRANCH_SELLER) completamente excluidos del módulo LABORATORY.
  - Actualizada navegación para ocultar "?? Laboratorio" tanto para BRANCH_ADMIN como BRANCH_SELLER.
  - Backend guards ya protegen correctamente (BRANCH_SELLER no tiene StockMove).

- **Inventory Move Button Restriction**:
  - Botón "Mover" en inventario condicionado por permiso `stock:move`.
   - BRANCH_SELLER no ve el botón "Mover" (no tiene `stock:move`).
   - BRANCH_ADMIN mantiene acceso al botón "Mover" (tiene `stock:move`).
   - Tenant admin mantiene control total.

---

### **[07 Ago 2026] Diagnóstico de desajuste en kardex del lote 30-26264 en SUC-CBB**

#### Contexto
- `InventoryBalance` muestra **32400** unidades para el lote "30-26264" en la sucursal Cochabamba (Institucional).
- El kardex filtrado por `affectsWarehouse=true` no concuerda con este balance.

#### Causas raíz

1. **Bug de código en el kardex** (`backend/src/adapters/http/routes/products.ts`):
   - Los movimientos tipo `OUT` con `referenceType: MOVEMENT_REQUEST` que tienen `toLocationId` en la sucursal filtrada (transferencias inter-sucurals) **no se marcaban como `affectsWarehouse=true`**.
   - El código solo verificaba `fromLocationId` para movimientos `OUT`, ignorando que `toLocationId` podría estar en la sucursal destino.
   - **Movimientos afectados**: MSMS2026-668 (OUT 600, LPZ?CBB) y MSMS2026-669 (OUT 300, LPZ?CBB).
   - **Fix aplicado**: Se trata `OUT` con `MOVEMENT_REQUEST` y `toLocationId` como `TRANSFER`, calculando `netDelta` basado en ambos `fromLocationId` y `toLocationId`.

2. **Código duplicado elimado**:
   - El bloque `else if (locationId)` estaba duplicado (líneas 1687-1710), causando dead code. Se eliminó la segunda instancia.

3. **Problema de datos (requiere intervención manual)**:
   - Movimientos **MS2026-955** (IN 18000, LPZ?CBB) y **MS2026-957** (IN 18000, LPZ?CBB) fueron creados el 25/06/25 y registrados en `AuditEvent` e `InventoryBalance`, pero **fueron eliminados** de la tabla `StockMovement`.
   - Esto dejó el `InventoryBalance` con 36000 unidades extra que no aparecen en el kardex.
   - Reconciliación: `32400 (InventoryBalance) - 36000 (fantasmas) = -3600` (kardex sin fix) o `-2700` (kardex con fix).
    - **Decisión pendiente**: Restaurar los movimientos eliminados o ajustar el `InventoryBalance`. El `InventoryBalance` actual de 32400 se mantiene como source of truth para stock físico.

---

### **[08 Ago 2026] Solicitud de movimiento: sub-almacén destino + ajuste de atender solicitudes**

#### Contexto
- Los usuarios deben poder crear solicitudes de movimiento especificando el sub-almacén (location) de destino.
- En la página "Atender solicitudes" (`/stock/fulfill-requests`), el input de "ubicación destino" fue eliminado del formulario principal. Ahora basta con elegir: almacén origen, ubicación origen y almacén destino. La ubicación destino se resuelve de la solicitud (`toLocationId`) si está disponible, o se elige en el modal "Atender solicitud".

#### Backend (`backend/src/adapters/http/routes/stock.ts`)
- `POST /api/v1/stock/movement-requests/bulk-fulfill`: `toLocationId` ahora es **opcional** en el schema.
- Si `toLocationId` no se envía, se resuelve **por solicitud** usando `req.toLocationId`.
- Si la solicitud no tiene `toLocationId` y no se proporciona uno global, retorna error 400.
- Se agregó `toLocationId` al `select` del query de solicitudes en el handler de `bulk-fulfill`.

#### Frontend (`frontend/src/pages/stock/BulkFulfillRequestsPageSimple.tsx`)
- **Eliminado** el input "Ubicación destino" del formulario principal.
- **Agregado** dropdown de "Ubicación destino" en el modal "Atender solicitud".
- **Agregado** display de la ubicación destino en la lista de solicitudes.
- El search ahora incluye `toLocation.code`.

#### **[08 Ago 2026] Atender solicitudes: ubicación destino por solicitud**
- **Eliminado** el input global "Ubicación destino" del modal de atender.
- **"Lo solicitado" ahora se divide por solicitud**, mostrando:
  - Dropdown de "Ubicación destino" por solicitud (poblado con locations del almacén destino).
  - Si la solicitud tiene `toLocationId`, se muestra preseleccionado con ?.
  - Si se selecciona otra ubicación, muestra ?? con advertencia.
  - Si la solicitud no tiene `toLocationId`, muestra ?? pidiendo selección.
- **Backend**: `POST /api/v1/stock/movement-requests/bulk-fulfill` acepta `toLocationId` opcional **por fulfillment**, resolviendo: fulfillment.toLocationId ? global ? req.toLocationId.
- **`performFulfillment`** envía `toLocationId` por fulfillment desde `requestLocations[req.id]` o `req.toLocationId`.
- **`getProductFulfillmentStatus`** ahora hace match por `productId`+`presentationId` (no por referencia) para soportar el listado dividido por solicitud.
- `toLocationsQuery` se mantiene para poblar el dropdown (locations del warehouse destino).


