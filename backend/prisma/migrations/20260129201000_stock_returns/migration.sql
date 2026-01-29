-- Stock returns with evidence (reason + photo)

-- CreateTable
CREATE TABLE "StockReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "reason" TEXT NOT NULL,
    "photoKey" TEXT,
    "photoUrl" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "StockReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReturnItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "presentationId" TEXT,
    "presentationQuantity" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "StockReturnItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StockReturn" ADD CONSTRAINT "StockReturn_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturnItem" ADD CONSTRAINT "StockReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "StockReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturnItem" ADD CONSTRAINT "StockReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturnItem" ADD CONSTRAINT "StockReturnItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturnItem" ADD CONSTRAINT "StockReturnItem_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "StockReturn_tenantId_idx" ON "StockReturn"("tenantId");

-- CreateIndex
CREATE INDEX "StockReturn_tenantId_createdAt_idx" ON "StockReturn"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockReturn_tenantId_toLocationId_idx" ON "StockReturn"("tenantId", "toLocationId");

-- CreateIndex
CREATE INDEX "StockReturnItem_tenantId_idx" ON "StockReturnItem"("tenantId");

-- CreateIndex
CREATE INDEX "StockReturnItem_returnId_idx" ON "StockReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "StockReturnItem_tenantId_productId_idx" ON "StockReturnItem"("tenantId", "productId");
