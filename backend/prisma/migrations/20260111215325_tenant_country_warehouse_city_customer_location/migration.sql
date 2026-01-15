-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "city" TEXT,
ADD COLUMN     "mapsUrl" TEXT,
ADD COLUMN     "zone" TEXT;

-- AlterTable
ALTER TABLE "InventoryBalance" ADD COLUMN     "reservedQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "country" TEXT DEFAULT 'BOLIVIA';

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "city" TEXT;

-- CreateTable
CREATE TABLE "SalesOrderReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "salesOrderLineId" TEXT NOT NULL,
    "inventoryBalanceId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "SalesOrderReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesOrderReservation_tenantId_idx" ON "SalesOrderReservation"("tenantId");

-- CreateIndex
CREATE INDEX "SalesOrderReservation_salesOrderId_idx" ON "SalesOrderReservation"("salesOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderReservation_salesOrderLineId_idx" ON "SalesOrderReservation"("salesOrderLineId");

-- CreateIndex
CREATE INDEX "SalesOrderReservation_inventoryBalanceId_idx" ON "SalesOrderReservation"("inventoryBalanceId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderReservation_tenantId_salesOrderLineId_inventoryBa_key" ON "SalesOrderReservation"("tenantId", "salesOrderLineId", "inventoryBalanceId");

-- AddForeignKey
ALTER TABLE "SalesOrderReservation" ADD CONSTRAINT "SalesOrderReservation_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderReservation" ADD CONSTRAINT "SalesOrderReservation_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderReservation" ADD CONSTRAINT "SalesOrderReservation_inventoryBalanceId_fkey" FOREIGN KEY ("inventoryBalanceId") REFERENCES "InventoryBalance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
