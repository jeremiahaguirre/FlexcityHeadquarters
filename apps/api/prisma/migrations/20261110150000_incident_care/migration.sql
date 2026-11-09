-- CreateEnum
CREATE TYPE "CareStatus" AS ENUM ('OFFERED', 'CHECKED_IN', 'DECLINED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "careSettings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "CareCheckIn" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "status" "CareStatus" NOT NULL DEFAULT 'OFFERED',
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "breakAskedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "completedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareCheckIn_status_dueAt_idx" ON "CareCheckIn"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CareCheckIn_incidentId_userId_key" ON "CareCheckIn"("incidentId", "userId");

