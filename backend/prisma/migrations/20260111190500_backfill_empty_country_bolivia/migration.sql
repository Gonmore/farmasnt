-- Backfill tenant country when it was stored as empty string
-- This migration is now a no-op since the country column is added with default in a later migration

-- UPDATE "Tenant"
-- SET "country" = 'BOLIVIA'
-- WHERE "country" IS NULL OR btrim("country") = '';
