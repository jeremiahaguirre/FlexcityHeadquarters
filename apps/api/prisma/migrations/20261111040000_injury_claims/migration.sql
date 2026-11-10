-- CreateEnum
CREATE TYPE "InjuryClaimStatus" AS ENUM ('OPEN', 'FILED', 'NOT_REQUIRED');

-- CreateTable
CREATE TABLE "InjuryClaim" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "incidentId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "learnedAt" TIMESTAMPTZ(3) NOT NULL,
    "province" "Province" NOT NULL,
    "board" TEXT NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "lostTime" BOOLEAN NOT NULL DEFAULT false,
    "healthCare" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "status" "InjuryClaimStatus" NOT NULL DEFAULT 'OPEN',
    "claimNumber" TEXT,
    "filedAt" TIMESTAMPTZ(3),
    "filedById" UUID,
    "accommodationId" UUID,
    "createdById" UUID NOT NULL,
    "reminderSentAt" TIMESTAMPTZ(3),
    "overdueSentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InjuryClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InjuryClaim_tenantId_status_dueAt_idx" ON "InjuryClaim"("tenantId", "status", "dueAt");

