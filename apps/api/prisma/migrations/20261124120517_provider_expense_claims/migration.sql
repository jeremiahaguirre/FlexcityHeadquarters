-- Expense claims paid through a payroll provider (ADP, Dayforce, Wagepoint): the reimbursement pay
-- code, and which provider send paid each claim.
ALTER TYPE "PayCodeKey" ADD VALUE IF NOT EXISTS 'REIMBURSEMENT';
ALTER TABLE "ExpenseClaim" ADD COLUMN "payrollSyncId" UUID;
-- Held for a send in progress (cleared once it finishes; a send that never finishes lets go after 10 minutes).
ALTER TABLE "ExpenseClaim" ADD COLUMN "providerReservedAt" TIMESTAMPTZ(3);
