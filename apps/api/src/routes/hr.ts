/**
 * The rest of a city HR department: leave balances, performance reviews,
 * training records, grievances (labour relations), offboarding, and an HR
 * overview that counts what needs attention in each area.
 *
 * Visibility follows the rest of the app: HR sees everyone; a supervisor or
 * manager only their departments (and, for reviews, only the ones they
 * conduct); everyone sees their own.
 */
import type { Prisma, TimeOffType } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { type AuthContext, authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { type Tx, audit, withTenant } from '../lib/db.js';
import { HttpError, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../services/notifications/notifier.js';
import { forgetActive } from '../services/people/customRoles.js';
import { peopleInScope, peopleWhere, userInScope } from '../services/people/scope.js';
import { loadGraph, setManagers, setReportsOf } from '../services/people/reporting.js';
import { h } from './context.js';
import { leaveHoursFrom, scheduledShifts, weekdayLeaveHours } from '../services/people/leaveHours.js';
import { assertUserInScope } from '../services/people/scope.js';
import { holidaysTouching, organizationDay, statutoryDay } from '../services/payroll/holidayRules.js';

export const hrRouter = Router();
hrRouter.use(['/leave', '/me/leave', '/reviews', '/me/reviews', '/training', '/me/training', '/grievances'], requireFeature('hrSuite'));

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LEAVE_TYPES = ['VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER'] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------- Leave balances

/** Kept for callers that measure a period with no schedule at hand. */
export const leaveHours = weekdayLeaveHours;

/** Minimums when no entitlement is set: two weeks' vacation (three after five years) and five sick days. Set your agreement's amounts per person. */
function defaultHours(type: TimeOffType, hireDate: Date | null, year: number): number | null {
  if (type === 'VACATION') return hireDate && year - hireDate.getUTCFullYear() >= 5 ? 120 : 80;
  if (type === 'SICK') return 40;
  return null;
}

async function balances(tx: Tx, userIds: string[], year: number) {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const [users, ents, requests, shifts] = await Promise.all([
    tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, hireDate: true } }),
    tx.leaveEntitlement.findMany({ where: { userId: { in: userIds }, year } }),
    tx.timeOffRequest.findMany({ where: { userId: { in: userIds }, startsAt: { lt: end }, endsAt: { gt: start }, status: { in: ['APPROVED', 'PENDING'] } } }),
    scheduledShifts(tx, userIds, start, end),
  ]);
  // Approved: what was charged at approval (older requests: the weekday count). Pending: their schedule as it stands.
  const hoursOf = (r: (typeof requests)[number]) =>
    r.status === 'APPROVED'
      ? r.chargedHours != null
        ? Number(r.chargedHours)
        : weekdayLeaveHours(r.startsAt, r.endsAt)
      : leaveHoursFrom(r, shifts.filter((s) => s.userId === r.userId)).hours;
  return users.map((u) => ({
    userId: u.id,
    name: `${u.firstName} ${u.lastName}`,
    types: LEAVE_TYPES.map((type) => {
      const e = ents.find((x) => x.userId === u.id && x.type === type);
      const entitled = e ? Number(e.hours) : defaultHours(type, u.hireDate, year);
      const carryover = e ? Number(e.carryover) : 0;
      const mine = requests.filter((r) => r.userId === u.id && r.type === type);
      const used = r2(mine.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + hoursOf(r), 0));
      const pending = r2(mine.filter((r) => r.status === 'PENDING').reduce((s, r) => s + hoursOf(r), 0));
      return { type, entitled, carryover, used, pending, remaining: entitled == null ? null : r2(entitled + carryover - used), set: !!e, note: e?.note ?? null };
    }),
  }));
}

hrRouter.get(
  '/leave/balances',
  h(async (req, res) => {
    const a = authOf(req);
    // HR, and anyone who approves time off (for their own department).
    if (!a.permissions.has('leave.manage') && !a.permissions.has('timeoff.approve')) throw forbidden();
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year ?? new Date().getUTCFullYear());
    const out = await withTenant(a.tenantId, async (tx) => {
      const ids = (await tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null, ...peopleWhere(a.scope) }, select: { id: true }, orderBy: [{ lastName: 'asc' }] })).map((u) => u.id);
      const rows = await balances(tx, ids, year);
      return rows.sort((x, y) => x.name.localeCompare(y.name));
    });
    res.json({ year, people: out });
  }),
);

