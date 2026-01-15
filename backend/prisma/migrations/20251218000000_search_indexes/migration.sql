-- Enable trigram search for ultra-fast ILIKE / contains queries
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Product search indexes (bitmap AND with existing tenantId btree index)
CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);

-- Optional: speed up customers search by name in future
CREATE INDEX IF NOT EXISTS "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);
