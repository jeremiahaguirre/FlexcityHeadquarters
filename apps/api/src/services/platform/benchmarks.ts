/**
 * Anonymous benchmarks across cities. Each opted-in city's measures for the
 * last 90 days are computed under its own row-level security, then only the
 * quartiles are kept, and only when at least MIN_CITIES contribute, so no
 * single city can be picked out. Cities see peers only if they share too.
 */
import type { PrismaClient } from '@prisma/client';
import { type Tx, tenantIds, withTenant } from '../../lib/db.js';

export const MIN_CITIES = 5;
export const METRICS = ['noShowRate', 'lateRate', 'certLapseRate', 'fillHours', 'overtimeShare'] as const;
export type Metric = (typeof METRICS)[number];
const WINDOW = 90 * 86_400_000;

export function quartiles(xs: number[]): { p25: number; p50: number; p75: number } | null {
  if (xs.length < MIN_CITIES) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    return s[lo]! + (s[Math.ceil(i)]! - s[lo]!) * (i - lo);
  };
  const r = (n: number) => Math.round(n * 100) / 100;
  return { p25: r(q(0.25)), p50: r(q(0.5)), p75: r(q(0.75)) };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** One city's measures for the last 90 days (run inside its tenant transaction). */
export async function cityMetrics(tx: Tx, now = new Date()): Promise<Record<Metric, number>> {
  const from = new Date(now.getTime() - WINDOW);
  const [shifts, noShows, punches, late, offers, ot, staff] = await Promise.all([
    tx.shift.findMany({ where: { status: 'PUBLISHED', userId: { not: null }, endsAt: { gte: from, lte: now } }, select: { startsAt: true, endsAt: true } }),
    tx.reliabilityEvent.count({ where: { type: 'NO_SHOW', occurredAt: { gte: from }, excludedReason: null } }),
    tx.timePunch.count({ where: { clockIn: { gte: from } } }),
    tx.reliabilityEvent.count({ where: { type: 'LATE_PUNCH', occurredAt: { gte: from }, excludedReason: null } }),
    tx.shiftOffer.findMany({ where: { status: 'COMPLETED', createdAt: { gte: from } }, select: { createdAt: true, updatedAt: true } }),
    tx.overtimeEntry.aggregate({ where: { kind: 'ACCEPTED', occurredAt: { gte: from } }, _sum: { hours: true } }),
    tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null, certifications: { some: { verifiedAt: { not: null } } } }, select: { certifications: { where: { verifiedAt: { not: null } }, select: { certificationId: true, expiryDate: true } } } }),
  ]);
  const hours = shifts.reduce((s, x) => s + (x.endsAt.getTime() - x.startsAt.getTime()) / 3_600_000, 0);
  const fill = offers.map((o) => (o.updatedAt.getTime() - o.createdAt.getTime()) / 3_600_000).sort((a, b) => a - b);
  const today = now.toISOString().slice(0, 10);
  const lapsed = staff.filter((u) => {
    const latest = new Map<string, string | null>();
    for (const c of u.certifications) {
      const e = c.expiryDate ? c.expiryDate.toISOString().slice(0, 10) : null;
      const prev = latest.get(c.certificationId);
      if (!latest.has(c.certificationId) || e === null || (prev !== null && prev !== undefined && e > prev)) latest.set(c.certificationId, e);
    }
    return [...latest.values()].some((e) => e !== null && e < today);
  }).length;
  return {
    noShowRate: pct(noShows, shifts.length),
    lateRate: pct(late, punches),
    certLapseRate: pct(lapsed, staff.length),
    fillHours: fill.length ? Math.round(fill[Math.floor(fill.length / 2)]! * 10) / 10 : 0,
    overtimeShare: pct(Number(ot._sum.hours ?? 0), hours),
  };
}

/** Nightly: gather opted-in cities, keep quartiles only when enough cities share. */
export async function computeBenchmarks(prisma: PrismaClient, now = new Date()): Promise<number> {
  const values: Record<Metric, number[]> = { noShowRate: [], lateRate: [], certLapseRate: [], fillHours: [], overtimeShare: [] };
  for (const id of await tenantIds(prisma)) {
    const m = await withTenant(
      id,
      async (tx) => {
        const t = await tx.tenant.findUnique({ where: { id }, select: { benchmarkOptIn: true } });
        return t?.benchmarkOptIn ? cityMetrics(tx, now) : null;
      },
      { prisma },
    );
    if (m) for (const k of METRICS) values[k].push(m[k]);
  }
  const computedOn = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  let stored = 0;
  for (const k of METRICS) {
    const q = quartiles(values[k]);
    if (!q) continue;
    await prisma.benchmarkSnapshot.upsert({ where: { metric_computedOn: { metric: k, computedOn } }, update: { ...q, cities: values[k].length }, create: { metric: k, computedOn, cities: values[k].length, ...q } });
    stored++;
  }
  return stored;
}
