-- Add warehouseId to Notification so per-warehouse routing works when two
-- warehouses share the same city (PROVIDER + SALES in Santa Cruz for tenant Febsa).
-- city remains for backward-compat with existing rows.

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "warehouseId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_tenantId_warehouseId_createdAt_idx" ON "Notification"("tenantId", "warehouseId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL;
