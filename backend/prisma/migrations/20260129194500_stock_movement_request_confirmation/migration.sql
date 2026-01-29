-- Add confirmation fields to StockMovementRequest

CREATE TYPE "StockMovementRequestConfirmationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

ALTER TABLE "StockMovementRequest"
ADD COLUMN "confirmationStatus" "StockMovementRequestConfirmationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "confirmedBy" TEXT,
ADD COLUMN "confirmationNote" TEXT;

CREATE INDEX "StockMovementRequest_tenantId_confirmationStatus_idx" ON "StockMovementRequest"("tenantId", "confirmationStatus");
