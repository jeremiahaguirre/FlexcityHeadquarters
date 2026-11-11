-- CreateEnum
CREATE TYPE "BidRoundKind" AS ENUM ('SHIFTS', 'LINES');

-- CreateEnum
CREATE TYPE "BidRoundStatus" AS ENUM ('OPEN', 'REVIEW', 'AWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SeniorityBasis" AS ENUM ('DATE', 'HOURS');

-- CreateTable
CREATE TABLE "BidRound" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BidRoundKind" NOT NULL,
    "departmentId" UUID,
    "positionIds" UUID[],
    "opensAt" TIMESTAMPTZ(3) NOT NULL,
    "closesAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "BidRoundStatus" NOT NULL DEFAULT 'OPEN',
    "maxAwardsPerPerson" INTEGER NOT NULL DEFAULT 1,
    "seniorityBasis" "SeniorityBasis" NOT NULL DEFAULT 'DATE',
    "templateId" UUID,
    "rangeFrom" DATE,
    "rangeTo" DATE,
    "openedNotifiedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "confirmedById" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "shiftIds" UUID[],
    "positionId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "firstStartsAt" TIMESTAMPTZ(3) NOT NULL,
    "lastEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BidItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidChoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidEntrant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "seniorityRank" INTEGER NOT NULL,
    "seniorityDate" DATE,
    "seniorityHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "hireDate" DATE,
    "tiebreak" TEXT NOT NULL,
    "outcomes" JSONB NOT NULL DEFAULT '[]',
    "notifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BidEntrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidAward" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "pass" INTEGER NOT NULL DEFAULT 1,
    "choiceRank" INTEGER,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overriddenById" UUID,
    "previousUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidRound_tenantId_status_closesAt_idx" ON "BidRound"("tenantId", "status", "closesAt");

-- CreateIndex
CREATE INDEX "BidItem_roundId_idx" ON "BidItem"("roundId");

-- CreateIndex
CREATE INDEX "BidChoice_roundId_userId_idx" ON "BidChoice"("roundId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BidChoice_roundId_userId_itemId_key" ON "BidChoice"("roundId", "userId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "BidEntrant_roundId_userId_key" ON "BidEntrant"("roundId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BidAward_roundId_itemId_key" ON "BidAward"("roundId", "itemId");

-- AddForeignKey
ALTER TABLE "BidItem" ADD CONSTRAINT "BidItem_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BidRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidChoice" ADD CONSTRAINT "BidChoice_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BidRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidEntrant" ADD CONSTRAINT "BidEntrant_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BidRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidAward" ADD CONSTRAINT "BidAward_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BidRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

