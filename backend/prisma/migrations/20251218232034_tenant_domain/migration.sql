-- DropIndex
DROP INDEX "Customer_name_trgm_idx";

-- DropIndex
DROP INDEX "Product_name_trgm_idx";

-- DropIndex
DROP INDEX "Product_sku_trgm_idx";

-- AlterTable
ALTER TABLE "TenantDomain" ALTER COLUMN "verifiedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "verificationTokenExpiresAt" SET DATA TYPE TIMESTAMP(3);
