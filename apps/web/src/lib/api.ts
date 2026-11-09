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
}
