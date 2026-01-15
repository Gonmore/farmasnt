-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "brandPrimary" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "brandSecondary" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "brandTertiary" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "defaultTheme" "ThemeMode" NOT NULL DEFAULT 'LIGHT';
