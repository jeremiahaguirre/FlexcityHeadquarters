-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "apiKeyId" UUID;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "preferredName" TEXT;

-- CreateTable
CREATE TABLE "ApiIdempotencyKey" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "apiKeyId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" INTEGER,
    "response" JSONB,
    "etag" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApiIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiIdempotencyKey_tenantId_expiresAt_idx" ON "ApiIdempotencyKey"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiIdempotencyKey_tenantId_apiKeyId_key_key" ON "ApiIdempotencyKey"("tenantId", "apiKeyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenantId_externalId_key" ON "Department"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_tenantId_externalId_key" ON "Position"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_externalId_key" ON "User"("tenantId", "externalId");

