-- Add optional branch/warehouse assignment to users.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'User_warehouseId_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "User_warehouseId_idx" ON "User"("warehouseId");
