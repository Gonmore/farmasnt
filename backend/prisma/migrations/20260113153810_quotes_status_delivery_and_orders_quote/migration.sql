/*
  Warnings:

  - A unique constraint covering the columns `[quoteId]` on the table `SalesOrder` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('CREATED', 'PROCESSED');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryCity" TEXT,
ADD COLUMN     "deliveryMapsUrl" TEXT,
ADD COLUMN     "deliveryZone" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "status" "QuoteStatus" NOT NULL DEFAULT 'CREATED';

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryCity" TEXT,
ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "deliveryMapsUrl" TEXT,
ADD COLUMN     "deliveryZone" TEXT,
ADD COLUMN     "quoteId" TEXT;

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "SalesOrder_quoteId_idx" ON "SalesOrder"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_quoteId_key" ON "SalesOrder"("quoteId");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
