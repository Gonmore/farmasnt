-- DropIndex
DROP INDEX "QuoteLine_presentationId_idx";

-- DropIndex
DROP INDEX "SalesOrderLine_presentationId_idx";

-- DropIndex
DROP INDEX "StockMovement_presentationId_idx";

-- DropIndex
DROP INDEX "StockMovementRequestItem_presentationId_idx";

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "openedBy" TEXT;

-- CreateIndex
CREATE INDEX "Batch_openedAt_idx" ON "Batch"("openedAt");
