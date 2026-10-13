-- Fix: Restore remainingQuantity for items incorrectly decremented by buggy auto-apply
-- (same-warehouse TRANSFER and BULK_TRANSFER movements with non-MOVEMENT_REQUEST refType)
-- Affected items in FinSNT tenant (317c5606) only.

-- SOL260047 / Imoss 40mg Iny 10ml: decremented by MS2026-2198 (null TRANSFER, same-warehouse, 661)
UPDATE "StockMovementRequestItem"
SET "remainingQuantity" = "requestedQuantity"
WHERE "id" = 'df282c9d-9733-42e3-b1ed-32d249a6cd8b'
  AND "tenantId" = '317c5606-4481-498e-8091-04b41bbdc81d'
  AND "remainingQuantity" < "requestedQuantity";

-- SOL260070 / Diclofenaco 100 mg: decremented by MS2026-2052 (null TRANSFER, same-warehouse, 2099, qty 400 applied)
UPDATE "StockMovementRequestItem"
SET "remainingQuantity" = "requestedQuantity"
WHERE "id" = '55c99a95-b959-4368-9c5a-36a0eaf5c403'
  AND "tenantId" = '317c5606-4481-498e-8091-04b41bbdc81d'
  AND "remainingQuantity" < "requestedQuantity";
