-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "presentationFormat" TEXT,
ADD COLUMN     "presentationQuantity" DECIMAL(65,30),
ADD COLUMN     "presentationWrapper" TEXT;
