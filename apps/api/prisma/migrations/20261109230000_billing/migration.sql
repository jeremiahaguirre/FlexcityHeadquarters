-- CreateEnum
CREATE TYPE "BillingPlan" AS ENUM ('MUNICIPAL', 'CLUB');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOID');

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "billingMonthlyCents" INTEGER,
ADD COLUMN     "billingTier" INTEGER;

-- CreateTable
CREATE TABLE "BillingAccount" (
    "tenantId" UUID NOT NULL,
    "plan" "BillingPlan" NOT NULL DEFAULT 'MUNICIPAL',
    "legalName" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "province" TEXT NOT NULL,
    "postalCode" TEXT,
    "poNumber" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "taxExemptNote" TEXT,
    "addOnHr" BOOLEAN NOT NULL DEFAULT false,
    "addOnOps" BOOLEAN NOT NULL DEFAULT false,
    "clubUserRateCents" INTEGER NOT NULL DEFAULT 500,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "issueDate" DATE,
    "dueDate" DATE,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxLines" JSONB NOT NULL DEFAULT '[]',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "billTo" JSONB NOT NULL,
    "poNumber" TEXT,
    "notes" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "paidAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "receivedOn" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_periodStart_idx" ON "Invoice"("tenantId", "periodStart");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

