-- CreateEnum
CREATE TYPE "BidAwardOrder" AS ENUM ('ROUND_ROBIN', 'SENIOR_FIRST');

-- AlterTable
ALTER TABLE "BidRound" ADD COLUMN     "awardOrder" "BidAwardOrder" NOT NULL DEFAULT 'ROUND_ROBIN';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adultConfirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "adultConfirmedById" UUID,
ADD COLUMN     "adultConfirmedNote" TEXT;

