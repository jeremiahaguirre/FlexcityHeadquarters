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
GRANT DELETE ON "Availability", "PositionCertRequirement", "UserPosition", "RuleOverride", "PayCodeMapping", "Notification", "SchoolCalendarPeriod", "TenantLogo", "Passkey", "PlatformPasskey", "WebAuthnChallenge", "CustomRole", "UserCustomRole", "InvoiceLine", "Invoice", "PositionOnboarding", "RateLimitHit", "SwimLevel", "LessonCampaign", "Member", "FeeItem", "CoverageRule", "Department", "DepartmentManager", "PayStatement", "TrainingRecord", "PadBatch", "PadDebit", "SsoConnection", "EmailOutbox", "AuthToken", "RefreshToken", "PushSubscription", "FacilityHours", "TrainingSpend", "PayAdjustment", "EmergencyContact", "SmsOutbox" TO flexcity_app;
-- Signed consent agreements are evidence: added, never changed or deleted by the app.
REVOKE UPDATE ON "ConsentRecord" FROM flexcity_app;
REVOKE UPDATE ON "PolicyAck" FROM flexcity_app;
-- Shared rate limiter: insert needs its id sequence.
GRANT USAGE, SELECT ON SEQUENCE "RateLimitHit_id_seq" TO flexcity_app;
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
    'LessonClass', 'LessonEnrollment', 'LessonAttendance', 'JobPosting', 'TenantLogo', 'Passkey', 'CustomRole', 'UserCustomRole', 'HeadCount', 'ConductNote', 'DeckStation', 'RotationLog', 'OnboardingItem', 'PositionOnboarding', 'OnboardingRecord', 'OvertimeEntry', 'CareCheckIn', 'AccommodationCase', 'LoneWorkSession', 'CallOut', 'CallOutContact', 'PatrolRoute', 'PatrolRecord', 'SwimLevel', 'LessonCampaign', 'Household', 'Member', 'FeeItem', 'Sale', 'BookableService', 'BookingRequest', 'CoverageRule', 'Vehicle', 'VehicleInspection', 'InjuryClaim', 'Department', 'DepartmentManager', 'PayProfile', 'BankAccount', 'PayRun', 'PayStatement', 'PayTransmission', 'BenefitPlan', 'BenefitEnrollment', 'LeaveEntitlement', 'PerformanceReview', 'TrainingCourse', 'TrainingRecord', 'Grievance', 'Offboarding', 'EmployeeDocument', 'SupportGrant', 'SsoConnection', 'PushSubscription', 'ConsentRecord', 'FacilityHours', 'TrainingSpend', 'PayrollSync', 'Salary', 'PayAdjustment', 'PayDeductionOrder', 'PolicyAck', 'Policy', 'ExpenseItem', 'ExpenseClaim', 'Kiosk', 'ShiftTrade', 'LieuAdjustment', 'SmsOutbox', 'EmergencyContact'
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
-- Its columns changed (disabledAt), so it's dropped and made again.
DROP FUNCTION IF EXISTS public_tenant_by_subdomain(text);
CREATE FUNCTION public_tenant_by_subdomain(p_subdomain text)
  RETURNS TABLE (id uuid, name text, "logoUrl" text, "themeColors" jsonb, "defaultLocale" text, "disabledAt" timestamptz, "exportUntil" timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id, name, "logoUrl", "themeColors", "defaultLocale", "disabledAt", "exportUntil" FROM "Tenant" WHERE subdomain = p_subdomain $$;
REVOKE ALL ON FUNCTION public_tenant_by_subdomain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_tenant_by_subdomain(text) TO flexcity_app;

-- Background workers iterate tenants before any tenant context exists.
CREATE OR REPLACE FUNCTION all_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id FROM "Tenant" $$;
REVOKE ALL ON FUNCTION all_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION all_tenant_ids() TO flexcity_app;

-- SQL injection, defence in depth: even if a query were ever subverted, the runtime roles can't
-- change the schema, create objects or temporary tables, run a statement for long, or sit in an
-- open transaction holding locks. (Row-level security above already keeps each city to its rows.)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM flexcity_app;
DO $$
BEGIN
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM flexcity_app', current_database());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flexcity_union') THEN
    EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM flexcity_union', current_database());
    REVOKE CREATE ON SCHEMA public FROM flexcity_union;
    ALTER ROLE flexcity_union SET statement_timeout = '30s';
    ALTER ROLE flexcity_union SET idle_in_transaction_session_timeout = '2min';
  END IF;
END $$;
-- The full data export reads whole tables, so the cap allows a couple of minutes.
ALTER ROLE flexcity_app SET statement_timeout = '120s';
ALTER ROLE flexcity_app SET idle_in_transaction_session_timeout = '3min';

-- FH's own records about each city (billing, debits, support visits, sign-in challenges, the Dev
-- console log) are read across cities by FH's billing and the Dev console, which run with no city
-- chosen. Inside a city's transaction they show that city's rows only, so a city's request can
-- never reach another city's invoices or support visits, even through a coding mistake.
DO $$
DECLARE
  t text;
  fh_tables text[] := ARRAY['BillingAccount', 'Invoice', 'PadAgreement', 'PadDebit', 'SupportSession', 'WebAuthnChallenge', 'PlatformAudit'];
BEGIN
  FOREACH t IN ARRAY fh_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS city_or_fh ON %I', t);
    EXECUTE format(
      'CREATE POLICY city_or_fh ON %I TO flexcity_app
         USING (app_current_tenant() IS NULL OR "tenantId" = app_current_tenant())
         WITH CHECK (app_current_tenant() IS NULL OR "tenantId" = app_current_tenant())', t);
  END LOOP;
END
$$;
-- Invoice lines and payments follow their invoice.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['InvoiceLine', 'InvoicePayment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS city_or_fh ON %I', t);
    EXECUTE format(
      'CREATE POLICY city_or_fh ON %I TO flexcity_app
         USING (app_current_tenant() IS NULL OR EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId" AND i."tenantId" = app_current_tenant()))
         WITH CHECK (app_current_tenant() IS NULL OR EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId" AND i."tenantId" = app_current_tenant()))', t);
  END LOOP;
END
$$;
