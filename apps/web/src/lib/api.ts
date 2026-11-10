'use client';

import { ApiError } from './apiError';
import { DEMO } from './demo';
import { demoApi } from './demoApi';

export { ApiError };

/**
 * Browser API client.
 * - The access token lives only in memory (never localStorage), so XSS can't
 *   lift a long-lived credential. The refresh token is an HTTP-only cookie.
 * - On 401, it refreshes once and retries.
 */
export const SUPPORT_TOKEN_KEY = 'fh-support-token';
/** An FH support visit keeps its short read-only token for this tab only. */
function supportToken(): string | null {
  try {
    return typeof window === 'undefined' ? null : sessionStorage.getItem(SUPPORT_TOKEN_KEY);
  } catch {
    return null;
  }
}
let accessToken: string | null = supportToken();
let refreshing: Promise<boolean> | null = null;

function tenantHeader(): Record<string, string> {
  // In development the API trusts this header; production resolves the tenant from Host.
  const host = window.location.hostname;
  const sub = host.split('.')[0];
  return host.includes('.') && sub ? { 'x-tenant-subdomain': sub } : {};
}

async function refresh(): Promise<boolean> {
  // A support visit can't be renewed: when it ends, it ends.
  if (supportToken()) return false;
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: tenantHeader() })
    .then(async (r) => {
      if (!r.ok) return false;
      accessToken = ((await r.json()) as { accessToken: string }).accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}, retry = true, steppedUp = false): Promise<T> {
  if (DEMO) return demoApi<T>(path, init);
  if (!accessToken && retry && !path.startsWith('/api/auth/')) await refresh();
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...tenantHeader(),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: unknown };
    // Sensitive action, sign-in not recent: confirm with a passkey or password, then try once more.
    if (body.code === 'STEP_UP_REQUIRED' && !steppedUp && stepUpHandler && (await stepUpHandler())) return api<T>(path, init, retry, true);
    // The organization needs a passkey for this account: give it (or set one up), then try once more.
    if (body.code === 'MFA_REQUIRED' && !steppedUp && (await secondFactor())) return api<T>(path, init, retry, true);
    if (res.status === 401 && body.code !== 'STEP_UP_REQUIRED' && retry && !path.startsWith('/api/auth/')) {
      if (await refresh()) return api<T>(path, init, false, steppedUp);
    }
    // A new version of the agreement to sign: the app reloads the session and shows it.
    if (body.code === 'CONSENT_REQUIRED' && typeof window !== 'undefined') window.dispatchEvent(new Event(CONSENT_EVENT));
    throw new ApiError(res.status, body.code ?? 'ERROR', body.message ?? res.statusText, body.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
export const CONSENT_EVENT = 'fh:consent-required';

type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
/** The app registers the "Confirm it's you" dialog here. */
export function setStepUpHandler(fn: StepUpHandler | null) {
  stepUpHandler = fn;
}
type MfaHandler = () => Promise<boolean>;
let mfaHandler: MfaHandler | null = null;
let mfaPending: Promise<boolean> | null = null;
/** The app registers the "Confirm with your passkey" dialog here. */
export function setMfaHandler(fn: MfaHandler | null) {
  mfaHandler = fn;
}
/** Several screens can hit the requirement at once: they all wait on one prompt. */
function secondFactor(): Promise<boolean> {
  if (!mfaHandler) return Promise.resolve(false);
  mfaPending ??= mfaHandler().finally(() => {
    mfaPending = null;
  });
  return mfaPending;
}
/** After signing in with a passkey or confirming it's you. */
export function setAccessToken(token: string) {
  accessToken = token;
}

/**
 * Fetches a file (e.g. a CSV export). Resolves with the blob and response
 * headers; a JSON error body is returned as `error` instead of thrown so the
 * screen can show its details (like payroll problems).
 */
export async function apiDownload(path: string, retry = true, body?: unknown): Promise<{ ok: true; blob: Blob; headers: Headers } | { ok: false; status: number; error: Record<string, unknown> }> {
  if (DEMO) return demoApi(path, { method: 'DOWNLOAD' });
  if (!accessToken && retry) await refresh();
  const res = await fetch(path, {
    credentials: 'include',
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { ...tenantHeader(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
  });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (error.code === 'STEP_UP_REQUIRED' && retry && stepUpHandler && (await stepUpHandler())) return apiDownload(path, false, body);
    if (error.code === 'MFA_REQUIRED' && retry && (await secondFactor())) return apiDownload(path, false, body);
    if (res.status === 401 && error.code !== 'STEP_UP_REQUIRED' && retry && (await refresh())) return apiDownload(path, false, body);
    return { ok: false, status: res.status, error };
  }
  return { ok: true, blob: await res.blob(), headers: res.headers };
}

/** Hands a blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function login(email: string, password: string) {
  const r = await api<{ accessToken: string; user: { id: string; firstName: string; roles: string[]; locale: string } }>(
    '/api/auth/login',
    { method: 'POST', body: { email, password } },
    false,
  );
  accessToken = r.accessToken;
  return r.user;
}

export interface SsoInfo { protocol: 'OIDC' | 'SAML'; label: string | null; enforced: boolean }

/** Whether this organization signs in with Microsoft / its own identity provider. */
export async function ssoInfo(): Promise<SsoInfo | null> {
  return (await signInInfo()).sso;
}

/** What the sign-in page needs: single sign-on, and whether the organization is closed (export only). */
export async function signInInfo(): Promise<{ sso: SsoInfo | null; closed: { exportUntil: string | null } | null }> {
  if (DEMO) return { sso: null, closed: null };
  const r = await api<{ sso?: SsoInfo | null; closed?: { exportUntil: string | null } }>('/api/public/tenant', {}, false).catch(() => null);
  return { sso: r?.sso ?? null, closed: r?.closed ?? null };
}

/** After single sign-on: trades the one-time code for a session. */
export async function ssoExchange(code: string) {
  const r = await api<{ accessToken: string; user: { id: string; firstName: string; roles: string[]; locale: string } }>('/api/auth/sso/exchange', { method: 'POST', body: { code } }, false);
  accessToken = r.accessToken;
  return r.user;
}

export async function logout() {
  // This device stops getting the person's push notifications (shared tablets and deck phones).
  await import('./device').then((d) => d.forgetPushDevice()).catch(() => undefined);
  await api('/api/auth/logout', { method: 'POST' }, false).catch(() => undefined);
  accessToken = null;
  try {
    sessionStorage.removeItem(SUPPORT_TOKEN_KEY);
  } catch {
    /* fine */
  }
  // Shared deck phones: don't leave rosters (children's names) or cached pages behind.
  try {
    localStorage.removeItem('fh-lessons-cache');
    if ('caches' in window) for (const k of await caches.keys()) if (k.startsWith('fh-')) await caches.delete(k);
  } catch {
    /* nothing cached */
  }
}

/**
 * Live notification signals over Server-Sent Events, read with fetch() so the
 * Bearer token can be sent. Reconnects with backoff; returns a stop function.
 */
export function streamNotifications(onSignal: () => void): () => void {
  if (DEMO) return () => undefined;
  let stopped = false;
  let controller: AbortController | null = null;
  let delay = 2000;
  const run = async () => {
    while (!stopped) {
      try {
        if (!accessToken) await refresh();
        controller = new AbortController();
        const res = await fetch('/api/notifications/stream', {
          headers: { ...tenantHeader(), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
          signal: controller.signal,
        });
        if (res.status === 401) await refresh();
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        delay = 2000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split('\n\n');
          buf = events.pop() ?? '';
          if (events.some((e) => e.includes('event: notification'))) onSignal();
        }
      } catch {
        /* fall through to retry */
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  };
  void run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
