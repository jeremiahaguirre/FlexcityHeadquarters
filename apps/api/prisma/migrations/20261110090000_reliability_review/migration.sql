-- AlterTable
ALTER TABLE "ReliabilityEvent" ADD COLUMN     "excusedAt" TIMESTAMPTZ(3),
ADD COLUMN     "excusedById" UUID,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "recordedById" UUID;

