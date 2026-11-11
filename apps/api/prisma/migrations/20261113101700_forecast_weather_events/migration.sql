-- CreateEnum
CREATE TYPE "FacilityExposure" AS ENUM ('INDOOR', 'OUTDOOR', 'MIXED');

-- CreateEnum
CREATE TYPE "VenueKind" AS ENUM ('POOL', 'PARK', 'BEACH', 'ARENA', 'COMMUNITY_CENTRE', 'OTHER');

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "exposure" "FacilityExposure" NOT NULL DEFAULT 'INDOOR',
ADD COLUMN     "venueKind" "VenueKind" NOT NULL DEFAULT 'POOL',
ADD COLUMN     "weatherSite" TEXT,
ADD COLUMN     "weatherSiteAuto" TEXT;

-- CreateTable
CREATE TABLE "SpecialEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "extraPeople" INTEGER,
    "percent" INTEGER,
    "recursYearly" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SpecialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherSite" (
    "site" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFr" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "climateId" TEXT,
    "lastFetchAt" TIMESTAMPTZ(3),
    "lastOkAt" TIMESTAMPTZ(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherSite_pkey" PRIMARY KEY ("site")
);

-- CreateTable
CREATE TABLE "WeatherForecastDay" (
    "site" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "high" INTEGER,
    "low" INTEGER,
    "pop" INTEGER,
    "iconCode" INTEGER,
    "condition" TEXT NOT NULL,
    "summaryEn" TEXT,
    "summaryFr" TEXT,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WeatherForecastDay_pkey" PRIMARY KEY ("site","date")
);

-- CreateTable
CREATE TABLE "WeatherObservation" (
    "site" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "precipMm" DOUBLE PRECISION,
    "snowCm" DOUBLE PRECISION,
    "condition" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WeatherObservation_pkey" PRIMARY KEY ("site","date")
);

-- CreateIndex
CREATE INDEX "SpecialEvent_tenantId_facilityId_idx" ON "SpecialEvent"("tenantId", "facilityId");

