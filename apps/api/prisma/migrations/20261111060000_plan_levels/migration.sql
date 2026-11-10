-- Public-sector plans by level, private-sector modules chosen one by one.
CREATE TYPE "PlanLevel" AS ENUM ('SMALL', 'BUSINESS', 'MULTI_COMPLEX', 'ENTERPRISE');

ALTER TABLE "BillingAccount"
  ADD COLUMN "level" "PlanLevel" NOT NULL DEFAULT 'BUSINESS',
  ADD COLUMN "quotedRateCents" INTEGER,
  ADD COLUMN "modules" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing accounts keep what they had: HR Compliance meant the multi-complex features.
UPDATE "BillingAccount" SET "level" = CASE WHEN "addOnHr" THEN 'MULTI_COMPLEX'::"PlanLevel" ELSE 'BUSINESS'::"PlanLevel" END
  WHERE "plan" = 'MUNICIPAL';
UPDATE "BillingAccount" SET "modules" = array_remove(array_remove(array_remove(array_remove(ARRAY[
    CASE WHEN "plan" = 'CLUB' AND "addOnHr" THEN 'hrCompliance' END,
    CASE WHEN "plan" = 'CLUB' AND "addOnHr" THEN 'hrSuite' END,
    CASE WHEN "plan" = 'CLUB' AND "addOnOps" THEN 'operations' END,
    CASE WHEN "addOnUnion" THEN 'union' END], NULL), NULL), NULL), NULL);

ALTER TABLE "BillingAccount" DROP COLUMN "addOnHr", DROP COLUMN "addOnOps", DROP COLUMN "addOnUnion";
