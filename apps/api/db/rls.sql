-- Row-level security: tenant isolation enforced by Postgres, not just app code.
-- Idempotent; run after every `prisma migrate deploy` (see scripts/apply-sql.mjs).
--
-- The API sets the tenant per transaction:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
-- If it is not set, current_setting(..., true) returns NULL and every policy
-- evaluates to false — a forgotten tenant context returns zero rows, never all rows.

GRANT USAGE ON SCHEMA public TO flexcity_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO flexcity_app;
-- No DELETE for the app role on payroll-bearing tables; deletes are limited below.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM flexcity_app;
GRANT DELETE ON "Availability", "PositionCertRequirement", "UserPosition", "RuleOverride", "PayCodeMapping", "Notification", "SchoolCalendarPeriod" TO flexcity_app;
-- Audit and access logs are append-only for the app.
REVOKE UPDATE ON "AuditLog", "IncidentAccessLog", "TimePunchEdit" FROM flexcity_app;
-- Migration bookkeeping is not the app's business.
REVOKE ALL ON "_prisma_migrations" FROM flexcity_app;

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'Facility', 'RuleOverride', 'User', 'RefreshToken', 'Position',
    'PositionCertRequirement', 'UserPosition', 'PayRate', 'UserCertification',
    'Availability', 'TimeOffRequest', 'Shift', 'ShiftOffer', 'TimePunch',
    'TimePunchEdit', 'PayCodeMapping', 'ReliabilityEvent', 'PoolBody',
    'ChemicalReading', 'PoolClosure', 'IncidentReport', 'IncidentAccessLog',
    'DisciplinaryRecord', 'AuditLog', 'Notification', 'EmailOutbox', 'AuthToken', 'SchoolCalendarPeriod',
    'LessonClass', 'LessonEnrollment', 'LessonAttendance'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO flexcity_app
         USING ("tenantId" = app_current_tenant())
         WITH CHECK ("tenantId" = app_current_tenant())', t);
  END LOOP;
END
$$;

-- Tenant table: a tenant can only see itself.
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON "Tenant";
CREATE POLICY tenant_self ON "Tenant" TO flexcity_app
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());

-- Certification catalogue: global rows (tenantId IS NULL) are readable by all,
-- writable by nobody through the app; tenant rows are isolated.
ALTER TABLE "Certification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Certification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cert_read ON "Certification";
DROP POLICY IF EXISTS cert_write ON "Certification";
DROP POLICY IF EXISTS cert_update ON "Certification";
CREATE POLICY cert_read ON "Certification" FOR SELECT TO flexcity_app
  USING ("tenantId" IS NULL OR "tenantId" = app_current_tenant());
CREATE POLICY cert_write ON "Certification" FOR INSERT TO flexcity_app
  WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY cert_update ON "Certification" FOR UPDATE TO flexcity_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- CertificationPrerequisite / StatutoryHoliday are global reference data: read-only for the app.
REVOKE INSERT, UPDATE ON "CertificationPrerequisite", "StatutoryHoliday" FROM flexcity_app;

-- Tenant lookup by subdomain happens BEFORE a tenant context exists (login page).
-- Expose only the public branding fields through a SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public_tenant_by_subdomain(p_subdomain text)
  RETURNS TABLE (id uuid, name text, "logoUrl" text, "themeColors" jsonb, "defaultLocale" text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id, name, "logoUrl", "themeColors", "defaultLocale" FROM "Tenant" WHERE subdomain = p_subdomain $$;
REVOKE ALL ON FUNCTION public_tenant_by_subdomain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_tenant_by_subdomain(text) TO flexcity_app;

-- Background workers iterate tenants before any tenant context exists.
CREATE OR REPLACE FUNCTION all_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id FROM "Tenant" $$;
REVOKE ALL ON FUNCTION all_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION all_tenant_ids() TO flexcity_app;
