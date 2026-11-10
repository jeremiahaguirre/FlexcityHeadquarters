-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "textSha256" TEXT NOT NULL,
    "signedName" TEXT NOT NULL,
    "signature" BYTEA NOT NULL,
    "signatureSha256" TEXT NOT NULL,
    "choices" JSONB NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_tenantId_signedAt_idx" ON "ConsentRecord"("tenantId", "signedAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_version_idx" ON "ConsentRecord"("userId", "version");

