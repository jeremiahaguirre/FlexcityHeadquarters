/**
 * The details a Trust test result may carry (monitors.ts), and how each one reads. Shared with the
 * web app, which labels every key in English and French (a web test checks both locales cover this
 * list), so this file has no imports.
 *
 * Kinds: count (a number of things), bool (yes/no), date (an instant), seconds (a duration),
 * list (names, refs or table problems; an item may be { en, fr } to be named in the reader's language), text (a technical word shown as is: a role, a region),
 * value (one of DETAIL_VALUES[key], translated).
 */
export const MONITOR_DETAILS = {
  // Row-level security
  problems: 'list',
  tablesChecked: 'count',
  rlsSqlRead: 'bool',
  // Passkeys and MFA
  enforced: 'bool',
  admins: 'count',
  missingPasskeys: 'list',
  organizations: 'list',
  without: 'list',
  // Database role
  role: 'text',
  superuser: 'bool',
  bypassRls: 'bool',
  canCreate: 'bool',
  ownsTables: 'bool',
  // Keys, secrets, TLS, headers
  provider: 'value',
  region: 'text',
  production: 'bool',
  length: 'count',
  distinctCharacters: 'count',
  source: 'value',
  missing: 'list',
  hsts: 'bool',
  sslmode: 'text',
  // Health, backlog, monitoring
  database: 'value',
  worker: 'value',
  workerAgeS: 'seconds',
  oldestAgeS: 'seconds',
  oldestSafetyS: 'seconds',
  configured: 'bool',
  // Backups, retention, audit, CI
  at: 'date',
  manual: 'bool',
  lastOkAt: 'date',
  lastErrorAt: 'date',
  appendOnly: 'bool',
  newest: 'date',
  lastAt: 'date',
  // Accounts, keys, webhooks
  stale: 'list',
  accounts: 'list',
  disabled: 'count',
  keys: 'count',
  endpoints: 'count',
  // Vendors, policies, risks, commitments, evidence
  overdue: 'list',
  unscheduled: 'list',
  vendors: 'count',
  policies: 'count',
  unpublished: 'list',
  reviewOverdue: 'list',
  acknowledgementsMissing: 'count',
  open: 'count',
  dueIn7Days: 'count',
  // A check that couldn't run
  error: 'text',
} as const;

export type MonitorDetailKey = keyof typeof MONITOR_DETAILS;
export type DetailKind = (typeof MONITOR_DETAILS)[MonitorDetailKey];
export const MONITOR_DETAIL_KEYS = Object.keys(MONITOR_DETAILS) as MonitorDetailKey[];
/** What a check may return: only the keys above (an unknown key is a type error). */
export type MonitorDetails = { [K in MonitorDetailKey]?: unknown };

/** The words a "value" detail can hold. */
export const DETAIL_VALUES = {
  provider: ['kms', 'local', 'kms+local', 'none'],
  source: ['deployed', 'in-process'],
  database: ['ok', 'warn', 'fail'],
  worker: ['ok', 'warn', 'fail'],
} as const satisfies Partial<Record<MonitorDetailKey, readonly string[]>>;

/** The endings of a row-level security problem ("Shift: not forced"), each translated. */
export const RLS_PROBLEMS = {
  'row-level security off': 'rlsOff',
  'no policy': 'noPolicy',
  'not forced': 'notForced',
  'listed in rls.sql but missing': 'missing',
} as const;

/** Keys that look like secrets never reach a result (the API drops them, and the web app never shows them). */
export const SECRETISH = /secret|token|password|dsn|key$|kek|arn|url/i;
