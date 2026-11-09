-- AlterTable
ALTER TABLE "BillingAccount" ADD COLUMN     "addOnUnion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "graceDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "preferredPayment" TEXT NOT NULL DEFAULT 'INVOICE',
ADD COLUMN     "suspensionHoldUntil" TIMESTAMPTZ(3),
ADD COLUMN     "trialEndsAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "checkoutId" TEXT;

