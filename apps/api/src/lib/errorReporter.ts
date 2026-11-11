/**
 * Error capture. Unexpected errors (the Express error handler, unhandled rejections, uncaught
 * exceptions, background job failures, errors reported by browsers) come here. Each one is
 * logged as before (lib/log.ts) and, when SENTRY_DSN is set, sent to a Sentry-compatible service
 * (Sentry or GlitchTip: one envelope POST, no SDK).
 *
 * What a report carries: the error's type, first line and stack frames, the request id, the route
 * *pattern*, the organization's id, and a one-way hash of the user's id. Never request bodies,
 * query strings, headers, names or emails, and everything is passed through lib/scrub.ts first.
 * Identical errors are sent at most once a minute (with a count of the repeats), and no more than
 * 60 reports a minute overall, so an outage can't flood the service or the log.
 */
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { assertPublicUrl } from './egress.js';
import { logError } from './log.js';
import { errorsTotal } from './metrics.js';
import { currentRequestId } from './requestContext.js';
import { scrubPath, scrubText } from './scrub.js';

export type ErrorSource = 'request' | 'unhandledRejection' | 'uncaughtException' | 'job' | 'client' | 'other';

export interface ErrorContext {
  source: ErrorSource;
  requestId?: string;
  /** A route pattern ("/api/users/:id") or a path, which is scrubbed of ids. */
  route?: string;
  method?: string;
  tenantId?: string;
  userId?: string;
  /** Job name, client release, browser: short labels only. */
  tags?: Record<string, string>;
  /** Already-split stack text, for errors that didn't happen here (the browser's). */
  stack?: string;
}

