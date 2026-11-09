-- CreateEnum
CREATE TYPE "OnboardingOwner" AS ENUM ('HR', 'SUPERVISOR', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "OnboardingKind" AS ENUM ('CHECK', 'TRAINING', 'ACKNOWLEDGEMENT', 'DOCUMENT', 'TASK');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('COMPLETE', 'WAIVED');

-- CreateTable
CREATE TABLE "OnboardingItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "description" TEXT,
    "descriptionFr" TEXT,
    "owner" "OnboardingOwner" NOT NULL,
    "kind" "OnboardingKind" NOT NULL,
    "allStaff" BOOLEAN NOT NULL DEFAULT false,
    "blocksScheduling" BOOLEAN NOT NULL DEFAULT false,
    "validityMonths" INTEGER,
    "policyText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionOnboarding" (
    "tenantId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,

    CONSTRAINT "PositionOnboarding_pkey" PRIMARY KEY ("positionId","itemId")
);

-- CreateTable
CREATE TABLE "OnboardingRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "status" "OnboardingStatus" NOT NULL,
    "completedOn" DATE NOT NULL,
    "expiresOn" DATE,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "waivedReason" TEXT,
    "reminderSentAt" TIMESTAMPTZ(3),

    CONSTRAINT "OnboardingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingItem_tenantId_key_key" ON "OnboardingItem"("tenantId", "key");

-- CreateIndex
CREATE INDEX "OnboardingRecord_userId_itemId_idx" ON "OnboardingRecord"("userId", "itemId");

-- AddForeignKey
ALTER TABLE "PositionOnboarding" ADD CONSTRAINT "PositionOnboarding_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOnboarding" ADD CONSTRAINT "PositionOnboarding_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OnboardingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingRecord" ADD CONSTRAINT "OnboardingRecord_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OnboardingItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingRecord" ADD CONSTRAINT "OnboardingRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

