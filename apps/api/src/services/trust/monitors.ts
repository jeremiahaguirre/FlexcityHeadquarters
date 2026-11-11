/**
 * Trust tests ("monitors"): automated checks of the platform's real state, run by the worker every
 * few minutes (each test on its own frequency, under the worker's advisory lock, so several workers
 * never run them twice) and on demand from the Dev console.
 *
 * A result is a status (PASS, FAIL, WARN: needs a person's look or only meaningful in production,
 * ERROR: the check itself couldn't run), a sentence in English and French, and small details: counts,
 * table names, account names. Never a secret, a key, a token, a connection string or a city's records.
 *
 * History (TrustTestRun): a row when a test's result changes, and at most one an hour while it stays
 * the same; kept HISTORY_DAYS. The latest result is always on TrustTest.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@prisma/client';
import { platformMfaRequired } from '../../auth/platform.js';
import { config } from '../../config.js';
import { db, tenantIds, withTenant } from '../../lib/db.js';
import { leastPrivilegeProblems, roleFacts } from '../../lib/dbRole.js';
import { readiness } from '../../lib/health.js';
import { type MonitorDetails, SECRETISH } from './detailKeys.js';
import type { TestStatus } from './scoring.js';

export const HISTORY_DAYS = 400;
const DAY = 86_400_000;

export interface Result {
  status: TestStatus;
  en: string;
  fr: string;
  /** Only the keys detailKeys.ts lists (each has English and French labels in the web app). */
  details?: MonitorDetails;
}
export interface Monitor {
  key: string;
  title: string;
  titleFr: string;
  /** How often the worker runs it (minutes). */
  everyMinutes: number;
  run(ctx: { db: PrismaClient; now: Date }): Promise<Result>;
}

const r = (status: TestStatus, en: string, fr: string, details?: MonitorDetails): Result => ({ status, en, fr, details });
/** Plural endings: English is singular for exactly 1, French for 0 and 1 ("0 compte", "2 comptes"). */
export const sEn = (n: number) => (n === 1 ? '' : 's');
export const sFr = (n: number) => (n > 1 ? 's' : '');
/** "label : value" in French: a non-breaking space before the colon, as the web app writes it. */
const frColon = (a: string, b: string) => `${a}\u00a0: ${b}`;
const isProd = () => config().NODE_ENV === 'production';
const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

/** Every organization, one transaction each (the Trust tables need no organization; tenant tables do). */
async function eachTenant<T>(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0], id: string) => Promise<T>): Promise<Array<{ id: string; value: T }>> {
  const out: Array<{ id: string; value: T }> = [];
  for (const id of await tenantIds()) out.push({ id, value: await withTenant(id, (tx) => fn(tx, id)) });
  return out;
}

/** A health check's reason (lib/health.ts, in English) in French, part by part; an unknown part stays as is. */
export function healthReasonFr(reason: string): string {
  const channel = (c: string) => ({ email: 'courriels', sms: 'textos', sms_safety: 'textos de sécurité' })[c] ?? c;
  const how = (x: string) => ({ 'timed out': 'délai dépassé', unreachable: 'injoignable' })[x] ?? x;
  return reason.split('; ').map((part) => {
    let m: RegExpExecArray | null;
    if (part === 'not checked: database unavailable') return 'non vérifié : base de données indisponible';
    if (part === 'no background worker connected') return 'aucun traitement en arrière-plan connecté';
    if ((m = /^worker last reported (\d+)s ago$/.exec(part))) return `dernier signal du traitement il y a ${m[1]} s`;
    if ((m = /^worker heartbeat (.+)$/.exec(part))) return `signal du traitement : ${how(m[1]!)}`;
    if ((m = /^database (.+)$/.exec(part))) return `base de données : ${how(m[1]!)}`;
    if ((m = /^outbox backlog (.+)$/.exec(part))) return `file des messages : ${how(m[1]!)}`;
    if ((m = /^safety texts waiting longer than (\d+)s$/.exec(part))) return `textos de sécurité en attente depuis plus de ${m[1]} s`;
    if ((m = /^(.+) waiting longer than (\d+)s$/.exec(part))) return `${m[1]!.split(' and ').map(channel).join(' et ')} en attente depuis plus de ${m[2]} s`;
    return part;
  }).join('; ');
}

// ---- Row-level security ---------------------------------------------------------------------

