-- CreateEnum
CREATE TYPE "ReportScheduleType" AS ENUM ('SALES', 'STOCK');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ReportScheduleType" NOT NULL,
    "reportKey" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "hour" INTEGER NOT NULL DEFAULT 8,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "recipients" TEXT[] NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportSchedule_tenantId_idx" ON "ReportSchedule"("tenantId");

-- CreateIndex
CREATE INDEX "ReportSchedule_tenantId_type_idx" ON "ReportSchedule"("tenantId", "type");

-- CreateIndex
CREATE INDEX "ReportSchedule_tenantId_enabled_idx" ON "ReportSchedule"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "ReportSchedule_tenantId_nextRunAt_idx" ON "ReportSchedule"("tenantId", "nextRunAt");
