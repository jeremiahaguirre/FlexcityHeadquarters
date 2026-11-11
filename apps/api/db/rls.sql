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
GRANT DELETE ON "Availability", "PositionCertRequirement", "UserPosition", "RuleOverride", "PayCodeMapping", "Notification", "SchoolCalendarPeriod", "TenantLogo", "Passkey", "PlatformPasskey", "WebAuthnChallenge", "CustomRole", "UserCustomRole", "InvoiceLine", "Invoice", "PositionOnboarding", "RateLimitHit", "SwimLevel", "LessonCampaign", "Member", "FeeItem", "CoverageRule", "Department", "DepartmentManager", "PayStatement", "TrainingRecord", "PadBatch", "PadDebit", "SsoConnection", "EmailOutbox", "AuthToken", "RefreshToken", "PushSubscription", "FacilityHours", "TrainingSpend", "PayAdjustment", "EmergencyContact", "SmsOutbox", "JobApplication", "PayeePayment", "SavedReport", "EventOutbox", "WebhookEndpoint", "WebhookDelivery", "SpecialEvent", "WeatherForecastDay", "WeatherObservation", "ApiIdempotencyKey", "RotationTemplate", "OnCallPeriod", "MfaCode", "ShiftTemplate", "ShiftTemplateSlot", "ShiftTemplateApplication", "ShiftPreference", "ShiftPreferenceLimit", "Conversation", "ConversationMember", "Message", "MessageAttachment", "MessageReport", "ConversationAccess", "Survey", "SurveyInvite", "SurveyResponse", "BidItem", "BidChoice", "BidEntrant", "BidAward" TO flexcity_app;
-- Signed consent agreements are evidence: added, never changed or deleted by the app.
REVOKE UPDATE ON "ConsentRecord" FROM flexcity_app;
REVOKE UPDATE ON "PolicyAck" FROM flexcity_app;
REVOKE UPDATE ON "LogEntry" FROM flexcity_app;
-- Investigation access to a conversation is a record of who opened it and why; anonymous survey answers never change.
REVOKE UPDATE ON "ConversationAccess", "SurveyResponse" FROM flexcity_app;
-- Shared rate limiter: insert needs its id sequence.
GRANT USAGE, SELECT ON SEQUENCE "RateLimitHit_id_seq" TO flexcity_app;
-- Audit and access logs are append-only for the app (each city's, and the Dev console's).
REVOKE UPDATE ON "AuditLog", "IncidentAccessLog", "TimePunchEdit", "PlatformAudit" FROM flexcity_app;
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
    'LessonClass', 'LessonEnrollment', 'LessonAttendance', 'JobPosting', 'TenantLogo', 'Passkey', 'CustomRole', 'UserCustomRole', 'HeadCount', 'ConductNote', 'DeckStation', 'RotationLog', 'OnboardingItem', 'PositionOnboarding', 'OnboardingRecord', 'OvertimeEntry', 'CareCheckIn', 'AccommodationCase', 'LoneWorkSession', 'CallOut', 'CallOutContact', 'PatrolRoute', 'PatrolRecord', 'SwimLevel', 'LessonCampaign', 'Household', 'Member', 'FeeItem', 'Sale', 'BookableService', 'BookingRequest', 'CoverageRule', 'Vehicle', 'VehicleInspection', 'InjuryClaim', 'Department', 'DepartmentManager', 'PayProfile', 'BankAccount', 'PayRun', 'PayStatement', 'PayTransmission', 'BenefitPlan', 'BenefitEnrollment', 'LeaveEntitlement', 'PerformanceReview', 'TrainingCourse', 'TrainingRecord', 'Grievance', 'Offboarding', 'EmployeeDocument', 'SupportGrant', 'SsoConnection', 'PushSubscription', 'ConsentRecord', 'FacilityHours', 'TrainingSpend', 'PayrollSync', 'Salary', 'PayAdjustment', 'PayDeductionOrder', 'BidAward', 'BidEntrant', 'BidChoice', 'BidItem', 'BidRound', 'SurveyResponse', 'SurveyInvite', 'Survey', 'ConversationAccess', 'MessageReport', 'MessageAttachment', 'Message', 'ConversationMember', 'Conversation', 'ShiftPreferenceLimit', 'ShiftPreference', 'ShiftTemplateApplication', 'ShiftTemplateSlot', 'ShiftTemplate', 'MfaCode', 'OnCallPeriod', 'RotationTemplate', 'ShiftChange', 'ApiIdempotencyKey', 'SpecialEvent', 'WebhookDelivery', 'WebhookEndpoint', 'ApiKey', 'EventOutbox', 'SavedReport', 'PayeePayment', 'Payee', 'JobApplication', 'AnnouncementRead', 'Announcement', 'LogEntry', 'PolicyAck', 'Policy', 'ExpenseItem', 'ExpenseClaim', 'Kiosk', 'ShiftTrade', 'LieuAdjustment', 'SmsOutbox', 'EmergencyContact'
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