const RLS_SQL = new URL('../../../db/rls.sql', import.meta.url);
/** The table lists in db/rls.sql, when the file ships with the build. */
export function rlsLists(text?: string): { tenant: string[]; fh: string[]; fhOnly: string[] } | null {
  let sql = text;
  if (sql === undefined) {
    try {
      sql = readFileSync(RLS_SQL, 'utf8');
    } catch {
      return null;
    }
  }
  const list = (name: string) => {
    const mm = new RegExp(`${name} text\\[\\] := ARRAY\\[([^\\]]*)\\]`).exec(sql!);
    return mm ? [...mm[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!) : [];
  };
  return { tenant: list('tenant_tables'), fh: list('fh_tables'), fhOnly: list('fh_only_tables') };
}

/** FH's own tables that carry a tenantId and are read across cities by the Dev console (RLS on, not forced). */
const CROSS_CITY = new Set(['PlatformAudit', 'BillingAccount', 'Invoice', 'InvoiceLine', 'InvoicePayment', 'InvoiceCounter', 'PadAgreement', 'PadDebit', 'SupportSession', 'Tenant', 'WebAuthnChallenge']);

/**
 * Every table in `schema` that holds an organization's rows (a "tenantId" column) must have
 * row-level security on, at least one policy, and (except FH's cross-city records) forced; every
 * table db/rls.sql lists must exist with row-level security on.
 */
export async function checkRls(prisma: PrismaClient, schema = 'public', lists = rlsLists()): Promise<Result> {
  const rows = await prisma.$queryRaw<Array<{ relname: string; rls: boolean; forced: boolean; policies: number; tenant: boolean }>>`
    SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenantId' AND NOT a.attisdropped) AS tenant
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${schema} AND c.relkind = 'r'`;
  const problems: string[] = [];
  const byName = new Map(rows.map((x) => [x.relname, x]));
  for (const t of rows.filter((x) => x.tenant)) {
    if (!t.rls) problems.push(`${t.relname}: row-level security off`);
    else if (!t.policies) problems.push(`${t.relname}: no policy`);
    else if (!t.forced && !CROSS_CITY.has(t.relname)) problems.push(`${t.relname}: not forced`);
    else if (CROSS_CITY.has(t.relname) && !t.rls) problems.push(`${t.relname}: row-level security off`);
  }
  if (lists && schema === 'public') {
    for (const name of [...lists.tenant, ...lists.fh, ...lists.fhOnly]) {
      const t = byName.get(name);
      if (!t) problems.push(`${name}: listed in rls.sql but missing`);
      else if (!t.rls && !problems.some((p) => p.startsWith(`${name}:`))) problems.push(`${name}: row-level security off`);
    }
  }
  const checked = rows.filter((x) => x.tenant).length;
  if (problems.length) return r('FAIL', `${problems.length} table${sEn(problems.length)} not isolated: ${problems.slice(0, 5).join('; ')}`, `${problems.length} table${sFr(problems.length)} non isolée${sFr(problems.length)} : ${problems.slice(0, 5).join('; ')}`, { problems: problems.slice(0, 50), tablesChecked: checked, rlsSqlRead: !!lists });
  return r('PASS', `All ${checked} tables with organization data are isolated by row-level security.`, `Les ${checked} tables contenant des données d’organisation sont isolées par la sécurité au niveau des lignes.`, { tablesChecked: checked, rlsSqlRead: !!lists });
}

// ---- Security headers -----------------------------------------------------------------------

export function headerProblems(h: Record<string, string | undefined>, production: boolean): { missing: string[]; hsts: boolean } {
  const missing: string[] = [];
  if (h['x-content-type-options'] !== 'nosniff') missing.push('X-Content-Type-Options');
  if (!h['x-frame-options']) missing.push('X-Frame-Options');
  if (!/frame-ancestors 'none'|default-src/.test(h['content-security-policy'] ?? '')) missing.push('Content-Security-Policy');
  if (!h['referrer-policy']) missing.push('Referrer-Policy');
  const hsts = /max-age=(\d+)/.exec(h['strict-transport-security'] ?? '');
  const hstsOk = !!hsts && Number(hsts[1]) >= 15_552_000;
  if (production && !hstsOk) missing.push('Strict-Transport-Security');
  return { missing, hsts: hstsOk };
}

/** The API's own /healthz answer: TRUST_SELF_URL when set (the deployed address), else an in-process copy of the header middleware. */
async function selfHeaders(): Promise<{ headers: Record<string, string | undefined>; source: string }> {
  const base = process.env.TRUST_SELF_URL;
  const pick = (get: (k: string) => string | null) =>
    Object.fromEntries(['x-content-type-options', 'x-frame-options', 'content-security-policy', 'referrer-policy', 'strict-transport-security'].map((k) => [k, get(k) ?? undefined]));
  if (base) {
    const res = await fetch(new URL('/healthz', base), { signal: AbortSignal.timeout(5000) });
    return { headers: pick((k) => res.headers.get(k)), source: 'deployed' };
  }
  const { securityHeaders } = await import('../../app.js');
  const server = createServer((req, res) => securityHeaders(req as never, res as never, () => res.end('ok')));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`, { signal: AbortSignal.timeout(5000) });
    return { headers: pick((k) => res.headers.get(k)), source: 'in-process' };
  } finally {
    server.close();
  }
}

/** The region in a KMS key or alias ARN ("arn:aws:kms:ca-central-1:…"), or null for a bare key id or alias. */
export function kmsRegion(arn: string): string | null {
  return /^arn:aws[\w-]*:kms:([a-z0-9-]+):/.exec(arn)?.[1] ?? null;
}

// ---- The tests ----------------------------------------------------------------------------

const DEV_SECRET = /dev-only|replace-with|change-me|changeme|example|secret-secret|^(.)\1+$/i;

/** Evidence on a control newer than `days` (and still valid). */
async function recentEvidence(prisma: PrismaClient, controlKey: string, days: number, now: Date, kind?: string) {
  return prisma.trustEvidence.findFirst({
    where: { controlKey, deletedAt: null, createdAt: { gte: ago(now, days) }, ...(kind ? { kind } : {}), OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, result: true, title: true },
  });
}

export const MONITORS: Monitor[] = [
  {
    key: 'platform_mfa', title: 'Dev console admins use passkeys', titleFr: 'Les administrateurs de la console utilisent un passe-clé', everyMinutes: 5,
    async run({ db: p }) {
      const withKeys = await p.platformPasskey.groupBy({ by: ['adminId'], _count: true });
      const all = await p.platformAdmin.findMany({ where: { disabledAt: null }, select: { id: true, name: true } });
      const missing = all.filter((a) => !withKeys.some((k) => k.adminId === a.id)).map((a) => a.name);
      const enforced = platformMfaRequired();
      if (!enforced) return r('FAIL', 'The passkey requirement is switched off in this environment (PLATFORM_MFA=off).', 'L’exigence du passe-clé est désactivée dans cet environnement (PLATFORM_MFA=off).', { enforced, admins: all.length, missingPasskeys: missing });
      const m = missing.length;
      if (m) return r('FAIL', `${m} of ${all.length} admins ${m === 1 ? 'has' : 'have'} no passkey yet.`, `${m} administrateur${sFr(m)} sur ${all.length} ${m > 1 ? 'n’ont' : 'n’a'} pas encore de passe-clé.`, { enforced, admins: all.length, missingPasskeys: missing });
      if (all.length === 1) return r('PASS', 'Passkeys required; the only admin has one.', 'Passe-clé exigé; le seul administrateur en a un.', { enforced, admins: 1 });
      return r('PASS', `Passkeys required; all ${all.length} admins have one.`, `Passe-clé exigé; les ${all.length} administrateurs en ont un.`, { enforced, admins: all.length });
    },
  },
  {
    key: 'city_mfa', title: 'Organizations require MFA for HR administrators', titleFr: 'Les organisations exigent l’AMF pour les administrateurs RH', everyMinutes: 15,
    async run() {
      const rows = await eachTenant(async (tx) => {
        const t = await tx.tenant.findFirstOrThrow({ select: { name: true, mfaRoles: true, disabledAt: true } });
        const sso = await tx.ssoConnection.count({ where: { idpMfa: true } }).catch(() => 0);
        return { name: t.name, ok: t.mfaRoles.includes('HR_ADMIN') || sso > 0, closed: !!t.disabledAt };
      });
      const open = rows.filter((x) => !x.value.closed);
      const without = open.filter((x) => !x.value.ok).map((x) => x.value.name);
      if (!open.length) return r('PASS', 'No organizations yet.', 'Aucune organisation pour l’instant.', { organizations: 0 });
      const w = without.length;
      if (w) return r('WARN', `${w} of ${open.length} organization${sEn(open.length)} ${w === 1 ? 'doesn’t' : 'don’t'} require a passkey for HR administrators (their choice; recommend it).`, `${w} organisation${sFr(w)} sur ${open.length} ${w > 1 ? 'n’exigent' : 'n’exige'} pas de passe-clé pour les administrateurs RH (leur choix; à recommander).`, { organizations: open.length, without: without.slice(0, 30) });
      if (open.length === 1) return r('PASS', 'The only organization requires MFA for HR administrators.', 'La seule organisation exige l’AMF pour les administrateurs RH.', { organizations: 1 });
      return r('PASS', `All ${open.length} organizations require MFA for HR administrators.`, `Les ${open.length} organisations exigent l’AMF pour les administrateurs RH.`, { organizations: open.length });
    },
  },
  {
    key: 'rls', title: 'Row-level security on every organization table', titleFr: 'Sécurité au niveau des lignes sur chaque table d’organisation', everyMinutes: 5,
    run: ({ db: p }) => checkRls(p),
  },
  {
    key: 'db_role', title: 'App database role is least-privilege', titleFr: 'Rôle de base de données à privilèges minimaux', everyMinutes: 15,
    async run() {
      const f = await roleFacts(config().APP_DATABASE_URL);
      const problems = leastPrivilegeProblems(f);
      if (problems.length) return r('FAIL', `The app’s database role is too powerful: ${problems.join('; ')}.`, `Le rôle de base de données de l’application est trop puissant : ${problems.join('; ')}.`, { role: f.role, superuser: f.superuser, bypassRls: f.bypassRls, canCreate: f.canCreate, ownsTables: f.ownsTables });
      return r('PASS', `Role ${f.role}: no superuser, no BYPASSRLS, no schema rights, owns no tables.`, `Rôle ${f.role} : pas superutilisateur, pas de BYPASSRLS, aucun droit sur le schéma, aucune table.`, { role: f.role, superuser: false, bypassRls: false });
    },
  },
  {
    key: 'kek', title: 'Encryption keys configured', titleFr: 'Clés de chiffrement configurées', everyMinutes: 15,
    async run() {
      const c = config();
      if (c.KMS_KEY_ARN && !c.LOCAL_KEK_BASE64) {
        // The key's own region (from its ARN; an alias or bare key id uses AWS_REGION): CR-02 promises a key in Canada.
        const region = kmsRegion(c.KMS_KEY_ARN) ?? c.AWS_REGION;
        if (!region.startsWith('ca-')) return r('FAIL', `The AWS KMS key is in ${region}, outside Canada.`, `La clé AWS KMS est dans la région ${region}, hors du Canada.`, { provider: 'kms', region });
        return r('PASS', `Records are sealed with an AWS KMS key in ${region} (Canada).`, `Les dossiers sont scellés avec une clé AWS KMS dans la région ${region} (Canada).`, { provider: 'kms', region });
      }
      if (isProd()) return r('FAIL', 'Production must use AWS KMS and no local key.', 'La production doit utiliser AWS KMS et aucune clé locale.', { provider: c.KMS_KEY_ARN ? 'kms+local' : 'local' });
      const len = c.LOCAL_KEK_BASE64 ? Buffer.from(c.LOCAL_KEK_BASE64, 'base64').length : 0;
      if (len !== 32) return r('FAIL', 'No usable key-encryption key: sealed records can’t be read or written.', 'Aucune clé de chiffrement de clés utilisable : les dossiers scellés ne peuvent être lus ni écrits.', { provider: 'none' });
      return r('WARN', 'A local development key is in use (fine here; production uses KMS).', 'Une clé de développement locale est utilisée (correct ici; la production utilise KMS).', { provider: 'local', production: false });
    },
  },
  {
    key: 'jwt_secret', title: 'Sign-in signing secret is strong', titleFr: 'Le secret de signature est robuste', everyMinutes: 60,
    async run() {
      const s = config().JWT_SECRET;
      const distinct = new Set(s).size;
      const details: MonitorDetails = { length: s.length, distinctCharacters: distinct };
      if (s.length < 32 || distinct < 12) return r('FAIL', 'The signing secret is too short or too repetitive.', 'Le secret de signature est trop court ou trop répétitif.', details);
      if (DEV_SECRET.test(s)) return isProd() ? r('FAIL', 'Production is using a development signing secret.', 'La production utilise un secret de signature de développement.', details) : r('WARN', 'A development signing secret is in use (fine here, never in production).', 'Un secret de signature de développement est utilisé (correct ici, jamais en production).', details);
      return r('PASS', `Signing secret: ${s.length} characters, random-looking.`, `Secret de signature : ${s.length} caractères, d’apparence aléatoire.`, details);
    },
  },
  {
    key: 'security_headers', title: 'HTTPS and security headers', titleFr: 'HTTPS et en-têtes de sécurité', everyMinutes: 15,
    async run() {
      const { headers, source } = await selfHeaders();
      const prod = isProd() || !!process.env.TRUST_SELF_URL?.startsWith('https:');
      const { missing, hsts } = headerProblems(headers, prod);
      if (missing.length) return r('FAIL', `Missing or weak: ${missing.join(', ')}.`, `Manquants ou faibles : ${missing.join(', ')}.`, { source, missing, hsts });
      if (!hsts) return r('WARN', 'Security headers set; HSTS is only sent in production.', 'En-têtes de sécurité présents; HSTS n’est envoyé qu’en production.', { source, hsts });
      return r('PASS', 'HSTS, CSP, frame, sniffing and referrer headers all set.', 'En-têtes HSTS, CSP, cadre, détection et référent tous présents.', { source, hsts });
    },
  },
  {
    key: 'db_tls', title: 'Database connections use TLS', titleFr: 'Les connexions à la base de données utilisent TLS', everyMinutes: 60,
    async run() {
      const ssl = /[?&]sslmode=(require|verify-ca|verify-full)\b/.exec(config().APP_DATABASE_URL)?.[1] ?? null;
      if (ssl) return r('PASS', `Database connections require TLS (${ssl}).`, `Les connexions exigent TLS (${ssl}).`, { sslmode: ssl });
      if (isProd()) return r('FAIL', 'Production database connections don’t require TLS.', 'Les connexions de production n’exigent pas TLS.', { sslmode: null });
      return r('WARN', 'Local database without TLS (production refuses to start without it).', 'Base de données locale sans TLS (la production refuse de démarrer sans).', { sslmode: null, production: false });
    },
  },
  {
    key: 'readiness', title: 'Service ready and worker running', titleFr: 'Service disponible et traitement en cours', everyMinutes: 5,
    async run() {
      const x = await readiness({ strict: true });
      const { database, worker } = x.checks;
      const details: MonitorDetails = { database: database.status, worker: worker.status, workerAgeS: worker.lastBeatAgeS ?? null };
      if (database.status !== 'ok') return r('FAIL', 'The database isn’t answering.', 'La base de données ne répond pas.', details);
      if (worker.status !== 'ok') return r('FAIL', `Background worker: ${worker.reason ?? 'not reporting'}.`, `Traitement en arrière-plan : ${worker.reason ? healthReasonFr(worker.reason) : 'aucun signal'}.`, details);
      return r('PASS', 'Database and background worker healthy.', 'Base de données et traitement en arrière-plan en bon état.', details);
    },
  },
  {
    key: 'outbox', title: 'Email and text backlog healthy', titleFr: 'File de courriels et de textos en bon état', everyMinutes: 5,
    async run() {
      const { outbox } = (await readiness({ strict: true })).checks;
      const details: MonitorDetails = { oldestAgeS: outbox.oldestAgeS ?? null, oldestSafetyS: outbox.oldestSafetyS ?? null };
      if (outbox.status !== 'ok') return r('FAIL', `Messages waiting: ${outbox.reason ?? 'backlog'}.`, `Messages en attente : ${outbox.reason ? healthReasonFr(outbox.reason) : 'retard'}.`, details);
      return r('PASS', 'No email or text has waited too long.', 'Aucun courriel ni texto n’attend trop longtemps.', details);
    },
  },
  {
    key: 'error_tracking', title: 'Error tracking configured', titleFr: 'Suivi des erreurs configuré', everyMinutes: 60,
    async run() {
      if (config().SENTRY_DSN) return r('PASS', 'Errors are reported (scrubbed) to the error-tracking service.', 'Les erreurs sont signalées (épurées) au service de suivi.', { configured: true });
      return r('FAIL', 'No error-tracking service yet (SENTRY_DSN unset): choose a Canadian-hosted vendor.', 'Aucun service de suivi des erreurs (SENTRY_DSN non défini) : choisissez un fournisseur hébergé au Canada.', { configured: false });
    },
  },
  {
    key: 'metrics_token', title: 'Metrics protected by a token', titleFr: 'Mesures protégées par un jeton', everyMinutes: 60,
    async run() {
      const t = config().METRICS_TOKEN;
      if (t) return r('PASS', 'Metrics are on and need a bearer token.', 'Les mesures sont actives et exigent un jeton.', { configured: true, length: t.length });
      return r('FAIL', 'Metrics are off (METRICS_TOKEN unset): nothing to alert on.', 'Les mesures sont désactivées (METRICS_TOKEN non défini) : rien pour alerter.', { configured: false });
    },
  },
  {
    key: 'data_residency', title: 'Hosted in a Canadian region', titleFr: 'Hébergé dans une région canadienne', everyMinutes: 60,
    async run() {
      const region = config().AWS_REGION;
      if (region.startsWith('ca-')) return r('PASS', `Region ${region} (Canada).`, `Région ${region} (Canada).`, { region });
      return r('FAIL', `Region ${region} is outside Canada.`, `La région ${region} est hors du Canada.`, { region });
    },
  },
  {
    key: 'backup_evidence', title: 'Backups confirmed this week', titleFr: 'Sauvegardes confirmées cette semaine', everyMinutes: 60,
    async run({ db: p, now }) {
      const e = await recentEvidence(p, 'BK-01', 8, now);
      if (e) return r('PASS', `Backup confirmation recorded ${e.createdAt.toISOString().slice(0, 10)}.`, `Confirmation de sauvegarde consignée le ${e.createdAt.toISOString().slice(0, 10)}.`, { at: e.createdAt });
      return r('FAIL', 'No backup confirmation in the last 8 days. The app has no backup job of its own: record the hosting provider’s result.', 'Aucune confirmation de sauvegarde depuis 8 jours. L’application n’a pas sa propre tâche de sauvegarde : consignez le résultat de l’hébergeur.', { manual: true });
    },
  },
  {
    key: 'restore_evidence', title: 'Restore tested this month', titleFr: 'Restauration testée ce mois-ci', everyMinutes: 60,
    async run({ db: p, now }) {
      const e = await recentEvidence(p, 'BK-02', 35, now);
      if (e) return r('PASS', `Restore test recorded ${e.createdAt.toISOString().slice(0, 10)}.`, `Test de restauration consigné le ${e.createdAt.toISOString().slice(0, 10)}.`, { at: e.createdAt });
      return r('FAIL', 'No restore test recorded in the last 35 days.', 'Aucun test de restauration consigné depuis 35 jours.', { manual: true });
    },
  },
  {
    key: 'retention_job', title: 'Retention ran in the last 25 hours', titleFr: 'La conservation s’est exécutée dans les 25 dernières heures', everyMinutes: 30,
    async run({ db: p, now }) {
      const j = await p.workerJobRun.findUnique({ where: { name: 'retention' } });
      if (!j?.lastOkAt) return r('FAIL', 'The retention job has never finished on record.', 'Aucune exécution réussie de la tâche de conservation n’est consignée.', { lastOkAt: null });
      const h = Math.round((now.getTime() - j.lastOkAt.getTime()) / 3_600_000);
      if (h > 25) return r('FAIL', `Retention last finished ${h} hours ago.`, `La conservation s’est terminée il y a ${h} heures.`, { lastOkAt: j.lastOkAt, lastErrorAt: j.lastErrorAt });
      return r('PASS', `Retention finished ${h <= 1 ? 'within the hour' : `${h} hours ago`}.`, `Conservation terminée ${h <= 1 ? 'dans la dernière heure' : `il y a ${h} heures`}.`, { lastOkAt: j.lastOkAt });
    },
  },
  {
    key: 'audit_log', title: 'Audit log written and append-only', titleFr: 'Journal d’audit alimenté et en ajout seulement', everyMinutes: 15,
    async run({ db: p, now }) {
      // The role the app actually connects as (db() uses APP_DATABASE_URL), on both logs: each city's and the Dev console's.
      const priv = await p.$queryRaw<Array<{ tbl: string; upd: boolean; del: boolean }>>`
        SELECT t AS tbl, has_table_privilege(current_user, format('%I', t), 'UPDATE') AS upd, has_table_privilege(current_user, format('%I', t), 'DELETE') AS del
          FROM unnest(ARRAY['AuditLog', 'PlatformAudit']) AS t`;
      const editable = priv.filter((x) => x.upd || x.del).map((x) => x.tbl);
      if (editable.length) return r('FAIL', `The app can change or delete audit entries (${editable.join(', ')}).`, `L’application peut modifier ou supprimer des entrées d’audit (${editable.join(', ')}).`, { appendOnly: false, editableTables: editable });
      const fh = await p.platformAudit.findFirst({ orderBy: { at: 'desc' }, select: { at: true } });
      let newest = fh?.at ?? null;
      for (const x of await eachTenant((tx) => tx.auditLog.findFirst({ orderBy: { at: 'desc' }, select: { at: true } }))) if (x.value && (!newest || x.value.at > newest)) newest = x.value.at;
      if (newest && now.getTime() - newest.getTime() <= DAY) return r('PASS', 'Audit entries written in the last 24 hours; the app can’t edit them.', 'Entrées d’audit écrites dans les 24 dernières heures; l’application ne peut les modifier.', { appendOnly: true, newest });
      return r('WARN', 'No audit entry in 24 hours: a quiet day, or logging stopped. Check.', 'Aucune entrée d’audit en 24 heures : journée calme, ou journalisation arrêtée. À vérifier.', { appendOnly: true, newest });
    },
  },
  {
    key: 'dependency_audit', title: 'CI security scan passed this week', titleFr: 'Analyse de sécurité CI réussie cette semaine', everyMinutes: 60,
    async run({ db: p, now }) {
      const e = await p.trustEvidence.findFirst({ where: { controlKey: 'VM-01', kind: 'CI', deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, result: true } });
      if (!e || now.getTime() - e.createdAt.getTime() > 8 * DAY) return r('WARN', 'No CI security result recorded in 8 days. Record the latest “Security” workflow run (dependency audit, CodeQL, secret scan).', 'Aucun résultat de sécurité CI consigné depuis 8 jours. Consignez la dernière exécution du flux « Security » (audit des dépendances, CodeQL, recherche de secrets).', { lastAt: e?.createdAt ?? null });
      if (e.result === 'FAIL') return r('FAIL', 'The latest CI security run failed.', 'La dernière analyse de sécurité CI a échoué.', { lastAt: e.createdAt });
      return r('PASS', `CI security run passed (${e.createdAt.toISOString().slice(0, 10)}).`, `Analyse de sécurité CI réussie (${e.createdAt.toISOString().slice(0, 10)}).`, { lastAt: e.createdAt });
    },
  },
  {
    key: 'stale_admins', title: 'No stale Dev console accounts', titleFr: 'Aucun compte de console inactif', everyMinutes: 60,
    async run({ db: p, now }) {
      const admins = await p.platformAdmin.findMany({ where: { disabledAt: null }, select: { name: true, lastLoginAt: true, createdAt: true } });
      const stale = admins.filter((a) => (a.lastLoginAt ?? a.createdAt) < ago(now, 90)).map((a) => a.name);
      const n = stale.length;
      if (n) return r('FAIL', `${n} account${sEn(n)} unused for over 90 days: disable or confirm.`, `${n} compte${sFr(n)} inutilisé${sFr(n)} depuis plus de 90 jours : désactiver ou confirmer.`, { stale, admins: admins.length });
      if (!admins.length) return r('PASS', 'No active account.', 'Aucun compte actif.', { admins: 0 });
      if (admins.length === 1) return r('PASS', 'The only active account was used in the last 90 days.', 'Le seul compte actif a servi dans les 90 derniers jours.', { admins: 1 });
      return r('PASS', `All ${admins.length} active accounts used in the last 90 days.`, `Les ${admins.length} comptes actifs ont servi dans les 90 derniers jours.`, { admins: admins.length });
    },
  },
  {
    key: 'offboarded_admins', title: 'Departed staff have no access', titleFr: 'Le personnel parti n’a plus d’accès', everyMinutes: 15,
    async run({ db: p, now }) {
      const live = await p.platformSession.findMany({ where: { revokedAt: null, expiresAt: { gt: now }, admin: { disabledAt: { not: null } } }, select: { admin: { select: { name: true } } } });
      const names = [...new Set(live.map((s) => s.admin.name))];
      const n = names.length;
      if (n) return r('FAIL', `${n} disabled account${sEn(n)} still ${n === 1 ? 'has' : 'have'} an open session.`, `${n} compte${sFr(n)} désactivé${sFr(n)} ${n > 1 ? 'ont' : 'a'} encore une session ouverte.`, { accounts: names });
      const disabled = await p.platformAdmin.count({ where: { disabledAt: { not: null } } });
      return r('PASS', `No disabled account has a session (${disabled} disabled).`, `Aucun compte désactivé n’a de session (${disabled} désactivé${sFr(disabled)}).`, { disabled });
    },
  },
  {
    key: 'api_key_age', title: 'Integration keys rotated yearly', titleFr: 'Clés d’intégration renouvelées chaque année', everyMinutes: 60,
    async run({ now }) {
      const rows = await eachTenant(async (tx) => {
        const n = await tx.apiKey.count({ where: { revokedAt: null, createdAt: { lt: ago(now, 365) }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
        return n ? { n, name: (await tx.tenant.findFirstOrThrow({ select: { name: true } })).name } : null;
      });
      const old = rows.filter((x) => x.value).map((x) => x.value!);
      const total = old.reduce((s, x) => s + x.n, 0);
      if (total) return r('WARN', `${total} active API key${sEn(total)} over a year old: ask the organization to rotate ${total === 1 ? 'it' : 'them'}.`, `${total} clé${sFr(total)} API active${sFr(total)} de plus d’un an : demandez à l’organisation de ${total > 1 ? 'les' : 'la'} renouveler.`, { keys: total, organizations: old.map((x) => x.name).slice(0, 30) });
      return r('PASS', 'No active API key is over a year old.', 'Aucune clé API active n’a plus d’un an.', { keys: 0 });
    },
  },
  {
    key: 'webhooks_failing', title: 'Webhook endpoints delivering', titleFr: 'Points de terminaison Webhook fonctionnels', everyMinutes: 15,
    async run() {
      const rows = await eachTenant((tx) => tx.webhookEndpoint.count({ where: { OR: [{ disabledReason: 'failures' }, { enabled: true, consecutiveFailures: { gte: 5 } }] } }));
      const failing = rows.reduce((s, x) => s + x.value, 0);
      const orgs = rows.filter((x) => x.value).length;
      if (failing) return r('WARN', `${failing} webhook endpoint${sEn(failing)} in ${orgs} organization${sEn(orgs)} failing or turned off after failures.`, `${failing} point${sFr(failing)} de terminaison Webhook dans ${orgs} organisation${sFr(orgs)} en échec ou désactivé${sFr(failing)} après des échecs.`, { endpoints: failing, organizations: orgs });
      return r('PASS', 'Every webhook endpoint is delivering.', 'Chaque point de terminaison Webhook fonctionne.', { endpoints: 0 });
    },
  },
  {
    key: 'vendor_reviews', title: 'Vendor reviews and documents current', titleFr: 'Revues et documents des fournisseurs à jour', everyMinutes: 60,
    async run({ db: p, now }) {
      const vs = await p.trustVendor.findMany({ where: { status: 'ACTIVE' }, select: { name: true, nextReviewAt: true, dpaExpiresAt: true, soc2ExpiresAt: true, isoExpiresAt: true } });
      const late = vs.filter((v) => [v.nextReviewAt, v.dpaExpiresAt, v.soc2ExpiresAt, v.isoExpiresAt].some((d) => d && d < now)).map((v) => v.name);
      const never = vs.filter((v) => !v.nextReviewAt).map((v) => v.name);
      if (late.length) return r('FAIL', `${late.length} vendor${sEn(late.length)} with an overdue review or an expired agreement or report.`, `${late.length} fournisseur${sFr(late.length)} avec une revue en retard ou une entente ou un rapport expiré.`, { overdue: late, unscheduled: never });
      if (never.length) return r('WARN', `${never.length} vendor${sEn(never.length)} without a review date.`, `${never.length} fournisseur${sFr(never.length)} sans date de revue.`, { unscheduled: never });
      if (!vs.length) return r('PASS', 'No active vendor.', 'Aucun fournisseur actif.', { vendors: 0 });
      if (vs.length === 1) return r('PASS', 'The only active vendor is reviewed on time.', 'Le seul fournisseur actif est revu à temps.', { vendors: 1 });
      return r('PASS', `All ${vs.length} active vendors reviewed on time.`, `Les ${vs.length} fournisseurs actifs sont revus à temps.`, { vendors: vs.length });
    },
  },
  {
    key: 'policy_acks', title: 'Policies approved, current and accepted', titleFr: 'Politiques approuvées, à jour et acceptées', everyMinutes: 30,
    async run({ db: p, now }) {
      const policies = await p.trustPolicy.findMany({ select: { title: true, titleFr: true, nextReviewAt: true, versions: { where: { status: 'PUBLISHED' }, select: { id: true, acks: { select: { adminId: true } } } } } });
      const admins = await p.platformAdmin.findMany({ where: { disabledAt: null }, select: { id: true } });
      // Policy titles in both languages ({ en, fr }), so the drawer names them in the reader's language.
      const name = (x: { title: string; titleFr: string }) => ({ en: x.title, fr: x.titleFr });
      const unpublished = policies.filter((x) => !x.versions.length).map(name);
      const overdue = policies.filter((x) => x.nextReviewAt && x.nextReviewAt < now).map(name);
      let missing = 0;
      for (const x of policies) for (const v of x.versions) missing += admins.filter((a) => !v.acks.some((k) => k.adminId === a.id)).length;
      const details: MonitorDetails = { policies: policies.length, unpublished, reviewOverdue: overdue, acknowledgementsMissing: missing };
      const u = unpublished.length;
      const o = overdue.length;
      if (o || u || missing) return r('FAIL', `Policies: ${u} not yet published, ${o} past review, ${missing} acknowledgement${sEn(missing)} missing.`, `Politiques : ${u} non publiée${sFr(u)}, ${o} à revoir, ${missing} acceptation${sFr(missing)} manquante${sFr(missing)}.`, details);
      if (!policies.length) return r('PASS', 'No policy yet.', 'Aucune politique pour l’instant.', details);
      if (policies.length === 1) return r('PASS', 'The only policy is published, current and accepted by every admin.', 'La seule politique est publiée, à jour et acceptée par chaque administrateur.', details);
      return r('PASS', `All ${policies.length} policies published, current and accepted by every admin.`, `Les ${policies.length} politiques sont publiées, à jour et acceptées par chaque administrateur.`, details);
    },
  },
  {
    key: 'risks_overdue', title: 'Risk treatments and reviews on time', titleFr: 'Traitements et revues des risques à temps', everyMinutes: 60,
    async run({ db: p, now }) {
      const risks = await p.trustRisk.findMany({ where: { status: 'OPEN' }, select: { ref: true, dueAt: true, lastReviewedAt: true, createdAt: true, reviewEveryDays: true } });
      const late = risks.filter((x) => (x.dueAt && x.dueAt < now) || (x.lastReviewedAt ?? x.createdAt).getTime() + x.reviewEveryDays * DAY < now.getTime()).map((x) => x.ref);
      if (late.length) return r('FAIL', `${late.length} risk${sEn(late.length)} past ${late.length === 1 ? 'its' : 'their'} treatment date or review.`, `${late.length} risque${sFr(late.length)} en retard de traitement ou de revue.`, { overdue: late, open: risks.length });
      if (!risks.length) return r('PASS', 'No open risk.', 'Aucun risque ouvert.', { open: 0 });
      if (risks.length === 1) return r('PASS', 'The only open risk is on schedule.', 'Le seul risque ouvert est à jour.', { open: 1 });
      return r('PASS', `All ${risks.length} open risks on schedule.`, `Les ${risks.length} risques ouverts sont à jour.`, { open: risks.length });
    },
  },
  {
    key: 'commitments_overdue', title: 'Customer commitments on time', titleFr: 'Engagements envers les clients à temps', everyMinutes: 15,
    async run({ db: p, now }) {
      const late = await p.trustCommitment.findMany({ where: { status: 'OPEN', dueAt: { lt: now } }, select: { title: true, customer: true } });
      const soon = await p.trustCommitment.count({ where: { status: 'OPEN', dueAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) } } });
      // Each item in both languages ({ en, fr }), so the drawer writes "Client : title" in French.
      if (late.length) return r('FAIL', `${late.length} customer commitment${sEn(late.length)} overdue.`, `${late.length} engagement${sFr(late.length)} envers des clients en retard.`, { overdue: late.map((c) => ({ en: `${c.customer}: ${c.title}`, fr: frColon(c.customer, c.title) })).slice(0, 30), dueIn7Days: soon });
      return r('PASS', `No commitment overdue (${soon} due within 7 days).`, `Aucun engagement en retard (${soon} à échéance dans 7 jours).`, { dueIn7Days: soon });
    },
  },
  {
    key: 'evidence_overdue', title: 'Evidence requests met on time', titleFr: 'Demandes de preuves satisfaites à temps', everyMinutes: 60,
    async run({ db: p, now }) {
      const late = await p.trustEvidenceRequest.findMany({ where: { status: 'OPEN', dueAt: { lt: now } }, select: { title: true, controlKey: true } });
      if (late.length) return r('FAIL', `${late.length} evidence request${sEn(late.length)} overdue.`, `${late.length} demande${sFr(late.length)} de preuves en retard.`, { overdue: late.map((x) => ({ en: `${x.controlKey}: ${x.title}`, fr: frColon(x.controlKey, x.title) })).slice(0, 30) });
      return r('PASS', 'No evidence request overdue.', 'Aucune demande de preuves en retard.', {});
    },
  },
];

export const monitorByKey = new Map(MONITORS.map((x) => [x.key, x]));

const TIMEOUT_MS = 20_000;
function timed<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

/** Keys that look like secrets (detailKeys.ts SECRETISH) never reach a result, whatever a check returns. */
export function scrubDetails(d: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!d) return {};
  return Object.fromEntries(Object.entries(d).filter(([k]) => !SECRETISH.test(k) || k === 'apiKeys'));
}

export interface RunOutcome { key: string; status: TestStatus; changed: boolean }

/**
 * Runs the tests that are due (or `keys`, or all with `force`), records each result, keeps history,
 * and raises an alert when a test starts failing or recovers. Returns what ran.
 */
export async function runMonitors(opts: { keys?: string[]; force?: boolean; trigger?: 'schedule' | 'manual'; now?: Date; prisma?: PrismaClient } = {}): Promise<RunOutcome[]> {
  const p = opts.prisma ?? db();
  const now = opts.now ?? new Date();
  const trigger = opts.trigger ?? 'schedule';
  const rows = new Map((await p.trustTest.findMany()).map((x) => [x.key, x]));
  const out: RunOutcome[] = [];
  for (const mon of MONITORS) {
    if (opts.keys && !opts.keys.includes(mon.key)) continue;
    const row = rows.get(mon.key);
    if (row && !row.enabled && !opts.keys) continue;
    const due = !row?.lastRunAt || now.getTime() - row.lastRunAt.getTime() >= mon.everyMinutes * 60_000 - 5_000;
    if (!due && !opts.force && !opts.keys) continue;
    const started = Date.now();
    let res: Result;
    try {
      res = await timed(mon.run({ db: p, now }));
    } catch (e) {
      // The reason only ("timed out", an error class): a message could carry a connection string.
      res = r('ERROR', `The check couldn’t run (${e instanceof Error && e.message === 'timed out' ? 'timed out' : 'error'}).`, `Le test n’a pas pu s’exécuter (${e instanceof Error && e.message === 'timed out' ? 'délai dépassé' : 'erreur'}).`, { error: e instanceof Error ? e.name : 'Error' });
    }
    const details = { ...scrubDetails(res.details), summaryFr: res.fr };
    const durationMs = Date.now() - started;
    const changed = row?.lastStatus !== res.status;
    const lastRun = await p.trustTestRun.findFirst({ where: { testKey: mon.key }, orderBy: { at: 'desc' }, select: { at: true } });
    if (changed || trigger === 'manual' || !lastRun || now.getTime() - lastRun.at.getTime() >= 3_600_000) {
      await p.trustTestRun.create({ data: { testKey: mon.key, status: res.status, summary: res.en, details: details as object, durationMs, trigger, at: now } });
    }
    const failing = res.status === 'FAIL' || res.status === 'ERROR';
    let alertedStatus = row?.alertedStatus ?? null;
    if (failing && alertedStatus !== 'FAIL') {
      await p.trustAlert.create({ data: { kind: 'test_failed', title: `Test failing: ${mon.title}`, titleFr: `Test en échec : ${mon.titleFr}`, link: `/platform/trust/tests?test=${mon.key}`, ownerId: row?.ownerId ?? null } });
      alertedStatus = 'FAIL';
    } else if (!failing && alertedStatus === 'FAIL') {
      await p.trustAlert.create({ data: { kind: 'test_recovered', title: `Test passing again: ${mon.title}`, titleFr: `Test de nouveau réussi : ${mon.titleFr}`, link: `/platform/trust/tests?test=${mon.key}`, ownerId: row?.ownerId ?? null } });
      alertedStatus = null;
    }
    await p.trustTest.upsert({
      where: { key: mon.key },
      create: { key: mon.key, lastRunAt: now, lastStatus: res.status, lastSummary: res.en, lastDetails: details as object, alertedStatus },
      update: { lastRunAt: now, lastStatus: res.status, lastSummary: res.en, lastDetails: details as object, alertedStatus },
    });
    out.push({ key: mon.key, status: res.status, changed });
  }
  return out;
}

/** History, snapshots and the feed are kept HISTORY_DAYS. */
export async function pruneTrustHistory(prisma: PrismaClient = db(), now = new Date()): Promise<number> {
  const before = ago(now, HISTORY_DAYS);
  const a = await prisma.trustTestRun.deleteMany({ where: { at: { lt: before } } });
  const b = await prisma.trustScoreSnapshot.deleteMany({ where: { at: { lt: before } } });
  const c = await prisma.trustAlert.deleteMany({ where: { createdAt: { lt: before } } });
  return a.count + b.count + c.count;
}
