# Plan: Enhancement of Kardex, Deliveries, Movement Requests, and Payments

## Goal
Implement four major improvements covering stock Kardex report per presentation with Excel export, delivery completion modal with return handling, movement requests with sub-warehouse destination routing, and PDF/image payment proofs.

---

## Scope & Technical Design

### 1. Kardex per Product Presentation (`/stock/inventory`)
- **Backend**: 
  - Add a new endpoint `GET /api/v1/products/:id/kardex` (or within reports/stock) returning chronological movements grouped or filtered by presentation.
  - Computes running balances (units and presentations) across locations (Sub-Almacenes) mimicking `Kardex_pres.md`.
- **Frontend**:
  - Add a "Kardex" button to each product row in `/stock/inventory`.
  - Opens a Modal containing tabs for each product presentation (`ProductPresentation`).
  - Renders a clean table with columns: Fecha, Ubicación (Sub-Almacén), Tipo Movimiento, Lote, Detalle / Cliente, Entrada (u), Salida (u), Saldo Unidades, Saldo Presentaciones.
  - Include an "Exportar a Excel" button that exports the Kardex with each presentation on a separate worksheet (using `xlsx` library).

### 2. Delivery Completion & Returns (`/sales/deliveries`)
- **Backend**:
  - Update delivery completion / order fulfillment endpoint (`PATCH /api/v1/sales/orders/:id/fulfill` or equivalent) to accept structured return quantities per item/batch.
  - When returned items are indicated, automatically register `StockReturn` / `StockMovement` of type `IN` restoring stock back to the origin location/batch.
- **Frontend**:
  - Replace the direct confirm alert in `/sales/deliveries` with a modal (`MarkDeliveredModal`).
  - Allows marking items as normally delivered or returning partial/total quantities per item, specifying reason/note and destination location.

### 3. Sub-Warehouse Destination in Movement Requests (`/stock/movement-requests`)
- **Backend**:
  - Update `StockMovementRequest` Prisma model and DTOs to include `toLocationId` (Sub-Almacén destino) alongside `warehouseId`.
  - Propagate `toLocationId` through fulfillment (`fulfill`), bulk-fulfill, receipt confirmation (`receive`), and traceability views.
- **Frontend**:
  - Update "Crear Solicitud" modal in `/stock/movement-requests` to include a dropdown for selecting the destination "Sub-Almacén" (`locationId`) within the selected warehouse.
  - Reflect destination sub-warehouse in tables, detail views, and traceability flows.

### 4. PDF and Image Payment Proofs (`/sales/payments`)
- **Backend**:
  - Extend payment attachment schema / storage handling in `salesPayments` routes to accept PDF content types (`application/pdf`) alongside images (`image/png`, `image/jpeg`, `image/webp`).
- **Frontend**:
  - Update file upload input in the "Confirmar pago" modal (`PaymentsPage.tsx`) to accept `.pdf` files in addition to images, updating the label to "Comprobante (Imagen o PDF)".

---

## Validation Plan
1. Compile backend (`npm --prefix backend run build`) and frontend (`npm --prefix frontend run build`).
2. Verify API contracts and OpenAPI docs generation.
3. Smoke-test UI flows manually or via existing test runners if applicable.
