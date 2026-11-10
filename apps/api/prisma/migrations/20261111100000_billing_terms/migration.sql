-- Billing terms: monthly, yearly or whole-term invoicing, a committed term, and its discount.
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL', 'TERM');
ALTER TABLE "BillingAccount"
  ADD COLUMN "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "termMonths" INTEGER,
  ADD COLUMN "termStart" DATE,
  ADD COLUMN "discountPercent" DECIMAL(5,2);
