-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Quote_isActive_idx" ON "Quote"("isActive");
