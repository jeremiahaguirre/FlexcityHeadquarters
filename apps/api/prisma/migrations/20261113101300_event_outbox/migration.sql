-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'DELIVERED', 'DEAD');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "EventOutbox" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventOutbox_status_availableAt_idx" ON "EventOutbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "EventOutbox_tenantId_status_availableAt_idx" ON "EventOutbox"("tenantId", "status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_dedupeKey_key" ON "Notification"("tenantId", "dedupeKey");