-- Readiness and metrics (lib/health.ts): how far behind the email and text outboxes are, across
-- every organization. Counts and an age only: no addresses, no tenant ids, no contents.
DROP FUNCTION IF EXISTS outbox_backlog();
CREATE FUNCTION outbox_backlog() RETURNS TABLE(channel text, pending bigint, failed bigint, oldest_age_s double precision)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT 'email', count(*) FILTER (WHERE attempts < 5), count(*) FILTER (WHERE attempts >= 5),
          coalesce(extract(epoch FROM now() - min("createdAt") FILTER (WHERE attempts < 5)), 0)::double precision
     FROM "EmailOutbox" WHERE "sentAt" IS NULL
   UNION ALL
   SELECT 'sms', count(*) FILTER (WHERE attempts < 5), count(*) FILTER (WHERE attempts >= 5),
          coalesce(extract(epoch FROM now() - min("createdAt") FILTER (WHERE attempts < 5)), 0)::double precision
     FROM "SmsOutbox" WHERE "sentAt" IS NULL
   UNION ALL
   -- Safety texts and calls (services/notifications/sms.ts SAFETY_TEMPLATES), which /readyz holds to SAFETY_SMS_ALERT_S.
   SELECT 'sms_safety', count(*) FILTER (WHERE attempts < 5), count(*) FILTER (WHERE attempts >= 5),
          coalesce(extract(epoch FROM now() - min("createdAt") FILTER (WHERE attempts < 5)), 0)::double precision
     FROM "SmsOutbox" WHERE "sentAt" IS NULL
      AND template IN ('lonework_check_in_now', 'lonework_overdue', 'lonework_escalated', 'lonework_help', 'callout_offer')
   UNION ALL
   SELECT 'events', count(*) FILTER (WHERE status = 'PENDING'), count(*) FILTER (WHERE status = 'DEAD'),
          coalesce(extract(epoch FROM now() - min("createdAt") FILTER (WHERE status = 'PENDING')), 0)::double precision
     FROM "EventOutbox" WHERE status <> 'DELIVERED' $$;
REVOKE ALL ON FUNCTION outbox_backlog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_backlog() TO flexcity_app;

-- Event outbox dispatcher (lib/outbox.ts): which organizations have domain events due now. Ids
-- only; each organization's events are then claimed inside its own context, under RLS.
CREATE OR REPLACE FUNCTION tenants_with_due_events() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT DISTINCT "tenantId" FROM "EventOutbox" WHERE status = 'PENDING' AND "availableAt" <= now() $$;
REVOKE ALL ON FUNCTION tenants_with_due_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenants_with_due_events() TO flexcity_app;

