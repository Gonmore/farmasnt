# Plan: Trazabilidad por movimiento + recepción obligatoria en transferencias

> Estado: borrador de plan (solo recolección + diseño). Sin cambios de código todavía.
> Fecha: 13 Ago 2026

## Objetivo
1. Trazabilidad **por movimiento individual** (1 código `number` único por `StockMovement`), cubriendo pasados y nuevos, sin depender de lotes ni de agrupación por solicitud.
2. "Movimientos Realizados" muestra **absolutamente todos** los movimientos, cada uno con botón "Ver" (modal de detalle) y "Exportar PDF" (picking/rótulo) según corresponda.
3. **Recepción obligatoria** en TODAS las transferencias (simples y masivas): al enviar solo descuenta en origen; el destino aumenta stock solo al confirmar recepción por `BRANCH_ADMIN` / `BRANCH_PROVIDER` del almacén destino.

## Decisiones ya confirmadas con el usuario
- NO renumerar movimientos legacy (los `SM-<random>` son dead code; hoy el backend usa `nextSequence` para todo).
- `IN` y `ADJUSTMENT` individuales SÍ aparecen en "Realizados" (creación de lote, ajuste) con su código para trazabilidad, pero **sin picking** (no hay movimiento físico entre ubicaciones).
- Nuevos movimientos siguen `nextSequence` (ya implementado en `stockMovementService.ts:191`, `salesOrders.ts:277`, `supplyStockMovementService.ts:137`).

---

## Parte A — Trazabilidad por movimiento (bajo riesgo)

### A1. Backend: incluir IN/ADJUSTMENT individuales en "Realizados"
- `GET /api/v1/stock/completed-movements` (`stock.ts:4256`): quitar el filtro `type: { not: 'IN' }` (`:4261`) para que los `IN`/`ADJUSTMENT` individuales entren como `type: 'MOVEMENT'`.
- En el mapeo individual (`:4325-4343`):
  - `canExportPicking` / `canExportLabel` = `true` solo para `OUT`/`TRANSFER` (ya así, `:4341-4342`). IN/ADJUSTMENT quedan `false` (sin picking físico).
  - Asegurar que `typeLabel` sea correcto ("Entrada", "Salida", "Transferencia", "Ajuste").

### A2. Backend: permitir /picking y /label para movimientos IN/ADJUSTMENT individuales
- `GET /api/v1/stock/completed-movements/:id/picking` (`stock.ts:4569`): hoy bloquea `MOVEMENT` que no sea OUT/TRANSFER. Extender para `IN`/`ADJUSTMENT` (el `sentLines` ya funciona con cualquier `movement`; solo relajar la guarda). Opcional: para IN/ADJUSTMENT el PDF de picking puede mostrar solo origen/destino/lote sin "líneas de envío".
- `GET /api/v1/stock/completed-movements/:id/label` (`stock.ts:4749`): análogo; relajar guarda para IN/ADJUSTMENT si aplica (o dejar label solo para OUT/TRANSFER).

### A3. Frontend: columna de acciones en CompletedMovementsPage.tsx
- Agregar columna "Acciones" con:
  - Botón **Ver** → abre modal con detalle del movimiento (reusa `GET /picking?type=MOVEMENT` para OUT/TRANSFER; para IN/ADJUSTMENT muestra datos del movimiento: número, tipo, origen/destino `Warehouse:Location`, lote, cantidad, quién/cuándo, `referenceType`/`referenceId` si lo hay).
  - Botón **Exportar PDF** (picking) habilitado solo si `canExportPicking`. Reusa `exportPickingToPdf` de `lib/movementRequestDocsPdf.ts` (ya usado en `BulkTransferPage.tsx:218`).
  - Botón **Exportar Rótulo** habilitado solo si `canExportLabel`. Reusa `exportLabelToPdf`.
- Aplicar a **todos** los `type` (MOVEMENT, BULK_TRANSFER, FULFILL_REQUEST, RETURN) que tengan `canExportPicking/canExportLabel = true`.
- Reusar helpers `cleanCode()` / `locLabel()` ya presentes en el archivo.

### A4. Filtro por número de movimiento (nice-to-have)
- En `MovementHistoryTab.tsx` y/o `CompletedMovementsPage.tsx` agregar búsqueda por `number` para saltar a un movimiento específico (el `number` ya es `@@unique([tenantId, number])`, `schema.prisma:642`).

> Nota: el kardex ya expone `movementId` + `movementNumber` (`products.ts:1744-1746`); eso cubre trazabilidad individual en el kardex.

---

## Parte B — Recepción obligatoria en TODAS las transferencias (alto impacto)

### B0. Cambio de modelo de negocio (crítico)
Hoy:
- `TRANSFER` simple (`stock.ts:2719`) y `BULK_TRANSFER` (`stock.ts:2930`) aumentan destino **inmediatamente** (OUT+IN atómico, `stockMovementService.ts:172-174`).
- Solo `MOVEMENT_REQUEST` separa envío (OUT) de recepción (`MOVEMENT_REQUEST_RECEIPT` IN, `:3541`/`:3930`).
- `StockMovement` NO tiene campo de estado (`schema.prisma:617-648`).

