-- CreateEnum
CREATE TYPE "CallOutStatus" AS ENUM ('OPEN', 'FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallOutContactStatus" AS ENUM ('WAITING', 'OFFERED', 'ACCEPTED', 'DECLINED', 'NO_ANSWER', 'SKIPPED', 'NOT_NEEDED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "winterSettings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "CallOut" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "responseMinutes" INTEGER NOT NULL,
    "status" "CallOutStatus" NOT NULL DEFAULT 'OPEN',
    "filledUserId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CallOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallOutContact" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "callOutId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "status" "CallOutContactStatus" NOT NULL DEFAULT 'WAITING',
    "skipReason" TEXT,
    "offeredAt" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "recordedById" UUID,

    CONSTRAINT "CallOutContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatrolRoute" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "roadClass" TEXT,
    "intervalHours" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatrolRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatrolRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "conditions" TEXT[],
    "actions" TEXT[],
    "snowCm" DECIMAL(5,1),
    "airTempC" DECIMAL(4,1),
    "roadTempC" DECIMAL(4,1),
    "materialTonnes" DECIMAL(7,2),
    "vehicle" TEXT,
    "notes" TEXT,
    "startLat" DECIMAL(9,6),
    "startLng" DECIMAL(9,6),
    "endLat" DECIMAL(9,6),
    "endLng" DECIMAL(9,6),

    CONSTRAINT "PatrolRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallOut_tenantId_status_createdAt_idx" ON "CallOut"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CallOutContact_callOutId_rank_idx" ON "CallOutContact"("callOutId", "rank");

-- CreateIndex
CREATE INDEX "CallOutContact_tenantId_status_offeredAt_idx" ON "CallOutContact"("tenantId", "status", "offeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatrolRoute_tenantId_name_key" ON "PatrolRoute"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PatrolRecord_tenantId_routeId_startedAt_idx" ON "PatrolRecord"("tenantId", "routeId", "startedAt");

-- CreateIndex
CREATE INDEX "PatrolRecord_userId_startedAt_idx" ON "PatrolRecord"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "CallOutContact" ADD CONSTRAINT "CallOutContact_callOutId_fkey" FOREIGN KEY ("callOutId") REFERENCES "CallOut"("id") ON DELETE CASCADE ON UPDATE CASCADE;

