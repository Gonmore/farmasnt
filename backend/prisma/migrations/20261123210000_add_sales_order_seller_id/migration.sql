-- Add explicit seller to SalesOrder. Keep createdBy as audit/actor field.
ALTER TABLE "SalesOrder" ADD COLUMN "sellerId" TEXT;

CREATE INDEX "SalesOrder_sellerId_idx" ON "SalesOrder"("sellerId");

ALTER TABLE "SalesOrder"
  ADD CONSTRAINT "SalesOrder_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from createdBy when it references a valid user in the same tenant.
UPDATE "SalesOrder" so
SET "sellerId" = so."createdBy"
FROM "User" u
WHERE so."sellerId" IS NULL
  AND so."createdBy" IS NOT NULL
  AND u.id = so."createdBy"
  AND u."tenantId" = so."tenantId";
