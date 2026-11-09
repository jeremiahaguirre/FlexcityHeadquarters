-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignKind" AS ENUM ('LESSONS', 'SWIM_CLUB', 'CAMP', 'OTHER');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('GUARDIAN', 'CHILD', 'ADULT');

-- CreateEnum
CREATE TYPE "FeeKind" AS ENUM ('MEMBERSHIP', 'DROP_IN', 'PASS', 'PROGRAM');

-- CreateEnum
CREATE TYPE "FeePeriod" AS ENUM ('YEAR', 'MONTH', 'VISIT', 'NONE');

-- AlterTable
ALTER TABLE "LessonClass" ADD COLUMN     "campaignId" UUID,
ADD COLUMN     "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "levelId" UUID,
ADD COLUMN     "maxAgeMonths" INTEGER,
ADD COLUMN     "memberPriceCents" INTEGER,
ADD COLUMN     "minAgeMonths" INTEGER,
ADD COLUMN     "priceCents" INTEGER,
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "LessonEnrollment" ADD COLUMN     "ageOverride" TEXT,
ADD COLUMN     "householdId" UUID,
ADD COLUMN     "memberId" UUID,
ADD COLUMN     "priceCents" INTEGER,
ADD COLUMN     "registeredById" UUID,
ADD COLUMN     "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED';

-- CreateTable
CREATE TABLE "SwimLevel" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "program" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "minAgeMonths" INTEGER NOT NULL,
    "maxAgeMonths" INTEGER,
    "parentInWater" BOOLEAN NOT NULL DEFAULT false,
    "ratio" INTEGER NOT NULL DEFAULT 6,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SwimLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonCampaign" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "kind" "CampaignKind" NOT NULL DEFAULT 'LESSONS',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "registrationOpensAt" TIMESTAMPTZ(3),
    "registrationClosesAt" TIMESTAMPTZ(3),
    "skipDates" DATE[],
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "email" TEXT,
    "phone" TEXT,
    "safetyNote" TEXT,
    "photoConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID,
    "kind" "FeeKind" NOT NULL,
    "period" "FeePeriod" NOT NULL DEFAULT 'NONE',
    "ageGroup" TEXT NOT NULL DEFAULT 'ALL',
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "priceCents" INTEGER NOT NULL,
    "visits" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "householdId" UUID,
    "memberId" UUID,
    "feeId" UUID,
    "enrollmentId" UUID,
    "facilityId" UUID,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "paymentMethod" TEXT NOT NULL,
    "soldById" UUID NOT NULL,
    "refundedAt" TIMESTAMPTZ(3),
    "refundedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SwimLevel_tenantId_program_name_key" ON "SwimLevel"("tenantId", "program", "name");

-- CreateIndex
CREATE INDEX "LessonCampaign_tenantId_status_idx" ON "LessonCampaign"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Household_tenantId_name_idx" ON "Household"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Member_tenantId_lastName_idx" ON "Member"("tenantId", "lastName");

-- CreateIndex
CREATE INDEX "Member_householdId_idx" ON "Member"("householdId");

-- CreateIndex
CREATE INDEX "FeeItem_tenantId_kind_idx" ON "FeeItem"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "Sale_tenantId_createdAt_idx" ON "Sale"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_householdId_idx" ON "Sale"("householdId");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

