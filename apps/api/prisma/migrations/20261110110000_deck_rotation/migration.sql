-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "maxOnChairMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "rotationMinutes" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "DeckStation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "poolBodyId" UUID,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeckStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "stationId" UUID,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "recordedById" UUID NOT NULL,
    "overdueNotifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RotationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeckStation_facilityId_idx" ON "DeckStation"("facilityId");

-- CreateIndex
CREATE INDEX "RotationLog_facilityId_startedAt_idx" ON "RotationLog"("facilityId", "startedAt");

-- CreateIndex
CREATE INDEX "RotationLog_userId_startedAt_idx" ON "RotationLog"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "DeckStation" ADD CONSTRAINT "DeckStation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

