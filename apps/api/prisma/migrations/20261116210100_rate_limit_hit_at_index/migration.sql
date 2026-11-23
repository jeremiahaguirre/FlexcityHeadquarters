-- The worker's purge of old rate-limit hits (ARCHITECTURE-REVIEW A25). CONCURRENTLY, so sign-ins
-- keep writing hits while it builds. It must be the only statement in its migration: it cannot run
-- inside a transaction.
-- No IF NOT EXISTS: a failed concurrent build leaves an INVALID index behind, and a retry must
-- fail loudly rather than keep it. Recovery: DROP INDEX CONCURRENTLY IF EXISTS "RateLimitHit_at_idx";
-- then npx prisma migrate resolve --rolled-back 20261116210100_rate_limit_hit_at_index, and deploy.
CREATE INDEX CONCURRENTLY "RateLimitHit_at_idx" ON "RateLimitHit"("at");
