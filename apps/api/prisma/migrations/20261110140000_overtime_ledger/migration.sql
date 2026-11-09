-- CreateEnum
CREATE TYPE "OvertimeEntryKind" AS ENUM ('ACCEPTED', 'REFUSED', 'NO_ANSWER');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "overtimePolicy" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "OvertimeEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "positionId" UUID,
    "shiftId" UUID,
    "kind" "OvertimeEntryKind" NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OvertimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OvertimeEntry_userId_occurredAt_idx" ON "OvertimeEntry"("userId", "occurredAt");

