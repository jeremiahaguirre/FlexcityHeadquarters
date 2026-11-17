-- Expense claims paid through a payroll provider (ADP, Dayforce, Wagepoint): the reimbursement pay
-- code, and which provider send paid each claim.
ALTER TYPE "PayCodeKey" ADD VALUE IF NOT EXISTS 'REIMBURSEMENT';
ALTER TABLE "ExpenseClaim" ADD COLUMN "payrollSyncId" UUID;
