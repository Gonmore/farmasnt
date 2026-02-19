-- AlterTable
ALTER TABLE "SalesOrder"
  ADD COLUMN "paymentReceiptType" TEXT,
  ADD COLUMN "paymentReceiptRef" TEXT,
  ADD COLUMN "paymentReceiptPhotoUrl" TEXT,
  ADD COLUMN "paymentReceiptPhotoKey" TEXT;
