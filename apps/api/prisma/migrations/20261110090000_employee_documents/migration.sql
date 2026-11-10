-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('MEDICAL_NOTE', 'CERTIFICATE', 'IDENTIFICATION', 'CONTRACT', 'POLICY', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('HR', 'DEPARTMENT');

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'HR',
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "wrappedKey" BYTEA NOT NULL,
    "kekId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),
    "deletedById" UUID,
    "deletedReason" TEXT,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeDocument_tenantId_userId_idx" ON "EmployeeDocument"("tenantId", "userId");

