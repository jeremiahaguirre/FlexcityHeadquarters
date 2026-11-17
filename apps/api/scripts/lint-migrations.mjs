#!/usr/bin/env node
// Migration safety lint (docs/MIGRATIONS.md; ARCHITECTURE-REVIEW A9). Run in CI:
//   node scripts/lint-migrations.mjs [migrations dir]
//
// During a rolling deployment the previous release keeps running on the new schema, and a rollback
// runs it again. So a migration may only ADD: tables, nullable columns or columns with a default,
// indexes, constraints that old code already satisfies. These fail the check unless the statement
// carries a marker comment saying why it is safe (a contract step, a backfill in batches, …):
//   DROP (except DROP DEFAULT / DROP NOT NULL), RENAME, a column TYPE change, SET NOT NULL,
//   ADD COLUMN … NOT NULL without a DEFAULT, UPDATE, DELETE, TRUNCATE (also inside a WITH),
//   a DO block or a CALL / SELECT of a function the migration creates (either can hide any of
//   these), and a plain CREATE INDEX on a large table (it blocks
//   writes while it builds: use CREATE INDEX CONCURRENTLY, alone in its own migration).
//
// The marker is a comment in the statement, on the lines just before it, or after its semicolon
// on the same line:
//   -- migration-safety: contract step; nothing reads "Shift"."legacyNote" since release 2027.01
// Migrations up to BASELINE are not checked: they were written before launch, with no real data.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The last migration on main when this check arrived (all pre-launch, with no real data). Move it
// only to the newest migration that merged before the check did.
export const BASELINE = '20261116180000_custom_role_needs';
export const MARKER = /--[ \t]*migration-safety:[ \t]*\S/i;

/** Tables expected to grow large in production: a plain CREATE INDEX on them blocks writes for a while. */
export const LARGE_TABLES = new Set([
  'AuditLog', 'TimePunch', 'TimePunchEdit', 'Shift', 'ShiftOffer', 'Notification', 'EmailOutbox', 'SmsOutbox', 'EventOutbox',
  'WebhookDelivery', 'RateLimitHit', 'Message', 'ConversationMember', 'PayStatement', 'LessonAttendance', 'LessonEnrollment',
  'ChemicalReading', 'HeadCount', 'RotationLog', 'LogEntry', 'ReliabilityEvent', 'PushSubscription', 'RefreshToken',
  'AuthToken', 'PlatformAudit', 'IncidentAccessLog', 'OvertimeEntry', 'Availability', 'User', 'Sale', 'AnnouncementRead',
]);

/**
 * One left-to-right pass over a statement: its code, with comments, string literals and $$ bodies
 * blanked and whitespace collapsed, and its comments' text. A `--` inside a string is not a
 * comment, and a marker inside a string is not a marker.
 */
function scan(text) {
  let out = '';
  const comments = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    if (rest.startsWith('--')) {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      comments.push(text.slice(i, stop));
      out += ' ';
      i = stop;
    } else if (rest.startsWith('/*')) {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      comments.push(text.slice(i, stop));
      out += ' ';
      i = stop;
    } else if (text[i] === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      out += "''";
      i = j + 1;
    } else if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      const stop = end < 0 ? text.length : end + 1;
      out += text.slice(i, stop);
      i = stop;
    } else {
      const dollar = rest.match(/^\$[A-Za-z_]*\$/);
      if (dollar) {
        const end = text.indexOf(dollar[0], i + dollar[0].length);
        out += ' $$ ';
        i = end < 0 ? text.length : end + dollar[0].length;
      } else {
        out += text[i];
        i++;
      }
    }
  }
  return { code: out.replace(/\s+/g, ' ').trim(), comments: comments.join('\n') };
}

const code = (text) => scan(text).code;

/**
 * Splits SQL into statements. Leading comments go with the statement after them; a comment after a
 * semicolon on the same line goes with the statement before it; comment-only text is not a
 * statement. Understands '…' strings, "…" identifiers, $tag$…$tag$ bodies, -- and /* *\/ comments.
 */
export function splitStatements(sql) {
  const out = [];
  let cur = '';
  let line = 1;
  let startLine = 1;
  let i = 0;
  const push = () => {
    if (code(cur)) out.push({ text: cur, line: startLine });
    else if (cur.trim() && out.length) out.at(-1).text += `\n${cur}`; // comment-only text at the end
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
      i++;
      // A comment after the semicolon, on the same line, belongs to this statement.
      const trailing = sql.slice(i).match(/^[ \t]*(--[^\n]*)/);
      if (trailing) {
        cur += ` ${trailing[1]}`;
        i += trailing[0].length;
      }
      push();
      continue;
    }
    if (c === '\n') line++;
    cur += c;
    i++;
  }
  push();
  return out;
}

const quotedTable = (text) => text.match(/\bON\s+(?:ONLY\s+)?(?:"?public"?\.)?"([^"]+)"/i)?.[1] ?? text.match(/\bON\s+(?:ONLY\s+)?(?:public\.)?([A-Za-z_][\w]*)/i)?.[1];
const IDENT = '("[^"]+"|\\w+)';