Nuevo comportamiento deseado:
- Al **enviar** transferencia (simple o masiva): crear solo el `OUT` (descuenta origen). El destino queda "en tránsito" (sin stock).
- Al **recepcionar** (branch admin/provider del almacén destino): crear el `IN` (aumenta destino) y marcar la transferencia como recibida.

### B1. Migración Prisma (nueva)
- `StockMovement`:
  - `receiptStatus` `StockMovementReceiptStatus` `@default(RECEIVED)` para no romper los existentes (los TRANSFER/BULK_TRANSFER ya recibidos se asumen `RECEIVED`).
  - `receivedAt`, `receivedBy` (opcionales).
  - Índices: `[tenantId, receiptStatus]`, `[tenantId, referenceId, receiptStatus]`.
- Nueva migración `20260813xx_add_transfer_receipt_status/migration.sql`. Aplicar `prisma migrate deploy` antes de deploy.

### B2. Backend: envío de transferencias sin aumentar destino
- `POST /api/v1/stock/movements` (`type:TRANSFER`, `:2719`): crear SOLO el `OUT` (descuenta origen). No crear el `IN`. Marcar `receiptStatus: PENDING` si hay `toLocationId` en otra ubicación.
- `POST /api/v1/stock/bulk-transfers` (`:2930`): igual, cada ítem crea solo `OUT` con `referenceType:'BULK_TRANSFER'`, `receiptStatus: PENDING`.
- `stockMovementService.ts`: separar la creación de OUT (envío) de IN (recepción) para TRANSFER; o agregar flag `deferDestination: true`.
- El `number` del grupo (`referenceId` BULK_TRANSFER) se mantiene para trazabilidad agrupada; cada OUT individual conserva su `number` (trazabilidad por movimiento).

### B3. Backend: endpoint de recepción para transferencias
- Extender `POST /api/v1/stock/movement-requests/:id/reception` (`:3737`) o crear `POST /api/v1/stock/transfers/:referenceId/receive` (o `POST /api/v1/stock/movements/:id/receive` para simple).
- Valida `receivedQuantity ≤ pending` (cantidad enviada - ya recibida).
- Crea `IN` con `referenceType: 'TRANSFER_RECEIPT'` (nuevo) y `referenceId` = id del OUT (o `referenceId` del grupo para masiva).
- Marca `receiptStatus: RECEIVED`, `receivedAt`, `receivedBy`.
- Permisos: `BRANCH_ADMIN` / `BRANCH_PROVIDER` del almacén **destino** (reusa lógica de `branchWarehouseIdOf` y filtro de ciudad actual). `403` si no es su almacén.
- Emite eventos socket (`stock.movement.created`, `stock.balance.changed`) al crear el IN.

### B4. Backend: listados y reportes
- `GET /api/v1/stock/completed-movements`: las transferencias PENDING aparecen como "En tránsito" hasta recepción; al recepcionar se consolidan.
- Reportes (`existencias`, `balances-expanded`): decidir si el "en tránsito" cuenta como comprometido/reservado (recomendado: no suma a disponible de destino hasta recepción; opcionalmente exponer "en tránsito").
- Kardex: el OUT aparece en origen; el IN aparece en destino solo tras recepción (el saldo de destino se actualiza entonces).

### B5. Frontend: recepción de transferencias
- Nueva pestaña/modal "Recepciones de transferencia" (espejo de `/stock/returns` pero para TRANSFER/BULK_TRANSFER PENDING dirigidas al almacén del usuario).
- Botón "Recepcionar" por ítem/grupo, con cantidad recibida, nota y (opcional) foto.
- Reusa `confirmReceptionUnified`-style flow adaptado a transferencias.

### B6. Riesgo en producción
- Los `TRANSFER`/`BULK_TRANSFER` **existentes** ya aumentaron destino; su `receiptStatus` se inicializa `RECEIVED` (default) → no requieren recepción retroactiva.
- La recepción obligatoria aplica solo a movimientos creados tras el deploy.
- Backward-compat: `completed-movements`, kardex y reportes deben tratar `RECEIVED` (default) igual que hoy.

---

## Archivos a tocar (resumen)
- Backend: `prisma/schema.prisma`, nueva migración, `src/application/stock/stockMovementService.ts`, `src/adapters/http/routes/stock.ts` (completed-movements, /movements, /bulk-transfers, /picking, /label, nuevo endpoint de recepción), `src/adapters/http/routes/products.ts` (kardex si aplica), `src/adapters/http/routes/reports.ts` (existencias/balances si aplica).
- Frontend: `pages/stock/CompletedMovementsPage.tsx` (columna acciones + modal Ver + export PDF), `lib/movementRequestDocsPdf.ts` (reuso), nueva página/modal de recepción de transferencias, `MovementHistoryTab.tsx` (filtro por número, opcional).

## Verificación
- TypeScript check frontend + backend.
- Vite build + backend build.
- Prueba manual: crear TRANSFER simple y masiva →确认 origen descuenta, destino NO aumenta hasta recepción; recepcionar como branch admin/provider → destino aumenta; "Realizados" muestra IN/ADJUSTMENT con código y botones; export PDF funciona para OUT/TRANSFER.
- Aplicar migración en staging antes de producción.
