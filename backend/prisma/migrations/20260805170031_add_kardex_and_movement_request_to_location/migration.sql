-- AlterTable
ALTER TABLE "StockMovementRequest" ADD COLUMN     "toLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "StockMovementRequest" ADD CONSTRAINT "StockMovementRequest_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