/** Problems in one statement: { level: 'error' | 'allowed', rule, message }. */
export function checkStatement(text) {
  const { code: s, comments } = scan(text);
  const marked = MARKER.test(comments);
  const found = [];
  const err = (rule, message) => found.push({ level: marked ? 'allowed' : 'error', rule, message });

  if (/^DO\b/i.test(s)) err('do', 'DO block: it can run anything (a backfill, a drop) out of sight of this check. Say what it does and why it is safe.');
  const drops = [...s.matchAll(new RegExp(`\\bDROP\\s+${IDENT}`, 'gi'))]
    .map((m) => (m[1].startsWith('"') ? 'COLUMN' : m[1].toUpperCase()))
    .filter((w) => w !== 'DEFAULT' && w !== 'NOT');
  if (drops.length) err('drop', `DROP ${drops.join(', DROP ')}: the running release may still use it. Drop it in a later release (contract step).`);
  if (/\bRENAME\b/i.test(s)) err('rename', 'RENAME: the running release still uses the old name. Add the new one, write both, switch reads, drop the old one a release later.');
  if (new RegExp(`\\bALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+(?:SET\\s+DATA\\s+)?TYPE\\b`, 'i').test(s)) err('type', 'Column TYPE change: rewrites the table under an exclusive lock and can break the running release. Add a new column instead.');
  if (/\bSET\s+NOT\s+NULL\b/i.test(s)) err('set-not-null', 'SET NOT NULL: the running release may still write NULL. Add a CHECK (...) NOT VALID, validate it, then SET NOT NULL a release later.');
  for (const m of s.matchAll(new RegExp(`\\bADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}\\s+((?:[^,()]|\\([^()]*\\))*)`, 'gi'))) {
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|VALUE)$/i.test(m[1])) continue;
    if (/\bNOT\s+NULL\b/i.test(m[2]) && !/\bDEFAULT\b/i.test(m[2])) {
      err('add-not-null', `ADD COLUMN ${m[1]} NOT NULL without a DEFAULT: inserts from the running release fail. Give it a default, or add it nullable.`);
    }
  }
  const cte = /^WITH\b/i.test(s);
  if (/^UPDATE\b/i.test(s) || (cte && new RegExp(`\\bUPDATE\\s+${IDENT}\\s+(?:AS\\s+\\w+\\s+|\\w+\\s+)?SET\\b`, 'i').test(s))) {
    err('update', 'UPDATE (a backfill) runs inside the deployment and locks every row it touches. Backfill in batches from the worker, or say why the table is small.');
  }
  if (/^DELETE\b/i.test(s) || (cte && /\bDELETE\s+FROM\b/i.test(s))) err('delete', 'DELETE in a migration: data the running release may still expect. Say why it is safe.');
  if (/^TRUNCATE\b/i.test(s)) err('truncate', 'TRUNCATE in a migration: data loss. Say why it is safe.');
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(s) && !/\bCONCURRENTLY\b/i.test(s)) {
    const table = quotedTable(s);
    if (table && LARGE_TABLES.has(table)) {
      err('index', `Plain CREATE INDEX on "${table}", a large table: it blocks writes while it builds. Use CREATE INDEX CONCURRENTLY, alone in its own migration.`);
    }
  }
  return found;
}

/** Names of the functions and procedures a migration creates (lower case, unquoted). */
export function createdRoutines(statements) {
  const names = new Set();
  for (const st of statements) {
    const m = code(st.text).match(/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:"?public"?\.)?("[^"]+"|\w+)/i);
    if (m) names.add(m[1].replace(/"/g, '').toLowerCase());
  }
  return names;
}

/**
 * A function body is not checked (its text is a $$ string), so running one from the migration
 * (CALL, or SELECT of a function the migration creates) could hide a backfill or a drop: it needs a
 * marker, like a DO block. Creating a function (a trigger function, say) needs none.
 */
export function checkRoutineCall(text, created) {
  const { code: s, comments } = scan(text);
  const level = MARKER.test(comments) ? 'allowed' : 'error';
  const message = 'Runs a function or procedure from the migration: its body is not checked. Say what it does and why it is safe.';
  if (/^CALL\b/i.test(s)) return [{ level, rule: 'call', message }];
  if (/^SELECT\b/i.test(s)) {
    for (const name of created) if (new RegExp(`(^|[^\\w"])"?${name}"?\\s*\\(`, 'i').test(s)) return [{ level, rule: 'call', message }];
  }
  return [];
}

/** Checks every migration after BASELINE. Returns { errors, checked }. */
export function lintMigrations(dir, baseline = BASELINE) {
  const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const errors = [];
  let checked = 0;
  for (const name of names) {
    if (name <= baseline) continue;
    const file = join(dir, name, 'migration.sql');
    if (!existsSync(file)) continue;
    checked++;
    const statements = splitStatements(readFileSync(file, 'utf8'));
    const created = createdRoutines(statements);
    for (const st of statements) {
      const problems = [...checkStatement(st.text), ...checkRoutineCall(st.text, created)];
      for (const p of problems) {
        if (p.level === 'error') errors.push(`${name}/migration.sql:${st.line}: ${p.message}`);
      }
    }
    // CONCURRENTLY can't run in a transaction: Prisma sends a migration as one script, so it must be alone.
    if (statements.length > 1 && statements.some((st) => /\bCONCURRENTLY\b/i.test(code(st.text)))) {
      errors.push(`${name}/migration.sql: CREATE INDEX CONCURRENTLY must be the only statement in its migration.`);
    }
  }
  return { errors, checked };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');
  const { errors, checked } = lintMigrations(dir);
  const gh = process.env.GITHUB_ACTIONS === 'true';
  for (const e of errors) console.error(gh ? `::error::${e}` : `error: ${e}`);
  if (errors.length) {
    console.error(`\n${errors.length} unsafe statement(s). Make the change additive (docs/MIGRATIONS.md), or add "-- migration-safety: <why>" above the statement.`);
    process.exit(1);
  }
  console.log(`${checked} migration(s) after ${BASELINE} checked: additive only.`);
}
