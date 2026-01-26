-- Add payment + delivery tracking fields to SalesOrder
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "paymentMode" TEXT NOT NULL DEFAULT 'CASH';
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "paidBy" TEXT;

CREATE INDEX IF NOT EXISTS "SalesOrder_paidAt_idx" ON "SalesOrder" ("paidAt");
CREATE INDEX IF NOT EXISTS "SalesOrder_deliveredAt_idx" ON "SalesOrder" ("deliveredAt");
CREATE INDEX IF NOT EXISTS "SalesOrder_paymentMode_idx" ON "SalesOrder" ("paymentMode");
