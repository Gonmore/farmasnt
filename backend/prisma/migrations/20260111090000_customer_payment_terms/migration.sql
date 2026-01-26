-- Add payment term flags to customers
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "creditDays7Enabled" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "creditDays14Enabled" BOOLEAN NOT NULL DEFAULT FALSE;