-- Urgent texts (services/notifications/urgent.ts): which organizations have texts or calls due now
-- (the worker's sweep, every few seconds), and which have safety alerts still unsent after
-- min_age_s (its alert). Ids and counts only; each organization's messages are then read under RLS.
CREATE OR REPLACE FUNCTION tenants_with_due_sms() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT DISTINCT "tenantId" FROM "SmsOutbox"
    WHERE "sentAt" IS NULL AND attempts < 5
      AND (params->>'_retryAt' IS NULL OR (params->>'_retryAt')::timestamptz <= now()) $$;
REVOKE ALL ON FUNCTION tenants_with_due_sms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenants_with_due_sms() TO flexcity_app;

DROP FUNCTION IF EXISTS safety_sms_overdue(int);
CREATE FUNCTION safety_sms_overdue(min_age_s int) RETURNS TABLE(tenant_id uuid, overdue bigint, oldest_age_s double precision)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT "tenantId", count(*), extract(epoch FROM now() - min("createdAt"))::double precision
     FROM "SmsOutbox"
    WHERE "sentAt" IS NULL
      AND template IN ('lonework_check_in_now', 'lonework_overdue', 'lonework_escalated', 'lonework_help', 'callout_offer')
      AND "createdAt" <= now() - make_interval(secs => min_age_s)
      AND "createdAt" > now() - interval '6 hours'
    GROUP BY "tenantId" $$;
REVOKE ALL ON FUNCTION safety_sms_overdue(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safety_sms_overdue(int) TO flexcity_app;

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
-- FH's own security program (the Dev console's Trust area) and the worker's job log: no city's
-- data, read and written only with no city chosen. Inside any city's transaction they show nothing,
-- so no city request can read FH's risks, vendors or customer commitments, even by mistake.
DO $$
DECLARE
  t text;
  fh_only_tables text[] := ARRAY['TrustControlState', 'TrustTest', 'TrustTestRun', 'TrustScoreSnapshot', 'TrustEvidence', 'TrustEvidenceRequest', 'TrustPolicy', 'TrustPolicyVersion', 'TrustPolicyAck', 'TrustRisk', 'TrustVendor', 'TrustCommitment', 'TrustCommitmentFulfilment', 'TrustAnswer', 'TrustReminder', 'TrustAlert', 'TrustSettings', 'WorkerJobRun'];
BEGIN
  FOREACH t IN ARRAY fh_only_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS fh_only ON %I', t);
    EXECUTE format(
      'CREATE POLICY fh_only ON %I TO flexcity_app
         USING (app_current_tenant() IS NULL) WITH CHECK (app_current_tenant() IS NULL)', t);
  END LOOP;
END
$$;
-- Test history, posture snapshots and the Trust feed are thinned out by age (services/trust/monitors.ts).
GRANT DELETE ON "TrustTestRun", "TrustScoreSnapshot", "TrustAlert" TO flexcity_app;
-- Policy acknowledgements are evidence: added, never changed.
REVOKE UPDATE ON "TrustPolicyAck" FROM flexcity_app;

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

-- Public API (/api/v1, services/integrations/apiKeys.ts): a request brings only its key, so the
-- organization is found from the key's SHA-256 before any context exists. Returns the tenant id
-- only, and only to someone who already holds the key; the key itself is then read under RLS.
CREATE OR REPLACE FUNCTION api_key_tenant(p_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT "tenantId" FROM "ApiKey" WHERE "keyHash" = p_hash $$;
REVOKE ALL ON FUNCTION api_key_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_key_tenant(text) TO flexcity_app;

-- Webhook sender (services/integrations/webhooks.ts): which organizations have deliveries due. Ids only.
CREATE OR REPLACE FUNCTION tenants_with_due_webhooks() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT DISTINCT "tenantId" FROM "WebhookDelivery" WHERE status = 'PENDING' AND "nextAttemptAt" <= now() $$;
REVOKE ALL ON FUNCTION tenants_with_due_webhooks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenants_with_due_webhooks() TO flexcity_app;

-- Webhook events, recorded by the database itself in the same transaction as the change, so every
-- path that changes a person, a shift, a request, a punch or a pay run (screens, imports, the Dev
-- console, background jobs) is covered. They go to the event outbox (lib/outbox.ts), which queues a
-- delivery per subscribed endpoint. Ids and the names of changed fields only, never the values.
-- Nothing is written unless the organization has an endpoint that wants that type. Runs as the
-- caller (not SECURITY DEFINER), so row-level security applies to the outbox insert.
CREATE OR REPLACE FUNCTION fh_public_event(p_tenant uuid, p_type text, p_data jsonb) RETURNS void
  LANGUAGE plpgsql AS
$$
BEGIN
  IF EXISTS (SELECT 1 FROM "WebhookEndpoint" WHERE "tenantId" = p_tenant AND enabled AND p_type = ANY(events)) THEN
    INSERT INTO "EventOutbox" (id, "tenantId", type, payload)
    VALUES (gen_random_uuid(), p_tenant, p_type, jsonb_build_object('type', p_type, 'tenantId', p_tenant, 'data', p_data));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION fh_user_event() RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  changed text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fh_public_event(NEW."tenantId", 'person.created', jsonb_build_object('id', NEW.id));
    RETURN NEW;
  END IF;
  IF NEW."firstName" IS DISTINCT FROM OLD."firstName" THEN changed := changed || 'first_name'::text; END IF;
  IF NEW."lastName" IS DISTINCT FROM OLD."lastName" THEN changed := changed || 'last_name'::text; END IF;
  IF NEW."preferredName" IS DISTINCT FROM OLD."preferredName" THEN changed := changed || 'preferred_name'::text; END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN changed := changed || 'email'::text; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN changed := changed || 'status'::text; END IF;
  IF NEW."employmentStatus" IS DISTINCT FROM OLD."employmentStatus" THEN changed := changed || 'employment_status'::text; END IF;
  IF NEW."hireDate" IS DISTINCT FROM OLD."hireDate" THEN changed := changed || 'hire_date'::text; END IF;
  IF NEW."employeeNumber" IS DISTINCT FROM OLD."employeeNumber" THEN changed := changed || 'employee_number'::text; END IF;
  IF NEW."reportsToId" IS DISTINCT FROM OLD."reportsToId" THEN changed := changed || 'manager_id'::text; END IF;
  IF cardinality(changed) = 0 THEN RETURN NEW; END IF;
  IF NEW.status = 'TERMINATED' AND OLD.status <> 'TERMINATED' THEN
    PERFORM fh_public_event(NEW."tenantId", 'person.terminated', jsonb_build_object('id', NEW.id));
  END IF;
  PERFORM fh_public_event(NEW."tenantId", 'person.updated', jsonb_build_object('id', NEW.id, 'changed', to_jsonb(changed)));
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS fh_public_event ON "User";
CREATE TRIGGER fh_public_event AFTER INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION fh_user_event();

CREATE OR REPLACE FUNCTION fh_user_position_event() RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  tid uuid;
  uid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN tid := OLD."tenantId"; uid := OLD."userId"; ELSE tid := NEW."tenantId"; uid := NEW."userId"; END IF;
  -- The person's positions are part of their public record: their updated_at moves too, so a
  -- system syncing with updated_since sees the change.
  UPDATE "User" SET "updatedAt" = now() WHERE id = uid;
  PERFORM fh_public_event(tid, 'person.updated', jsonb_build_object('id', uid, 'changed', jsonb_build_array('positions')));
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS fh_public_event ON "UserPosition";
CREATE TRIGGER fh_public_event AFTER INSERT OR DELETE ON "UserPosition" FOR EACH ROW EXECUTE FUNCTION fh_user_position_event();

CREATE OR REPLACE FUNCTION fh_shift_event() RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE
  changed text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'PUBLISHED' THEN PERFORM fh_public_event(NEW."tenantId", 'shift.published', jsonb_build_object('id', NEW.id)); END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'PUBLISHED' AND OLD.status <> 'PUBLISHED' THEN
    PERFORM fh_public_event(NEW."tenantId", 'shift.published', jsonb_build_object('id', NEW.id));
  ELSIF NEW.status = 'CANCELLED' AND OLD.status = 'PUBLISHED' THEN
    PERFORM fh_public_event(NEW."tenantId", 'shift.cancelled', jsonb_build_object('id', NEW.id));
  ELSIF NEW.status = 'PUBLISHED' THEN
    IF NEW."userId" IS DISTINCT FROM OLD."userId" THEN changed := changed || 'person_id'::text; END IF;
    IF NEW."startsAt" IS DISTINCT FROM OLD."startsAt" THEN changed := changed || 'starts_at'::text; END IF;
    IF NEW."endsAt" IS DISTINCT FROM OLD."endsAt" THEN changed := changed || 'ends_at'::text; END IF;
    IF NEW."positionId" IS DISTINCT FROM OLD."positionId" THEN changed := changed || 'position_id'::text; END IF;
    IF NEW."facilityId" IS DISTINCT FROM OLD."facilityId" THEN changed := changed || 'facility_id'::text; END IF;
    IF cardinality(changed) > 0 THEN
      PERFORM fh_public_event(NEW."tenantId", 'shift.updated', jsonb_build_object('id', NEW.id, 'changed', to_jsonb(changed)));
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS fh_public_event ON "Shift";
CREATE TRIGGER fh_public_event AFTER INSERT OR UPDATE ON "Shift" FOR EACH ROW EXECUTE FUNCTION fh_shift_event();

CREATE OR REPLACE FUNCTION fh_time_off_event() RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF NEW.status = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD.status <> 'APPROVED') THEN
    PERFORM fh_public_event(NEW."tenantId", 'timeoff.approved', jsonb_build_object('id', NEW.id, 'person_id', NEW."userId"));
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'CANCELLED' AND OLD.status = 'APPROVED' THEN
    PERFORM fh_public_event(NEW."tenantId", 'timeoff.cancelled', jsonb_build_object('id', NEW.id, 'person_id', NEW."userId"));
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS fh_public_event ON "TimeOffRequest";
CREATE TRIGGER fh_public_event AFTER INSERT OR UPDATE ON "TimeOffRequest" FOR EACH ROW EXECUTE FUNCTION fh_time_off_event();

CREATE OR REPLACE FUNCTION fh_punch_event() RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF NEW.status = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD.status <> 'APPROVED') THEN
    PERFORM fh_public_event(NEW."tenantId", 'punch.approved', jsonb_build_object('id', NEW.id, 'person_id', NEW."userId"));
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS fh_public_event ON "TimePunch";
CREATE TRIGGER fh_public_event AFTER INSERT OR UPDATE ON "TimePunch" FOR EACH ROW EXECUTE FUNCTION fh_punch_event();

CREATE OR REPLACE FUNCTION fh_pay_run_event() RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF NEW.status = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD.status <> 'APPROVED') THEN
    PERFORM fh_public_event(NEW."tenantId", 'payrun.approved', jsonb_build_object('id', NEW.id));
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS fh_public_event ON "PayRun";
CREATE TRIGGER fh_public_event AFTER INSERT OR UPDATE ON "PayRun" FOR EACH ROW EXECUTE FUNCTION fh_pay_run_event();
