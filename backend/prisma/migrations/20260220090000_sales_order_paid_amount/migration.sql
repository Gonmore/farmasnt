-- Add cumulative paid amount to support partial payments
ALTER TABLE "SalesOrder"
ADD COLUMN "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;
