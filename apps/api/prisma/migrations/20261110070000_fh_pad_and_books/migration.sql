-- CreateEnum
CREATE TYPE "PadStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PadBatchStatus" AS ENUM ('CREATED', 'SENT', 'SETTLED');

-- CreateEnum
CREATE TYPE "PadDebitStatus" AS ENUM ('PENDING', 'SETTLED', 'RETURNED');

-- CreateTable
CREATE TABLE "PadAgreement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "status" "PadStatus" NOT NULL DEFAULT 'ACTIVE',
    "payorName" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerTitle" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "transit" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "accountSealed" JSONB NOT NULL,
    "agreementVersion" TEXT NOT NULL,
    "waivedPreNotice" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL,
    "authorizedBy" TEXT NOT NULL,
    "authorizedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,

    CONSTRAINT "PadAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PadBatch" (
    "id" UUID NOT NULL,
    "fileNumber" INTEGER NOT NULL,
    "debitDate" DATE NOT NULL,
    "status" "PadBatchStatus" NOT NULL DEFAULT 'CREATED',
    "totalCents" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "settledAt" TIMESTAMPTZ(3),

    CONSTRAINT "PadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PadDebit" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PadDebitStatus" NOT NULL DEFAULT 'PENDING',
    "returnReason" TEXT,
    "returnedOn" DATE,

    CONSTRAINT "PadDebit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FhBooks" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "accounts" JSONB NOT NULL DEFAULT '{}',
    "padOriginator" JSONB,
    "lastFileNumber" INTEGER NOT NULL DEFAULT 0,
    "fiscalYearStart" INTEGER NOT NULL DEFAULT 1,
    "closedThrough" DATE,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FhBooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FhJournalEntry" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "memo" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "reference" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FhJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PadAgreement_tenantId_status_idx" ON "PadAgreement"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PadDebit_invoiceId_idx" ON "PadDebit"("invoiceId");

-- AddForeignKey
ALTER TABLE "PadDebit" ADD CONSTRAINT "PadDebit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PadDebit" ADD CONSTRAINT "PadDebit_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "PadAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'other';

-- Existing lines: infer the kind from the wording.
UPDATE "InvoiceLine" SET "kind" = CASE
  WHEN "description" ILIKE '%Facility licence%' OR "description" ILIKE '%Licence d’installation%' THEN 'facility'
  WHEN "description" ILIKE 'Platform fee%' OR "description" ILIKE 'Frais de plateforme%' THEN 'club_base'
  WHEN "description" ILIKE 'Active users%' OR "description" ILIKE 'Utilisateurs actifs%' THEN 'club_users'
  WHEN "description" ILIKE 'HR Compliance%' OR "description" ILIKE 'Module Conformité%' THEN 'addon_hr'
  WHEN "description" ILIKE 'Operations add-on%' OR "description" ILIKE 'Module Opérations%' THEN 'addon_ops'
  WHEN "amountCents" < 0 THEN 'credit'
  ELSE 'other' END;
