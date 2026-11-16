import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASELINE, checkStatement, lintMigrations, splitStatements } from '../../scripts/lint-migrations.mjs';

const rules = (sql: string) => checkStatement(sql).filter((p: { level: string }) => p.level === 'error').map((p: { rule: string }) => p.rule);

describe('migration safety lint (ARCHITECTURE-REVIEW A9, docs/MIGRATIONS.md)', () => {
  it('fails on statements that break the release still running during a deployment', () => {
    expect(rules('ALTER TABLE "Shift" DROP COLUMN "note"')).toEqual(['drop']);
    expect(rules('DROP TABLE "Legacy"')).toEqual(['drop']);
    expect(rules('DROP INDEX "Shift_note_idx"')).toEqual(['drop']);
    expect(rules('ALTER TABLE "Shift" RENAME COLUMN "note" TO "notes"')).toEqual(['rename']);
    expect(rules(`ALTER TYPE "PayCodeKey" RENAME VALUE 'A' TO 'B'`)).toEqual(['rename']);
    expect(rules('ALTER TABLE "Shift" ALTER COLUMN "hours" TYPE DECIMAL(6,2)')).toEqual(['type']);
    expect(rules('ALTER TABLE "Shift" ALTER COLUMN "hours" SET DATA TYPE INTEGER')).toEqual(['type']);
    expect(rules('ALTER TABLE "Shift" ALTER COLUMN "note" SET NOT NULL')).toEqual(['set-not-null']);
    expect(rules('ALTER TABLE "Shift" ADD COLUMN "kind" TEXT NOT NULL')).toEqual(['add-not-null']);
    expect(rules(`UPDATE "Shift" SET "kind" = 'x'`)).toEqual(['update']);
    expect(rules(`DELETE FROM "Shift" WHERE "kind" IS NULL`)).toEqual(['delete']);
  });

  it('lets additive statements through', () => {
    expect(rules('CREATE TABLE "New" ("id" UUID NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "New_pkey" PRIMARY KEY ("id"))')).toEqual([]);
    expect(rules('ALTER TABLE "Shift" ADD COLUMN "kind" TEXT')).toEqual([]);
    expect(rules(`ALTER TABLE "Shift" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'x'`)).toEqual([]);
    expect(rules('ALTER TABLE "Shift" ALTER COLUMN "note" DROP NOT NULL')).toEqual([]);
    expect(rules('ALTER TABLE "Shift" ALTER COLUMN "note" DROP DEFAULT')).toEqual([]);
    expect(rules(`ALTER TYPE "Kind" ADD VALUE 'NEW'`)).toEqual([]);
    expect(rules('ALTER TABLE "Shift" ADD CONSTRAINT "Shift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE')).toEqual([]);
    expect(rules('CREATE INDEX "New_name_idx" ON "New"("name")')).toEqual([]);
    // Words inside comments and strings don't count.
    expect(rules(`-- we never DROP anything here\nCOMMENT ON TABLE "Shift" IS 'drop-in shifts; rename later'`)).toEqual([]);
  });

  it('accepts a destructive statement that says why it is safe', () => {
    const sql = '-- migration-safety: contract step; nothing reads "note" since release 2027.02\nALTER TABLE "Shift" DROP COLUMN "note"';
    expect(rules(sql)).toEqual([]);
    expect(checkStatement(sql)).toEqual([expect.objectContaining({ level: 'allowed', rule: 'drop' })]);
    // An empty marker is not a reason.
    expect(rules('-- migration-safety:\nDROP TABLE "Legacy"')).toEqual(['drop']);
  });

  it('flags a plain CREATE INDEX on a large table, not CONCURRENTLY', () => {
    expect(checkStatement('CREATE INDEX "TimePunch_at_idx" ON "TimePunch"("at")')).toEqual([expect.objectContaining({ level: 'warning', rule: 'index' })]);
    expect(checkStatement('CREATE INDEX CONCURRENTLY IF NOT EXISTS "TimePunch_at_idx" ON "TimePunch"("at")')).toEqual([]);
  });

  it('splits statements on semicolons outside strings, identifiers, comments and $$ bodies', () => {
    const st = splitStatements(`-- one; still a comment\nCREATE TABLE "a;b" (x TEXT DEFAULT ';');\nDO $$ BEGIN UPDATE x SET y = 1; END $$;\n/* c; */ SELECT 1`);
    expect(st).toHaveLength(3);
    expect(st[0]!.text).toContain('-- one; still a comment');
    expect(st[1]!.line).toBe(3);
    expect(st[2]!.text).toContain('SELECT 1');
  });

  it('checks only migrations after the baseline, and needs CONCURRENTLY alone in its migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fh-migrations-'));
    const add = (name: string, sql: string) => {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'migration.sql'), sql);
    };
    add('20260101000000_old', 'ALTER TABLE "Shift" DROP COLUMN "x";');
    add('20991231000000_new', 'ALTER TABLE "Shift" RENAME COLUMN "a" TO "b";\nUPDATE "Shift" SET "b" = 1;');
    add('20991231000100_index', 'CREATE INDEX CONCURRENTLY "S_idx" ON "Shift"("b");\nCREATE INDEX "T_idx" ON "Shift"("c");');
    const r = lintMigrations(dir, '20261113103200_maintenance_windows');
    expect(r.checked).toBe(2);
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0]).toMatch(/^20991231000000_new\/migration\.sql:1: RENAME/);
    expect(r.errors[1]).toMatch(/^20991231000000_new\/migration\.sql:2: UPDATE/);
    expect(r.errors[2]).toMatch(/CONCURRENTLY must be the only statement/);
  });

  it('would have caught the destructive pre-launch migrations, and passes everything after the baseline', () => {
    const dir = join(import.meta.dirname, '..', '..', 'prisma', 'migrations');
    const all = lintMigrations(dir, '');
    // DROP/RENAME before launch (with no real data): 20261109090000_rename_stat_worked and others.
    expect(all.errors.some((e: string) => e.startsWith('20261109090000_rename_stat_worked/'))).toBe(true);
    expect(all.errors.length).toBeGreaterThanOrEqual(5);
    expect(lintMigrations(dir, BASELINE).errors).toEqual([]);
  });
});
