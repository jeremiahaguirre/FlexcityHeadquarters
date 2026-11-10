/**
 * Built-in reports. Each needs one of its permissions, respects the reader's
 * department (scope), and returns column keys (the screens translate them) and
 * rows. Date ranges are inclusive days; "ahead" reports look forward from today.
 */
import type { AuthContext } from '../../auth/middleware.js';
import type { Permission } from '../../auth/permissions.js';
import type { Tx } from '../../lib/db.js';
import { forbidden } from '../../lib/errors.js';
import { peopleInScope } from '../people/scope.js';

export interface ReportParams { from: string; to: string; days: number }
export interface ReportResult { columns: string[]; rows: Array<Record<string, string | number | null>> }
interface Report { permissions: Permission[]; kind: 'range' | 'ahead'; wholeOrg?: boolean; run: (tx: Tx, a: AuthContext, p: ReportParams) => Promise<ReportResult> }

const r2 = (n: number) => Math.round(n * 100) / 100;
const start = (d: string) => new Date(`${d}T00:00:00Z`);
const after = (d: string) => new Date(start(d).getTime() + 86_400_000);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function names(tx: Tx, ids: string[]) {
  const users = await tx.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
}
async function people(tx: Tx, a: AuthContext) {
  const s = await peopleInScope(tx, a.scope);
  return s ? { userId: { in: [...s] } } : {};
}

