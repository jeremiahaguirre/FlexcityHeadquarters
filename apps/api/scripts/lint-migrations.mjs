#!/usr/bin/env node
// Migration safety lint (docs/MIGRATIONS.md; ARCHITECTURE-REVIEW A9). Run in CI:
//   node scripts/lint-migrations.mjs [migrations dir]
//
// During a rolling deployment the previous release keeps running on the new schema, and a rollback
// runs it again. So a migration may only ADD: tables, nullable columns or columns with a default,
// indexes, constraints that old code already satisfies. These fail the check unless the statement
// carries a marker comment saying why it is safe (a contract step, a backfill in batches, …):
//   DROP (except DROP DEFAULT / DROP NOT NULL), RENAME, a column TYPE change, SET NOT NULL,
//   ADD COLUMN … NOT NULL without a DEFAULT, UPDATE, DELETE.
// Plain CREATE INDEX on a large table is flagged (a warning): it blocks writes while it builds;
// use CREATE INDEX CONCURRENTLY, alone in its own migration.
//
// The marker is a comment in the statement or on the lines just before it:
//   -- migration-safety: contract step; nothing reads "Shift"."legacyNote" since release 2027.01
// Migrations up to BASELINE are not checked: they were written before launch, with no real data.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE = '20261113103200_maintenance_windows';
export const MARKER = /--[ \t]*migration-safety:[ \t]*\S/i;

/** Tables expected to grow large in production: a plain CREATE INDEX on them blocks writes for a while. */
export const LARGE_TABLES = new Set([
  'AuditLog', 'TimePunch', 'TimePunchEdit', 'Shift', 'ShiftOffer', 'Notification', 'EmailOutbox', 'SmsOutbox', 'EventOutbox',
  'WebhookDelivery', 'RateLimitHit', 'Message', 'ConversationMember', 'PayStatement', 'LessonAttendance', 'LessonEnrollment',
  'ChemicalReading', 'HeadCount', 'RotationLog', 'LogEntry', 'ReliabilityEvent', 'PushSubscription', 'RefreshToken',
  'AuthToken', 'PlatformAudit', 'IncidentAccessLog', 'OvertimeEntry', 'Availability', 'User', 'Sale', 'AnnouncementRead',
]);

/**
 * Splits SQL into statements, keeping each statement's leading comments with it. Understands
 * '…' strings, "…" identifiers, $tag$…$tag$ bodies, -- and /* *\/ comments.
 */
export function splitStatements(sql) {
  const out = [];
  let cur = '';
  let line = 1;
  let startLine = 1;
  let i = 0;
  const push = () => {
    if (cur.trim()) out.push({ text: cur, line: startLine });
    cur = '';
  };
  while (i < sql.length) {
    const c = sql[i];
    const rest = sql.slice(i);
    if (!cur.trim()) startLine = line;
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      const stop = end < 0 ? sql.length : end;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      const chunk = sql.slice(i, stop);
      line += chunk.split('\n').length - 1;
      cur += chunk;
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      const chunk = sql.slice(i, j + 1);
      line += chunk.split('\n').length - 1;
      cur += chunk;
      i = j + 1;
      continue;
    }
    const dollar = rest.match(/^\$[A-Za-z_]*\$/);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end < 0 ? sql.length : end + tag.length;
      const chunk = sql.slice(i, stop);
      line += chunk.split('\n').length - 1;
      cur += chunk;
      i = stop;
      continue;
    }
    if (c === ';') {
      push();
      i++;
      continue;
    }
    if (c === '\n') line++;
    cur += c;
    i++;
  }
  push();
  return out;
}

/** The statement with comments, string literals and $$ bodies blanked, whitespace collapsed (identifiers kept). */
function code(text) {
  return text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' $$ ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\s+/g, ' ')
    .trim();
}

const quotedTable = (text) => text.match(/\bON\s+(?:ONLY\s+)?(?:"?public"?\.)?"([^"]+)"/i)?.[1] ?? text.match(/\bON\s+(?:ONLY\s+)?(?:public\.)?([A-Za-z_][\w]*)/i)?.[1];

