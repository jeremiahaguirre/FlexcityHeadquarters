/**
 * The organization's complete data export: everything it keeps in FlexcityHeadquarters,
 * in a zip it can open without us. Offered at any time to its administrators, and, after
 * offboarding, through a download-only sign-in until the export window closes.
 *
 * - One CSV (opens in Excel; nested values as JSON) and one JSON Lines file per kind of record.
 * - What's sealed with the organization's key is opened, because FH deletes those keys
 *   afterwards: SINs, bank account numbers, incident narratives, employee documents
 *   (as the original files). Each incident opened is logged like any other reading.
 * - Team messages: while the organization is active, the export has each conversation's
 *   metadata only (kind, member ids, message count, dates), never message text, first versions of
 *   edited messages, files or file names: the employer reads a conversation it isn't in only through
 *   an investigation, with a reason, every reading logged. When the organization leaves FH
 *   (offboarded), the records pass to it: the export it receives then includes every message,
 *   first version and file, and an audit row says messages were included.
 * - Signatures, logos and other stored files are written as files, linked from their rows.
 * - Left out: sign-in secrets (password hashes, sessions, one-time links, passkeys, the SSO
 *   client secret, bank-connection credentials), FH's own billing and support records, and
 *   the union hub, which belongs to the union local, not the employer.
 */
import { qualified } from '../../lib/sqlIdent.js';
import { createHash } from 'node:crypto';
import { Zip, ZipDeflate } from 'fflate';
import { audit, withTenant } from '../../lib/db.js';
import { keys } from '../../routes/context.js';
import { open } from '../crypto/envelope.js';
import { csvCell } from '../payroll/export.js';
import { accountNumber, revealSin } from '../payroll/bank.js';
import { attachmentName } from '../messaging/conversations.js';
import { messageAad, openWith } from '../messaging/crypto.js';
import { anonymousResults, type Answers, type Question } from '../surveys/results.js';
import { isClosed } from '../surveys/surveys.js';

/** Sign-in secrets and FH's own records: never in the export. */
const SKIP_TABLES = new Set(['AuthToken', 'RefreshToken', 'MfaCode', 'Passkey', 'WebAuthnChallenge', 'PlatformAudit', 'SupportSession', 'BillingAccount', 'PadAgreement', 'PadDebit', 'TenantLogo', 'RateLimitHit']);
/** Columns that are secrets or only the machinery of encryption. */
const SKIP_COLUMNS = new Set(['nameCiphertext', 'nameIv', 'nameAuthTag', 'passwordHash', 'tokenHash', 'ssoSubject', 'failedLoginCount', 'lockedUntil', 'oidcSecret', 'ciphertext', 'iv', 'authTag', 'wrappedDataKey', 'wrappedKey', 'kekId', 'sinCiphertext', 'sinIv', 'sinAuthTag', 'sinWrappedKey', 'sinKekId', 'accountCiphertext', 'accountIv', 'accountAuthTag', 'accountWrappedKey', 'accountKekId', 'publicKey', 'originalCiphertext', 'originalIv', 'originalAuthTag']);

type Row = Record<string, unknown>;

/** A sealed value inside a settings object ({ c, iv, t, k, kek }) is shown as "[sealed]", never its parts. */
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    const o = v as Record<string, unknown>;
    if ('c' in o && 'iv' in o && 'kek' in o) return '[sealed]';
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file';
const enc = new TextEncoder();

export interface ExportSummary { tables: Array<{ table: string; rows: number }>; files: number; messagesIncluded: boolean }

/** Message contents: only in the export the organization receives when it leaves FH. */
const MESSAGE_CONTENT = new Set(['Message', 'MessageAttachment']);

/** Has the organization left FH (offboarded)? Then the export includes message contents. */
async function leaving(tenantId: string): Promise<boolean> {
  return !!(await withTenant(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { offboardedAt: true } })))?.offboardedAt;
}