hrRouter.get(
  '/me/leave',
  h(async (req, res) => {
    const a = authOf(req);
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year ?? new Date().getUTCFullYear());
    const [mine] = await withTenant(a.tenantId, (tx) => balances(tx, [a.userId], year));
    res.json({ year, types: mine?.types ?? [] });
  }),
);

/**
 * The organization's statutory holidays for the coming year, for time-off screens: each with its
 * own date, the day the law moves it to (Canada Day on a Sunday → July 2) and the day the
 * organization is closed for it (the next weekday where it observes weekend holidays that way).
 * Public information, so anyone signed in may see it.
 */
hrRouter.get(
  '/me/holidays',
  h(async (req, res) => {
    const a = authOf(req);
    const from = isoDate.optional().parse(req.query.from) ?? new Date().toISOString().slice(0, 10);
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 366 * 86_400_000).toISOString().slice(0, 10);
    const out = await withTenant(a.tenantId, async (tx) => {
      const [t, facilities] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { holidayObservance: true } }),
        tx.facility.findMany({ select: { province: true } }),
      ]);
      const provinces = [...new Set(facilities.map((f) => f.province))].sort();
      const rows = await Promise.all(provinces.map(async (province) => (await holidaysTouching(tx, province, from, to)).map((h) => ({ province, key: h.key, name: h.name, nameFr: h.nameFr, date: h.date, kind: h.kind, observedOn: h.kind === 'ACTUAL' ? null : statutoryDay(h), closedOn: organizationDay(h, t.holidayObservance) }))));
      return { observance: t.holidayObservance, provinces, holidays: rows.flat().filter((h) => h.closedOn >= from).sort((x, y) => x.closedOn.localeCompare(y.closedOn) || x.province.localeCompare(y.province)) };
    });
    res.json(out);
  }),
);

hrRouter.put(
  '/users/:id/leave',
  requirePermission('leave.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const b = z.object({ year: z.number().int().min(2020).max(2100), type: z.enum(LEAVE_TYPES), hours: z.number().min(0).max(2000), carryover: z.number().min(0).max(2000).default(0), note: z.string().trim().max(200).nullable().optional() }).parse(req.body);
    if (userId === a.userId) throw forbidden('You can’t set your own leave entitlement.');
    await withTenant(a.tenantId, async (tx) => {
      await assertUserInScope(tx, a, userId);
      await tx.leaveEntitlement.upsert({
        where: { userId_year_type: { userId, year: b.year, type: b.type } },
        update: { hours: b.hours, carryover: b.carryover, note: b.note ?? null },
        create: { tenantId: a.tenantId, userId, year: b.year, type: b.type, hours: b.hours, carryover: b.carryover, note: b.note ?? null },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'leave.entitlement', entity: 'User', entityId: userId, after: b });
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------- Performance reviews
type Goal = { text: string; met: boolean | null };
const reviewView = (r: { id: string; userId: string; reviewerId: string; cycle: string; dueOn: Date; status: string; goals: unknown; selfComments: string | null; managerComments: string | null; rating: number | null; employeeComments: string | null; acknowledgedAt: Date | null }, names: Map<string, string>) => ({
  ...r,
  dueOn: r.dueOn.toISOString().slice(0, 10),
  goals: r.goals as Goal[],
  employee: names.get(r.userId) ?? '',
  reviewer: names.get(r.reviewerId) ?? '',
});
async function nameMap(tx: Tx, ids: string[]) {
  const users = await tx.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
}

hrRouter.get(
  '/reviews',
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      // HR sees every review (in their scope); anyone else, the reviews they conduct.
      const where: Prisma.PerformanceReviewWhereInput = a.permissions.has('performance.manage') && a.roles.includes('HR_ADMIN') ? {} : { reviewerId: a.userId };
      const rows = await tx.performanceReview.findMany({ where, orderBy: [{ dueOn: 'asc' }] });
      const names = await nameMap(tx, rows.flatMap((r) => [r.userId, r.reviewerId]));
      return rows.map((r) => ({ ...reviewView(r, names), mine: r.userId === a.userId, reviewing: r.reviewerId === a.userId }));
    });
    res.json(out);
  }),
);

