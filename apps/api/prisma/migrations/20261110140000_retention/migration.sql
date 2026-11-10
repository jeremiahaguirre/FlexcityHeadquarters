-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "retentionSettings" JSONB NOT NULL DEFAULT '{}';

