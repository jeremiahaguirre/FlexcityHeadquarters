-- CreateEnum
CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "payrollSettings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "PayProfile" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "province" "Province",
    "federalClaim" DECIMAL(12,2),
    "provincialClaim" DECIMAL(12,2),
    "extraTaxPerPeriod" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cppExempt" BOOLEAN NOT NULL DEFAULT false,
    "eiExempt" BOOLEAN NOT NULL DEFAULT false,
    "sinCiphertext" BYTEA,
    "sinIv" BYTEA,
    "sinAuthTag" BYTEA,
    "sinWrappedKey" BYTEA,
    "sinKekId" TEXT,
    "sinLast3" TEXT,
    "td1SignedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PayProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "holderName" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "transit" TEXT NOT NULL,
    "accountCiphertext" BYTEA NOT NULL,
    "accountIv" BYTEA NOT NULL,
    "accountAuthTag" BYTEA NOT NULL,
    "accountWrappedKey" BYTEA NOT NULL,
    "accountKekId" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'PENDING',
    "consentText" TEXT NOT NULL,
    "consentAt" TIMESTAMPTZ(3) NOT NULL,
    "enteredById" UUID NOT NULL,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRun" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "departmentId" UUID,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "payDate" DATE NOT NULL,
    "periodsPerYear" INTEGER NOT NULL,
    "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "paidAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "totals" JSONB NOT NULL DEFAULT '{}',
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "fileCreationNumber" INTEGER,
    "depositFileSha256" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayStatement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "payRunId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "departmentId" UUID,
    "province" "Province" NOT NULL,
    "year" INTEGER NOT NULL,
    "payDate" DATE NOT NULL,
    "hours" DECIMAL(10,2) NOT NULL,
    "earnings" JSONB NOT NULL,
    "deductions" JSONB NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "totalDeductions" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "employerCpp" DECIMAL(12,2) NOT NULL,
    "employerEi" DECIMAL(12,2) NOT NULL,
    "ytd" JSONB NOT NULL,
    "bankAccountId" UUID,
    "depositLast4" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollTaxTable" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "verifiedBy" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PayrollTaxTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayProfile_userId_key" ON "PayProfile"("userId");

-- CreateIndex
CREATE INDEX "BankAccount_userId_status_idx" ON "BankAccount"("userId", "status");

-- CreateIndex
CREATE INDEX "PayRun_tenantId_periodStart_idx" ON "PayRun"("tenantId", "periodStart");

-- CreateIndex
CREATE INDEX "PayStatement_userId_year_idx" ON "PayStatement"("userId", "year");

-- CreateIndex
CREATE INDEX "PayStatement_payRunId_idx" ON "PayStatement"("payRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollTaxTable_year_jurisdiction_key" ON "PayrollTaxTable"("year", "jurisdiction");

-- AddForeignKey
ALTER TABLE "PayProfile" ADD CONSTRAINT "PayProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayStatement" ADD CONSTRAINT "PayStatement_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayStatement" ADD CONSTRAINT "PayStatement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

