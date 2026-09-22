-- Create SalesOrderPayment table for multi-payment support
CREATE TABLE IF NOT EXISTS "SalesOrderPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "paidById" TEXT,
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "paymentMode" TEXT NOT NULL DEFAULT 'CASH',
    "paymentReceiptType" TEXT,
    "paymentReceiptRef" TEXT,
    "paymentReceiptPhotoUrl" TEXT,
    "paymentReceiptPhotoKey" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "SalesOrderPayment_pkey" PRIMARY KEY ("id")
);

-- Add foreign key constraints (CREATE IF NOT EXISTS not supported for FK)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'SalesOrderPayment_salesOrderId_fkey' AND contype = 'f'
    ) THEN
        ALTER TABLE "SalesOrderPayment" ADD CONSTRAINT "SalesOrderPayment_salesOrderId_fkey" 
        FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'SalesOrderPayment_paidById_fkey' AND contype = 'f'
    ) THEN
        ALTER TABLE "SalesOrderPayment" ADD CONSTRAINT "SalesOrderPayment_paidById_fkey" 
        FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS "SalesOrderPayment_tenantId_idx" ON "SalesOrderPayment"("tenantId");
CREATE INDEX IF NOT EXISTS "SalesOrderPayment_salesOrderId_idx" ON "SalesOrderPayment"("salesOrderId");
CREATE INDEX IF NOT EXISTS "SalesOrderPayment_createdAt_idx" ON "SalesOrderPayment"("createdAt");

-- Backfill: create SalesOrderPayment records for existing paid orders
INSERT INTO "SalesOrderPayment" (
    "id", "tenantId", "salesOrderId", "paidById", "amount",
    "paymentMode", "paymentReceiptType", "paymentReceiptRef",
    "paymentReceiptPhotoUrl", "paymentReceiptPhotoKey", "createdAt", "createdBy"
)
SELECT
    gen_random_uuid()::TEXT,
    o."tenantId",
    o."id",
    o."paidBy",
    o."paidAmount",
    o."paymentMode",
    o."paymentReceiptType",
    o."paymentReceiptRef",
    o."paymentReceiptPhotoUrl",
    o."paymentReceiptPhotoKey",
    o."paidAt",
    o."paidBy"
FROM "SalesOrder" o
WHERE (o."paidAt" IS NOT NULL OR o."paidAmount" > 0)
    AND NOT EXISTS (
        SELECT 1 FROM "SalesOrderPayment" sop
        WHERE sop."salesOrderId" = o."id"
    );
