-- Names for the built-in roles: the organization's own, and which default words it uses. Additive only.

-- CreateEnum
CREATE TYPE "RoleVocabulary" AS ENUM ('AQUATIC', 'MUNICIPAL', 'PRIVATE');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "roleLabels" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "roleVocabulary" "RoleVocabulary";