export const REPORTS: Record<string, Report> = {
  hours_worked: {
    permissions: ['timeclock.review', 'payroll.export'],
    kind: 'range',
    async run(tx, a, p) {
      const punches = await tx.timePunch.findMany({ where: { ...(await people(tx, a)), status: 'APPROVED', clockOut: { not: null }, clockIn: { gte: start(p.from), lt: after(p.to) } }, select: { userId: true, clockIn: true, clockOut: true } });
      const by = new Map<string, { hours: number; shifts: number }>();
      for (const x of punches) {
        const r = by.get(x.userId) ?? { hours: 0, shifts: 0 };
        r.hours += (x.clockOut!.getTime() - x.clockIn.getTime()) / 3_600_000;
        r.shifts += 1;
        by.set(x.userId, r);
      }
      const n = await names(tx, [...by.keys()]);
      return { columns: ['person', 'shifts', 'hours'], rows: [...by].map(([u, r]) => ({ person: n.get(u) ?? '', shifts: r.shifts, hours: r2(r.hours) })).sort((x, y) => String(x.person).localeCompare(String(y.person))) };
    },
  },
  overtime: {
    permissions: ['overtime.manage'],
    kind: 'range',
    async run(tx, a, p) {
      const entries = await tx.overtimeEntry.findMany({ where: { ...(await people(tx, a)), occurredAt: { gte: start(p.from), lt: after(p.to) } }, select: { userId: true, kind: true, hours: true } });
      const by = new Map<string, { accepted: number; refused: number }>();
      for (const e of entries) {
        const r = by.get(e.userId) ?? { accepted: 0, refused: 0 };
        if (e.kind === 'ACCEPTED') r.accepted += Number(e.hours);
        else r.refused += 1;
        by.set(e.userId, r);
      }
      const n = await names(tx, [...by.keys()]);
      return { columns: ['person', 'overtimeHours', 'refusals'], rows: [...by].map(([u, r]) => ({ person: n.get(u) ?? '', overtimeHours: r2(r.accepted), refusals: r.refused })).sort((x, y) => Number(y.overtimeHours) - Number(x.overtimeHours)) };
    },
  },
  labour_cost: {
    permissions: ['accounting.manage'],
    kind: 'range',
    wholeOrg: true,
    async run(tx, _a, p) {
      const st = await tx.payStatement.findMany({ where: { payDate: { gte: start(p.from), lt: after(p.to) }, payRun: { status: { in: ['APPROVED', 'PAID'] } } }, select: { departmentId: true, gross: true, employerCpp: true, employerEi: true, deductions: true } });
      const depts = await tx.department.findMany({ select: { id: true, name: true } });
      const by = new Map<string, { gross: number; employer: number; people: number }>();
      for (const s of st) {
        const k = s.departmentId ?? '';
        const r = by.get(k) ?? { gross: 0, employer: 0, people: 0 };
        const d = s.deductions as { employerBenefits?: number; employerQpip?: number };
        r.gross += Number(s.gross);
        r.employer += Number(s.employerCpp) + Number(s.employerEi) + (d.employerBenefits ?? 0) + (d.employerQpip ?? 0);
        r.people += 1;
        by.set(k, r);
      }
      return { columns: ['department', 'statements', 'gross', 'employerCosts', 'total'], rows: [...by].map(([k, r]) => ({ department: depts.find((d) => d.id === k)?.name ?? null, statements: r.people, gross: r2(r.gross), employerCosts: r2(r.employer), total: r2(r.gross + r.employer) })) };
    },
  },
  time_off: {
    permissions: ['leave.manage', 'timeoff.approve'],
    kind: 'range',
    async run(tx, a, p) {
      const reqs = await tx.timeOffRequest.findMany({ where: { ...(await people(tx, a)), status: 'APPROVED', startsAt: { lt: after(p.to) }, endsAt: { gt: start(p.from) } }, select: { userId: true, type: true, startsAt: true, endsAt: true, chargedHours: true } });
      const n = await names(tx, reqs.map((r) => r.userId));
      return { columns: ['person', 'type', 'from', 'to', 'hours'], rows: reqs.sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime()).map((r) => ({ person: n.get(r.userId) ?? '', type: r.type, from: day(r.startsAt), to: day(r.endsAt), hours: r.chargedHours == null ? null : Number(r.chargedHours) })) };
    },
  },
  certs_expiring: {
    permissions: ['certs.verify', 'training.manage'],
    kind: 'ahead',
    async run(tx, a, p) {
      const today = new Date(new Date().toISOString().slice(0, 10));
      const rows = await tx.userCertification.findMany({ where: { ...(await people(tx, a)), verifiedAt: { not: null }, expiryDate: { gte: today, lt: new Date(today.getTime() + (p.days + 1) * 86_400_000) }, user: { status: 'ACTIVE' } }, select: { userId: true, expiryDate: true, certification: { select: { name: true } } }, orderBy: { expiryDate: 'asc' } });
      const n = await names(tx, rows.map((r) => r.userId));
      return { columns: ['person', 'certification', 'expires'], rows: rows.map((r) => ({ person: n.get(r.userId) ?? '', certification: r.certification.name, expires: day(r.expiryDate) })) };
    },
  },
  incidents: {
    permissions: ['incidents.read'],
    kind: 'range',
    async run(tx, a, p) {
      const list = await tx.incidentReport.findMany({ where: { occurredAt: { gte: start(p.from), lt: after(p.to) }, ...(a.scope?.facilityIds.length ? { facilityId: { in: a.scope.facilityIds } } : {}) }, select: { category: true, facility: { select: { name: true } } } });
      const by = new Map<string, number>();
      for (const i of list) by.set(`${i.facility.name}\u0000${i.category}`, (by.get(`${i.facility.name}\u0000${i.category}`) ?? 0) + 1);
      return { columns: ['facility', 'category', 'count'], rows: [...by].map(([k, count]) => ({ facility: k.split('\u0000')[0]!, category: k.split('\u0000')[1]!, count })).sort((x, y) => y.count - x.count) };
    },
  },
  lone_work: {
    permissions: ['lonework.monitor'],
    kind: 'range',
    async run(tx, a, p) {
      const list = await tx.loneWorkSession.findMany({ where: { ...(await people(tx, a)), startedAt: { gte: start(p.from), lt: after(p.to) } }, select: { userId: true, overdueAt: true, escalatedAt: true, helpAt: true } });
      const by = new Map<string, { sessions: number; missed: number; escalated: number; help: number }>();
      for (const s of list) {
        const r = by.get(s.userId) ?? { sessions: 0, missed: 0, escalated: 0, help: 0 };
        r.sessions += 1;
        if (s.overdueAt) r.missed += 1;
        if (s.escalatedAt) r.escalated += 1;
        if (s.helpAt) r.help += 1;
        by.set(s.userId, r);
      }
      const n = await names(tx, [...by.keys()]);
      return { columns: ['person', 'sessions', 'missedCheckIns', 'escalated', 'helpRequests'], rows: [...by].map(([u, r]) => ({ person: n.get(u) ?? '', sessions: r.sessions, missedCheckIns: r.missed, escalated: r.escalated, helpRequests: r.help })) };
    },
  },
  policies_unsigned: {
    permissions: ['policies.manage'],
    kind: 'ahead',
    wholeOrg: true,
    async run(tx) {
      const policies = await tx.policy.findMany({ where: { retiredAt: null }, include: { _count: { select: { acks: true } } } });
      const rows = [];
      for (const p of policies) {
        const of = await tx.user.count({ where: { status: 'ACTIVE', anonymizedAt: null, ...(p.positionIds.length ? { positions: { some: { positionId: { in: p.positionIds } } } } : { roles: { isEmpty: false } }) } });
        rows.push({ policy: p.title, version: p.version, signed: p._count.acks, waiting: Math.max(0, of - p._count.acks) });
      }
      return { columns: ['policy', 'version', 'signed', 'waiting'], rows };
    },
  },
  expenses: {
    permissions: ['expenses.approve'],
    kind: 'range',
    async run(tx, a, p) {
      const claims = await tx.expenseClaim.findMany({ where: { ...(await people(tx, a)), status: { in: ['APPROVED', 'PAID'] }, decidedAt: { gte: start(p.from), lt: after(p.to) } }, select: { userId: true, total: true, items: { select: { km: true } } } });
      const by = new Map<string, { claims: number; total: number; km: number }>();
      for (const c of claims) {
        const r = by.get(c.userId) ?? { claims: 0, total: 0, km: 0 };
        r.claims += 1;
        r.total += Number(c.total);
        r.km += c.items.reduce((s, i) => s + Number(i.km ?? 0), 0);
        by.set(c.userId, r);
      }
      const n = await names(tx, [...by.keys()]);
      return { columns: ['person', 'claims', 'km', 'total'], rows: [...by].map(([u, r]) => ({ person: n.get(u) ?? '', claims: r.claims, km: r2(r.km), total: r2(r.total) })) };
    },
  },
};

