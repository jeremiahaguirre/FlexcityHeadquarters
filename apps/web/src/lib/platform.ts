'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './apiError';
import { DEMO } from './demo';
import { demoPlatformApi, demoPlatformFile } from './demoApi';
import { CLIENT_HEADERS, markOutdated, noteServerVersion } from './appUpdate';

/**
 * The headers that show the API a request comes from the console's own pages: x-fh-platform, and
 * the double-submit CSRF token (the readable fh_csrf cookie set at sign-in) echoed in x-fh-csrf.
 */
export function platformHeaders(): Record<string, string> {
  const m = typeof document === 'undefined' ? null : /(?:^|;\s*)fh_csrf=([^;]+)/.exec(document.cookie);
  return { 'x-fh-platform': '1', ...(m ? { 'x-fh-csrf': decodeURIComponent(m[1]!) } : {}) };
}

/**
 * FH Dev console client. The session is an HTTP-only cookie the browser sends
 * by itself; platformHeaders() are the API's guard against cross-site requests.
 */
export async function papi<T>(path: string, init: { method?: string; body?: unknown; steppedUp?: boolean } = {}): Promise<T> {
  if (DEMO) return demoPlatformApi<T>(path, init);
  const res = await fetch(`/api/platform${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: { ...CLIENT_HEADERS, ...platformHeaders(), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  noteServerVersion(res.headers.get('x-fh-version'));
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: unknown };
    if (b.code === 'CLIENT_OUTDATED') markOutdated();
    // Sensitive actions: confirm with the passkey, then try once more.
    if (b.code === 'PASSKEY_STEP_UP' && !init.steppedUp) {
      const { platformConfirmWithPasskey } = await import('./passkeys');
      await platformConfirmWithPasskey();
      return papi<T>(path, { ...init, steppedUp: true });
    }
    throw new ApiError(res.status, b.code ?? 'ERROR', b.message ?? res.statusText, b.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Like useQuery, for the Dev console. A lost session sends you to its sign-in page. */
export function usePlatformQuery<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const router = useRouter();
  const current = useRef(path);
  current.current = path;
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const d = await papi<T>(path);
      if (current.current === path) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace('/platform/login');
      // Signed in with a password only: the passkey step comes next.
      if (e instanceof ApiError && e.code === 'MFA_REQUIRED') router.replace('/platform/login?step=passkey');
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', String(e)));
    } finally {
      setLoading(false);
    }
  }, [path, router]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load };
}

export interface CitySummary { id: string; name: string; subdomain: string; logoUrl: string | null; staff: number; facilities: number; featuresOn: number; featuresTotal: number; createdAt: string }
export interface Facility { id: string; name: string; province: string; timezone: string; latitude: number | null; longitude: number | null; geoRadiusM: number; costCenter: string | null }
export interface PositionRow { id: string; name: string; nameFr: string | null; minimumAge: number | null; departmentId?: string | null; hoursOfService?: { maxDailyHours?: number | null; minRestHours?: number | null; maxHoursIn7Days?: number | null } | null; requiredCertificationIds: string[]; staff: number }
export interface CityDetail {
  organization: { id: string; name: string; subdomain: string; defaultLocale: string; timeFormat?: string; themeColors: { primary?: string } | null; logoUrl: string | null; payWeekStartDay: number; vacationPayMode: string; payrollRetentionYears: number; createdAt: string; signInUrl: string };
  features: Record<string, boolean>;
  featureDefaults: Record<string, boolean>;
  /** Switches set on purpose for this organization: releases leave them alone. */
  featureChoices?: string[];
  /** Features that only work while another is on (shift bidding → seniority). */
  featureRequires?: Record<string, string>;
  facilities: Facility[];
  positions: PositionRow[];
  departments?: Array<{ id: string; name: string; nameFr: string | null; aquatic: boolean }>;
  departmentSetup?: import('./departments').Departments;
  certifications: Array<{ id: string; name: string; nameFr: string | null }>;
  staff: number;
  admins: Array<{ id: string; name: string; email: string; invited: boolean }>;
  customRoles: import('./customRoles').CustomRole[];
  roleCatalog: import('./customRoles').RoleCatalog;
  pools: import('@/components/pools/PoolsEditor').PoolDetailsRow[];
}
export interface ImportIssue { field: string; code: string; value?: string }
export interface ImportPreview {
  rows: Array<{ line: number; firstName: string; lastName: string; email: string; employmentStatus: string | null; positions: string[]; status: 'create' | 'exists' | 'error'; errors: ImportIssue[]; warnings: ImportIssue[] }>;
  missingColumns: string[];
  unknownColumns: string[];
  summary: { create: number; exists: number; error: number };
}

/** Downloads a file from the Dev console API (bank files, CSV exports) and saves it. */
export async function pdownload(path: string, fallbackName: string): Promise<void> {
  // The static demo has no files to hand out: it saves a short note saying so instead.
  if (DEMO) return saveFile(demoPlatformFile(fallbackName), fallbackName.replace(/\.(pdf|zip)$/, '.txt'));
  // Only ever a path on this site's console API: a value built into `path` can't point the request
  // (and its console cookies) anywhere else, or climb out of /api/platform.
  const target = new URL(`/api/platform${path}`, window.location.origin);
  if (target.origin !== window.location.origin || !target.pathname.startsWith('/api/platform/') || /\.\.|\\/.test(path)) throw new ApiError(400, 'BAD_REQUEST', 'Not a Dev console download.');
  // Rebuilt from fixed text and encoded segments: each segment can only ever be one path segment.
  const segments = target.pathname.slice('/api/platform/'.length).split('/').map((s) => encodeURIComponent(decodeURIComponent(s)));
  const res = await fetch(`/api/platform/${segments.join('/')}${target.search}`, { credentials: 'include', headers: { ...CLIENT_HEADERS, ...platformHeaders() } });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(res.status, b.code ?? 'ERROR', b.message ?? res.statusText);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  saveFile(await res.blob(), name);
}

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
