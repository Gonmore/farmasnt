-- CreateTable
CREATE TABLE "ProductPresentation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitsPerPresentation" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "priceOverride" DECIMAL(65,30),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "ProductPresentation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProductPresentation" ADD CONSTRAINT "ProductPresentation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ProductPresentation_tenantId_idx" ON "ProductPresentation"("tenantId");
CREATE INDEX "ProductPresentation_tenantId_productId_idx" ON "ProductPresentation"("tenantId", "productId");
CREATE INDEX "ProductPresentation_productId_idx" ON "ProductPresentation"("productId");
CREATE UNIQUE INDEX "ProductPresentation_tenantId_productId_name_key" ON "ProductPresentation"("tenantId", "productId", "name");

-- Only one default presentation per product
CREATE UNIQUE INDEX "ProductPresentation_one_default_per_product" ON "ProductPresentation"("tenantId", "productId") WHERE "isDefault" = true;

-- Extend QuoteLine
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "presentationQuantity" DECIMAL(65,30);

CREATE INDEX IF NOT EXISTS "QuoteLine_presentationId_idx" ON "QuoteLine"("presentationId");
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Extend SalesOrderLine
ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;
ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "presentationQuantity" DECIMAL(65,30);

CREATE INDEX IF NOT EXISTS "SalesOrderLine_presentationId_idx" ON "SalesOrderLine"("presentationId");
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Extend StockMovement
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "presentationQuantity" DECIMAL(65,30);

CREATE INDEX IF NOT EXISTS "StockMovement_presentationId_idx" ON "StockMovement"("presentationId");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
