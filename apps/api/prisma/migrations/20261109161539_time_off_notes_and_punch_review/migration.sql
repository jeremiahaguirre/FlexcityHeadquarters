-- AlterTable
ALTER TABLE "TimeOffRequest" ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "TimePunch" ADD COLUMN     "reviewedAt" TIMESTAMPTZ(3),
ADD COLUMN     "reviewedById" UUID;
