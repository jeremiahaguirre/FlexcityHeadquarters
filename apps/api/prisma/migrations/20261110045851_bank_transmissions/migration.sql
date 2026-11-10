-- CreateEnum
CREATE TYPE "TransmissionStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "PayTransmission" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "payRunId" UUID NOT NULL,
    "sentById" UUID,
    "method" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL,
    "status" "TransmissionStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayTransmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayTransmission_payRunId_idx" ON "PayTransmission"("payRunId");

-- AddForeignKey
ALTER TABLE "PayTransmission" ADD CONSTRAINT "PayTransmission_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

