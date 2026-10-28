# Incidente: Discrepancia en cantidad de Croxix 75mg (COT-20260747 → OV-20260747)

## Resumen
- **Producto:** CROV-75 (Crovix 75 mg), presentación "Caja" (100 unidades/caja)
- **Cotización:** COT-20260747
- **Orden de venta:** OV-20260747
- **Tenant:** FinSNT (`317c5606-4481-498e-8091-04b41bbdc81d`)

## Cronología (Horario Bolivia GMT-4)

| Fecha/Hora (GMT-4) | Acción | Usuario | Cantidad | Observación |
|---|---|---|---|---|
| 14/10/2026 — 01:33:18 | CREATE | Marco Castro (`febsa.scz@gmail.com`) | **1 caja (100 unidades)** | Cotización creada originalmente con 1 caja |
| 14/10/2026 — 12:06:09 | UPDATE | Marco Castro (`febsa.scz@gmail.com`) | **2 cajas (200 unidades)** | Cotización editada — se duplicó la cantidad |
| 15/10/2026 — 19:47:00 | PROCESS | Marco Castro (`febsa.scz@gmail.com`) | 200 unidades | Cotización procesada → orden OV-20260747 creada con 2 cajas |

## Hallazgos
1. **No hay bug de backend:** el proceso de `procesar cotización → orden` copia las líneas al momento del PROCESS. La orden OV-20260747 refleja correctamente el estado de la cotización al momento de procesar (2 cajas).
2. **Discrepancia explicada:** la cotización fue creada con 1 caja y **editada manualmente** el mismo día para duplicar a 2 cajas. Si el usuario vio "1 caja" en la cotización, fue antes de la edición (12:06) o debido a caché del navegador.
3. **Auditoría completa:** el `AuditEvent` capura `before` y `after` con el detalle completo de líneas, presentación y discountPct.

## Usuario involucrado
- **Nombre:** Marco Castro
- **Email:** `febsa.scz@gmail.com`
- **UserId:** `4e5b0954-007a-4d06-8cf0-18ceeb0553bd`
- **Rol:** Administrador Sucursal Santa Cruz (BRANCH_ADMIN)
- **Departamento:** Santa Cruz

## Conclusión
**Incidente atendido.** La discrepancia entre cotización (1 caja) y orden (2 cajas) se debe a una **edición manual de la cotización** realizada por Marco Castro el 14/10 a las 12:06, **antes** de la procesación el 15/10. No hay error en el código.
