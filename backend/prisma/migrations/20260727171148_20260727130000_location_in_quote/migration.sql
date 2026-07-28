-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "locationId" TEXT;

-- CreateIndex
CREATE INDEX "Quote_locationId_idx" ON "Quote"("locationId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ProductPresentation_tenantId_productId_name_unitsPerPresentatio" RENAME TO "ProductPresentation_tenantId_productId_name_unitsPerPresent_key";
