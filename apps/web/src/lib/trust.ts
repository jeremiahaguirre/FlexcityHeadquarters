'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tone } from '@/components/ui/StatusPill';
import { ApiError } from './apiError';
import { DEMO } from './demo';
import { papi } from './platform';

/** Dev console › Trust: types, live polling and the small pure helpers the charts use. */

export type FrameworkKey = 'soc2' | 'iso27001' | 'hipaa' | 'pipeda' | 'provincial' | 'law25';
export const FRAMEWORK_KEYS: FrameworkKey[] = ['soc2', 'iso27001', 'hipaa', 'pipeda', 'provincial', 'law25'];
export type ControlStatus = 'PASSING' | 'FAILING' | 'NEEDS_EVIDENCE' | 'NOT_APPLICABLE';
export type TestStatus = 'PASS' | 'FAIL' | 'WARN' | 'ERROR';

export interface FrameworkReadiness { key: FrameworkKey; name: string; nameFr: string; optional: boolean; inScope: boolean; readiness: number; met: number; partial: number; gaps: number; uncovered: number; notApplicable: number; total: number }
export interface TrendPoint { day: string; score: number; frameworks: Record<string, number>; pass: number; fail: number; warn: number; kpis: Partial<Kpis> }
export interface Kpis { failingTests: number; overdueEvidence: number; openHighRisks: number; vendorsDue: number; commitmentsDue30: number; commitmentsOverdue: number; policiesUnacked: number }
export interface OverviewRisk { id: string; ref: string; title: string; titleFr: string | null; likelihood: number; impact: number; residualLikelihood: number; residualImpact: number; score: number }
export interface Overview {
  libraryVersion: string;
  scope: FrameworkKey[];
  savedScope: FrameworkKey[];
  riskAppetite: number;
  appetiteRange: [number, number];
  score: number;
  updatedAt: string | null;
  frameworks: FrameworkReadiness[];
  controls: Partial<Record<ControlStatus, number>>;
  tests: Array<{ key: string; title: string; titleFr: string; status: TestStatus | null; lastRunAt: string | null; summary: string | null; summaryFr: string | null; enabled: boolean }>;
  kpis: Kpis;
  trend: TrendPoint[];
  risks: OverviewRisk[];
  vendors: { low: number; medium: number; high: number };
  commitments: Array<{ id: string; title: string; customer: string; kind: string; dueAt: string }>;
  policyAcks: { required: number; done: number; policies: number; admins: number };
  alerts: Array<{ id: string; kind: string; title: string; titleFr: string; link: string | null; createdAt: string; readAt: string | null }>;
  /** Where to report a security issue (the API's SECURITY_EMAIL), or null. */
  securityContact?: string | null;
}

export const controlTone: Record<ControlStatus, Tone> = { PASSING: 'ok', FAILING: 'danger', NEEDS_EVIDENCE: 'warn', NOT_APPLICABLE: 'neutral' };
export const testTone = (s: TestStatus | null): Tone => (s === 'PASS' ? 'ok' : s === 'FAIL' || s === 'ERROR' ? 'danger' : s === 'WARN' ? 'warn' : 'neutral');
export const fr = (lang: string) => lang.startsWith('fr');
/** A whole-number percentage the way the language writes it ("51%", "51 %"). */
export const pct = (n: number, lang: string) => new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(n / 100);
/** "Label: " in English, "Label : " (non-breaking space) in French. */
export const colon = (lang: string) => (fr(lang) ? '\u00a0: ' : ': ');
/** The French field when the interface is in French and the field exists. */
export const pick = (o: object, field: string, lang: string): string => {
  const r = o as Record<string, unknown>;
  return String((fr(lang) && r[`${field}Fr`]) || r[field] || '');
};

/**
 * The Overview, kept live: it polls every 20 s while the tab is visible (and at once when it comes
 * back), sending the last ETag so an unchanged posture costs a 304 and no re-render.
 */
