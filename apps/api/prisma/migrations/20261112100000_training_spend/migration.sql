-- CreateEnum
CREATE TYPE "TrainingSpendKind" AS ENUM ('COURSE_FEES', 'TRAINER', 'WAGES_IN_TRAINING', 'TRAVEL', 'MATERIALS', 'OTHER');

-- CreateTable
CREATE TABLE "TrainingSpend" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "spentOn" DATE NOT NULL,
    "category" "TrainingSpendKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "trainingRecordId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingSpend_tenantId_year_idx" ON "TrainingSpend"("tenantId", "year");

