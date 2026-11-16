-- The worker's purge of old rate-limit hits (ARCHITECTURE-REVIEW A25). CONCURRENTLY, so sign-ins
-- keep writing hits while it builds. It must be the only statement in its migration: it cannot run
-- inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "RateLimitHit_at_idx" ON "RateLimitHit"("at");
