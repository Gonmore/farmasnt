-- Add generic (non-commercial) product name
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "genericName" TEXT;

-- Speed up catalog searches by generic name as well
CREATE INDEX IF NOT EXISTS "Product_genericName_trgm_idx" ON "Product" USING GIN ("genericName" gin_trgm_ops);
