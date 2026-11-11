-- CreateEnum
CREATE TYPE "MfaChannel" AS ENUM ('EMAIL', 'SMS');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "mfaCodes" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "MfaCode" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "MfaChannel" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MfaCode_userId_createdAt_idx" ON "MfaCode"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MfaCode" ADD CONSTRAINT "MfaCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