hrRouter.get(
  '/me/reviews',
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const rows = await tx.performanceReview.findMany({ where: { OR: [{ userId: a.userId }, { reviewerId: a.userId }] }, orderBy: [{ dueOn: 'desc' }] });
      const names = await nameMap(tx, rows.flatMap((r) => [r.userId, r.reviewerId]));
      return rows.map((r) => ({ ...reviewView(r, names), mine: r.userId === a.userId, reviewing: r.reviewerId === a.userId }));
    });
    res.json(out);
  }),
);

hrRouter.post(
  '/reviews',
  requirePermission('performance.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    // No reviewer chosen: the person's manager (services/people/reporting.ts).
    const body = z.object({ userId: uuid, reviewerId: uuid.optional(), cycle: z.string().trim().min(2).max(60), dueOn: isoDate, goals: z.array(z.string().trim().min(2).max(300)).max(20).default([]) }).parse(req.body);
    if (body.userId === body.reviewerId) throw new HttpError(400, 'SELF_REVIEWER', 'Someone else has to conduct the review.');
    const r = await withTenant(a.tenantId, async (tx) => {
      if (!(await userInScope(tx, a.scope, body.userId))) throw notFound('Person');
      const reviewerId = body.reviewerId ?? (await loadGraph(tx)).parent(body.userId);
      if (!reviewerId) throw new HttpError(400, 'NO_REVIEWER', 'This person has no manager yet: choose who conducts the review.');
      if (!(await tx.user.findFirst({ where: { id: reviewerId, status: 'ACTIVE', anonymizedAt: null }, select: { id: true } }))) throw notFound('Reviewer');
      const b = { ...body, reviewerId };
      const created = await tx.performanceReview.create({ data: { tenantId: a.tenantId, userId: b.userId, reviewerId: b.reviewerId, cycle: b.cycle, dueOn: new Date(b.dueOn), goals: b.goals.map((text) => ({ text, met: null })), createdById: a.userId } });
      await notify(tx, a.tenantId, [{ userId: b.userId, type: 'review_self', params: { cycle: b.cycle }, link: '/profile#reviews' }]);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'review.create', entity: 'PerformanceReview', entityId: created.id, after: b });
      return created;
    });
    res.status(201).json({ id: r.id });
  }),
);

async function reviewFor(tx: Tx, id: string) {
  const r = await tx.performanceReview.findUnique({ where: { id } });
  if (!r) throw notFound('Review');
  return r;
}

hrRouter.put(
  '/reviews/:id/self',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ selfComments: z.string().trim().min(2).max(5000) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const r = await reviewFor(tx, id);
      if (r.userId !== a.userId) throw notFound('Review');
      if (r.status !== 'SELF') throw conflict('REVIEW_STEP', 'Your self-assessment is already in.');
      await tx.performanceReview.update({ where: { id }, data: { selfComments: b.selfComments, status: 'MANAGER' } });
      await notify(tx, a.tenantId, [{ userId: r.reviewerId, type: 'review_manager', params: { cycle: r.cycle }, link: '/profile#reviews' }]);
    });
    res.json({ ok: true });
  }),
);

hrRouter.put(
  '/reviews/:id/manager',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ managerComments: z.string().trim().min(2).max(5000), rating: z.number().int().min(1).max(5), goalsMet: z.array(z.boolean().nullable()).max(20).default([]) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const r = await reviewFor(tx, id);
      if (r.reviewerId !== a.userId) throw notFound('Review');
      if (r.status !== 'MANAGER') throw conflict('REVIEW_STEP', 'This review isn’t waiting for you.');
      const goals = (r.goals as Goal[]).map((g, i) => ({ ...g, met: b.goalsMet[i] ?? g.met }));
      await tx.performanceReview.update({ where: { id }, data: { managerComments: b.managerComments, rating: b.rating, goals, status: 'DISCUSS' } });
      await notify(tx, a.tenantId, [{ userId: r.userId, type: 'review_ready', params: { cycle: r.cycle }, link: '/profile#reviews' }]);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'review.manager', entity: 'PerformanceReview', entityId: id });
    });
    res.json({ ok: true });
  }),
);

