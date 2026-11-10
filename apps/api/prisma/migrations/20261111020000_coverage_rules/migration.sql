-- CreateTable
CREATE TABLE "CoverageRule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "certificationId" UUID NOT NULL,
    "minCount" INTEGER NOT NULL DEFAULT 1,
    "daysOfWeek" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastAlertedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoverageRule_tenantId_facilityId_idx" ON "CoverageRule"("tenantId", "facilityId");

