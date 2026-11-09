-- AlterEnum
ALTER TYPE "AccessRole" ADD VALUE 'EMPLOYEE';

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "description" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCustomRole" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "customRoleId" UUID NOT NULL,

    CONSTRAINT "UserCustomRole_pkey" PRIMARY KEY ("userId","customRoleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_tenantId_name_key" ON "CustomRole"("tenantId", "name");

-- CreateIndex
CREATE INDEX "UserCustomRole_tenantId_customRoleId_idx" ON "UserCustomRole"("tenantId", "customRoleId");

-- AddForeignKey
ALTER TABLE "UserCustomRole" ADD CONSTRAINT "UserCustomRole_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

