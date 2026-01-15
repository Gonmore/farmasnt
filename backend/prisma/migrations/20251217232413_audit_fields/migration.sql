/*
  Warnings:

  - Added the required column `updatedAt` to the `AuditEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `SalesOrderLine` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `StockMovement` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SalesOrderLine" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
