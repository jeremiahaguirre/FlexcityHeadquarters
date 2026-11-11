-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY['trust.read', 'trust.manage']::TEXT[];

-- CreateTable
CREATE TABLE "TrustControlState" (
    "key" TEXT NOT NULL,
    "ownerId" UUID,
    "manualStatus" TEXT,
    "justification" TEXT,
    "notes" TEXT,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrustControlState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TrustTest" (
    "key" TEXT NOT NULL,
    "ownerId" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMPTZ(3),
    "lastStatus" TEXT,
    "lastSummary" TEXT,
    "lastDetails" JSONB,
    "alertedStatus" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrustTest_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TrustTestRun" (
    "id" UUID NOT NULL,
    "testKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "durationMs" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustScoreSnapshot" (
    "id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "frameworks" JSONB NOT NULL,
    "testsPass" INTEGER NOT NULL,
    "testsFail" INTEGER NOT NULL,
    "testsWarn" INTEGER NOT NULL,
    "controls" JSONB NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustEvidence" (
    "id" UUID NOT NULL,
    "controlKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "note" TEXT,
    "result" TEXT,
    "fileName" TEXT,
    "contentType" TEXT,
    "size" INTEGER,
    "sha256" TEXT,
    "ciphertext" BYTEA,
    "iv" BYTEA,
    "authTag" BYTEA,
    "wrappedKey" BYTEA,
    "kekId" TEXT,
    "testKey" TEXT,
    "validUntil" TIMESTAMPTZ(3),
    "addedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TrustEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustEvidenceRequest" (
    "id" UUID NOT NULL,
    "controlKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "ownerId" UUID,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "evidenceId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TrustEvidenceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustPolicy" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleFr" TEXT NOT NULL,
    "ownerId" UUID,
    "reviewEveryMonths" INTEGER NOT NULL DEFAULT 12,
    "nextReviewAt" TIMESTAMPTZ(3),
    "controlKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustPolicyVersion" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "bodyFr" TEXT NOT NULL,
    "changeNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TrustPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustPolicyAck" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustPolicyAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustRisk" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleFr" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "residualLikelihood" INTEGER NOT NULL,
    "residualImpact" INTEGER NOT NULL,
    "treatment" TEXT NOT NULL,
    "treatmentPlan" TEXT,
    "ownerId" UUID,
    "controlKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vendorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dueAt" TIMESTAMPTZ(3),
    "reviewEveryDays" INTEGER NOT NULL DEFAULT 90,
    "lastReviewedAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrustRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustVendor" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "purposeFr" TEXT,
    "criticality" TEXT NOT NULL,
    "dataAccessed" TEXT NOT NULL,
    "personalInfo" BOOLEAN NOT NULL DEFAULT false,
    "dataLocation" TEXT NOT NULL,
    "inCanada" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "dpaSignedAt" TIMESTAMPTZ(3),
    "dpaExpiresAt" TIMESTAMPTZ(3),
    "soc2ExpiresAt" TIMESTAMPTZ(3),
    "isoExpiresAt" TIMESTAMPTZ(3),
    "reviewEveryMonths" INTEGER NOT NULL DEFAULT 12,
    "lastReviewedAt" TIMESTAMPTZ(3),
    "nextReviewAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "questionnaire" JSONB,
    "score" INTEGER,
    "ownerId" UUID,
    "controlKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrustVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustCommitment" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "customer" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "source" TEXT,
    "dueAt" TIMESTAMPTZ(3),
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "ownerId" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "controlKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrustCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustCommitmentFulfilment" (
    "id" UUID NOT NULL,
    "commitmentId" UUID NOT NULL,
    "dueAt" TIMESTAMPTZ(3),
    "metAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "evidenceId" UUID,
    "byId" UUID,

    CONSTRAINT "TrustCommitmentFulfilment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustAnswer" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "questionFr" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "answerFr" TEXT NOT NULL,
    "controlKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastReviewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrustAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustReminder" (
    "id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "dueKey" TEXT NOT NULL,
    "daysBefore" INTEGER NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustAlert" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleFr" TEXT NOT NULL,
    "link" TEXT,
    "ownerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),
    "emailedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TrustAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "riskAppetite" INTEGER NOT NULL DEFAULT 12,
    "frameworks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrustSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerJobRun" (
    "name" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMPTZ(3),
    "lastOkAt" TIMESTAMPTZ(3),
    "lastErrorAt" TIMESTAMPTZ(3),
    "lastDurationMs" INTEGER,

    CONSTRAINT "WorkerJobRun_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "TrustTestRun_testKey_at_idx" ON "TrustTestRun"("testKey", "at");

-- CreateIndex
CREATE INDEX "TrustTestRun_at_idx" ON "TrustTestRun"("at");

-- CreateIndex
CREATE INDEX "TrustScoreSnapshot_at_idx" ON "TrustScoreSnapshot"("at");

-- CreateIndex
CREATE INDEX "TrustEvidence_controlKey_createdAt_idx" ON "TrustEvidence"("controlKey", "createdAt");

-- CreateIndex
CREATE INDEX "TrustEvidenceRequest_status_dueAt_idx" ON "TrustEvidenceRequest"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrustPolicy_key_key" ON "TrustPolicy"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TrustPolicyVersion_policyId_version_key" ON "TrustPolicyVersion"("policyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TrustPolicyAck_versionId_adminId_key" ON "TrustPolicyAck"("versionId", "adminId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustRisk_ref_key" ON "TrustRisk"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "TrustVendor_name_key" ON "TrustVendor"("name");

-- CreateIndex
CREATE INDEX "TrustCommitment_status_dueAt_idx" ON "TrustCommitment"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrustReminder_subject_dueKey_daysBefore_key" ON "TrustReminder"("subject", "dueKey", "daysBefore");

-- CreateIndex
CREATE INDEX "TrustAlert_createdAt_idx" ON "TrustAlert"("createdAt");

-- CreateIndex
CREATE INDEX "TrustAlert_emailedAt_idx" ON "TrustAlert"("emailedAt");

-- AddForeignKey
ALTER TABLE "TrustPolicyVersion" ADD CONSTRAINT "TrustPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "TrustPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustPolicyAck" ADD CONSTRAINT "TrustPolicyAck_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TrustPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustCommitmentFulfilment" ADD CONSTRAINT "TrustCommitmentFulfilment_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "TrustCommitment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

