-- AlterTable
ALTER TABLE "LoneWorkSession" ADD COLUMN     "locationAt" TIMESTAMPTZ(3),
ADD COLUMN     "remindedAt" TIMESTAMPTZ(3),
ADD COLUMN     "shareLocation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "pushedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "device" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMPTZ(3),
    "failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_tenantId_userId_idx" ON "PushSubscription"("tenantId", "userId");

