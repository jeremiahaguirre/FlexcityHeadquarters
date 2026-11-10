-- CreateEnum
CREATE TYPE "PayeeKind" AS ENUM ('PERSON', 'BUSINESS');

-- CreateTable
CREATE TABLE "Payee" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "PayeeKind" NOT NULL DEFAULT 'PERSON',
    "firstName" TEXT,
    "lastName" TEXT,
    "businessName" TEXT,
    "businessNumber" TEXT,
    "sinLast3" TEXT,
    "sinCiphertext" BYTEA,
    "sinIv" BYTEA,
    "sinAuthTag" BYTEA,
    "sinWrappedKey" BYTEA,
    "sinKekId" TEXT,
    "address" JSONB,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Payee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayeePayment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "payeeId" UUID NOT NULL,
    "paidOn" DATE NOT NULL,
    "box" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "taxWithheld" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payee_tenantId_idx" ON "Payee"("tenantId");

-- CreateIndex
CREATE INDEX "PayeePayment_tenantId_paidOn_idx" ON "PayeePayment"("tenantId", "paidOn");

-- AddForeignKey
ALTER TABLE "PayeePayment" ADD CONSTRAINT "PayeePayment_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Payee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