async function tenantTables(tenantId: string, withMessages: boolean) {
  return withTenant(tenantId, async (tx) => {
    const cols = await tx.$queryRaw<Array<{ table: string }>>`
      SELECT table_name AS table FROM information_schema.columns
      WHERE column_name = 'tenantId' AND table_schema = 'public' ORDER BY table_name`;
    return cols.map((c) => c.table).filter((t) => !SKIP_TABLES.has(t) && (withMessages || !MESSAGE_CONTENT.has(t)));
  });
}

/** How much there is, for the screen before the download. */
export async function exportSummary(tenantId: string): Promise<ExportSummary> {
  const messagesIncluded = await leaving(tenantId);
  const tables = await tenantTables(tenantId, messagesIncluded);
  const out: ExportSummary = { tables: [], files: 0, messagesIncluded };
  await withTenant(tenantId, async (tx) => {
    for (const t of tables) {
      const [r] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM ${qualified('public', t)} WHERE "tenantId" = $1::uuid`, tenantId);
      const rows = Number(r?.n ?? 0);
      if (rows) out.tables.push({ table: t, rows });
    }
    out.files = await tx.employeeDocument.count({ where: { deletedAt: null } });
  });
  return out;
}

/**
 * Streams the zip to `write`. Returns what went in (for the audit log and the manifest).
 * `by` is who asked: recorded in the manifest and on every incident opened.
 */
export async function writeCityExport(tenantId: string, by: { userId: string; name: string }, write: (chunk: Uint8Array, final: boolean) => void) {
  const zip = new Zip((err, chunk, final) => {
    if (err) throw err;
    write(chunk, final);
  });
  const add = (name: string, data: Uint8Array) => {
    const f = new ZipDeflate(`flexcity-export/${name}`, { level: 6 });
    zip.add(f);
    f.push(data, true);
  };
  const withMessages = await leaving(tenantId);
  const tables = await tenantTables(tenantId, withMessages);
  if (withMessages) {
    // The organization is leaving and receives its messages: recorded before any leave.
    const [messages, attachments] = await withTenant(tenantId, (tx) => Promise.all([tx.message.count(), tx.messageAttachment.count()]));
    await withTenant(tenantId, (tx) => audit(tx, { tenantId, actorId: by.userId, action: 'data.export_messages', entity: 'Tenant', entityId: tenantId, after: { messagesIncluded: true, messages, files: attachments, reason: 'Offboarding: the organization receives its records' } }));
  }
  const counts: Array<{ table: string; rows: number; file: string }> = [];
  const problems: string[] = [];
  let files = 0;
  // Conversation keys, unwrapped once each for the messages and files they seal; wiped at the end.
  const convKeys = new Map<string, Buffer>();
  const convKey = async (conversationId: string) => {
    let k = convKeys.get(conversationId);
    if (!k) {
      const c = await withTenant(tenantId, (tx) => tx.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { wrappedKey: true, kekId: true } }));
      k = await keys().unwrapDataKey(c.kekId, Buffer.from(c.wrappedKey));
      convKeys.set(conversationId, k);
    }
    return k;
  };

  const tenant = await withTenant(tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }));
  const logo = await withTenant(tenantId, (tx) => tx.tenantLogo.findUnique({ where: { tenantId } }));
  if (logo) {
    add(`files/logo.${logo.contentType.split('/')[1] ?? 'bin'}`, new Uint8Array(logo.bytes));
    files++;
  }
  add('organization.json', enc.encode(JSON.stringify(scrub({ ...tenant }), null, 2)));

  for (const table of tables) {
    const rows = await withTenant(tenantId, (tx) => tx.$queryRawUnsafe<Row[]>(`SELECT * FROM ${qualified('public', table)} WHERE "tenantId" = $1::uuid`, tenantId), { timeoutMs: 120_000 });
    if (!rows.length) continue;
    if (table === 'Conversation') {
      // Metadata: who is in it and how many messages, never what they say.
      const [members, msgCounts] = await withTenant(tenantId, (tx) => Promise.all([tx.conversationMember.findMany({ select: { conversationId: true, userId: true } }), tx.message.groupBy({ by: ['conversationId'], _count: { _all: true } })]));
      for (const r of rows) {
        r.memberIds = members.filter((m) => m.conversationId === r.id).map((m) => m.userId).sort();
        r.messages = msgCounts.find((c) => c.conversationId === r.id)?._count._all ?? 0;
      }
    }
    if (table === 'Notification' && !withMessages) {
      // Older "new message" notifications could hold a preview: never in this export.
      for (const r of rows) if (r.type === 'message_new' && r.params && typeof r.params === 'object') delete (r.params as Record<string, unknown>).preview;
    }
    if (table === 'SurveyResponse') {
      // Anonymous answers leave only as results that respect the minimum group (never row by row, which
      // could be matched to people); named exit-survey answers are exported as they are.
      const surveys = await withTenant(tenantId, (tx) => tx.survey.findMany({ select: { id: true, title: true, anonymous: true, questions: true, minGroup: true, closedAt: true, closesAt: true } }));
      for (const s of surveys.filter((x) => x.anonymous)) {
        const rs = rows.filter((r) => r.surveyId === s.id).map((r) => ({ answers: r.answers as Answers, departmentId: (r.departmentId as string | null) ?? null, positionId: (r.positionId as string | null) ?? null }));
        if (rs.length) add(`surveys/${s.id}-results.json`, enc.encode(JSON.stringify({ title: s.title, ...anonymousResults(s.questions as unknown as Question[], rs, s.minGroup, isClosed(s)) }, null, 2)));
      }
      const named = new Set(surveys.filter((x) => !x.anonymous).map((x) => x.id));
      rows.splice(0, rows.length, ...rows.filter((r) => named.has(r.surveyId as string)).sort((x, y) => String(x.id).localeCompare(String(y.id))));
      if (!rows.length) continue;
    }
    const out: Row[] = [];
    for (const r of rows) {
      const row: Row = {};
      // Open what's sealed with the organization's key, before its machinery is dropped.
      try {
        if (table === 'PayProfile') row.sin = await revealSin(tenantId, r as never);
        if (table === 'BankAccount') row.accountNumber = await accountNumber(tenantId, r as never);
        if (table === 'IncidentReport') {
          row.narrative = JSON.parse(await open(keys(), { ciphertext: r.ciphertext as Buffer, iv: r.iv as Buffer, authTag: r.authTag as Buffer, wrappedDataKey: r.wrappedDataKey as Buffer, kekId: r.kekId as string }, `incident:${tenantId}:${r.id}`));
          await withTenant(tenantId, (tx) => tx.incidentAccessLog.create({ data: { tenantId, incidentId: r.id as string, userId: by.userId, purpose: 'Organization data export' } }));
        }
        if (table === 'Message') {
          const at = (part: 'text' | 'original') => messageAad(tenantId, r.conversationId as string, r.id as string, part);
          if (r.ciphertext) row.text = openWith(await convKey(r.conversationId as string), { ciphertext: r.ciphertext as Buffer, iv: r.iv as Buffer, authTag: r.authTag as Buffer }, at('text')).toString('utf8');
          if (r.originalCiphertext) row.originalText = openWith(await convKey(r.conversationId as string), { ciphertext: r.originalCiphertext as Buffer, iv: r.originalIv as Buffer, authTag: r.originalAuthTag as Buffer }, at('original')).toString('utf8');
        }
        if (table === 'MessageAttachment') {
          const m = await withTenant(tenantId, (tx) => tx.message.findUniqueOrThrow({ where: { id: r.messageId as string }, select: { conversationId: true } }));
          const key = await convKey(m.conversationId);
          const bytes = openWith(key, { ciphertext: r.ciphertext as Buffer, iv: r.iv as Buffer, authTag: r.authTag as Buffer }, messageAad(tenantId, m.conversationId, r.messageId as string, 'file'));
          r.fileName = attachmentName(key, tenantId, m.conversationId, r.messageId as string, r as never);
          const path = `files/messages/${String(r.messageId)}-${safeName(String(r.fileName))}`;
          add(path, new Uint8Array(bytes));
          files++;
          row.file = path;
        }
        if (table === 'EmployeeDocument' && !r.deletedAt) {
          const b64 = await open(keys(), { ciphertext: r.ciphertext as Buffer, iv: r.iv as Buffer, authTag: r.authTag as Buffer, wrappedDataKey: r.wrappedKey as Buffer, kekId: r.kekId as string }, `doc:${tenantId}:${r.id}`);
          const bytes = Buffer.from(b64, 'base64');
          const path = `files/documents/${r.userId}/${r.id}-${safeName(String(r.fileName))}`;
          add(path, new Uint8Array(bytes));
          files++;
          row.file = path;
          if (createHash('sha256').update(bytes).digest('hex') !== r.sha256) problems.push(`${path}: doesn't match the fingerprint taken when it was uploaded.`);
        }
      } catch {
        problems.push(`${table} ${String(r.id ?? '')}: a sealed value couldn't be opened.`);
      }
      for (const [k, v] of Object.entries(r)) {
        if (SKIP_COLUMNS.has(k)) continue;
        if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
          // A stored file (e.g. a signature image): written out, linked from the row.
          const path = `files/${table}/${String(r.id ?? files)}-${k}.${k.toLowerCase().includes('signature') ? 'png' : 'bin'}`;
          add(path, new Uint8Array(v));
          files++;
          row[k] = path;
          continue;
        }
        row[k] = scrub(v);
      }
      out.push(row);
    }
    const head = [...new Set(out.flatMap((x) => Object.keys(x)))];
    const csv = [head.map(csvCell).join(','), ...out.map((x) => head.map((h) => csvCell(cell(x[h]))).join(','))].join('\r\n') + '\r\n';
    // A byte-order mark so Excel reads accents (French names) correctly.
    add(`csv/${table}.csv`, enc.encode(`﻿${csv}`));
    add(`json/${table}.jsonl`, enc.encode(out.map(json).join('\n') + '\n'));
    counts.push({ table, rows: out.length, file: `csv/${table}.csv` });
  }

  const manifest = {
    organization: tenant.name,
    generatedAt: new Date().toISOString(),
    requestedBy: by.name,
    contents: counts,
    files,
    notIncluded: [
      'Sign-in secrets: password hashes, sessions, one-time links, passkeys, the single sign-on client secret, bank-connection credentials.',
      'The union hub: it belongs to the union local, not the employer. The local can export it.',
      'FlexcityHeadquarters billing and support records (your invoices are in the Billing screen).',
    ],
    problems,
    messages: withMessages
      ? 'Team messages are included (csv/Message.csv, with first versions of edited messages and removed messages; files in files/messages/): the organization has left FlexcityHeadquarters and its records pass to it.'
      : 'Team messages are not included: csv/Conversation.csv lists each conversation (kind, member ids, message count, dates) without what was said. Message text and files are included only in the export the organization receives when it leaves FlexcityHeadquarters. To read a conversation for a workplace investigation, open it in Messages with a reason.',
    readme:
      'csv/ has one spreadsheet per kind of record (dates in UTC, ISO 8601; nested values as JSON). json/ has the same records as JSON Lines. files/ holds documents, signatures and the logo; rows link to them by path. Contains personal information, Social Insurance Numbers and bank account numbers: store it as securely as your HR records.',
  };
  for (const k of convKeys.values()) k.fill(0);
  add('README.json', enc.encode(JSON.stringify(manifest, null, 2)));
  zip.end();
  return { tables: counts.length, rows: counts.reduce((a, c) => a + c.rows, 0), files, problems: problems.length };
}

/** Recorded after the download, in the organization's audit log. */
export async function recordExport(tenantId: string, userId: string, result: { tables: number; rows: number; files: number }) {
  await withTenant(tenantId, (tx) => audit(tx, { tenantId, actorId: userId, action: 'data.export', entity: 'Tenant', entityId: tenantId, after: result }));
}
