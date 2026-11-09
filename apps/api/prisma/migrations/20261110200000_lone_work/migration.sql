-- CreateEnum
CREATE TYPE "LoneWorkStatus" AS ENUM ('ACTIVE', 'OVERDUE', 'ESCALATED', 'HELP', 'ENDED');

-- CreateTable
CREATE TABLE "LoneWorkSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "facilityId" UUID,
    "location" TEXT NOT NULL,
    "task" TEXT,
    "intervalMinutes" INTEGER NOT NULL,
    "status" "LoneWorkStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckInAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextDueAt" TIMESTAMPTZ(3) NOT NULL,
    "overdueAt" TIMESTAMPTZ(3),
    "escalatedAt" TIMESTAMPTZ(3),
    "helpAt" TIMESTAMPTZ(3),
    "helpNote" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "respondingId" UUID,
    "respondingAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LoneWorkSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoneWorkSession_tenantId_status_nextDueAt_idx" ON "LoneWorkSession"("tenantId", "status", "nextDueAt");

-- CreateIndex
CREATE INDEX "LoneWorkSession_userId_startedAt_idx" ON "LoneWorkSession"("userId", "startedAt");

