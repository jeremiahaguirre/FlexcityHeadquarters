-- Custom fields on people. Additive only.
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'CHOICE', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "CustomFieldAccess" AS ENUM ('HR', 'MANAGER');

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelFr" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "choices" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "viewAccess" "CustomFieldAccess" NOT NULL DEFAULT 'HR',
    "editAccess" "CustomFieldAccess" NOT NULL DEFAULT 'HR',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fieldId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "value" TEXT,
    "valueCiphertext" BYTEA,
    "valueIv" BYTEA,
    "valueAuthTag" BYTEA,
    "valueWrappedKey" BYTEA,
    "valueKekId" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_tenantId_key_key" ON "CustomFieldDefinition"("tenantId", "key");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_userId_idx" ON "CustomFieldValue"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_fieldId_userId_key" ON "CustomFieldValue"("fieldId", "userId");

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A value is either plain text (a manager-level field) or sealed whole (an HR-only field), never both or half.
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_plain_or_sealed" CHECK (
  ("value" IS NOT NULL AND "valueCiphertext" IS NULL AND "valueIv" IS NULL AND "valueAuthTag" IS NULL AND "valueWrappedKey" IS NULL AND "valueKekId" IS NULL)
  OR ("value" IS NULL AND "valueCiphertext" IS NOT NULL AND "valueIv" IS NOT NULL AND "valueAuthTag" IS NOT NULL AND "valueWrappedKey" IS NOT NULL AND "valueKekId" IS NOT NULL)
);
