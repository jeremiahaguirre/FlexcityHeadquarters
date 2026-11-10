-- CreateEnum
CREATE TYPE "BenefitKind" AS ENUM ('PENSION', 'HEALTH', 'DENTAL', 'LIFE', 'DISABILITY', 'UNION_DUES', 'EAP', 'OTHER');

-- CreateTable
CREATE TABLE "BenefitPlan" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "kind" "BenefitKind" NOT NULL,
    "provider" TEXT,
    "employeePercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "employeeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "employerPercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "employerAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "employerTaxable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitEnrollment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "coverage" TEXT,
    "employeeAmount" DECIMAL(10,2),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BenefitPlan_tenantId_name_key" ON "BenefitPlan"("tenantId", "name");

-- CreateIndex
CREATE INDEX "BenefitEnrollment_userId_idx" ON "BenefitEnrollment"("userId");

-- CreateIndex
CREATE INDEX "BenefitEnrollment_planId_idx" ON "BenefitEnrollment"("planId");

-- AddForeignKey
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BenefitPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

