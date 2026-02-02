-- AlterTable
ALTER TABLE "StockMovementRequest" ADD COLUMN     "warehouseId" TEXT;

-- CreateIndex
CREATE INDEX "StockMovementRequest_tenantId_warehouseId_idx" ON "StockMovementRequest"("tenantId", "warehouseId");

-- AddForeignKey
ALTER TABLE "StockMovementRequest" ADD CONSTRAINT "StockMovementRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