export function useLiveTrust<T>(path: string, intervalMs = 20_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [changedAt, setChangedAt] = useState<number | null>(null);
  const etag = useRef<string | null>(null);
  const current = useRef(path);
  current.current = path;
  const load = useCallback(async (fresh = false) => {
    const p = path;
    try {
      // The static demo answers from its recordings (no ETags there).
      if (DEMO) {
        const body = await papi<T>(p);
        if (current.current !== p) return;
        setCheckedAt(Date.now());
        setData(body);
        setChangedAt(Date.now());
        setError(null);
        return;
      }
      const res = await fetch(`/api/platform${p}`, { credentials: 'include', headers: { 'x-fh-platform': '1', ...(etag.current && !fresh ? { 'if-none-match': etag.current } : {}) } });
      if (current.current !== p) return;
      setCheckedAt(Date.now());
      if (res.status === 304) return;
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        if (res.status === 401) window.location.assign('/platform/login');
        throw new ApiError(res.status, b.code ?? 'ERROR', b.message ?? res.statusText);
      }
      etag.current = res.headers.get('etag');
      setData((await res.json()) as T);
      setChangedAt(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', String(e)));
    }
  }, [path]);
  useEffect(() => {
    etag.current = null;
    void load(true);
    const tick = () => document.visibilityState === 'visible' && void load();
    const id = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, intervalMs]);
  return { data, error, checkedAt, changedAt, reload: () => load(true) };
}

// ---- Pure helpers (unit tested) -------------------------------------------------------------

export const riskLevel = (score: number, appetite: number): 'low' | 'medium' | 'high' => (score >= appetite ? 'high' : score >= Math.max(1, Math.ceil(appetite / 2)) ? 'medium' : 'low');

/** 5×5 heat map: risks per (likelihood, impact) cell, residual or inherent. Row 0 is impact 5 (top). */
export function heatCells(risks: OverviewRisk[], mode: 'residual' | 'inherent') {
  const cells: Array<{ likelihood: number; impact: number; score: number; risks: OverviewRisk[] }> = [];
  for (let impact = 5; impact >= 1; impact--) {
    for (let likelihood = 1; likelihood <= 5; likelihood++) {
      cells.push({ likelihood, impact, score: likelihood * impact, risks: risks.filter((r) => (mode === 'residual' ? r.residualLikelihood === likelihood && r.residualImpact === impact : r.likelihood === likelihood && r.impact === impact)) });
    }
  }
  return cells;
}

/** An SVG polyline path through values (0–max) in a w×h box. */
export function linePath(values: number[], w: number, h: number, max = Math.max(1, ...values), pad = 2): string {
  if (!values.length) return '';
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => `${i ? 'L' : 'M'}${(pad + i * step).toFixed(1)},${(h - pad - (Math.max(0, v) / max) * (h - pad * 2)).toFixed(1)}`).join(' ');
}

/** Where a date falls on a timeline from `start` over `days` (0–1), clamped; overdue items sit at 0. */
export function timelinePos(due: string, start: number, days: number): number {
  const t = (new Date(due).getTime() - start) / (days * 86_400_000);
  return Math.min(1, Math.max(0, t));
}

export const daysLeft = (due: string, now = Date.now()) => Math.floor((new Date(due).getTime() - now) / 86_400_000);

/** Time-range slider stops: 7 days … 12 months. */
export const RANGE_STOPS = [7, 14, 30, 60, 90, 180, 365] as const;

/** Overall score from per-control statuses (mirrors the API: needs-evidence counts half). */
export function scoreOf(counts: Partial<Record<ControlStatus, number>>): number {
  const pass = counts.PASSING ?? 0;
  const ev = counts.NEEDS_EVIDENCE ?? 0;
  const fail = counts.FAILING ?? 0;
  const n = pass + ev + fail;
  return n ? Math.round((100 * (pass + ev / 2)) / n) : 0;
}

/** Generic table sort: strings by locale, numbers and dates numerically, empty values last. */
export function compareValues(a: unknown, b: unknown, lang: string): number {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const da = typeof a === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a) ? Date.parse(a) : NaN;
  const db = typeof b === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b) ? Date.parse(b) : NaN;
  if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
  return String(a).localeCompare(String(b), lang, { numeric: true, sensitivity: 'base' });
}
