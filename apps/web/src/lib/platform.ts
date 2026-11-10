'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './apiError';
import { DEMO } from './demo';

/**
 * FH Dev console client. The session is an HTTP-only cookie the browser sends
 * by itself; the x-fh-platform header is the API's guard against cross-site requests.
 */
export async function papi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  // The Dev console is FH's own tool: it isn't part of the public demo.
  if (DEMO) throw new ApiError(404, 'NOT_IN_DEMO', 'Not available in the demo.');
  const res = await fetch(`/api/platform${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: { 'x-fh-platform': '1', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: unknown };
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
  const res = await fetch(`/api/platform${path}`, { credentials: 'include', headers: { 'x-fh-platform': '1' } });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(res.status, b.code ?? 'ERROR', b.message ?? res.statusText);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
