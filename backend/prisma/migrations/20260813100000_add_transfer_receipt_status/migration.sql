/*
  Warns: columns with not null without default value will be created
  Please add a default value or migrate the existing data.

  Este cambio agrega el estado de recepción a StockMovement para soportar
  recepción obligatoria en transferencias (simples y masivas).
  El default RECEIVED mantiene el comportamiento actual de los movimientos existentes
  (ninguno requiere recepción retroactiva).
*/

-- CreateEnum
CREATE TYPE "StockMovementReceiptStatus" AS ENUM ('RECEIVED', 'PENDING');

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN "receiptStatus" "StockMovementReceiptStatus" NOT NULL DEFAULT 'RECEIVED';
ALTER TABLE "StockMovement" ADD COLUMN "receivedAt" TIMESTAMP(3);
ALTER TABLE "StockMovement" ADD COLUMN "receivedBy" TEXT;

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_receiptStatus_idx" ON "StockMovement"("tenantId", "receiptStatus");
CREATE INDEX "StockMovement_tenantId_referenceId_receiptStatus_idx" ON "StockMovement"("tenantId", "referenceId", "receiptStatus");
