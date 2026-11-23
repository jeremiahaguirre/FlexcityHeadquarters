#!/usr/bin/env node
// Migration safety lint (docs/MIGRATIONS.md; ARCHITECTURE-REVIEW A9). Run in CI:
//   node scripts/lint-migrations.mjs [migrations dir]
//
// During a rolling deployment the previous release keeps running on the new schema, and a rollback
// runs it again. So a migration may only ADD: tables, nullable columns or columns with a default,
// indexes, constraints that old code already satisfies. These fail the check unless the statement
// carries a marker comment saying why it is safe (a contract step, a backfill in batches, …):
//   DROP (except DROP DEFAULT / DROP NOT NULL), RENAME, a column TYPE change, SET NOT NULL,
//   ADD COLUMN … NOT NULL without a DEFAULT, UPDATE, DELETE, MERGE, TRUNCATE (anywhere in the
//   statement: inside a WITH, EXPLAIN ANALYZE or PREPARE too), a DO block, CALL, EXECUTE, or any use
//   of a function the migration creates (each can hide any of these), and on a large table: a plain
//   CREATE INDEX (it blocks writes while it builds: use CREATE INDEX CONCURRENTLY, alone in its own
//   migration), ADD UNIQUE / PRIMARY KEY without USING INDEX (blocks reads too while it builds), and
//   ADD FOREIGN KEY / CHECK without NOT VALID (blocks writes while it checks every row).
//
// The marker is a comment in the statement, on the lines just before it, or after its semicolon
// on the same line:
//   -- migration-safety: contract step; nothing reads "Shift"."legacyNote" since release 2027.01
// Every migration is checked. The ones already on main that fail are listed by name and SHA-256 in
// migration-lint-grandfathered.json (applied before this check existed, most before launch with no
// real data; Prisma checksums applied migrations, so they can't be edited to add a marker). A listed
// migration whose file changes fails the check. Never add a new migration to that list: mark it.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Migrations applied before this check existed that fail it: { name: sha256 of migration.sql }. */
export const GRANDFATHERED = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'migration-lint-grandfathered.json'), 'utf8'));
export const MARKER = /--[ \t]*migration-safety:[ \t]*\S/i;

/** Tables expected to grow large in production: a plain CREATE INDEX on them blocks writes for a while. */
export const LARGE_TABLES = new Set([
  'AuditLog', 'TimePunch', 'TimePunchEdit', 'Shift', 'ShiftOffer', 'Notification', 'EmailOutbox', 'SmsOutbox', 'EventOutbox',
  'WebhookDelivery', 'RateLimitHit', 'Message', 'ConversationMember', 'PayStatement', 'LessonAttendance', 'LessonEnrollment',
  'ChemicalReading', 'HeadCount', 'RotationLog', 'LogEntry', 'ReliabilityEvent', 'PushSubscription', 'RefreshToken',
  'AuthToken', 'PlatformAudit', 'IncidentAccessLog', 'OvertimeEntry', 'Availability', 'User', 'Sale', 'AnnouncementRead',
]);

/** E'…' (or e'…'): a backslash escapes the next character, so E'it\'s' is one string. */
const isEscapeString = (text, i) => /[Ee]/.test(text[i - 1] ?? '') && !/[\w$]/.test(text[i - 2] ?? '');

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
      const escapes = isEscapeString(text, i);
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" || (escapes && text[j] === '\\') ? 2 : 1;
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
      const escapes = c === "'" && isEscapeString(sql, i);
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') j += 2;
        else if (sql[j] === c && sql[j + 1] === c) j += 2;
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

/**
 * Problems in one statement: { level: 'error' | 'allowed', rule, message }. `newTables`: tables the
 * same migration creates. They are empty, so an index or a constraint on them locks nothing that matters.
 */
