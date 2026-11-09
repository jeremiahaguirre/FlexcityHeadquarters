-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "roleOverrides" JSONB NOT NULL DEFAULT '{}';

