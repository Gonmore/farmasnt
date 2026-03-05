-- Persist bell notifications (server-side) with per-user read timestamp

-- AlterTable
ALTER TABLE "User" ADD COLUMN "notificationsLastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "city" TEXT,
  "targetUserId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "linkTo" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");
CREATE INDEX "Notification_tenantId_city_createdAt_idx" ON "Notification"("tenantId", "city", "createdAt");
CREATE INDEX "Notification_tenantId_targetUserId_createdAt_idx" ON "Notification"("tenantId", "targetUserId", "createdAt");
