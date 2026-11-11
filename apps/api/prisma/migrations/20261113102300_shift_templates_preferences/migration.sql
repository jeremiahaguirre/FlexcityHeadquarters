-- CreateEnum
CREATE TYPE "ShiftPreferenceKind" AS ENUM ('PREFER', 'AVOID');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "templateApplicationId" UUID,
ADD COLUMN     "templateSlotId" UUID;

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" UUID,
    "validFrom" DATE,
    "validTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "autoWeeksAhead" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTemplateSlot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "daysOfWeek" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "facilityId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "unpaidBreakMinutes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShiftTemplateSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTemplateApplication" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "created" INTEGER NOT NULL DEFAULT 0,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "undoneAt" TIMESTAMPTZ(3),
    "undoneById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftTemplateApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPreference" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "ShiftPreferenceKind" NOT NULL,
    "daysOfWeek" INTEGER[],
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "positionId" UUID,
    "facilityId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPreferenceLimit" (
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "maxWeeklyHours" DECIMAL(5,2),
    "maxDaysPerWeek" INTEGER,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftPreferenceLimit_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "ShiftTemplate_tenantId_departmentId_idx" ON "ShiftTemplate"("tenantId", "departmentId");

-- CreateIndex
CREATE INDEX "ShiftTemplateSlot_templateId_idx" ON "ShiftTemplateSlot"("templateId");

-- CreateIndex
CREATE INDEX "ShiftTemplateApplication_tenantId_templateId_createdAt_idx" ON "ShiftTemplateApplication"("tenantId", "templateId", "createdAt");

-- CreateIndex
CREATE INDEX "ShiftPreference_tenantId_userId_idx" ON "ShiftPreference"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "ShiftPreferenceLimit_tenantId_idx" ON "ShiftPreferenceLimit"("tenantId");

-- CreateIndex
CREATE INDEX "Shift_templateSlotId_startsAt_idx" ON "Shift"("templateSlotId", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_templateApplicationId_idx" ON "Shift"("templateApplicationId");

-- AddForeignKey
ALTER TABLE "ShiftTemplateSlot" ADD CONSTRAINT "ShiftTemplateSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTemplateApplication" ADD CONSTRAINT "ShiftTemplateApplication_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

