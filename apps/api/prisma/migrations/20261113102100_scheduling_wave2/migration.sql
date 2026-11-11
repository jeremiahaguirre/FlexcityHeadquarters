-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayCodeKey" ADD VALUE 'REPORTING_PAY';
ALTER TYPE "PayCodeKey" ADD VALUE 'SCHEDULE_CHANGE_PREMIUM';
ALTER TYPE "PayCodeKey" ADD VALUE 'STANDBY_PAY';
ALTER TYPE "PayCodeKey" ADD VALUE 'CALLBACK_PAY';

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "neverAlone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unpaidBreakMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "callBack" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "neverAlone" BOOLEAN,
ADD COLUMN     "rotationTemplateId" UUID,
ADD COLUMN     "unpaidBreakMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "workRules" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "ShiftChange" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "oldStartsAt" TIMESTAMPTZ(3),
    "oldEndsAt" TIMESTAMPTZ(3),
    "newStartsAt" TIMESTAMPTZ(3),
    "newEndsAt" TIMESTAMPTZ(3),
    "noticeHours" DECIMAL(8,2) NOT NULL,
    "requiredHours" DECIMAL(8,2),
    "late" BOOLEAN NOT NULL DEFAULT false,
    "premiumHours" DECIMAL(8,2),
    "multiplier" DECIMAL(6,3),
    "flatAmount" DECIMAL(10,2),
    "payOn" DATE,
    "waivedAt" TIMESTAMPTZ(3),
    "waivedById" UUID,
    "waiveReason" TEXT,
    "changedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" UUID,
    "facilityId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "cycleDays" INTEGER NOT NULL,
    "anchorDate" DATE NOT NULL,
    "pattern" JSONB NOT NULL,
    "crews" JSONB NOT NULL,
    "unpaidBreakMinutes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RotationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnCallPeriod" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnCallPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftChange_tenantId_payOn_idx" ON "ShiftChange"("tenantId", "payOn");

-- CreateIndex
CREATE INDEX "ShiftChange_shiftId_idx" ON "ShiftChange"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftChange_userId_createdAt_idx" ON "ShiftChange"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RotationTemplate_tenantId_departmentId_idx" ON "RotationTemplate"("tenantId", "departmentId");

-- CreateIndex
CREATE INDEX "OnCallPeriod_tenantId_departmentId_startsAt_idx" ON "OnCallPeriod"("tenantId", "departmentId", "startsAt");

-- CreateIndex
CREATE INDEX "OnCallPeriod_userId_startsAt_idx" ON "OnCallPeriod"("userId", "startsAt");

