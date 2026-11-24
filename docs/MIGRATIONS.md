# Database migrations

A deployment runs the migration task first, then replaces the API, worker and web tasks a few at a time. For several minutes **the previous release runs on the new schema**, and a rollback (the circuit breaker, a deployment alarm, or applying the previous `image_tag`) runs it again on that schema. So every migration must leave a database that **both the new and the previous release can use**.

`npm run lint:migrations` (in `apps/api`, also in CI) enforces this for every migration. The migrations already applied when the check arrived that fail it (most from before launch, with no real data) are listed by name and SHA-256 in `apps/api/scripts/migration-lint-grandfathered.json`: Prisma checksums applied migrations, so they can't be edited to add a marker, and if one of them changes the check fails. Never add a new migration to that list; give it a marker instead.

## The rule: expand, then contract

A release only **adds** to the schema. Anything that removes or changes something takes two or more releases.

| Change | Release N (expand) | Release N+1 or later (contract) |
| --- | --- | --- |
| New table, new index, new enum value | Add it | — |
| New column | Add it **nullable or with a default** | Make it `NOT NULL` if needed (see below) |
| Rename a column or table | Add the new one; write to both; read the new one, falling back to the old | Backfill (below), then stop writing the old one; drop it a release later |
| Change a column's type | Add a new column of the new type; write both | Backfill, switch reads, drop the old column a release later |
| Remove a column, table or enum use | Stop reading and writing it (code only) | Drop it |
| Make a column required | Write it everywhere; backfill; add `CHECK ("col" IS NOT NULL) NOT VALID`, then `VALIDATE CONSTRAINT` | `SET NOT NULL` (instant once the check is validated), drop the check |

## Backfills

A backfill (`UPDATE … SET`) inside a migration runs during the deployment, in one transaction, and locks every row it touches. Small tables are fine; anything that grows with cities or staff is not.

1. Expand: add the column (nullable), and make the new code write it.
2. Behind a switch if the behaviour changes, read the new column with a fallback to the old data.
3. Backfill **from the worker, in batches** (a few thousand rows per statement, committed separately, resumable).
4. Contract a release later: drop the fallback, then the old data.

## Indexes

`CREATE INDEX` blocks writes to its table while it builds. On a table that is already large (`LARGE_TABLES` in `scripts/lint-migrations.mjs`: punches, shifts, audit log, outboxes, messages…), use:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Table_col_idx" ON "Table"("col");
```

as the **only statement in its own migration**: it cannot run inside a transaction, and Prisma sends a migration file as one script. Keep the index name Prisma would generate (`<Table>_<columns>_idx`), so `prisma migrate diff` stays clean.

## Constraints on a large table

On a table in `LARGE_TABLES` (not one the same migration creates, which is empty):
- `ADD CONSTRAINT … UNIQUE` or `PRIMARY KEY` builds its index under a lock that blocks **reads** as well as writes. Build the index first, `CREATE UNIQUE INDEX CONCURRENTLY` alone in its own migration, then `ALTER TABLE … ADD CONSTRAINT … UNIQUE USING INDEX "…"` in the next.
- `ADD CONSTRAINT … FOREIGN KEY` or `CHECK` blocks writes while it checks every row. Add it `NOT VALID` (new and changed rows are checked at once), then `ALTER TABLE … VALIDATE CONSTRAINT "…"` in a later migration, which doesn't block writes. Prisma writes foreign keys without `NOT VALID`: edit the generated SQL.

## When a destructive statement is right

The lint fails on `DROP` (except `DROP DEFAULT` / `DROP NOT NULL`), `RENAME`, a column `TYPE` change, `SET NOT NULL`, `ADD COLUMN … NOT NULL` without a default, `UPDATE`, `DELETE`, `MERGE` and `TRUNCATE` anywhere in a statement (inside a `WITH`, `EXPLAIN ANALYZE` or `PREPARE` too), any `DO` block, `CALL` or `EXECUTE`, any use of a function the same migration creates (in a `SELECT`, an `INSERT … SELECT`, `CREATE TABLE AS`, a column `DEFAULT`…: a function body is not checked, so any of these can hide the rest; creating it, or a trigger that executes it, is fine), and on a large table a plain `CREATE INDEX` or the constraints above. `E'…'` strings are read with their backslash escapes. The marker counts only in a comment, never inside a string. When the statement is the contract step of an earlier expand, or the table is known to be small, say so in a marker comment just above it (or after its semicolon, on the same line), so the reviewer sees why:

```sql
-- migration-safety: contract step; nothing reads "Shift"."legacyNote" since 2027.02 (PR #123)
ALTER TABLE "Shift" DROP COLUMN "legacyNote";
```

Prisma writes some of these itself (changing a foreign key's `ON DELETE` drops and re-adds the constraint): check the generated SQL and mark it.

## Row-level security and the other SQL files

`db/rls.sql` and `db/union_hub.sql` are applied after the migrations by `scripts/apply-sql.mjs`. It:
- skips a file when the file, the set of applied migrations and the `public` schema itself are unchanged since it was last applied, **and** every policy and row-level security flag in the database is exactly as these files left it (recorded in `fh_meta.sql_applied`). Most deployments take no locks at all; a schema rebuilt by `prisma migrate reset`, or a policy dropped by hand, gets every file applied again;
- otherwise applies it in one transaction with `lock_timeout` (`SQL_LOCK_TIMEOUT_MS`, 2 s by default), so it never waits long behind a slow report while holding locks on other tables, and retries (`SQL_LOCK_RETRIES`, 10) with a growing pause. Both must be positive whole numbers, or the task stops;
- `--force` applies the files whatever the record says.

## Order of a deployment

1. Migration task: `prisma migrate deploy`, then `apply-sql.mjs` (`npm run db:migrate`).
2. Only if it succeeded: the new task definitions (API, worker, web).
3. Rolling back means deploying the previous image tag; the schema stays (it is additive), so there is no "down" migration.
