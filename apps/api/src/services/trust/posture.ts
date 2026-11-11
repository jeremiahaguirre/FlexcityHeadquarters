/**
 * Posture: every control's status (from the latest test results, evidence and manual states),
 * framework readiness, the overall score, the dashboard's counts, and snapshots over time.
 */
import type { PrismaClient } from '@prisma/client';
import { CONTROLS, FRAMEWORKS, type FrameworkKey } from './library.js';
import { controlStatus, frameworkReadiness, postureScore, riskLevel, riskScore, vendorRisk, type ControlStatus, type TestStatus } from './scoring.js';

const DAY = 86_400_000;

export async function controlStatuses(p: PrismaClient, now = new Date()) {
  const [tests, ev, states] = await Promise.all([
    p.trustTest.findMany({ select: { key: true, lastStatus: true } }),
    p.trustEvidence.groupBy({ by: ['controlKey'], where: { deletedAt: null, OR: [{ validUntil: null }, { validUntil: { gte: now } }] }, _max: { createdAt: true } }),
    p.trustControlState.findMany(),
  ]);
  const inputs = {
    tests: Object.fromEntries(tests.map((t) => [t.key, (t.lastStatus ?? undefined) as TestStatus | undefined])),
    evidenceAt: Object.fromEntries(ev.map((e) => [e.controlKey, e._max.createdAt ?? undefined])),
    manual: Object.fromEntries(states.map((s) => [s.key, { status: (s.manualStatus as ControlStatus | null) ?? null }])),
    now,
  };
  const statuses = Object.fromEntries(CONTROLS.map((c) => [c.key, controlStatus(c, inputs)])) as Record<string, ControlStatus>;
  return { statuses, inputs, states };
}

export interface Kpis { failingTests: number; overdueEvidence: number; openHighRisks: number; vendorsDue: number; commitmentsDue30: number; commitmentsOverdue: number; policiesUnacked: number }

export async function kpis(p: PrismaClient, now: Date, appetite: number): Promise<Kpis> {
  const in30 = new Date(now.getTime() + 30 * DAY);
  const [failingTests, overdueEvidence, risks, vendors, commitmentsDue30, commitmentsOverdue, ack] = await Promise.all([
    p.trustTest.count({ where: { enabled: true, lastStatus: { in: ['FAIL', 'ERROR'] } } }),
    p.trustEvidenceRequest.count({ where: { status: 'OPEN', dueAt: { lt: now } } }),
    p.trustRisk.findMany({ where: { status: 'OPEN' }, select: { residualLikelihood: true, residualImpact: true } }),
    p.trustVendor.count({ where: { status: 'ACTIVE', OR: [{ nextReviewAt: { lt: in30 } }, { dpaExpiresAt: { lt: in30 } }, { soc2ExpiresAt: { lt: in30 } }, { isoExpiresAt: { lt: in30 } }] } }),
    p.trustCommitment.count({ where: { status: 'OPEN', dueAt: { gte: now, lt: in30 } } }),
    p.trustCommitment.count({ where: { status: 'OPEN', dueAt: { lt: now } } }),
    policyAckProgress(p),
  ]);
  return { failingTests, overdueEvidence, openHighRisks: risks.filter((r) => riskLevel(riskScore(r.residualLikelihood, r.residualImpact), appetite) === 'high').length, vendorsDue: vendors, commitmentsDue30, commitmentsOverdue, policiesUnacked: ack.required - ack.done };
}

/** Acknowledgements of every published version by every active admin. */
export async function policyAckProgress(p: PrismaClient) {
  const [versions, admins] = await Promise.all([
    p.trustPolicyVersion.findMany({ where: { status: 'PUBLISHED' }, select: { acks: { select: { adminId: true } } } }),
    p.platformAdmin.findMany({ where: { disabledAt: null }, select: { id: true } }),
  ]);
  const ids = new Set(admins.map((a) => a.id));
  const required = versions.length * admins.length;
  const done = versions.reduce((s, v) => s + v.acks.filter((a) => ids.has(a.adminId)).length, 0);
  return { required, done, policies: versions.length, admins: admins.length };
}

export async function settings(p: PrismaClient) {
  return p.trustSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export const parseScope = (raw: unknown): FrameworkKey[] => {
  const keys = FRAMEWORKS.map((f) => f.key);
  const list = (typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : []).map(String).filter((k): k is FrameworkKey => (keys as string[]).includes(k));
  return [...new Set(list)];
};

/** The default scope: the settings' frameworks, or every framework that isn't optional. */
export const defaultScope = (saved: string[]): FrameworkKey[] => (saved.length ? parseScope(saved) : FRAMEWORKS.filter((f) => !f.optional).map((f) => f.key));

/** Score and readiness for a scope, as stored in snapshots. */
export function summarize(statuses: Record<string, ControlStatus>, scope: FrameworkKey[]) {
  return {
    score: postureScore(statuses, scope),
    frameworks: Object.fromEntries(FRAMEWORKS.map((f) => [f.key, frameworkReadiness(f.key, statuses).readiness])),
    counts: CONTROLS.reduce<Record<string, number>>((acc, c) => ((acc[statuses[c.key]!] = (acc[statuses[c.key]!] ?? 0) + 1), acc), {}),
  };
}

/** A posture snapshot, at most hourly unless forced (after a manual run). */
export async function snapshot(p: PrismaClient, now = new Date(), force = false): Promise<boolean> {
  const last = await p.trustScoreSnapshot.findFirst({ orderBy: { at: 'desc' }, select: { at: true } });
  if (!force && last && now.getTime() - last.at.getTime() < 3_600_000 - 30_000) return false;
  const s = await settings(p);
  const { statuses } = await controlStatuses(p, now);
  const sum = summarize(statuses, defaultScope(s.frameworks));
  const tests = await p.trustTest.groupBy({ by: ['lastStatus'], where: { enabled: true }, _count: true });
  const n = (st: string[]) => tests.filter((t) => t.lastStatus && st.includes(t.lastStatus)).reduce((a, t) => a + t._count, 0);
  const k = await kpis(p, now, s.riskAppetite);
  await p.trustScoreSnapshot.create({ data: { score: sum.score, frameworks: sum.frameworks, testsPass: n(['PASS']), testsFail: n(['FAIL', 'ERROR']), testsWarn: n(['WARN']), controls: { statuses, counts: sum.counts, kpis: k } as object, at: now } });
  return true;
}

/** Daily points (the last snapshot of each day) over `days`, for the trend and the sparklines. */
export async function trend(p: PrismaClient, days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY);
  const snaps = await p.trustScoreSnapshot.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' }, select: { at: true, score: true, frameworks: true, testsPass: true, testsFail: true, testsWarn: true, controls: true } });
  const byDay = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) byDay.set(s.at.toISOString().slice(0, 10), s);
  return [...byDay.entries()].map(([day, s]) => {
    const k = ((s.controls as { kpis?: Partial<Kpis> } | null)?.kpis ?? {}) as Partial<Kpis>;
    return { day, score: s.score, frameworks: s.frameworks as Record<string, number>, pass: s.testsPass, fail: s.testsFail, warn: s.testsWarn, kpis: k };
  });
}

export function vendorDistribution(vendors: Array<{ criticality: string; personalInfo: boolean; inCanada: boolean; score: number | null; status: string }>) {
  const out = { low: 0, medium: 0, high: 0 };
  for (const v of vendors.filter((x) => x.status !== 'OFFBOARDED')) out[vendorRisk(v)]++;
  return out;
}
