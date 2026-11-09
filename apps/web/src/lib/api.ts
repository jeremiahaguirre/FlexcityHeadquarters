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
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

function tenantHeader(): Record<string, string> {
  // In development the API trusts this header; production resolves the tenant from Host.
  const host = window.location.hostname;
  const sub = host.split('.')[0];
  return host.includes('.') && sub ? { 'x-tenant-subdomain': sub } : {};
}

async function refresh(): Promise<boolean> {
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

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
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
  if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
    if (await refresh()) return api<T>(path, init, false);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, body.code ?? 'ERROR', body.message ?? res.statusText, body.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * Fetches a file (e.g. a CSV export). Resolves with the blob and response
 * headers; a JSON error body is returned as `error` instead of thrown so the
 * screen can show its details (like payroll problems).
 */
export async function apiDownload(path: string, retry = true): Promise<{ ok: true; blob: Blob; headers: Headers } | { ok: false; status: number; error: Record<string, unknown> }> {
  if (DEMO) return demoApi(path, { method: 'DOWNLOAD' });
  if (!accessToken && retry) await refresh();
  const res = await fetch(path, { credentials: 'include', headers: { ...tenantHeader(), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) } });
  if (res.status === 401 && retry && (await refresh())) return apiDownload(path, false);
  if (!res.ok) return { ok: false, status: res.status, error: (await res.json().catch(() => ({}))) as Record<string, unknown> };
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

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' }, false).catch(() => undefined);
  accessToken = null;
  // Shared deck phones: don't leave rosters (children's names) or cached pages behind.
  try {
    localStorage.removeItem('fh-lessons-cache');
    if ('caches' in window) await caches.delete('fh-v1');
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
