-- Add movement request codes (SOLYY####) scoped per tenant + year

-- 1) Add columns (nullable first for safe backfill)
ALTER TABLE "StockMovementRequest"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "codeYear" INTEGER,
  ADD COLUMN "codeSeq" INTEGER;

-- 2) Backfill existing rows
WITH ranked AS (
  SELECT
    r."id" AS id,
    r."tenantId" AS tenant_id,
    EXTRACT(YEAR FROM r."createdAt")::int AS year,
    ROW_NUMBER() OVER (
      PARTITION BY r."tenantId", EXTRACT(YEAR FROM r."createdAt")::int
      ORDER BY r."createdAt" ASC, r."id" ASC
    )::int AS seq
  FROM "StockMovementRequest" r
  WHERE r."code" IS NULL
)
UPDATE "StockMovementRequest" r
SET
  "codeYear" = ranked.year,
  "codeSeq" = ranked.seq,
  "code" = 'SOL' || RIGHT(ranked.year::text, 2) || LPAD(ranked.seq::text, 4, '0')
FROM ranked
WHERE r."id" = ranked.id;

-- 3) Enforce non-null + uniqueness
ALTER TABLE "StockMovementRequest"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "codeYear" SET NOT NULL,
  ALTER COLUMN "codeSeq" SET NOT NULL;

CREATE UNIQUE INDEX "StockMovementRequest_tenantId_code_key" ON "StockMovementRequest"("tenantId", "code");
CREATE INDEX "StockMovementRequest_tenantId_codeYear_codeSeq_idx" ON "StockMovementRequest"("tenantId", "codeYear", "codeSeq");

-- 4) Seed TenantSequence currentValue based on backfilled data (no new seed scripts; done in migration)
INSERT INTO "TenantSequence" ("id", "tenantId", "year", "key", "currentValue", "updatedAt")
SELECT
  ('SEQ:' || r."tenantId" || ':' || r."codeYear"::text || ':SOL') AS id,
  r."tenantId" AS tenant_id,
  r."codeYear" AS year,
  'SOL' AS key,
  MAX(r."codeSeq") AS current_value,
  NOW() AS updated_at
FROM "StockMovementRequest" r
GROUP BY r."tenantId", r."codeYear"
ON CONFLICT ("tenantId", "year", "key")
DO UPDATE SET
  "currentValue" = EXCLUDED."currentValue",
  "updatedAt" = NOW();
