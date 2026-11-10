-- CreateTable
CREATE TABLE "Policy" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "textSha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "replacesId" UUID,
    "positionIds" UUID[],
    "dueDays" INTEGER,
    "createdById" UUID NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAck" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "signedName" TEXT NOT NULL,
    "textSha256" TEXT NOT NULL,
    "signedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Policy_tenantId_retiredAt_idx" ON "Policy"("tenantId", "retiredAt");

-- CreateIndex
CREATE INDEX "PolicyAck_tenantId_userId_idx" ON "PolicyAck"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAck_policyId_userId_key" ON "PolicyAck"("policyId", "userId");

-- AddForeignKey
ALTER TABLE "PolicyAck" ADD CONSTRAINT "PolicyAck_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

