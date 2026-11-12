-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "featureChoices" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ReleaseRing" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseRing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseRingMember" (
    "tenantId" UUID NOT NULL,
    "ringId" UUID NOT NULL,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseRingMember_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "summaryEn" TEXT NOT NULL,
    "summaryFr" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseStage" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "ringId" UUID NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "noticeDays" INTEGER NOT NULL DEFAULT 7,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "appliedAt" TIMESTAMPTZ(3),
    "rolledBackAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseChange" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT NOT NULL,
    "summaryEn" TEXT NOT NULL,
    "summaryFr" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "skipped" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "previous" JSONB,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "noticeSentAt" TIMESTAMPTZ(3),
    "appliedAt" TIMESTAMPTZ(3),
    "rolledBackAt" TIMESTAMPTZ(3),

    CONSTRAINT "ReleaseChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseRing_name_key" ON "ReleaseRing"("name");

-- CreateIndex
CREATE INDEX "ReleaseRingMember_ringId_idx" ON "ReleaseRingMember"("ringId");

-- CreateIndex
CREATE INDEX "ReleaseStage_status_scheduledAt_idx" ON "ReleaseStage"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseStage_releaseId_ringId_key" ON "ReleaseStage"("releaseId", "ringId");

-- CreateIndex
CREATE INDEX "ReleaseChange_tenantId_status_idx" ON "ReleaseChange"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ReleaseChange_status_scheduledAt_idx" ON "ReleaseChange"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseChange_stageId_tenantId_key" ON "ReleaseChange"("stageId", "tenantId");

-- AddForeignKey
ALTER TABLE "ReleaseRingMember" ADD CONSTRAINT "ReleaseRingMember_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "ReleaseRing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseStage" ADD CONSTRAINT "ReleaseStage_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseChange" ADD CONSTRAINT "ReleaseChange_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ReleaseStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Switches the Dev console already set for an organization count as chosen on purpose (from its audit log).
UPDATE "Tenant" t SET "featureChoices" = c.keys
FROM (
  SELECT a."tenantId", array_agg(DISTINCT k ORDER BY k) AS keys
  FROM "PlatformAudit" a, jsonb_object_keys(CASE WHEN jsonb_typeof(a."detail"->'features') = 'object' THEN a."detail"->'features' ELSE '{}'::jsonb END) AS k
  WHERE a."action" = 'tenant.features' AND a."tenantId" IS NOT NULL
  GROUP BY a."tenantId"
) c
WHERE c."tenantId" = t."id";
