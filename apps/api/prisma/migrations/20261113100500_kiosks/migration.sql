-- AlterTable
ALTER TABLE "TimePunch" ADD COLUMN     "kioskId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kioskPinHash" TEXT;

-- CreateTable
CREATE TABLE "Kiosk" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Kiosk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Kiosk_tokenHash_key" ON "Kiosk"("tokenHash");

-- CreateIndex
CREATE INDEX "Kiosk_tenantId_facilityId_idx" ON "Kiosk"("tenantId", "facilityId");

