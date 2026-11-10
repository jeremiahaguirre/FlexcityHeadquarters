-- Sent (or abandoned) emails no longer keep their contents: sign-in links and names.
UPDATE "EmailOutbox" SET "params" = '{}'::jsonb WHERE "sentAt" IS NOT NULL OR "attempts" >= 5;
