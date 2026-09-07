# Auditoría Febsa — Ventas con descuento de almacén en ciudad incorrecta

**Fecha del análisis:** 2026-09-04
**Tenant:** Febsa (`317c5606-4481-498e-8091-04b41bbdc81d`)
**Base analizada:** backup de producción en `postgres-local` (`farmasnt`)

## Regla violada

Toda venta (`SalesOrder` con `referenceType='SALES_ORDER'`, `type='OUT'`) debe descontar stock de un almacén cuya `city` coincida con `SalesOrder.deliveryCity` (que a su vez coincide con `Customer.city`).

## Resumen

- **Ventas cumplidas totales:** 502
- **Órdenes con `OUT` registrado:** 502
- **Movimientos anómalos detectados:** 14
- **Órdenes afectadas:** 10

## Distribución por almacén de origen (resumen)

| from_warehouse | from_city | order_city | movs | total_qty |
|---|---|---|---|---|
| SUC-CBB | COCHABAMBA | COCHABAMBA | 437 | 2,436,632 |
| SUC-LPZ | LA PAZ | COCHABAMBA | **6** | **73,700** |
| SUC-LPZ | LA PAZ | MUNICIPIO TARIJA | **1** | **1,500** |
| SUC-SCR | SUCRE | SUCRE | 66 | 1,152,866 |
| SUC-SCZ | SANTA CRUZ | COCHABAMBA | **3** | **65** |
| SUC-SCZ | SANTA CRUZ | LA PAZ | **4** | **325** |
| SUC-SCZ | SANTA CRUZ | SANTA CRUZ | 458 | 1,921,300 |
| SUC-TJA | TARIJA | TARIJA | 13 | 71,730 |

CBB, SUCRE y TARIJA como origen: 0 anomalías.

## Detalle de anomalías

### Cluster 1 — `febsa.scz@gmail.com` (Feb 2026): ventas NO-SCZ descontadas de SCZ

| # | Orden | Status | deliveryCity | Cliente | Producto | Lote | Cantidad | from_warehouse | from_city | Fecha |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | OV-20260003 | CONFIRMED | LA PAZ | HOTEL MITRU SUR | Imoss 40mg Iny 10ml | LOT-2026010 | 22 | SUC-SCZ | SANTA CRUZ | 2026-02-03 23:12:43.931 |
| 2 | OV-20260003 | CONFIRMED | LA PAZ | HOTEL MITRU SUR | Imoss 40mg Iny 10ml | LOT-2026011 | 3 | SUC-SCZ | SANTA CRUZ | 2026-02-03 23:12:43.940 |
| 3 | OV-20260003 | CONFIRMED | LA PAZ | HOTEL MITRU SUR | Cardil 6.25 | LOT-2026003 | 100 | SUC-SCZ | SANTA CRUZ | 2026-02-03 23:12:43.948 |
| 4 | OV-20260003 | CONFIRMED | LA PAZ | HOTEL MITRU SUR | Cardil 12.5 | LOT-2026004 | 200 | SUC-SCZ | SANTA CRUZ | 2026-02-03 23:12:43.953 |
| 5 | OV-20260007 | FULFILLED | COCHABAMBA | Farmacia del Valle | Imoss 40mg Iny 10ml | LOT-2026010 | 10 | SUC-SCZ | SANTA CRUZ | 2026-02-05 18:57:49.794 |
| 6 | OV-20260011 | CONFIRMED | COCHABAMBA | Farmacia Cristo | Abasor 150 mg | LOT-2026013 | 30 | SUC-SCZ | SANTA CRUZ | 2026-02-10 13:05:51.752 |
| 7 | OV-20260012 | FULFILLED | COCHABAMBA | Farmacia Cristo | Imoss 40mg Iny 10ml | LOT-2026010 | 25 | SUC-SCZ | SANTA CRUZ | 2026-02-10 13:05:54.628 |

**Subtotal cluster 1:** 7 movs / 390 unidades, 4 órdenes, todas con `from_warehouse = SUC-SCZ`.

### Cluster 2 — `camilo.jadue84@gmail.com` (19-20 Ago 2026): ventas NO-LPZ descontadas de LPZ

