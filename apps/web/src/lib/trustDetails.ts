/**
 * Dev console › Trust › Tests: a test result's details as translated label/value pairs.
 *
 * The keys and kinds mirror apps/api/src/services/trust/detailKeys.ts (trustDetails.test.ts checks
 * they match and that every key and value has English and French words). A key the web doesn't
 * know yet still reads well ("lastSeenAt" → "Last seen at"), and anything that looks like a
 * secret is never shown, even though the API already drops it.
 */
type Kind = 'count' | 'bool' | 'date' | 'seconds' | 'list' | 'text' | 'value';

export const DETAIL_KINDS: Record<string, Kind> = {
  problems: 'list', tablesChecked: 'count', rlsSqlRead: 'bool',
  enforced: 'bool', admins: 'count', missingPasskeys: 'list', organizations: 'list', without: 'list',
  role: 'text', superuser: 'bool', bypassRls: 'bool', canCreate: 'bool', ownsTables: 'bool',
  provider: 'value', region: 'text', production: 'bool', length: 'count', distinctCharacters: 'count', source: 'value', missing: 'list', hsts: 'bool', sslmode: 'text',
  database: 'value', worker: 'value', workerAgeS: 'seconds', oldestAgeS: 'seconds', oldestSafetyS: 'seconds', configured: 'bool',
  at: 'date', manual: 'bool', lastOkAt: 'date', lastErrorAt: 'date', appendOnly: 'bool', newest: 'date', lastAt: 'date',
  stale: 'list', accounts: 'list', disabled: 'count', keys: 'count', endpoints: 'count',
  overdue: 'list', unscheduled: 'list', vendors: 'count', policies: 'count', unpublished: 'list', reviewOverdue: 'list', acknowledgementsMissing: 'count', open: 'count', dueIn7Days: 'count',
  error: 'text',
};
export const DETAIL_VALUES: Record<string, readonly string[]> = {
  provider: ['kms', 'local', 'kms+local', 'none'],
  source: ['deployed', 'in-process'],
  database: ['ok', 'warn', 'fail'],
  worker: ['ok', 'warn', 'fail'],
};
export const RLS_PROBLEMS: Record<string, string> = {
  'row-level security off': 'rlsOff',
  'no policy': 'noPolicy',
  'not forced': 'notForced',
  'listed in rls.sql but missing': 'missing',
};
export const SECRETISH = /secret|token|password|dsn|key$|kek|arn|url/i;
/** Never shown as a detail: the French sentence rides along in the details. */
const HIDDEN = new Set(['summaryFr']);

type T = (key: string, opts?: Record<string, unknown>) => string;
export interface DetailRow { key: string; label: string; value: string | string[] }

/** "lastSeenAt" / "last_seen_at" → "Last seen at". */
export function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

const isDateLike = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));

export function formatSeconds(s: number, lang: string): string {
  const unit = (n: number, u: 'second' | 'minute' | 'hour' | 'day') => new Intl.NumberFormat(lang, { style: 'unit', unit: u, unitDisplay: 'long', maximumFractionDigits: 0 }).format(n);
  if (s < 60) return unit(s, 'second');
  if (s < 3600) return unit(Math.round(s / 60), 'minute');
  if (s < 86_400 * 2) return unit(Math.round(s / 3600), 'hour');
  return unit(Math.round(s / 86_400), 'day');
}

function one(key: string, v: unknown, kind: Kind | undefined, t: T, lang: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? t('trust.yes') : t('trust.no');
  if (kind === 'seconds' && typeof v === 'number') return formatSeconds(v, lang);
  if (typeof v === 'number') return new Intl.NumberFormat(lang).format(v);
  if (kind === 'date' || isDateLike(v)) {
    const d = new Date(String(v));
    if (!Number.isNaN(d.getTime())) return d.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
  }
  if (kind === 'value' && typeof v === 'string' && DETAIL_VALUES[key]?.includes(v)) return t(`trust.testDetails.values.${key}.${v}`);
  if (key === 'problems' && typeof v === 'string') {
    const m = /^(.+?): (.+)$/.exec(v);
    const id = m ? RLS_PROBLEMS[m[2]!] : undefined;
    if (m && id) return t(`trust.testDetails.rls.${id}`, { table: m[1] });
  }
  if (typeof v === 'object') return Array.isArray(v) ? v.map((x) => one(key, x, undefined, t, lang)).join(', ') : JSON.stringify(v);
  return String(v);
}

/** The details to show, in the order the check returned them, labelled and formatted for `lang`. */
export function detailRows(details: Record<string, unknown> | null | undefined, t: T, lang: string): DetailRow[] {
  return Object.entries(details ?? {})
    .filter(([k]) => !HIDDEN.has(k) && !SECRETISH.test(k))
    .map(([k, v]) => {
      const kind = DETAIL_KINDS[k];
      const label = kind ? t(`trust.testDetails.keys.${k}`) : humanize(k);
      if (Array.isArray(v)) return { key: k, label, value: v.length ? v.map((x) => one(k, x, undefined, t, lang)) : '—' };
      return { key: k, label, value: one(k, v, kind, t, lang) };
    });
}
