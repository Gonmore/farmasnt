-- Manual migration: lab sections + supply categories + WIP timing

-- CreateEnum
CREATE TYPE "SupplyCategory" AS ENUM ('RAW_MATERIAL', 'MAINTENANCE');

-- AlterTable: Supply
ALTER TABLE "Supply" ADD COLUMN "category" "SupplyCategory" NOT NULL DEFAULT 'RAW_MATERIAL';

-- Replace unique constraint (was tenantId+name)
DROP INDEX IF EXISTS "Supply_tenantId_name_key";
CREATE UNIQUE INDEX "Supply_tenantId_category_name_key" ON "Supply"("tenantId", "category", "name");
CREATE INDEX "Supply_tenantId_category_idx" ON "Supply"("tenantId", "category");

-- AlterTable: Laboratory (3 sections/locations)
ALTER TABLE "Laboratory"
  ADD COLUMN "rawMaterialsLocationId" TEXT,
  ADD COLUMN "wipLocationId" TEXT,
  ADD COLUMN "maintenanceLocationId" TEXT;

-- Backfill: rawMaterialsLocationId defaults to existing defaultLocationId
UPDATE "Laboratory"
SET "rawMaterialsLocationId" = "defaultLocationId"
WHERE "rawMaterialsLocationId" IS NULL AND "defaultLocationId" IS NOT NULL;

-- Foreign keys (SetNull on delete)
ALTER TABLE "Laboratory"
  ADD CONSTRAINT "Laboratory_rawMaterialsLocationId_fkey" FOREIGN KEY ("rawMaterialsLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Laboratory"
  ADD CONSTRAINT "Laboratory_wipLocationId_fkey" FOREIGN KEY ("wipLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Laboratory"
  ADD CONSTRAINT "Laboratory_maintenanceLocationId_fkey" FOREIGN KEY ("maintenanceLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Laboratory_rawMaterialsLocationId_idx" ON "Laboratory"("rawMaterialsLocationId");
CREATE INDEX "Laboratory_wipLocationId_idx" ON "Laboratory"("wipLocationId");
CREATE INDEX "Laboratory_maintenanceLocationId_idx" ON "Laboratory"("maintenanceLocationId");

-- AlterTable: LabRecipe (estimated duration)
ALTER TABLE "LabRecipe" ADD COLUMN "estimatedDurationHours" INTEGER;

-- AlterTable: LabProductionRun (estimated completion)
ALTER TABLE "LabProductionRun" ADD COLUMN "estimatedCompleteAt" TIMESTAMP(3);
