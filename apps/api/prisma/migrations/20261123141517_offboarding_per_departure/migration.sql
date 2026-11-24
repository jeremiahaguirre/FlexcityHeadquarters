-- One offboarding for each time someone leaves: a person rehired after leaving can be offboarded again.
-- Dropping the unique index keeps every existing row; a plain index keeps the lookups by person fast.
DROP INDEX IF EXISTS "Offboarding_userId_key";
CREATE INDEX IF NOT EXISTS "Offboarding_userId_idx" ON "Offboarding"("userId");