| # | Orden | Status | deliveryCity | Cliente | Producto | Lote | Cantidad | from_warehouse | from_city | Fecha |
|---|---|---|---|---|---|---|---|---|---|---|
| 8 | OV-20260453 | FULFILLED | MUNICIPIO TARIJA | HOSPITAL SAN JUAN DE DIOS - TARIJA | Abasor 75 mg | C5024 | 1,500 | SUC-LPZ | LA PAZ | 2026-08-01 00:52:09.449 |
| 9 | OV-20260497 | FULFILLED | COCHABAMBA | LA LUZ | Abasor 150 mg | C4015 | 900 | SUC-LPZ | LA PAZ | 2026-08-19 11:18:04.059 |
| 10 | OV-20260498 | FULFILLED | COCHABAMBA | LA LUZ | Abasor 75 mg | C5024 | 900 | SUC-LPZ | LA PAZ | 2026-08-19 11:19:27.616 |
| 11 | OV-20260499 | FULFILLED | COCHABAMBA | LA LUZ | Abasor 75 mg | C5024 | 900 | SUC-LPZ | LA PAZ | 2026-08-19 11:35:34.652 |
| 12 | OV-20260528 | FULFILLED | COCHABAMBA | SEGURO SOCIAL UNIVERSITARIO | Medifor 850mg | 26215 | 13 | SUC-LPZ | LA PAZ | 2026-08-20 11:40:24.141 |
| 13 | OV-20260528 | FULFILLED | COCHABAMBA | SEGURO SOCIAL UNIVERSITARIO | Medifor 850mg | 26239 | 62,000 | SUC-LPZ | LA PAZ | 2026-08-20 11:40:24.151 |
| 14 | OV-20260528 | FULFILLED | COCHABAMBA | SEGURO SOCIAL UNIVERSITARIO | Medifor 850mg | 26245 | 8,987 | SUC-LPZ | LA PAZ | 2026-08-20 11:40:24.156 |

**Subtotal cluster 2:** 7 movs / 75,200 unidades, 4 órdenes, todas con `from_warehouse = SUC-LPZ`. El movimiento #13 (62,000 unidades de `Medifor 850mg`) es el de mayor impacto.

## Patrones identificados

- **2 clusters temporales** muy marcados (Feb 2026 y Ago 2026) → sugiere bug sistémico, no errores manuales aislados.
- **2 usuarios involucrados:** `febsa.scz@gmail.com` y `camilo.jadue84@gmail.com` (`camilo.jadue.a@gmail.com` aparece en una sola fila del cluster 2).
- **Lotes afectados** quedaron artificialmente bajos en su almacén de origen:
  - En **SCZ**: `LOT-2026010`, `LOT-2026011`, `LOT-2026003`, `LOT-2026004`, `LOT-2026013`
  - En **LPZ**: `C5024`, `C4015`, `26215`, `26239`, `26245`
- **Sin anomalías** en CBB→otra, SUCRE→otra ni TARIJA→otra. CBB, SUCRE y TARIJA como origen no se vieron afectados.
- En todos los casos, `SalesOrder.deliveryCity` y `Customer.city` coinciden, descartando inconsistencia en la cabecera de la orden.

## Recomendaciones

1. **Reponer stock** en los almacenes de origen (SCZ y LPZ) vía `TRANSFER IN` desde la ciudad correcta, o re-expedir los lotes hacia la ciudad cliente.
2. **Revisar el fix de código** que ya aplicaste: confirmar que la selección de `fromLocation` en la ruta de fulfillment de ventas fuerce la ciudad del `deliveryCity` / `warehouseId` del usuario vendedor.
3. **Validar casos `CONFIRMED` sin `FULFILLED`**: las órdenes OV-20260003 y OV-20260011 quedaron en `CONFIRMED` (movimientos de stock ya creados); revisar si conviene revertir o formalizar el movimiento.
4. **Auditoría cruzada:** ejecutar la misma query para los demás tenants (febsa es el primer caso reportado; podría haber patrones similares en otros).

## Archivos

- CSV detalle completo: `C:\Users\arman\AppData\Local\Temp\kilo\anomalies_febsa.csv` (16 columnas: `movement_id, order_number, order_id, order_status, order_city, customer, customer_city, product, batch, quantity, movement_date, from_location, from_warehouse_code, from_warehouse_name, from_warehouse_city, from_warehouse_type, created_by`)
- Scripts SQL: `C:\Users\arman\AppData\Local\Temp\kilo\01_explore.sql` … `06_export.sql`

## Queries de referencia

```sql
-- Resumen
SELECT w_from.code, w_from.city, so."deliveryCity", COUNT(*), SUM(sm.quantity)
FROM "StockMovement" sm
JOIN "SalesOrder" so ON so.number = sm."referenceId"
JOIN "Location" l_from ON l_from.id = sm."fromLocationId"
JOIN "Warehouse" w_from ON w_from.id = l_from."warehouseId"
WHERE sm."tenantId" = '317c5606-4481-498e-8091-04b41bbdc81d'
  AND sm."referenceType" = 'SALES_ORDER' AND sm.type = 'OUT'
GROUP BY 1,2,3 ORDER BY 1,3;

-- Anomalías
SELECT *
FROM "StockMovement" sm
JOIN "SalesOrder" so ON so.number = sm."referenceId"
LEFT JOIN "Customer" c ON c.id = so."customerId"
LEFT JOIN "Batch" b ON b.id = sm."batchId"
JOIN "Location" l_from ON l_from.id = sm."fromLocationId"
JOIN "Warehouse" w_from ON w_from.id = l_from."warehouseId"
WHERE sm."tenantId" = '317c5606-4481-498e-8091-04b41bbdc81d'
  AND sm."referenceType" = 'SALES_ORDER' AND sm.type = 'OUT'
  AND w_from.city IS DISTINCT FROM so."deliveryCity"
ORDER BY sm."createdAt";
```
