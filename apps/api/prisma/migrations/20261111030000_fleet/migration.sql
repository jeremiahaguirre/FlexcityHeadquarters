-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'MINOR', 'MAJOR');

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "hoursOfService" JSONB;

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID,
    "unit" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "plate" TEXT,
    "certificationId" UUID,
    "outOfServiceAt" TIMESTAMPTZ(3),
    "outOfServiceReason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleInspection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "odometerKm" INTEGER,
    "items" JSONB NOT NULL,
    "result" "InspectionResult" NOT NULL,
    "notes" TEXT,
    "repairedAt" TIMESTAMPTZ(3),
    "repairedById" UUID,
    "repairNote" TEXT,

    CONSTRAINT "VehicleInspection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_tenantId_unit_key" ON "Vehicle"("tenantId", "unit");

-- CreateIndex
CREATE INDEX "VehicleInspection_tenantId_vehicleId_at_idx" ON "VehicleInspection"("tenantId", "vehicleId", "at");

