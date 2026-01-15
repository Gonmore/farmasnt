-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "subscriptionExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Tenant_subscriptionExpiresAt_idx" ON "Tenant"("subscriptionExpiresAt");
