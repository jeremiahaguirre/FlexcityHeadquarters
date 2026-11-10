-- AlterTable
ALTER TABLE "PayRun" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'REGULAR',
ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "Salary" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "annualAmount" DECIMAL(12,2) NOT NULL,
    "weeklyHours" DECIMAL(5,2) NOT NULL DEFAULT 37.5,
    "overtimeEligible" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Salary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayAdjustment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "payRunId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "positionId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayDeductionOrder" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "reference" TEXT,
    "amountPerPay" DECIMAL(12,2),
    "percentOfNet" DECIMAL(5,2),
    "maxPercentOfNet" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "totalOwed" DECIMAL(12,2),
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayDeductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Salary_tenantId_userId_effectiveFrom_idx" ON "Salary"("tenantId", "userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PayAdjustment_tenantId_payRunId_idx" ON "PayAdjustment"("tenantId", "payRunId");

-- CreateIndex
CREATE INDEX "PayDeductionOrder_tenantId_userId_idx" ON "PayDeductionOrder"("tenantId", "userId");

