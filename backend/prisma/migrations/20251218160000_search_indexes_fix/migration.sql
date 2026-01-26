-- Re-add trigram search indexes for ultra-fast catalog search
-- NOTE: Prisma schema cannot express gin_trgm_ops today; keep these in SQL migrations.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);
