-- Add configurable credit fields (keep legacy flags)
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "creditEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "creditDays" INTEGER;

-- Backfill from legacy flags (prefer 14 over 7)
UPDATE "Customer"
SET
  "creditEnabled" = ("creditDays14Enabled" = TRUE OR "creditDays7Enabled" = TRUE),
  "creditDays" = CASE
    WHEN "creditDays14Enabled" = TRUE THEN 14
    WHEN "creditDays7Enabled" = TRUE THEN 7
    ELSE NULL
  END
WHERE "creditEnabled" = FALSE AND "creditDays" IS NULL;