hrRouter.post(
  '/reviews/:id/acknowledge',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ employeeComments: z.string().trim().max(5000).nullable().optional() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const r = await reviewFor(tx, id);
      if (r.userId !== a.userId) throw notFound('Review');
      if (r.status !== 'DISCUSS') throw conflict('REVIEW_STEP', 'This review isn’t ready to acknowledge.');
      // Acknowledging means "I've read it", not "I agree"; the employee can add their side.
      await tx.performanceReview.update({ where: { id }, data: { employeeComments: b.employeeComments ?? null, status: 'ACKNOWLEDGED', acknowledgedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'review.acknowledge', entity: 'PerformanceReview', entityId: id });
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------- Training
async function trainingStatus(tx: Tx, userIds: string[]) {
  const [courses, records, positions] = await Promise.all([
    tx.trainingCourse.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    tx.trainingRecord.findMany({ where: { userId: { in: userIds } }, orderBy: { completedOn: 'desc' } }),
    tx.userPosition.findMany({ where: { userId: { in: userIds } }, select: { userId: true, positionId: true } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const due = [] as Array<{ userId: string; courseId: string; status: 'MISSING' | 'EXPIRED' | 'DUE_SOON'; expiresOn: string | null }>;
  for (const userId of userIds) {
    const held = positions.filter((p) => p.userId === userId).map((p) => p.positionId);
    for (const c of courses.filter((x) => x.mandatory && (!x.positionIds.length || x.positionIds.some((p) => held.includes(p))))) {
      const last = records.find((r) => r.userId === userId && r.courseId === c.id);
      if (!last) {
        due.push({ userId, courseId: c.id, status: 'MISSING', expiresOn: null });
        continue;
      }
      if (!c.renewMonths) continue;
      const exp = new Date(last.completedOn);
      exp.setUTCMonth(exp.getUTCMonth() + c.renewMonths);
      const expiresOn = exp.toISOString().slice(0, 10);
      const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
      if (expiresOn < today) due.push({ userId, courseId: c.id, status: 'EXPIRED', expiresOn });
      else if (expiresOn <= soon) due.push({ userId, courseId: c.id, status: 'DUE_SOON', expiresOn });
    }
  }
  return { courses, records, due };
}
const courseView = (c: { id: string; name: string; nameFr: string | null; hours: unknown; mandatory: boolean; renewMonths: number | null; positionIds: string[]; active: boolean }) => ({ ...c, hours: Number(c.hours) });

hrRouter.get(
  '/training',
  requirePermission('training.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const people = await tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null, ...peopleWhere(a.scope) }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }] });
      const s = await trainingStatus(tx, people.map((p) => p.id));
      const name = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
      return {
        courses: s.courses.map(courseView),
        records: s.records.slice(0, 300).map((r) => ({ id: r.id, courseId: r.courseId, userId: r.userId, name: name.get(r.userId) ?? '', completedOn: r.completedOn.toISOString().slice(0, 10), hours: r.hours != null ? Number(r.hours) : null, trainer: r.trainer })),
        due: s.due.map((d) => ({ ...d, name: name.get(d.userId) ?? '' })),
        people: people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` })),
      };
    });
    res.json(out);
  }),
);

hrRouter.get(
  '/me/training',
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const s = await trainingStatus(tx, [a.userId]);
      return { courses: s.courses.map(courseView), records: s.records.map((r) => ({ id: r.id, courseId: r.courseId, completedOn: r.completedOn.toISOString().slice(0, 10), hours: r.hours != null ? Number(r.hours) : null, trainer: r.trainer })), due: s.due };
    });
    res.json(out);
  }),
);

const courseBody = z.object({ name: z.string().trim().min(2).max(80), nameFr: z.string().trim().max(80).nullable().optional(), hours: z.number().min(0).max(500).default(0), mandatory: z.boolean().default(false), renewMonths: z.number().int().min(1).max(120).nullable().optional(), positionIds: z.array(uuid).max(200).default([]), active: z.boolean().default(true) });

hrRouter.post(
  '/training/courses',
  requirePermission('training.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('Courses are set up by HR.');
    const b = courseBody.parse(req.body);
    const c = await withTenant(a.tenantId, async (tx) => {
      if (await tx.trainingCourse.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' } } })) throw conflict('COURSE_EXISTS', 'There is already a course with that name.');
      return tx.trainingCourse.create({ data: { ...b, nameFr: b.nameFr ?? null, renewMonths: b.renewMonths ?? null, tenantId: a.tenantId } });
    });
    res.status(201).json(courseView(c));
  }),
);

hrRouter.put(
  '/training/courses/:id',
  requirePermission('training.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('Courses are set up by HR.');
    const id = uuid.parse(req.params.id);
    const b = courseBody.parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.trainingCourse.findUnique({ where: { id } }))) throw notFound('Course');
      await tx.trainingCourse.update({ where: { id }, data: { ...b, nameFr: b.nameFr ?? null, renewMonths: b.renewMonths ?? null } });
    });
    res.json({ ok: true });
  }),
);

/** Record a session for one or more people (e.g. everyone at an in-service). Supervisors record for their department. */
hrRouter.post(
  '/training/records',
  requirePermission('training.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ courseId: uuid, userIds: z.array(uuid).min(1).max(200), completedOn: isoDate, hours: z.number().min(0).max(500).nullable().optional(), trainer: z.string().trim().max(80).nullable().optional() }).parse(req.body);
    if (b.completedOn > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'FUTURE_DATE', 'Training can’t be recorded for a future date.');
    const n = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.trainingCourse.findUnique({ where: { id: b.courseId } }))) throw notFound('Course');
      const allowed = await peopleInScope(tx, a.scope);
      if (allowed && b.userIds.some((u) => !allowed.has(u))) throw notFound('Person');
      await tx.trainingRecord.createMany({ data: b.userIds.map((userId) => ({ tenantId: a.tenantId, courseId: b.courseId, userId, completedOn: new Date(b.completedOn), hours: b.hours ?? null, trainer: b.trainer ?? null, recordedById: a.userId })) });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'training.record', entity: 'TrainingCourse', entityId: b.courseId, after: { people: b.userIds.length, completedOn: b.completedOn } });
      return b.userIds.length;
    });
    res.status(201).json({ recorded: n });
  }),
);

// ------------------------------------------------------------- Grievances (labour relations)
const grievanceView = (g: { id: string; number: number; userId: string | null; kind: string; title: string; articles: string | null; filedOn: Date; status: string; dueOn: Date | null; outcome: string | null; history: unknown }, names: Map<string, string>) => ({
  ...g,
  filedOn: g.filedOn.toISOString().slice(0, 10),
  dueOn: g.dueOn?.toISOString().slice(0, 10) ?? null,
  grievor: g.userId ? (names.get(g.userId) ?? '') : null,
});

hrRouter.get(
  '/grievances',
  requirePermission('grievances.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const inScope = await peopleInScope(tx, a.scope);
      const rows = await tx.grievance.findMany({ orderBy: [{ number: 'desc' }] });
      const visible = inScope ? rows.filter((g) => g.userId && inScope.has(g.userId)) : rows;
      const names = await nameMap(tx, visible.map((g) => g.userId).filter((x): x is string => !!x));
      return visible.map((g) => grievanceView(g, names));
    });
    res.json(out);
  }),
);

const STATUSES = ['FILED', 'STEP_1', 'STEP_2', 'STEP_3', 'ARBITRATION', 'RESOLVED', 'WITHDRAWN'] as const;

hrRouter.post(
  '/grievances',
  requirePermission('grievances.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ userId: uuid.nullable(), kind: z.enum(['INDIVIDUAL', 'GROUP', 'POLICY']).default('INDIVIDUAL'), title: z.string().trim().min(3).max(200), articles: z.string().trim().max(200).nullable().optional(), filedOn: isoDate, dueOn: isoDate.nullable().optional() }).parse(req.body);
    const g = await withTenant(a.tenantId, async (tx) => {
      if (b.userId && !(await userInScope(tx, a.scope, b.userId))) throw notFound('Person');
      const last = await tx.grievance.aggregate({ _max: { number: true } });
      return tx.grievance.create({
        data: { tenantId: a.tenantId, number: (last._max.number ?? 0) + 1, userId: b.userId, kind: b.kind, title: b.title, articles: b.articles ?? null, filedOn: new Date(b.filedOn), dueOn: b.dueOn ? new Date(b.dueOn) : null, history: [{ at: new Date().toISOString(), by: a.userId, status: 'FILED', note: null }], createdById: a.userId },
      });
    });
    res.status(201).json({ id: g.id, number: g.number });
  }),
);

hrRouter.patch(
  '/grievances/:id',
  requirePermission('grievances.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ status: z.enum(STATUSES), dueOn: isoDate.nullable().optional(), outcome: z.string().trim().max(2000).nullable().optional(), note: z.string().trim().max(1000).nullable().optional() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const g = await tx.grievance.findUnique({ where: { id } });
      if (!g) throw notFound('Grievance');
      if (g.userId && !(await userInScope(tx, a.scope, g.userId))) throw notFound('Grievance');
      const history = [...(g.history as object[]), { at: new Date().toISOString(), by: a.userId, status: b.status, note: b.note ?? null }];
      await tx.grievance.update({ where: { id }, data: { status: b.status, ...(b.dueOn !== undefined ? { dueOn: b.dueOn ? new Date(b.dueOn) : null } : {}), ...(b.outcome !== undefined ? { outcome: b.outcome } : {}), history } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'grievance.update', entity: 'Grievance', entityId: id, after: b });
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------- Offboarding
const OFFBOARD_ITEMS = ['finalPay', 'vacationPayout', 'roe', 'benefitsEnded', 'equipmentReturned', 'accessRemoved', 'exitInterview'] as const;

hrRouter.get(
  '/offboarding',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const rows = await tx.offboarding.findMany({ orderBy: [{ completedAt: { sort: 'desc', nulls: 'first' } }, { lastDay: 'asc' }], take: 100 });
      const names = await nameMap(tx, rows.map((r) => r.userId));
      const open = rows.filter((r) => !r.completedAt).map((r) => r.userId);
      // People whose manager is set to someone leaving: completing asks who they report to now.
      const reports = open.length ? await tx.user.groupBy({ by: ['reportsToId'], where: { reportsToId: { in: open }, anonymizedAt: null, status: { not: 'TERMINATED' } }, _count: { _all: true } }) : [];
      const reportCount = new Map(reports.map((r) => [r.reportsToId, r._count._all]));
      return rows.map((r) => ({ id: r.id, userId: r.userId, name: names.get(r.userId) ?? '', lastDay: r.lastDay.toISOString().slice(0, 10), reason: r.reason, checklist: r.checklist, completedAt: r.completedAt, reports: r.completedAt ? 0 : (reportCount.get(r.userId) ?? 0) }));
    });
    res.json({ items: OFFBOARD_ITEMS, offboardings: out });
  }),
);

hrRouter.post(
  '/users/:id/offboarding',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    if (userId === a.userId) throw forbidden('Someone else has to offboard you.');
    const b = z.object({ lastDay: isoDate, reason: z.enum(['RESIGNATION', 'RETIREMENT', 'END_OF_SEASON', 'END_OF_CONTRACT', 'DISMISSAL', 'LAYOFF', 'OTHER']) }).parse(req.body);
    const o = await withTenant(a.tenantId, async (tx) => {
      if (await tx.offboarding.findUnique({ where: { userId } })) throw conflict('ALREADY_OFFBOARDING', 'This person is already being offboarded.');
      const created = await tx.offboarding.create({ data: { tenantId: a.tenantId, userId, lastDay: new Date(b.lastDay), reason: b.reason, checklist: OFFBOARD_ITEMS.map((key) => ({ key, done: false, doneAt: null, doneById: null })), createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'offboarding.start', entity: 'User', entityId: userId, after: b });
      return created;
    });
    res.status(201).json({ id: o.id });
  }),
);

hrRouter.patch(
  '/offboarding/:id/items/:key',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const key = z.enum(OFFBOARD_ITEMS).parse(req.params.key);
    const { done } = z.object({ done: z.boolean() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const o = await tx.offboarding.findUnique({ where: { id } });
      if (!o || o.completedAt) throw notFound('Offboarding');
      const checklist = (o.checklist as Array<{ key: string }>).map((i) => (i.key === key ? { ...i, done, doneAt: done ? new Date().toISOString() : null, doneById: done ? a.userId : null } : i));
      await tx.offboarding.update({ where: { id }, data: { checklist } });
    });
    res.json({ ok: true });
  }),
);

/** Finish: benefits end on the last day and the person can no longer sign in (their sessions stop at the next request). */
hrRouter.post(
  '/offboarding/:id/complete',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { reassignTo } = z.object({ reassignTo: uuid.nullable().optional() }).parse(req.body ?? {});
    const o = await withTenant(a.tenantId, async (tx) => {
      const o = await tx.offboarding.findUnique({ where: { id } });
      if (!o || o.completedAt) throw notFound('Offboarding');
      const open = (o.checklist as Array<{ key: string; done: boolean }>).filter((i) => !i.done && i.key !== 'exitInterview');
      if (open.length) throw new HttpError(409, 'CHECKLIST_OPEN', 'Finish the checklist first (the exit interview is optional).', { open: open.map((i) => i.key) });
      // Their people need a new manager first (null: back to their department's manager).
      const reports = await setReportsOf(tx, o.userId);
      if (reports.length && reassignTo === undefined) throw new HttpError(409, 'HAS_REPORTS', 'Choose who their people report to now.', { reports: reports.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` })) });
      if (reports.length) {
        if (reassignTo === o.userId) throw new HttpError(400, 'MANAGER_INACTIVE', 'Choose someone who still works here.');
        await setManagers(tx, a, a.tenantId, reports.map((r) => r.id), reassignTo ?? null);
      }
      await tx.benefitEnrollment.updateMany({ where: { userId: o.userId, OR: [{ endsOn: null }, { endsOn: { gt: o.lastDay } }] }, data: { endsOn: o.lastDay } });
      await tx.user.update({ where: { id: o.userId }, data: { status: 'TERMINATED' } });
      await tx.offboarding.update({ where: { id }, data: { completedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'offboarding.complete', entity: 'User', entityId: o.userId });
      return o;
    });
    forgetActive(o.userId);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------- HR overview
/** What needs attention in each HR area, for HR's overview. */
hrRouter.get(
  '/hr/overview',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const out = await withTenant(a.tenantId, async (tx: Tx) => {
      const [staff, openJobs, draftRuns, plans, enrolled, openClaims, activeAccommodations, openGrievances, reviewsOpen, reviewsLate, offboarding, flagged, pendingBank] = await Promise.all([
        tx.user.count({ where: { status: 'ACTIVE', anonymizedAt: null } }),
        tx.jobPosting.count({ where: { closesOn: { gte: today } } }).catch(() => 0),
        tx.payRun.count({ where: { status: 'DRAFT' } }),
        tx.benefitPlan.count({ where: { active: true } }),
        tx.benefitEnrollment.count({ where: { OR: [{ endsOn: null }, { endsOn: { gte: today } }] } }),
        tx.injuryClaim.count({ where: { status: 'OPEN' } }),
        tx.accommodationCase.count({ where: { status: 'ACTIVE' } }),
        tx.grievance.count({ where: { status: { notIn: ['RESOLVED', 'WITHDRAWN'] } } }),
        tx.performanceReview.count({ where: { status: { not: 'ACKNOWLEDGED' } } }),
        tx.performanceReview.count({ where: { status: { not: 'ACKNOWLEDGED' }, dueOn: { lt: today } } }),
        tx.offboarding.count({ where: { completedAt: null } }),
        tx.user.count({ where: { reviewFlaggedAt: { not: null }, status: 'ACTIVE' } }),
        tx.bankAccount.count({ where: { status: 'PENDING' } }),
      ]);
      const people = (await tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null }, select: { id: true } })).map((u) => u.id);
      const training = await trainingStatus(tx, people);
      return {
        staff,
        openJobs,
        draftRuns,
        pendingBank,
        plans,
        enrolled,
        openClaims,
        activeAccommodations,
        openGrievances,
        reviewsOpen,
        reviewsLate,
        offboarding,
        flagged,
        trainingDue: training.due.filter((d) => d.status !== 'DUE_SOON').length,
      };
    });
    res.json(out);
  }),
);

export type { AuthContext };
