-- CreateEnum
CREATE TYPE "SchoolPeriodKind" AS ENUM ('TERM', 'BREAK');

-- CreateTable
CREATE TABLE "SchoolCalendarPeriod" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "SchoolPeriodKind" NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,

    CONSTRAINT "SchoolCalendarPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolCalendarPeriod_tenantId_startsOn_idx" ON "SchoolCalendarPeriod"("tenantId", "startsOn");
