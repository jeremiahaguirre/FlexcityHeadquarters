-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NEW', 'REVIEWING', 'INTERVIEW', 'OFFERED', 'HIRED', 'DECLINED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "applyInApp" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "applyUrl" DROP NOT NULL;

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "postingId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT,
    "certifications" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "consentAt" TIMESTAMPTZ(3) NOT NULL,
    "resumeName" TEXT,
    "resumeType" TEXT,
    "resumeSize" INTEGER,
    "resumeSha256" TEXT,
    "ciphertext" BYTEA,
    "iv" BYTEA,
    "authTag" BYTEA,
    "wrappedKey" BYTEA,
    "kekId" TEXT,
    "hiredUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobApplication_tenantId_postingId_status_idx" ON "JobApplication"("tenantId", "postingId", "status");