export type ReportKey = keyof typeof REPORTS;
export const REPORT_KEYS = Object.keys(REPORTS);

export const canRun = (a: AuthContext, key: string) => {
  const r = REPORTS[key];
  return !!r && r.permissions.some((p) => a.permissions.has(p)) && !(r.wholeOrg && a.scope);
};

export async function runReport(tx: Tx, a: AuthContext, key: string, p: ReportParams): Promise<ReportResult> {
  if (!canRun(a, key)) throw forbidden('This report isn’t open to you.');
  return REPORTS[key]!.run(tx, a, p);
}

/** The window a scheduled report covers when it's sent: the last week or the last calendar month. */
export function windowFor(schedule: 'WEEKLY' | 'MONTHLY', now = new Date()): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (schedule === 'WEEKLY') return { from: iso(new Date(now.getTime() - 7 * 86_400_000)), to: iso(new Date(now.getTime() - 86_400_000)) };
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: iso(first), to: iso(last) };
}

/** CSV for spreadsheets. Text that a spreadsheet would run as a formula is prefixed with a quote. */
export function toCsv(r: ReportResult, labels: Record<string, string> = {}) {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [r.columns.map((c) => cell(labels[c] ?? c)), ...r.rows.map((row) => r.columns.map((c) => cell(row[c])))].map((l) => l.join(',')).join('\n');
}
