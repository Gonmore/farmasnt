-- DropIndex
DROP INDEX "Product_genericName_trgm_idx";

-- DropIndex
DROP INDEX "QuoteLine_presentationId_idx";

-- DropIndex
DROP INDEX "SalesOrder_deliveredAt_idx";

-- DropIndex
DROP INDEX "SalesOrder_paidAt_idx";

-- DropIndex
DROP INDEX "SalesOrder_paymentMode_idx";

-- DropIndex
DROP INDEX "SalesOrderLine_presentationId_idx";

-- DropIndex
DROP INDEX "StockMovement_presentationId_idx";

-- AlterTable
ALTER TABLE "SalesOrderReservation" ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- RenameIndex
ALTER INDEX "StockMovementRequestItem_tenantId_productId_remainingQuantity_i" RENAME TO "StockMovementRequestItem_tenantId_productId_remainingQuanti_idx";