export function checkStatement(text, newTables = new Set()) {
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
  // Anywhere in the statement (strings and $$ bodies are blanked): inside a WITH, EXPLAIN ANALYZE,
  // PREPARE … AS. "ON UPDATE / ON DELETE" are foreign-key actions, not statements.
  if (/^UPDATE\b/i.test(s) || new RegExp(`(?<!\\bON\\s)\\bUPDATE\\s+(?:ONLY\\s+)?(?:"?public"?\\.)?${IDENT}\\s+(?:AS\\s+\\w+\\s+|\\w+\\s+)?SET\\b`, 'i').test(s)) {
    err('update', 'UPDATE (a backfill) runs inside the deployment and locks every row it touches. Backfill in batches from the worker, or say why the table is small.');
  }
  if (/^DELETE\b/i.test(s) || /(?<!\bON\s)\bDELETE\s+FROM\b/i.test(s)) err('delete', 'DELETE in a migration: data the running release may still expect. Say why it is safe.');
  if (/\bMERGE\s+INTO\b/i.test(s)) err('merge', 'MERGE in a migration: it updates, inserts or deletes rows the running release may still expect. Say why it is safe.');
  if (/(?:^|\s)TRUNCATE\b/i.test(s)) err('truncate', 'TRUNCATE in a migration: data loss. Say why it is safe.');
  if (/^EXECUTE\b/i.test(s)) err('execute', 'EXECUTE runs a prepared statement this check can\'t see. Write the statement itself.');
  const altered = s.match(new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:"?public"?\\.)?${IDENT}`, 'i'))?.[1]?.replace(/"/g, '');
  if (altered && LARGE_TABLES.has(altered) && !newTables.has(altered)) {
    const add = `\\bADD\\s+(?:CONSTRAINT\\s+${IDENT}\\s+)?`;
    if (new RegExp(`${add}(?:UNIQUE|PRIMARY\\s+KEY)\\b`, 'i').test(s) && !/\bUSING\s+INDEX\b/i.test(s)) {
      err('constraint-index', `ADD UNIQUE / PRIMARY KEY on "${altered}", a large table: it builds the index under a lock that blocks reads and writes. CREATE UNIQUE INDEX CONCURRENTLY first (its own migration), then ADD CONSTRAINT … USING INDEX.`);
    }
    if (new RegExp(`${add}(?:FOREIGN\\s+KEY|CHECK)\\b`, 'i').test(s) && !/\bNOT\s+VALID\b/i.test(s)) {
      err('constraint-validate', `ADD FOREIGN KEY / CHECK on "${altered}", a large table: it blocks writes while it checks every row. Add it NOT VALID, then VALIDATE CONSTRAINT in a later migration.`);
    }
  }
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(s) && !/\bCONCURRENTLY\b/i.test(s)) {
    const table = quotedTable(s);
    if (table && LARGE_TABLES.has(table) && !newTables.has(table)) {
      err('index', `Plain CREATE INDEX on "${table}", a large table: it blocks writes while it builds. Use CREATE INDEX CONCURRENTLY, alone in its own migration.`);
    }
  }
  return found;
}

/** Names of the tables a migration creates (as written, unquoted). */
export function createdTables(statements) {
  const names = new Set();
  for (const st of statements) {
    const m = code(st.text).match(new RegExp(`^CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?public"?\\.)?${IDENT}`, 'i'));
    if (m) names.add(m[1].replace(/"/g, ''));
  }
  return names;
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

/** Statements that name a routine without running it. */
const NOT_A_CALL = /^(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|(?:CONSTRAINT\s+)?TRIGGER)|COMMENT\s+ON|GRANT|REVOKE|ALTER\s+(?:FUNCTION|PROCEDURE)|DROP\s+(?:FUNCTION|PROCEDURE))\b/i;

/**
 * A function body is not checked (its text is a $$ string), so running one from the migration
 * could hide a backfill or a drop: CALL, or any use of a function the migration creates (in a
 * SELECT, an INSERT … SELECT, a WITH, CREATE TABLE AS, a column DEFAULT that runs once per row…)
 * needs a marker, like a DO block. Creating it, a trigger that executes it, and comments or grants
 * on it need none.
 */
export function checkRoutineCall(text, created) {
  const { code: s, comments } = scan(text);
  const level = MARKER.test(comments) ? 'allowed' : 'error';
  const message = 'Runs a function or procedure from the migration: its body is not checked. Say what it does and why it is safe.';
  if (/^CALL\b/i.test(s)) return [{ level, rule: 'call', message }];
  if (NOT_A_CALL.test(s)) return [];
  for (const name of created) if (new RegExp(`(^|[^\\w"])"?${name}"?\\s*\\(`, 'i').test(s)) return [{ level, rule: 'call', message }];
  return [];
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Checks every migration. A grandfathered one (by name, with the same SHA-256) is skipped; one whose
 * file changed is an error. Returns { errors, checked, grandfathered, failing }: `failing` lists the
 * migrations with errors, with their hashes (what a reviewed grandfather entry would be).
 */
export function lintMigrations(dir, grandfathered = GRANDFATHERED) {
  const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const errors = [];
  const failing = {};
  let checked = 0;
  let skipped = 0;
  for (const name of names) {
    const file = join(dir, name, 'migration.sql');
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf8');
    if (Object.hasOwn(grandfathered, name)) {
      if (grandfathered[name] === sha256(sql)) {
        skipped++;
        continue;
      }
      errors.push(`${name}/migration.sql: changed after it was grandfathered (scripts/migration-lint-grandfathered.json). An applied migration must not change.`);
      continue;
    }
    checked++;
    const before = errors.length;
    const statements = splitStatements(sql);
    const created = createdRoutines(statements);
    const newTables = createdTables(statements);
    for (const st of statements) {
      const problems = [...checkStatement(st.text, newTables), ...checkRoutineCall(st.text, created)];
      for (const p of problems) {
        if (p.level === 'error') errors.push(`${name}/migration.sql:${st.line}: ${p.message}`);
      }
    }
    // CONCURRENTLY can't run in a transaction: Prisma sends a migration as one script, so it must be alone.
    if (statements.length > 1 && statements.some((st) => /\bCONCURRENTLY\b/i.test(code(st.text)))) {
      errors.push(`${name}/migration.sql: CREATE INDEX CONCURRENTLY must be the only statement in its migration.`);
    }
    if (errors.length > before) failing[name] = sha256(sql);
  }
  return { errors, checked, grandfathered: skipped, failing };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');
  const { errors, checked, grandfathered } = lintMigrations(dir);
  const gh = process.env.GITHUB_ACTIONS === 'true';
  for (const e of errors) console.error(gh ? `::error::${e}` : `error: ${e}`);
  if (errors.length) {
    console.error(`\n${errors.length} unsafe statement(s). Make the change additive (docs/MIGRATIONS.md), or add "-- migration-safety: <why>" above the statement.`);
    process.exit(1);
  }
  console.log(`${checked} migration(s) checked: additive only (${grandfathered} applied before this check, grandfathered by hash).`);
}
