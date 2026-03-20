DROP INDEX IF EXISTS "ProductPresentation_tenantId_productId_name_key";

CREATE UNIQUE INDEX "ProductPresentation_tenantId_productId_name_unitsPerPresentation_key"
ON "ProductPresentation"("tenantId", "productId", "name", "unitsPerPresentation");