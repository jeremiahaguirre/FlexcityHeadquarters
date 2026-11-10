-- CreateEnum
CREATE TYPE "SmsKind" AS ENUM ('TEXT', 'CALL');

-- AlterEnum
ALTER TYPE "AuthTokenPurpose" ADD VALUE 'SMS_VERIFY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "smsPhone" TEXT,
ADD COLUMN     "smsUrgentShifts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsVerifiedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "SmsOutbox" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "toPhone" TEXT NOT NULL,
    "kind" "SmsKind" NOT NULL DEFAULT 'TEXT',
    "template" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "locale" TEXT NOT NULL DEFAULT 'en-CA',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsOutbox_tenantId_sentAt_idx" ON "SmsOutbox"("tenantId", "sentAt");

