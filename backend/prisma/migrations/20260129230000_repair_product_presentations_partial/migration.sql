-- Repair migration for partially-applied 20260127140000_product_presentations
-- Goal: make schema consistent without failing if objects already exist.

-- Ensure ProductPresentation constraints/indexes exist
DO $$
BEGIN
  -- FK to Product
  BEGIN
    ALTER TABLE "ProductPresentation"
      ADD CONSTRAINT "ProductPresentation_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

CREATE INDEX IF NOT EXISTS "ProductPresentation_tenantId_idx" ON "ProductPresentation"("tenantId");
CREATE INDEX IF NOT EXISTS "ProductPresentation_tenantId_productId_idx" ON "ProductPresentation"("tenantId", "productId");
CREATE INDEX IF NOT EXISTS "ProductPresentation_productId_idx" ON "ProductPresentation"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductPresentation_tenantId_productId_name_key" ON "ProductPresentation"("tenantId", "productId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductPresentation_one_default_per_product" ON "ProductPresentation"("tenantId", "productId") WHERE "isDefault" = true;

-- Extend QuoteLine (idempotent)
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "presentationQuantity" DECIMAL(65,30);
CREATE INDEX IF NOT EXISTS "QuoteLine_presentationId_idx" ON "QuoteLine"("presentationId");
DO $$
BEGIN
  BEGIN
    ALTER TABLE "QuoteLine"
      ADD CONSTRAINT "QuoteLine_presentationId_fkey"
      FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- Extend SalesOrderLine (idempotent)
ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;
ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "presentationQuantity" DECIMAL(65,30);
CREATE INDEX IF NOT EXISTS "SalesOrderLine_presentationId_idx" ON "SalesOrderLine"("presentationId");
DO $$
BEGIN
  BEGIN
    ALTER TABLE "SalesOrderLine"
      ADD CONSTRAINT "SalesOrderLine_presentationId_fkey"
      FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- Extend StockMovement (idempotent)
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "presentationQuantity" DECIMAL(65,30);
CREATE INDEX IF NOT EXISTS "StockMovement_presentationId_idx" ON "StockMovement"("presentationId");
DO $$
BEGIN
  BEGIN
    ALTER TABLE "StockMovement"
      ADD CONSTRAINT "StockMovement_presentationId_fkey"
      FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- Extend StockMovementRequestItem (idempotent)
ALTER TABLE "StockMovementRequestItem" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;
ALTER TABLE "StockMovementRequestItem" ADD COLUMN IF NOT EXISTS "presentationQuantity" DECIMAL(65,30);
CREATE INDEX IF NOT EXISTS "StockMovementRequestItem_presentationId_idx" ON "StockMovementRequestItem"("presentationId");
DO $$
BEGIN
  BEGIN
    ALTER TABLE "StockMovementRequestItem"
      ADD CONSTRAINT "StockMovementRequestItem_presentationId_fkey"
      FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;
