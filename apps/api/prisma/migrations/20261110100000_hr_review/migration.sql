-- CreateEnum
CREATE TYPE "DisciplineLevel" AS ENUM ('COACHING', 'VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'SUSPENSION', 'TERMINATION');

-- CreateEnum
CREATE TYPE "ConductCategory" AS ENUM ('SAFETY_PROCEDURE', 'POLICY', 'CONDUCT', 'PERFORMANCE', 'COMMENDATION');

-- AlterTable
ALTER TABLE "DisciplinaryRecord" ADD COLUMN     "employeeResponse" TEXT,
ADD COLUMN     "evidence" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "fairProcess" JSONB,
ADD COLUMN     "level" "DisciplineLevel",
ADD COLUMN     "respondedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reviewFlaggedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "ConductNote" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recordedById" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "category" "ConductCategory" NOT NULL,
    "summary" TEXT NOT NULL,
    "incidentId" UUID,
    "retractedAt" TIMESTAMPTZ(3),
    "retractedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConductNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConductNote_userId_occurredAt_idx" ON "ConductNote"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ConductNote" ADD CONSTRAINT "ConductNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

