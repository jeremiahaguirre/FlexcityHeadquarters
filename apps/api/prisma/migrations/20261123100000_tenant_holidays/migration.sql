-- City-added holidays and closure days on top of the statutory ones. Additive only.

-- CreateEnum
CREATE TYPE "TenantHolidayKind" AS ENUM ('PAID', 'CLOSURE');

-- CreateEnum
CREATE TYPE "HolidayRecurrence" AS ENUM ('NONE', 'YEARLY_DATE', 'YEARLY_NTH_WEEKDAY', 'YEARLY_LAST_WEEKDAY', 'EASTER_OFFSET');

-- CreateTable
CREATE TABLE "TenantHoliday" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT NOT NULL,
    "kind" "TenantHolidayKind" NOT NULL DEFAULT 'PAID',
    "date" DATE NOT NULL,
    "recurrence" "HolidayRecurrence" NOT NULL DEFAULT 'NONE',
    "untilYear" INTEGER,
    "province" "Province",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TenantHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantHoliday_tenantId_date_idx" ON "TenantHoliday"("tenantId", "date");
