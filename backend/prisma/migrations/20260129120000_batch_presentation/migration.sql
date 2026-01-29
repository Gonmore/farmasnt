-- Extend Batch with presentationId (each batch has a single presentation)
ALTER TABLE "Batch" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;

CREATE INDEX IF NOT EXISTS "Batch_presentationId_idx" ON "Batch"("presentationId");

ALTER TABLE "Batch" ADD CONSTRAINT "Batch_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
