-- City-defined leave types (expand only: nothing is dropped or renamed).
-- LeaveEntitlement.type becomes optional (the organization's own types have none); every existing
-- row keeps its value. The six system types are seeded for every organization and existing requests
-- and entitlements are linked to them, so balances and behaviour stay exactly as they were. Old app
-- versions keep reading and writing "type" as before during a rolling deploy.

-- AlterEnum
ALTER TYPE "PayCodeKey" ADD VALUE 'LEAVE_PAY';

-- AlterTable
ALTER TABLE "LeaveEntitlement" ADD COLUMN     "leaveTypeId" UUID,
ALTER COLUMN "type" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TimeOffRequest" ADD COLUMN     "approvalStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "chargedDays" JSONB,
ADD COLUMN     "leaveTypeId" UUID;

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "system" "TimeOffType",
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "hasBalance" BOOLEAN NOT NULL DEFAULT false,
    "yearlyHours" DECIMAL(8,2),
    "carryOverMaxHours" DECIMAL(8,2),
    "protectedLeave" BOOLEAN NOT NULL DEFAULT false,
    "approvalChain" JSONB NOT NULL DEFAULT '[]',
    "payCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_tenantId_code_key" ON "LeaveType"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_tenantId_system_key" ON "LeaveType"("tenantId", "system");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveEntitlement_userId_year_leaveTypeId_key" ON "LeaveEntitlement"("userId", "year", "leaveTypeId");

-- CreateIndex
CREATE INDEX "TimeOffRequest_leaveTypeId_idx" ON "TimeOffRequest"("leaveTypeId");

-- AddForeignKey
ALTER TABLE "TimeOffRequest" ADD CONSTRAINT "TimeOffRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: the six system types for every existing organization (new ones: services/people/leaveTypes.ts ensureLeaveTypes).
INSERT INTO "LeaveType" ("id", "tenantId", "system", "code", "name", "nameFr", "paid", "hasBalance", "protectedLeave", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), t."id", v.sys::"TimeOffType", v.sys, v.name, v.name_fr, v.paid, v.balance, v.protected, v.ord, CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
  ('VACATION', 'Vacation', 'Vacances', true, true, false, 1),
  ('SICK', 'Sick day', 'Congé de maladie', true, true, true, 2),
  ('PROTECTED_LEAVE', 'Protected leave', 'Congé protégé', false, true, true, 3),
  ('UNPAID_PERSONAL', 'Unpaid personal day', 'Congé personnel non payé', false, true, false, 4),
  ('OTHER', 'Other', 'Autre', false, true, false, 5),
  ('LIEU', 'Time in lieu', 'Congé compensatoire', true, false, false, 6)
) AS v(sys, name, name_fr, paid, balance, protected, ord)
ON CONFLICT DO NOTHING;

-- Backfill (data only, additive): link existing requests and entitlements to their system type.
UPDATE "TimeOffRequest" r SET "leaveTypeId" = lt."id"
FROM "LeaveType" lt WHERE lt."tenantId" = r."tenantId" AND lt."system" = r."type" AND r."leaveTypeId" IS NULL;
UPDATE "LeaveEntitlement" e SET "leaveTypeId" = lt."id"
FROM "LeaveType" lt WHERE lt."tenantId" = e."tenantId" AND lt."system" = e."type" AND e."leaveTypeId" IS NULL;
