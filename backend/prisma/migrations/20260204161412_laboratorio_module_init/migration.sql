/*
  Warnings:

  - The `status` column on the `Batch` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[tenantId,city]` on the table `Laboratory` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('RELEASED', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "SupplyStockMovementType" AS ENUM ('IN', 'OUT', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SupplyPurchaseListStatus" AS ENUM ('DRAFT', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplyReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LabProductionRequestStatus" AS ENUM ('DRAFT', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LabProductionRunStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ModuleCode" ADD VALUE 'LABORATORY';

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "qcNote" TEXT,
ADD COLUMN     "qcRejectedAt" TIMESTAMP(3),
ADD COLUMN     "qcRejectedBy" TEXT,
ADD COLUMN     "qcReleasedAt" TIMESTAMP(3),
ADD COLUMN     "qcReleasedBy" TEXT,
ADD COLUMN     "quarantineUntil" TIMESTAMP(3),
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- Preserve data when converting Batch.status from TEXT -> enum
UPDATE "Batch" SET "status" = 'RELEASED' WHERE "status" NOT IN ('RELEASED', 'QUARANTINE');

-- Drop existing TEXT default before converting to enum (Postgres can't cast it automatically)
ALTER TABLE "Batch" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Batch" ALTER COLUMN "status" TYPE "BatchStatus" USING ("status"::text::"BatchStatus");
ALTER TABLE "Batch" ALTER COLUMN "status" SET DEFAULT 'RELEASED';

-- AlterTable
ALTER TABLE "Laboratory" ADD COLUMN     "city" TEXT,
ADD COLUMN     "outputWarehouseId" TEXT,
ADD COLUMN     "quarantineLocationId" TEXT;

-- CreateTable
CREATE TABLE "Supply" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "Supply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyPresentation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "multiplier" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "SupplyPresentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "vendorName" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "SupplyLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyInventoryBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reservedQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "SupplyInventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyStockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "numberYear" INTEGER NOT NULL,
    "type" "SupplyStockMovementType" NOT NULL,
    "supplyId" TEXT NOT NULL,
    "lotId" TEXT,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "presentationId" TEXT,
    "presentationQuantity" DECIMAL(65,30),
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "SupplyStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyPurchaseList" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "laboratoryId" TEXT,
    "city" TEXT,
    "number" TEXT NOT NULL,
    "numberYear" INTEGER NOT NULL,
    "status" "SupplyPurchaseListStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "SupplyPurchaseList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyPurchaseListLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseListId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "requestedQuantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "vendorName" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "SupplyPurchaseListLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "laboratoryId" TEXT,
    "purchaseListId" TEXT,
    "number" TEXT,
    "numberYear" INTEGER,
    "status" "SupplyReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "vendorName" TEXT,
    "vendorDocument" TEXT,
    "receivedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "SupplyReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyReceiptLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "purchaseListLineId" TEXT,
    "lotId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "presentationId" TEXT,
    "presentationQuantity" DECIMAL(65,30),
    "lotNumber" TEXT,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "SupplyReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabRecipe" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outputQuantity" DECIMAL(65,30),
    "outputUnit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "LabRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabRecipeItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "LabRecipeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabProductionRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "laboratoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "requestedOutputQuantity" DECIMAL(65,30) NOT NULL,
    "outputUnit" TEXT NOT NULL,
    "status" "LabProductionRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "neededBy" TIMESTAMP(3),
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "LabProductionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabProductionRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "laboratoryId" TEXT NOT NULL,
    "requestId" TEXT,
    "recipeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "plannedOutputQuantity" DECIMAL(65,30),
    "outputUnit" TEXT,
    "actualOutputQuantity" DECIMAL(65,30),
    "status" "LabProductionRunStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "LabProductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabProductionRunInput" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "LabProductionRunInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabProductionRunOutput" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "LabProductionRunOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabProductionRunWaste" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "supplyId" TEXT,
    "lotId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "LabProductionRunWaste_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supply_tenantId_idx" ON "Supply"("tenantId");

-- CreateIndex
CREATE INDEX "Supply_tenantId_isActive_idx" ON "Supply"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "Supply_tenantId_code_idx" ON "Supply"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Supply_tenantId_name_key" ON "Supply"("tenantId", "name");

-- CreateIndex
CREATE INDEX "SupplyPresentation_tenantId_idx" ON "SupplyPresentation"("tenantId");

-- CreateIndex
CREATE INDEX "SupplyPresentation_supplyId_idx" ON "SupplyPresentation"("supplyId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyPresentation_tenantId_supplyId_name_key" ON "SupplyPresentation"("tenantId", "supplyId", "name");

-- CreateIndex
CREATE INDEX "SupplyLot_tenantId_idx" ON "SupplyLot"("tenantId");

-- CreateIndex
CREATE INDEX "SupplyLot_supplyId_idx" ON "SupplyLot"("supplyId");

-- CreateIndex
CREATE INDEX "SupplyLot_expiresAt_idx" ON "SupplyLot"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyLot_tenantId_supplyId_lotNumber_key" ON "SupplyLot"("tenantId", "supplyId", "lotNumber");

-- CreateIndex
CREATE INDEX "SupplyInventoryBalance_tenantId_idx" ON "SupplyInventoryBalance"("tenantId");

-- CreateIndex
CREATE INDEX "SupplyInventoryBalance_locationId_idx" ON "SupplyInventoryBalance"("locationId");

-- CreateIndex
CREATE INDEX "SupplyInventoryBalance_supplyId_idx" ON "SupplyInventoryBalance"("supplyId");

-- CreateIndex
CREATE INDEX "SupplyInventoryBalance_lotId_idx" ON "SupplyInventoryBalance"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyInventoryBalance_tenantId_locationId_supplyId_lotId_key" ON "SupplyInventoryBalance"("tenantId", "locationId", "supplyId", "lotId");

-- CreateIndex
CREATE INDEX "SupplyStockMovement_tenantId_idx" ON "SupplyStockMovement"("tenantId");

-- CreateIndex
CREATE INDEX "SupplyStockMovement_supplyId_idx" ON "SupplyStockMovement"("supplyId");

-- CreateIndex
CREATE INDEX "SupplyStockMovement_lotId_idx" ON "SupplyStockMovement"("lotId");

-- CreateIndex
CREATE INDEX "SupplyStockMovement_createdAt_idx" ON "SupplyStockMovement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyStockMovement_tenantId_number_key" ON "SupplyStockMovement"("tenantId", "number");

-- CreateIndex
CREATE INDEX "SupplyPurchaseList_tenantId_idx" ON "SupplyPurchaseList"("tenantId");

-- CreateIndex
CREATE INDEX "SupplyPurchaseList_tenantId_status_idx" ON "SupplyPurchaseList"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SupplyPurchaseList_tenantId_city_idx" ON "SupplyPurchaseList"("tenantId", "city");

-- CreateIndex
CREATE INDEX "SupplyPurchaseList_laboratoryId_idx" ON "SupplyPurchaseList"("laboratoryId");

-- CreateIndex
CREATE INDEX "SupplyPurchaseList_createdAt_idx" ON "SupplyPurchaseList"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyPurchaseList_tenantId_number_key" ON "SupplyPurchaseList"("tenantId", "number");

-- CreateIndex
CREATE INDEX "SupplyPurchaseListLine_tenantId_idx" ON "SupplyPurchaseListLine"("tenantId");

-- CreateIndex
CREATE INDEX "SupplyPurchaseListLine_purchaseListId_idx" ON "SupplyPurchaseListLine"("purchaseListId");

-- CreateIndex
CREATE INDEX "SupplyPurchaseListLine_supplyId_idx" ON "SupplyPurchaseListLine"("supplyId");

-- CreateIndex
CREATE INDEX "SupplyReceipt_tenantId_idx" ON "SupplyReceipt"("tenantId");

-- CreateIndex
CREATE INDEX "SupplyReceipt_laboratoryId_idx" ON "SupplyReceipt"("laboratoryId");

-- CreateIndex
CREATE INDEX "SupplyReceipt_purchaseListId_idx" ON "SupplyReceipt"("purchaseListId");

-- CreateIndex
CREATE INDEX "SupplyReceipt_tenantId_status_idx" ON "SupplyReceipt"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SupplyReceipt_receivedAt_idx" ON "SupplyReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "SupplyReceipt_postedAt_idx" ON "SupplyReceipt"("postedAt");

-- CreateIndex
CREATE INDEX "SupplyReceiptLine_tenantId_idx" ON "SupplyReceiptLine"("tenantId");

-- CreateIndex
CREATE INDEX "SupplyReceiptLine_receiptId_idx" ON "SupplyReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "SupplyReceiptLine_supplyId_idx" ON "SupplyReceiptLine"("supplyId");

-- CreateIndex
CREATE INDEX "SupplyReceiptLine_purchaseListLineId_idx" ON "SupplyReceiptLine"("purchaseListLineId");

-- CreateIndex
CREATE INDEX "SupplyReceiptLine_lotId_idx" ON "SupplyReceiptLine"("lotId");

-- CreateIndex
CREATE INDEX "LabRecipe_tenantId_idx" ON "LabRecipe"("tenantId");

-- CreateIndex
CREATE INDEX "LabRecipe_productId_idx" ON "LabRecipe"("productId");

-- CreateIndex
CREATE INDEX "LabRecipe_tenantId_isActive_idx" ON "LabRecipe"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LabRecipe_tenantId_productId_key" ON "LabRecipe"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "LabRecipeItem_tenantId_idx" ON "LabRecipeItem"("tenantId");

-- CreateIndex
CREATE INDEX "LabRecipeItem_recipeId_idx" ON "LabRecipeItem"("recipeId");

-- CreateIndex
CREATE INDEX "LabRecipeItem_supplyId_idx" ON "LabRecipeItem"("supplyId");

-- CreateIndex
CREATE INDEX "LabProductionRequest_tenantId_idx" ON "LabProductionRequest"("tenantId");

-- CreateIndex
CREATE INDEX "LabProductionRequest_laboratoryId_idx" ON "LabProductionRequest"("laboratoryId");

-- CreateIndex
CREATE INDEX "LabProductionRequest_productId_idx" ON "LabProductionRequest"("productId");

-- CreateIndex
CREATE INDEX "LabProductionRequest_recipeId_idx" ON "LabProductionRequest"("recipeId");

-- CreateIndex
CREATE INDEX "LabProductionRequest_tenantId_status_idx" ON "LabProductionRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LabProductionRequest_createdAt_idx" ON "LabProductionRequest"("createdAt");

-- CreateIndex
CREATE INDEX "LabProductionRun_tenantId_idx" ON "LabProductionRun"("tenantId");

-- CreateIndex
CREATE INDEX "LabProductionRun_laboratoryId_idx" ON "LabProductionRun"("laboratoryId");

-- CreateIndex
CREATE INDEX "LabProductionRun_requestId_idx" ON "LabProductionRun"("requestId");

-- CreateIndex
CREATE INDEX "LabProductionRun_tenantId_status_idx" ON "LabProductionRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LabProductionRun_createdAt_idx" ON "LabProductionRun"("createdAt");

-- CreateIndex
CREATE INDEX "LabProductionRunInput_tenantId_idx" ON "LabProductionRunInput"("tenantId");

-- CreateIndex
CREATE INDEX "LabProductionRunInput_runId_idx" ON "LabProductionRunInput"("runId");

-- CreateIndex
CREATE INDEX "LabProductionRunInput_supplyId_idx" ON "LabProductionRunInput"("supplyId");

-- CreateIndex
CREATE INDEX "LabProductionRunInput_lotId_idx" ON "LabProductionRunInput"("lotId");

-- CreateIndex
CREATE INDEX "LabProductionRunOutput_tenantId_idx" ON "LabProductionRunOutput"("tenantId");

-- CreateIndex
CREATE INDEX "LabProductionRunOutput_runId_idx" ON "LabProductionRunOutput"("runId");

-- CreateIndex
CREATE INDEX "LabProductionRunOutput_batchId_idx" ON "LabProductionRunOutput"("batchId");

-- CreateIndex
CREATE INDEX "LabProductionRunWaste_tenantId_idx" ON "LabProductionRunWaste"("tenantId");

-- CreateIndex
CREATE INDEX "LabProductionRunWaste_runId_idx" ON "LabProductionRunWaste"("runId");

-- CreateIndex
CREATE INDEX "LabProductionRunWaste_supplyId_idx" ON "LabProductionRunWaste"("supplyId");

-- CreateIndex
CREATE INDEX "LabProductionRunWaste_lotId_idx" ON "LabProductionRunWaste"("lotId");

-- CreateIndex
CREATE INDEX "Batch_status_idx" ON "Batch"("status");

-- CreateIndex
CREATE INDEX "Batch_quarantineUntil_idx" ON "Batch"("quarantineUntil");

-- CreateIndex
CREATE INDEX "Laboratory_city_idx" ON "Laboratory"("city");

-- CreateIndex
CREATE INDEX "Laboratory_outputWarehouseId_idx" ON "Laboratory"("outputWarehouseId");

-- CreateIndex
CREATE INDEX "Laboratory_quarantineLocationId_idx" ON "Laboratory"("quarantineLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Laboratory_tenantId_city_key" ON "Laboratory"("tenantId", "city");

-- AddForeignKey
ALTER TABLE "Laboratory" ADD CONSTRAINT "Laboratory_outputWarehouseId_fkey" FOREIGN KEY ("outputWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Laboratory" ADD CONSTRAINT "Laboratory_quarantineLocationId_fkey" FOREIGN KEY ("quarantineLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPresentation" ADD CONSTRAINT "SupplyPresentation_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyLot" ADD CONSTRAINT "SupplyLot_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyInventoryBalance" ADD CONSTRAINT "SupplyInventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyInventoryBalance" ADD CONSTRAINT "SupplyInventoryBalance_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyInventoryBalance" ADD CONSTRAINT "SupplyInventoryBalance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "SupplyLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyStockMovement" ADD CONSTRAINT "SupplyStockMovement_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyStockMovement" ADD CONSTRAINT "SupplyStockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "SupplyLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyStockMovement" ADD CONSTRAINT "SupplyStockMovement_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "SupplyPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPurchaseList" ADD CONSTRAINT "SupplyPurchaseList_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPurchaseListLine" ADD CONSTRAINT "SupplyPurchaseListLine_purchaseListId_fkey" FOREIGN KEY ("purchaseListId") REFERENCES "SupplyPurchaseList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPurchaseListLine" ADD CONSTRAINT "SupplyPurchaseListLine_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceipt" ADD CONSTRAINT "SupplyReceipt_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceipt" ADD CONSTRAINT "SupplyReceipt_purchaseListId_fkey" FOREIGN KEY ("purchaseListId") REFERENCES "SupplyPurchaseList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceiptLine" ADD CONSTRAINT "SupplyReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "SupplyReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceiptLine" ADD CONSTRAINT "SupplyReceiptLine_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceiptLine" ADD CONSTRAINT "SupplyReceiptLine_purchaseListLineId_fkey" FOREIGN KEY ("purchaseListLineId") REFERENCES "SupplyPurchaseListLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceiptLine" ADD CONSTRAINT "SupplyReceiptLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "SupplyLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceiptLine" ADD CONSTRAINT "SupplyReceiptLine_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "SupplyPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabRecipe" ADD CONSTRAINT "LabRecipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabRecipeItem" ADD CONSTRAINT "LabRecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "LabRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabRecipeItem" ADD CONSTRAINT "LabRecipeItem_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRequest" ADD CONSTRAINT "LabProductionRequest_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRequest" ADD CONSTRAINT "LabProductionRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRequest" ADD CONSTRAINT "LabProductionRequest_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "LabRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRun" ADD CONSTRAINT "LabProductionRun_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRun" ADD CONSTRAINT "LabProductionRun_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LabProductionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRun" ADD CONSTRAINT "LabProductionRun_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "LabRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRun" ADD CONSTRAINT "LabProductionRun_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRunInput" ADD CONSTRAINT "LabProductionRunInput_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LabProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRunInput" ADD CONSTRAINT "LabProductionRunInput_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRunInput" ADD CONSTRAINT "LabProductionRunInput_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "SupplyLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRunOutput" ADD CONSTRAINT "LabProductionRunOutput_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LabProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRunOutput" ADD CONSTRAINT "LabProductionRunOutput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRunWaste" ADD CONSTRAINT "LabProductionRunWaste_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LabProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRunWaste" ADD CONSTRAINT "LabProductionRunWaste_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabProductionRunWaste" ADD CONSTRAINT "LabProductionRunWaste_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "SupplyLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
