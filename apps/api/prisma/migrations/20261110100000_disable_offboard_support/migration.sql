-- CreateEnum
CREATE TYPE "SupportLevel" AS ENUM ('SETUP', 'FULL');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "deleteAfter" DATE,
ADD COLUMN     "disabledAt" TIMESTAMPTZ(3),
ADD COLUMN     "disabledReason" TEXT,
ADD COLUMN     "offboardedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "SupportGrant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "grantedById" UUID NOT NULL,
    "level" "SupportLevel" NOT NULL DEFAULT 'SETUP',
    "reason" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportGrant_tenantId_expiresAt_idx" ON "SupportGrant"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportSession_codeHash_key" ON "SupportSession"("codeHash");

-- CreateIndex
CREATE INDEX "SupportSession_tenantId_idx" ON "SupportSession"("tenantId");

