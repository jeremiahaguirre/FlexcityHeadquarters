-- CreateEnum
CREATE TYPE "ReportSchedule" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "schedule" "ReportSchedule" NOT NULL DEFAULT 'NONE',
    "lastSentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedReport_tenantId_ownerId_idx" ON "SavedReport"("tenantId", "ownerId");

