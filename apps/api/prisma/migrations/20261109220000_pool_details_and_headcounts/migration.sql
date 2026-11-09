-- AlterTable
ALTER TABLE "PoolBody" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "depthMaxM" DECIMAL(4,2),
ADD COLUMN     "depthMinM" DECIMAL(4,2),
ADD COLUMN     "maxCapacity" INTEGER,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "volumeLitres" INTEGER;

-- CreateTable
CREATE TABLE "HeadCount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "poolBodyId" UUID NOT NULL,
    "count" INTEGER NOT NULL,
    "overCapacity" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeadCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeadCount_poolBodyId_recordedAt_idx" ON "HeadCount"("poolBodyId", "recordedAt");

-- CreateIndex
CREATE INDEX "HeadCount_tenantId_recordedAt_idx" ON "HeadCount"("tenantId", "recordedAt");

-- AddForeignKey
ALTER TABLE "HeadCount" ADD CONSTRAINT "HeadCount_poolBodyId_fkey" FOREIGN KEY ("poolBodyId") REFERENCES "PoolBody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

