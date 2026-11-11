-- AlterTable
ALTER TABLE "TimePunch" ADD COLUMN     "clientInId" UUID,
ADD COLUMN     "clientOutId" UUID,
ADD COLUMN     "clockInReceivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "clockOutReceivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "clockSkewS" INTEGER,
ADD COLUMN     "recordedOffline" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "TimePunch_tenantId_clientInId_key" ON "TimePunch"("tenantId", "clientInId");

-- CreateIndex
CREATE UNIQUE INDEX "TimePunch_tenantId_clientOutId_key" ON "TimePunch"("tenantId", "clientOutId");

