-- Union Hub: physically separate schema with a separate DB role.
--
-- What this guarantees:
--   * The runtime API role (flexcity_app) has NO privileges on this schema. A bug,
--     a mis-scoped query, or an HR/Supervisor account cannot read it through the API,
--     because the connection the API uses is refused by Postgres itself.
--   * Message bodies are additionally encrypted with a per-union-local key that the
--     employer tenant's KMS key does not wrap (see services/union/unionHub.ts).
--
-- What it does NOT guarantee (say this to customers plainly):
--   * It is not legal privilege. Records may still be compellable by a tribunal or court.
--   * Database superusers / the vendor's on-call engineers can access storage. Mitigated by
--     the per-local encryption key and audited break-glass access, not eliminated.

CREATE SCHEMA IF NOT EXISTS union_hub;
REVOKE ALL ON SCHEMA union_hub FROM PUBLIC;
REVOKE ALL ON SCHEMA union_hub FROM flexcity_app;
GRANT USAGE ON SCHEMA union_hub TO flexcity_union;

CREATE TABLE IF NOT EXISTS union_hub.local (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,          -- employer tenant this local bargains with
  name        text NOT NULL,          -- e.g. "CUPE Local 338"
  kek_id      text NOT NULL,          -- KMS key owned by / dedicated to the local
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS union_hub.member_access (
  local_id    uuid NOT NULL REFERENCES union_hub.local(id),
  user_id     uuid NOT NULL,          -- public."User".id (no FK across the wall, by design)
  is_steward  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (local_id, user_id)
);

CREATE TABLE IF NOT EXISTS union_hub.message (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id         uuid NOT NULL REFERENCES union_hub.local(id),
  thread_id        uuid NOT NULL,
  author_user_id   uuid NOT NULL,
  ciphertext       bytea NOT NULL,
  iv               bytea NOT NULL,
  auth_tag         bytea NOT NULL,
  wrapped_data_key bytea NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_thread_idx ON union_hub.message (local_id, thread_id, created_at);

CREATE TABLE IF NOT EXISTS union_hub.document (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id     uuid NOT NULL REFERENCES union_hub.local(id),
  title        text NOT NULL,
  kind         text NOT NULL,          -- 'CBA', 'LOU', 'BULLETIN'
  storage_key  text NOT NULL,          -- object key in the union-only S3 bucket
  uploaded_by  uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS union_hub.access_log (
  id         bigserial PRIMARY KEY,
  local_id   uuid NOT NULL,
  user_id    uuid NOT NULL,
  action     text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA union_hub TO flexcity_union;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA union_hub TO flexcity_union;
GRANT UPDATE ON union_hub.member_access TO flexcity_union;

-- The union role needs to resolve who is who, and read the seniority roster and
-- published schedules (view-only, per the CBA). Nothing else in public.
CREATE OR REPLACE VIEW union_hub.staff_directory AS
  SELECT u.id, u."tenantId" AS tenant_id, u."firstName" AS first_name, u."lastName" AS last_name,
         u."unionMember" AS union_member, u."seniorityDate" AS seniority_date,
         u."seniorityHours" AS seniority_hours, u."employmentStatus" AS employment_status
  FROM public."User" u
  WHERE u.status <> 'TERMINATED' AND u."anonymizedAt" IS NULL
    AND u."tenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid;

CREATE OR REPLACE VIEW union_hub.published_schedule AS
  SELECT s.id, s."tenantId" AS tenant_id, s."facilityId" AS facility_id, s."positionId" AS position_id,
         s."userId" AS user_id, s."startsAt" AS starts_at, s."endsAt" AS ends_at
  FROM public."Shift" s
  WHERE s.status = 'PUBLISHED'
    AND s."tenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid;

-- Views run with the owner's rights (which bypass RLS), hence the explicit tenant filter above;
-- the union service sets app.tenant_id from the local's tenant before querying.
--, so flexcity_union reads them without any grant on public.
GRANT SELECT ON union_hub.staff_directory, union_hub.published_schedule TO flexcity_union;