export interface ErrorReport {
  event_id: string;
  timestamp: number;
  platform: string;
  level: 'error' | 'fatal';
  logger: string;
  environment: string;
  release?: string;
  fingerprint: string[];
  tags: Record<string, string>;
  user?: { id: string };
  exception: { values: Array<{ type: string; value: string; stacktrace?: { frames: Array<{ function?: string; filename?: string; lineno?: number; colno?: number }> } }> };
  extra: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lets support match reports from one person without the report naming them. */
export function hashUserId(userId: string): string {
  return createHash('sha256').update(`fh-user:${userId}`).digest('hex').slice(0, 16);
}

function parseFrames(stack: string) {
  const frames = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') || /@.+:\d+:\d+$/.test(l))
    .slice(0, 30)
    .map((l) => {
      // "at fn (file:1:2)", "at file:1:2" (V8) or "fn@file:1:2" (Firefox, Safari).
      const m = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(l) ?? /^(.*)@(.+?):(\d+):(\d+)$/.exec(l);
      if (!m) return { function: scrubText(l.slice(0, 200)) };
      return { function: m[1] ? scrubText(m[1].slice(0, 100)) : undefined, filename: scrubText(m[2]!.replace(/[?#].*$/, '').slice(0, 200)), lineno: Number(m[3]), colno: Number(m[4]) };
    });
  // Sentry lists the oldest call first.
  return frames.reverse();
}

/** Builds the (scrubbed) report for an error. Exported for tests. */
export function buildReport(err: unknown, ctx: ErrorContext): ErrorReport {
  const cfg = config();
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : `non-error thrown (${typeof err})`);
  // The message's first line only, as in the log: Prisma puts the query's arguments after it.
  const first = (e.message ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const code = (e as { code?: unknown }).code;
  const type = scrubText(e.name || 'Error').slice(0, 100);
  const value = scrubText(first).slice(0, 500);
  const route = ctx.route ? (ctx.route.includes(':') || ctx.route === 'unmatched' ? ctx.route : scrubPath(ctx.route)) : undefined;
  const frames = parseFrames(ctx.stack ?? e.stack ?? '');
  const tags: Record<string, string> = { source: ctx.source };
  if (ctx.requestId) tags.request_id = ctx.requestId;
  if (route) tags.route = route.slice(0, 200);
  if (ctx.method) tags.method = ctx.method.slice(0, 10);
  if (ctx.tenantId && UUID.test(ctx.tenantId)) tags.tenant_id = ctx.tenantId;
  if (typeof code === 'string' && /^[\w.-]{1,40}$/.test(code)) tags.code = code;
  for (const [k, v] of Object.entries(ctx.tags ?? {})) tags[k.slice(0, 32)] = scrubText(String(v)).slice(0, 200);
  const top = frames.at(-1);
  return {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: ctx.source === 'client' ? 'javascript' : 'node',
    level: ctx.source === 'uncaughtException' ? 'fatal' : 'error',
    logger: ctx.source === 'client' ? 'fh-web' : 'fh-api',
    environment: cfg.SENTRY_ENVIRONMENT ?? cfg.NODE_ENV,
    release: ctx.tags?.release ? scrubText(ctx.tags.release).slice(0, 100) : cfg.RELEASE,
    fingerprint: [type, value.replace(/\d+/g, 'N').slice(0, 200), top ? `${top.filename}:${top.function}` : '', route ?? ''],
    tags,
    user: ctx.userId ? { id: hashUserId(ctx.userId) } : undefined,
    exception: { values: [{ type, value, stacktrace: frames.length ? { frames } : undefined }] },
    extra: {},
  };
}

// --- Rate limits -------------------------------------------------------------------------------

const PER_ERROR_MS = 60_000;
const PER_MINUTE = 60;
const recent = new Map<string, { at: number; repeats: number }>();
let windowStart = 0;
let windowCount = 0;

/** Whether this report should go out now; if not, it's counted toward the next one. */
function admit(report: ErrorReport, now = Date.now()): boolean {
  const k = report.fingerprint.join('|');
  const hit = recent.get(k);
  if (hit && now - hit.at < PER_ERROR_MS) {
    hit.repeats++;
    return false;
  }
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= PER_MINUTE) return false;
  windowCount++;
  if (hit?.repeats) report.extra.repeats_since_last_report = hit.repeats;
  recent.set(k, { at: now, repeats: 0 });
  if (recent.size > 5000) for (const [key, v] of recent) if (now - v.at >= PER_ERROR_MS) recent.delete(key);
  return true;
}

export function resetErrorReporter(): void {
  recent.clear();
  windowStart = 0;
  windowCount = 0;
  sent.length = 0;
  dsnChecked = undefined;
}

// --- Transport ---------------------------------------------------------------------------------

/** Reports sent in this process (tests read it; it keeps the last 20). */
export const sent: ErrorReport[] = [];

interface Dsn {
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

export function parseDsn(dsn: string): Dsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split('/').filter(Boolean).pop();
    if (!u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = u.pathname.slice(0, u.pathname.lastIndexOf(`/${projectId}`));
    return { envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey: decodeURIComponent(u.username), dsn };
  } catch {
    return null;
  }
}

let dsnChecked: Promise<Dsn | null> | undefined;

/** The DSN, once: parsed, and its host checked to be on the public internet (lib/egress.ts). */
function target(): Promise<Dsn | null> {
  const dsn = config().SENTRY_DSN;
  if (!dsn) return Promise.resolve(null);
  dsnChecked ??= (async () => {
    const parsed = parseDsn(dsn);
    if (!parsed) {
      console.error('[error-reporter] SENTRY_DSN is not a valid DSN; reports are only logged');
      return null;
    }
    try {
      await assertPublicUrl(parsed.envelopeUrl, 'SENTRY_DSN');
      return parsed;
    } catch (e) {
      console.error(`[error-reporter] SENTRY_DSN refused: ${e instanceof Error ? e.message : 'unknown'}; reports are only logged`);
      return null;
    }
  })();
  return dsnChecked;
}

export function envelope(report: ErrorReport, dsn: string): string {
  return [JSON.stringify({ event_id: report.event_id, sent_at: new Date().toISOString(), dsn }), JSON.stringify({ type: 'event' }), JSON.stringify(report)].join('\n') + '\n';
}

async function send(report: ErrorReport): Promise<void> {
  const t = await target();
  if (!t) return;
  const res = await fetch(t.envelopeUrl, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/x-sentry-envelope',
      'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${t.publicKey}, sentry_client=fh-api/1.0`,
    },
    body: envelope(report, t.dsn),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`error service answered ${res.status}`);
}

/**
 * Records an unexpected error: logged, counted, and (when SENTRY_DSN is set) reported. Never
 * throws and never waits for the network; returns the report's id (or undefined when the rate
 * limit held it back).
 */
export function captureError(err: unknown, ctx: ErrorContext): string | undefined {
  try {
    errorsTotal.inc({ source: ctx.source });
    const requestId = ctx.requestId ?? currentRequestId();
    const report = buildReport(err, { ...ctx, requestId });
    // Our own errors are always logged, as before; browsers' reports only when admitted (anyone can send one).
    if (ctx.source !== 'client') logError(`${ctx.source}${report.tags.route ? ` ${ctx.method ?? ''} ${report.tags.route}` : ''}${ctx.tags?.job ? ` ${ctx.tags.job}` : ''}`, err);
    if (!admit(report)) return undefined;
    if (ctx.source === 'client') console.error(`[client-error] ${report.exception.values[0]!.type}: ${report.exception.values[0]!.value} route=${report.tags.route ?? '-'} release=${report.release ?? '-'}`);
    sent.push(report);
    if (sent.length > 20) sent.shift();
    void send(report).catch((e) => console.error(`[error-reporter] couldn’t send report ${report.event_id}: ${e instanceof Error ? e.message : 'unknown'}`));
    return report.event_id;
  } catch (e) {
    console.error('[error-reporter] failed', e instanceof Error ? e.message : e);
    return undefined;
  }
}

let installed = false;

/** Process-wide handlers: unhandled rejections are reported; an uncaught exception is reported, then the process exits (its state is unknown). */
export function installProcessHandlers(): void {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => {
    captureError(reason, { source: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err) => {
    captureError(err, { source: 'uncaughtException' });
    // Give the report a moment to leave, then stop: a supervisor (ECS, cluster) starts a fresh process.
    setTimeout(() => process.exit(1), 1000).unref();
  });
}
