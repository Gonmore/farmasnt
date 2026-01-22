-- CreateEnum
CREATE TYPE "StockMovementRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockMovementRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "StockMovementRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedCity" TEXT NOT NULL,
    "quoteId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovementRequestItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestedQuantity" DECIMAL(65,30) NOT NULL,
    "remainingQuantity" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovementRequestItem_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "StockMovementRequest_tenantId_idx" ON "StockMovementRequest"("tenantId");
CREATE INDEX "StockMovementRequest_tenantId_status_idx" ON "StockMovementRequest"("tenantId", "status");
CREATE INDEX "StockMovementRequest_tenantId_requestedCity_idx" ON "StockMovementRequest"("tenantId", "requestedCity");
CREATE INDEX "StockMovementRequest_tenantId_requestedCity_status_idx" ON "StockMovementRequest"("tenantId", "requestedCity", "status");
CREATE INDEX "StockMovementRequest_quoteId_idx" ON "StockMovementRequest"("quoteId");
CREATE INDEX "StockMovementRequest_requestedBy_idx" ON "StockMovementRequest"("requestedBy");

CREATE INDEX "StockMovementRequestItem_tenantId_idx" ON "StockMovementRequestItem"("tenantId");
CREATE INDEX "StockMovementRequestItem_requestId_idx" ON "StockMovementRequestItem"("requestId");
CREATE INDEX "StockMovementRequestItem_tenantId_productId_idx" ON "StockMovementRequestItem"("tenantId", "productId");
CREATE INDEX "StockMovementRequestItem_tenantId_productId_remainingQuantity_idx" ON "StockMovementRequestItem"("tenantId", "productId", "remainingQuantity");

-- FKs
ALTER TABLE "StockMovementRequest" ADD CONSTRAINT "StockMovementRequest_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockMovementRequestItem" ADD CONSTRAINT "StockMovementRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "StockMovementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovementRequestItem" ADD CONSTRAINT "StockMovementRequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
