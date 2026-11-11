/**
 * Browser error reports: uncaught errors, unhandled promise rejections and React error boundaries
 * are sent to the API (POST /api/client-errors), which scrubs them and passes them to the same
 * error reporter as the server's own (apps/api/src/lib/errorReporter.ts).
 *
 * A report carries the error's name, message and stack, the page's path with ids taken out, and
 * the build version. Never form contents, the query string, cookies or tokens. At most 10 reports
 * per page load, each distinct error once; the API also limits reports per address.
 */
import { DEMO } from './demo';

export type ErrorKind = 'error' | 'unhandledrejection' | 'boundary';

export interface ClientErrorReport {
  kind: ErrorKind;
  name?: string;
  message: string;
  stack?: string;
  route: string;
  release: string;
  digest?: string;
}

export const RELEASE = process.env.NEXT_PUBLIC_RELEASE || 'web@dev';

/** "/manage/people/5f0c…/edit?q=avery" → "/manage/people/:id/edit": no ids, no query string. */
export function routeOf(pathname: string): string {
  const [path = ''] = pathname.split(/[?#]/);
  return (
    path
      .split('/')
      .map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /\d/.test(seg) || seg.length > 40 || /[@%]/.test(seg) ? ':id' : seg))
      .join('/')
      .slice(0, 200) || '/'
  );
}

/** What gets sent for a thrown value: its name, first 1,000 characters of message, and stack. */
export function buildReport(kind: ErrorKind, thrown: unknown, pathname: string, digest?: string): ClientErrorReport {
  const err = thrown instanceof Error ? thrown : null;
  const message = err ? err.message : typeof thrown === 'string' ? thrown : `non-error rejection (${thrown === null ? 'null' : typeof thrown})`;
  return {
    kind,
    name: err?.name?.slice(0, 100) || undefined,
    message: (message || '(no message)').slice(0, 1000),
    stack: err?.stack?.slice(0, 8000),
    route: routeOf(pathname),
    release: RELEASE.slice(0, 100),
    ...(digest ? { digest: digest.slice(0, 100) } : {}),
  };
}

const MAX_PER_PAGE = 10;
const seen = new Set<string>();

/** Sends a report unless this page already sent it (or ten others). Never throws. */
export function reportError(kind: ErrorKind, thrown: unknown, opts: { digest?: string; send?: typeof fetch; pathname?: string } = {}): boolean {
  try {
    if (DEMO || typeof window === 'undefined') return false;
    const report = buildReport(kind, thrown, opts.pathname ?? window.location.pathname, opts.digest);
    const key = `${report.name}|${report.message}|${report.route}`;
    if (seen.has(key) || seen.size >= MAX_PER_PAGE) return false;
    seen.add(key);
    // A subdomain header in development, as api() sends; production resolves the organization from Host.
    const host = window.location.hostname;
    const sub = host.includes('.') ? host.split('.')[0] : undefined;
    void (opts.send ?? fetch)('/api/client-errors', {
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: { 'content-type': 'application/json', ...(sub ? { 'x-tenant-subdomain': sub } : {}) },
      body: JSON.stringify(report),
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function resetErrorReporting(): void {
  seen.clear();
}

/** Listens for uncaught errors and unhandled rejections; returns the function that stops listening. */
export function installErrorReporting(target: Window = window): () => void {
  const onError = (e: ErrorEvent) => {
    // Errors in other origins' scripts arrive as "Script error." with nothing useful.
    if (!e.error && /^Script error\.?$/.test(e.message)) return;
    reportError('error', e.error ?? e.message);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    reportError('unhandledrejection', e.reason);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
