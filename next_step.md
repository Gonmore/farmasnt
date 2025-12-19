# Next Steps (próxima sesión)

Fecha: 2025-12-18

Este checklist prioriza **control de vencimientos + semáforo de alertas** (requiere cambios de backend primero) y luego la **parte visual** para poder entregar el servicio.

---

## 0) Objetivo funcional (vencimientos)

Caso real:
- Un producto (ej. **Paracetamol**) tiene un identificador comercial (SKU) y puede existir en **múltiples lotes** (cajas/unidades) con **fechas de vencimiento distintas**.
- Además puede existir en **distintas presentaciones/composición** (ej. 500mg vs 1g, tableta vs cápsula, etc.).
- Necesitamos:
  - Ver stock “por lote” con su vencimiento.
  - Detectar y alertar vencimientos próximos con semáforo.
  - Evitar (o al menos advertir) movimientos/ventas de lotes vencidos.

---

## 1) Decisión de modelado (definir antes de tocar UI)

Elegir 1 enfoque (recomendación: empezar simple y no romper SKU):

**Opción A (recomendada / simple)**
- Cada **presentación** es un **Product distinto**.
  - Ej: `PARA-500TAB` (Paracetamol 500mg tabletas), `PARA-1GTAB`.
- Los **lotes** (Batch) cuelgan del Product y llevan `expiresAt`.
- Ventajas: consistente con inventario y ventas; no requiere “variantes” complejas.

**Opción B (SKU base + variantes)**
- Mantener un SKU “base” y mover la presentación a un nuevo concepto `ProductVariant` (o campos en `Batch`).
- Ventajas: refleja exactamente “mismo SKU con 500mg/1g”; más complejo.

> Sugerencia de avance: arrancar con **Opción A** (Product por presentación) y si el mercado exige SKU base, migrar luego.

---

## 2) Backend (PRIORIDAD 1)

### 2.1 Datos: asegurar trazabilidad por lote
- [x] Confirmar que todo el flujo permite operar con `batchId`:
  - `InventoryBalance.batchId` ya existe.
  - `StockMovement.batchId` ya existe.
  - `SalesOrderLine.batchId` ya existe.
- [ ] Endurecer reglas de negocio (mínimo viable):
  - [x] Al **fulfill** de ventas, si `batchId` existe y `expiresAt < hoy`, bloquear con `409` (override futuro).
  - [x] En **stock move OUT/TRANSFER/ADJUSTMENT negativo**, si `batchId` existe y está vencido, bloquear con `409`.

### 2.2 Semáforo de vencimiento (cálculo)
Definir rangos (configurables por tenant, con defaults):
- **Rojo**: vencido o vence en $\le 30$ días
- **Amarillo**: vence en $31..90$ días
- **Verde**: vence en $> 90$ días

Checklist:
- [x] Definir defaults en backend (constantes). Override vía `TenantSettings` queda para futuro.
- [x] Implementar cálculo `daysToExpire = floor((expiresAt - now)/86400000)`.

### 2.3 Endpoint read-side de alertas
Agregar endpoints “read-side” para UI (rápidos, sin joins en frontend):
- [x] `GET /api/v1/stock/expiry/summary`
  - Query: `warehouseId?`, `take`, `cursor`, `status?=RED|YELLOW|GREEN|EXPIRED`, `daysToExpireMax?`
  - Response item mínimo:
    - `productId, sku, name`
    - `batchId, batchNumber, expiresAt`
    - `warehouseId, warehouseCode, locationId, locationCode`
    - `quantity`
    - `daysToExpire`
    - `semaphoreStatus`
- [ ] Índices (si hace falta):
  - `Batch(expiresAt)` ya tiene index.
  - Evaluar index compuesto para consultas frecuentes (ej. `InventoryBalance(tenantId, batchId)` ya existe parcialmente).

### 2.4 UX del picking FIFO/FEFO (mínimo viable)
- [x] Endpoint helper opcional: `GET /api/v1/stock/fefo-suggestions?productId=...&warehouseId=...&take=10`
  - Retorna lotes con stock ordenados por `expiresAt ASC` (FEFO) y que no estén vencidos.
- [ ] Si no se implementa, al menos ordenar en UI por vencimiento.

### 2.5 Auditoría
- [x] Registrar en auditoría:
  - `stock.expiry.blocked` cuando se intente mover/vender un lote vencido.
  - `stock.expiry.warning` (futuro) si se permite override.

---

## 3) Frontend (PRIORIDAD 2 — parte visual)

Meta: pantallas claras, operables y con buen “look & feel” usando el sistema actual (Tailwind + theme vars `--pf-*`).

### 3.1 Pantalla: “Vencimientos” (semáforo)
- [x] Nueva sección dentro de Admin o dentro del módulo Stock (ubicación):
  - Recomendación: `Admin → Reports` o `Stock` (si ya hay pestañas).
- [x] Tabla con:
  - Producto (SKU + nombre)
  - Lote (batchNumber)
  - Vence (fecha)
  - Días restantes
  - Cantidad
  - Ubicación (warehouse/location)
  - Estado semáforo
- [x] Chips/Badges (sin inventar colores nuevos):
  - Usar `pf.primary/secondary/tertiary` + `text-slate-*` y `bg-slate-*`.
- [x] Filtros mínimos:
  - Warehouse (select)
  - Estado (Red/Yellow/Green)

### 3.2 Integración en flujos existentes
- [x] En “Movimientos” y “Fulfillment”, mostrar advertencia si el lote seleccionado vence pronto.
  - Implementado como columnas de vencimiento + semáforo en tablas de **Reportes → Stock** (balances y movimientos).
- [x] (Opcional) Auto-sugerir FEFO: seleccionar por defecto el lote con vencimiento más cercano no vencido.
  - Implementado en backend: en `POST /api/v1/sales/orders/:id/fulfill`, si una línea viene con `batchId: null`, se auto-selecciona un lote no vencido por FEFO y se asigna.

### 3.3 Detalles visuales para vender el servicio
- [ ] Mejorar layout/espaciado de Admin y tablas (consistencia en paddings, headers, acciones).
- [ ] Estados vacíos y loading (con copy claro: “Sin datos”, “Cargando…”, “Error…”).
- [ ] Branding visible (logo + colores) en header/login.

---

## 4) Pruebas / QA (rápido pero obligatorio)

- [x] Seed: crear 1 producto “Paracetamol 500mg” + 2 lotes con diferentes `expiresAt`.
- [x] Crear stock IN a cada lote (cantidades diferentes).
- [x] Verificar que el endpoint de alertas liste:
  - lote por vencer (amarillo)
  - lote vencido (rojo/expired)
- [x] Intentar fulfill con lote vencido → debe dar `409`.
  - Incluido en el botón “Ejecutar demo (Stock + Ventas)”.

---

## 5) Entregables de la próxima sesión

- Backend:
  - Endpoints de alertas + reglas de bloqueo por lote vencido.
  - (Opcional) FEFO suggestions.
- Frontend:
  - Pantalla “Vencimientos” con semáforo y filtros mínimos.
  - Ajustes visuales básicos para demo comercial.

---

## Notas de implementación (apuntes técnicos)

- Datos existentes útiles:
  - `Batch.expiresAt` ya existe.
  - Stock por lote ya existe vía `InventoryBalance(batchId)`.
- Riesgos:
  - Si se insiste en “mismo SKU para 500mg y 1g”, habrá que introducir variantes (Opción B) o re-definir SKU.
  - `migrate dev` crea migraciones nuevas si el schema cambia; mantener orden y revisar SQL generado.
