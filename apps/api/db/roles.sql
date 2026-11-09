-- Cluster bootstrap (run once per environment as a superuser, BEFORE migrations).
-- Passwords are set out-of-band (AWS Secrets Manager); these are placeholders for local dev.
--
--   flexcity_app    runtime API. NOT the table owner, so RLS always applies.
--                   Has no privileges on the union_hub schema.
--   flexcity_union  used only by the Union Hub service. Privileges on union_hub only
--                   (plus read on a minimal user directory view).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flexcity_app') THEN
    CREATE ROLE flexcity_app LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flexcity_union') THEN
    CREATE ROLE flexcity_union LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
