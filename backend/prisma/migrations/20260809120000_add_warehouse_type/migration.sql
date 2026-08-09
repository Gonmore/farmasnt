-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('PROVIDER', 'SALES');

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN "type" "WarehouseType" NOT NULL DEFAULT 'SALES';
