-- AlterEnum
ALTER TYPE "TimeOffType" ADD VALUE 'LIEU';

-- AlterTable
ALTER TABLE "PayAdjustment" ADD COLUMN     "hours" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bankOvertime" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bankOvertimeAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "LieuAdjustment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LieuAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LieuAdjustment_tenantId_userId_idx" ON "LieuAdjustment"("tenantId", "userId");