/** Problems in one statement: { level: 'error' | 'warning', rule, message }. */
export function checkStatement(text) {
  const s = code(text);
  const marked = MARKER.test(text);
  const found = [];
  const err = (rule, message) => found.push({ level: marked ? 'allowed' : 'error', rule, message });

  const drops = [...s.matchAll(/\bDROP\s+(\w+)/gi)].map((m) => m[1].toUpperCase()).filter((w) => w !== 'DEFAULT' && w !== 'NOT');
  if (drops.length) err('drop', `DROP ${drops.join(', DROP ')}: the running release may still use it. Drop it in a later release (contract step).`);
  if (/\bRENAME\b/i.test(s)) err('rename', 'RENAME: the running release still uses the old name. Add the new one, write both, switch reads, drop the old one a release later.');
  if (/\bALTER\s+COLUMN\s+("[^"]+"|\w+)\s+(SET\s+DATA\s+)?TYPE\b/i.test(s)) err('type', 'Column TYPE change: rewrites the table under an exclusive lock and can break the running release. Add a new column instead.');
  if (/\bSET\s+NOT\s+NULL\b/i.test(s)) err('set-not-null', 'SET NOT NULL: the running release may still write NULL. Add a CHECK (...) NOT VALID, validate it, then SET NOT NULL a release later.');
  for (const m of s.matchAll(/\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|\w+)\s+([^,]*)/gi)) {
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|VALUE)$/i.test(m[1])) continue;
    if (/\bNOT\s+NULL\b/i.test(m[2]) && !/\bDEFAULT\b/i.test(m[2])) {
      err('add-not-null', `ADD COLUMN ${m[1]} NOT NULL without a DEFAULT: inserts from the running release fail. Give it a default, or add it nullable.`);
    }
  }
  if (/^UPDATE\b/i.test(s)) err('update', 'UPDATE (a backfill) runs inside the deployment and locks every row it touches. Backfill in batches from the worker, or say why the table is small.');
  if (/^DELETE\b/i.test(s)) err('delete', 'DELETE in a migration: data the running release may still expect. Say why it is safe.');
  if (/^TRUNCATE\b/i.test(s)) err('truncate', 'TRUNCATE in a migration: data loss. Say why it is safe.');
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(s) && !/\bCONCURRENTLY\b/i.test(s)) {
    const table = quotedTable(s);
    if (table && LARGE_TABLES.has(table) && !marked) {
      found.push({ level: 'warning', rule: 'index', message: `Plain CREATE INDEX on "${table}", a large table: it blocks writes while it builds. Use CREATE INDEX CONCURRENTLY, alone in its own migration.` });
    }
  }
  return found;
}

/** Checks every migration after BASELINE. Returns { errors, warnings, checked }. */
export function lintMigrations(dir, baseline = BASELINE) {
  const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const errors = [];
  const warnings = [];
  let checked = 0;
  for (const name of names) {
    if (name <= baseline) continue;
    const file = join(dir, name, 'migration.sql');
    if (!existsSync(file)) continue;
    checked++;
    const statements = splitStatements(readFileSync(file, 'utf8'));
    for (const st of statements) {
      for (const p of checkStatement(st.text)) {
        const where = `${name}/migration.sql:${st.line}`;
        if (p.level === 'error') errors.push(`${where}: ${p.message}`);
        if (p.level === 'warning') warnings.push(`${where}: ${p.message}`);
      }
    }
    // CONCURRENTLY can't run in a transaction: Prisma sends a migration as one script, so it must be alone.
    if (statements.length > 1 && statements.some((st) => /\bCONCURRENTLY\b/i.test(code(st.text)))) {
      errors.push(`${name}/migration.sql: CREATE INDEX CONCURRENTLY must be the only statement in its migration.`);
    }
  }
  return { errors, warnings, checked };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');
  const { errors, warnings, checked } = lintMigrations(dir);
  const gh = process.env.GITHUB_ACTIONS === 'true';
  for (const w of warnings) console.log(gh ? `::warning::${w}` : `warning: ${w}`);
  for (const e of errors) console.error(gh ? `::error::${e}` : `error: ${e}`);
  if (errors.length) {
    console.error(`\n${errors.length} unsafe statement(s). Make the change additive (docs/MIGRATIONS.md), or add "-- migration-safety: <why>" above the statement.`);
    process.exit(1);
  }
  console.log(`${checked} migration(s) after ${BASELINE} checked: additive only${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`);
}
