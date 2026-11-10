-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE "LessonEnrollment" ADD COLUMN     "reference" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "signupSettings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "BookableService" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "description" TEXT,
    "descriptionFr" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "maxPartySize" INTEGER,
    "daysOfWeek" INTEGER[],
    "openMinute" INTEGER NOT NULL,
    "closeMinute" INTEGER NOT NULL,
    "leadDays" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookableService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "partySize" INTEGER,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "organization" TEXT,
    "notes" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "reference" TEXT NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookableService_tenantId_active_idx" ON "BookableService"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "BookingRequest_reference_key" ON "BookingRequest"("reference");

-- CreateIndex
CREATE INDEX "BookingRequest_tenantId_serviceId_startsAt_idx" ON "BookingRequest"("tenantId", "serviceId", "startsAt");

-- CreateIndex
CREATE INDEX "BookingRequest_tenantId_status_idx" ON "BookingRequest"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LessonEnrollment_reference_key" ON "LessonEnrollment"("reference");

