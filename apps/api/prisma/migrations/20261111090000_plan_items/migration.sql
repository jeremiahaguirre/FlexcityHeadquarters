-- Options sold one by one, each switchable per organization with its own price.
ALTER TABLE "BillingAccount" ADD COLUMN "items" JSONB NOT NULL DEFAULT '{}';

-- What each old module unlocked, as single options.
DO $$
DECLARE r RECORD; m TEXT; opt TEXT; acc JSONB;
BEGIN
  FOR r IN SELECT "tenantId", "modules" FROM "BillingAccount" WHERE cardinality("modules") > 0 LOOP
    acc := '{}';
    FOREACH m IN ARRAY r."modules" LOOP
      FOREACH opt IN ARRAY CASE m
        WHEN 'operations' THEN ARRAY['poolChemistry', 'incidents', 'statusBoard', 'rotations']
        WHEN 'programs' THEN ARRAY['registration']
        WHEN 'fleetWinter' THEN ARRAY['fleet', 'winter']
        WHEN 'hrCompliance' THEN ARRAY['onboarding', 'reliability', 'discipline', 'accommodation']
        ELSE ARRAY[m] END
      LOOP
        acc := acc || jsonb_build_object(opt, jsonb_build_object('on', true));
      END LOOP;
    END LOOP;
    UPDATE "BillingAccount" SET "items" = acc WHERE "tenantId" = r."tenantId";
  END LOOP;
END $$;

ALTER TABLE "BillingAccount" DROP COLUMN "modules";
