import { exportPersonRecords } from '../services/privacy/recordsExport.js';
import { assertShiftInScope, incidentsWhere, peopleInScope, userInScope } from '../services/people/scope.js';
import { offerCare } from '../services/people/care.js';
import { tenantFeatures } from '../services/platform/features.js';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { localDate, localIso } from '../lib/time.js';
import { resolveRules } from '../services/compliance/provincialRules.js';
import { createIncident, readIncident } from '../services/ops/incidents.js';
import { decideClosure, recordReading } from '../services/ops/poolOps.js';
import { runPayroll } from '../services/payroll/payrollRun.js';
import { requestErasure } from '../services/privacy/erasure.js';
import { computeReliability } from '../services/reliability/score.js';
import { proposeSchedule } from '../services/scheduling/assistant.js';
import { loadAssistantCandidates, loadShiftBundle } from '../services/scheduling/eligibilityLoader.js';
import { cancelOffer, claimOffer, decideOffer, postOffer } from '../services/shiftboard/offers.js';
import { clockIn, clockOut, editPunch } from '../services/timeclock/punches.js';
import { h, keys, tenantKekId } from './context.js';
import { notificationsRouter } from './notifications.js';
import { schedulingRouter } from './scheduling.js';
import { attendanceRouter } from './attendance.js';
import { staffRouter } from './staff.js';
import { opsRouter } from './ops.js';
import { disciplineRouter } from './discipline.js';
import { peopleRouter } from './people.js';
import { complianceRouter, deckRouter } from './deck.js';
import { onboardingRouter } from './onboarding.js';
import { overtimeRouter } from './overtime.js';
import { careRouter } from './care.js';
import { loneWorkRouter } from './loneWork.js';
import { billingRouter } from './billing.js';
import { winterRouter } from './winter.js';
import { programsRouter } from './programs.js';
import { membersRouter } from './members.js';
import { signupRouter } from './signup.js';
import { coverageRouter } from './coverage.js';
import { fleetRouter } from './fleet.js';
import { injuryRouter } from './injury.js';
import { accommodationRouter } from './accommodation.js';
import { benchmarksRouter } from './benchmarks.js';
import { settingsRouter } from './settings.js';
import { lessonsRouter } from './lessons.js';
import { unionRouter } from './union.js';
import { jobsRouter } from './jobs.js';
import { myPasskeysRouter } from './passkeys.js';
import { rolesRouter } from './roles.js';
import { departmentsRouter } from './departments.js';

export const api = Router();
api.use(requireAuth);
/**
 * A lead whose role is limited to a department can't open anyone outside it,
 * on any /users/:id/… or onboarding route; the person reads as not found.
 */
const PERSON_PATH = /^\/(?:users|onboarding\/people)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
api.use((req, _res, next) => {
  const a = authOf(req);
  const id = PERSON_PATH.exec(req.path)?.[1];
  if (!a.scope || !id || id === a.userId) return next();
  withTenant(a.tenantId, (tx) => userInScope(tx, a.scope, id))
    .then((ok) => next(ok ? undefined : notFound('Person')))
    .catch(next);
});
api.use(notificationsRouter);
api.use(myPasskeysRouter);
api.use(rolesRouter);
api.use(departmentsRouter);
api.use(schedulingRouter);
api.use(attendanceRouter);
api.use(staffRouter);
api.use(opsRouter);
api.use(disciplineRouter);
api.use(peopleRouter);
api.use(deckRouter);
api.use(complianceRouter);
api.use(onboardingRouter);
api.use(overtimeRouter);
api.use(careRouter);
api.use(loneWorkRouter);
api.use(billingRouter);
api.use(winterRouter);
api.use(programsRouter);
api.use(membersRouter);
api.use(signupRouter);
api.use(coverageRouter);
api.use(fleetRouter);
api.use(injuryRouter);
api.use(accommodationRouter);
api.use(benchmarksRouter);
api.use(settingsRouter);
api.use(lessonsRouter);
api.use(unionRouter);
api.use(jobsRouter);

const uuid = z.string().uuid();
const actorOf = (req: Parameters<typeof authOf>[0]) => {
  const a = authOf(req);
  return { userId: a.userId, tenantId: a.tenantId, canPostOpenShifts: a.permissions.has('shiftboard.assign_emergency') };
};

// ---------------------------------------------------------------- Shift Board
api.get(
  '/shiftboard/offers',
  requirePermission('shiftboard.claim'),
  h(async (req, res) => {
    const a = authOf(req);
    const offers = await withTenant(a.tenantId, (tx) =>
      tx.shiftOffer.findMany({
        where: { status: { in: ['OPEN', 'PENDING_APPROVAL'] }, shift: { startsAt: { gt: new Date() } } },
        include: { shift: { include: { facility: { select: { name: true, timezone: true } }, position: { select: { name: true, nameFr: true } } } } },
        orderBy: { shift: { startsAt: 'asc' } },
      }),
    );
    // Wall-clock times are computed here with the server's (updatable) tz database,
    // so a browser with stale tz data can't show a different time.
    res.json(
      offers.map((o) => ({
        ...o,
        shift: {
          ...o.shift,
          localStartsAt: localIso(o.shift.startsAt, o.shift.facility.timezone),
          localEndsAt: localIso(o.shift.endsAt, o.shift.facility.timezone),
        },
      })),
    );
  }),
);

api.post(
  '/shifts/:id/offer',
  requirePermission('shiftboard.post'),
  h(async (req, res) => {
    const actor = actorOf(req);
    const out = await withTenant(actor.tenantId, (tx) => postOffer(tx, actor, uuid.parse(req.params.id)));
    publish(out.events);
    res.status(201).json({ offerId: out.offerId });
  }),
);

api.post(
  '/offers/:id/claim',
  requirePermission('shiftboard.claim'),
  h(async (req, res) => {
    const actor = actorOf(req);
    const body = z.object({ expectedShiftVersion: z.number().int().optional() }).parse(req.body ?? {});
    const out = await withTenant(actor.tenantId, (tx) => claimOffer(tx, actor, uuid.parse(req.params.id), body.expectedShiftVersion));
    publish(out.events);
    res.json(out.outcome === 'ASSIGNED' ? { outcome: out.outcome } : { outcome: out.outcome, overtimeHours: out.overtimeHours });
  }),
);

api.post(
  '/offers/:id/decision',
  requirePermission('shiftboard.approve'),
  h(async (req, res) => {
    const actor = actorOf(req);
    const { decision } = z.object({ decision: z.enum(['APPROVE', 'DENY']) }).parse(req.body);
    const a = authOf(req);
    const events = await withTenant(actor.tenantId, async (tx) => {
      const offer = await tx.shiftOffer.findUnique({ where: { id: uuid.parse(req.params.id) }, select: { shift: { select: { positionId: true, facilityId: true } } } });
      if (offer) assertShiftInScope(a, offer.shift);
      return decideOffer(tx, actor, uuid.parse(req.params.id), decision);
    });
    publish(events);
    res.json({ ok: true });
  }),
);

api.delete(
  '/offers/:id',
  requirePermission('shiftboard.post'),
  h(async (req, res) => {
    const actor = actorOf(req);
    await withTenant(actor.tenantId, (tx) => cancelOffer(tx, actor, uuid.parse(req.params.id)));
    res.status(204).end();
  }),
);

// ------------------------------------------------------- Scheduling assistant
api.post(
  '/schedule/assist',
  requirePermission('schedule.assist'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z
      .object({
        facilityId: uuid,
        from: z.coerce.date(),
        to: z.coerce.date(),
        distributionMode: z.enum(['SENIORITY', 'EGALITARIAN']),
        useShadowTiers: z.boolean().default(false),
        apply: z.boolean().default(false),
      })
      .parse(req.body);
    if (body.to <= body.from) throw badRequest('`to` must be after `from`');

    const out = await withTenant(a.tenantId, async (tx) => {
      const facility = await tx.facility.findUniqueOrThrow({ where: { id: body.facilityId }, include: { tenant: true } });
      const open = await tx.shift.findMany({
        where: { facilityId: body.facilityId, userId: null, status: { in: ['DRAFT', 'PUBLISHED'] }, startsAt: { gte: body.from, lt: body.to } },
      });
      const bundles = (await Promise.all(open.map((s) => loadShiftBundle(tx, s.id)))).filter((b) => b !== null);
      const candidates = await loadAssistantCandidates(tx, body.from, body.to);
      const proposal = proposeSchedule({
        shifts: bundles.map((b) => ({ shift: b.shift, position: b.position })),
        candidates,
        // Same rules (incl. collective-agreement overrides) and school calendar as every other check.
        rules: bundles[0]?.rules ?? resolveRules(facility.province, localDate(body.from, facility.timezone)),
        payWeekStartDay: facility.tenant.payWeekStartDay,
        distributionMode: body.distributionMode,
        useShadowTiers: body.useShadowTiers,
        schoolCalendar: bundles[0]?.schoolCalendar,
      });
      if (body.apply) {
        // Drafts only — a supervisor still publishes. Compare-and-set on version.
        for (const asg of proposal.assignments) {
          const v = bundles.find((b) => b.shift.id === asg.shiftId)!.shift.version;
          await tx.shift.updateMany({ where: { id: asg.shiftId, version: v, userId: null }, data: { userId: asg.userId, version: { increment: 1 }, conflictReason: null } });
        }
        for (const u of proposal.unfilled) await tx.shift.update({ where: { id: u.shiftId }, data: { conflictReason: u.reason } });
      }
      return proposal;
    });
    res.json(out);
  }),
);

// ----------------------------------------------------------------- Timeclock
const location = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), accuracyM: z.number().nonnegative().nullable() }).nullable();

api.post(
  '/timeclock/in',
  requirePermission('timeclock.punch'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ facilityId: uuid, shiftId: uuid.optional(), positionId: uuid.optional(), location }).parse(req.body);
    const punch = await withTenant(a.tenantId, (tx) => clockIn(tx, { ...body, tenantId: a.tenantId, userId: a.userId, ip: req.ip ?? null }));
    res.status(201).json({ id: punch.id, locationStatus: punch.locationStatus });
  }),
);

api.post(
  '/timeclock/out',
  requirePermission('timeclock.punch'),
  h(async (req, res) => {
    const a = authOf(req);
    const punch = await withTenant(a.tenantId, (tx) => clockOut(tx, a.userId));
    res.json({ id: punch.id });
  }),
);

api.patch(
  '/punches/:id',
  requirePermission('timeclock.review'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ clockIn: z.coerce.date().optional(), clockOut: z.coerce.date().optional(), reason: z.string().min(3) }).parse(req.body);
    const p = await withTenant(a.tenantId, (tx) => editPunch(tx, { ...body, tenantId: a.tenantId, actorId: a.userId, punchId: uuid.parse(req.params.id) }));
    res.json({ id: p.id });
  }),
);

// ---------------------------------------------------------------- Operations
const decimalString = z.string().regex(/^\d+(\.\d+)?$/);

api.post(
  '/ops/readings',
  requirePermission('ops.chemical.record'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z
      .object({
        poolBodyId: uuid,
        freeChlorinePpm: decimalString.nullable().optional(),
        totalChlorinePpm: decimalString.nullable().optional(),
        ph: decimalString.nullable().optional(),
        waterTempC: decimalString.nullable().optional(),
        batherCount: z.number().int().nonnegative().nullable().optional(),
      })
      .parse(req.body);
    const out = await withTenant(a.tenantId, (tx) => recordReading(tx, a.tenantId, a.userId, body));
    publish(out.events);
    res.status(201).json({ id: out.reading.id, outOfRange: out.outOfRange, reasons: out.reasons });
  }),
);

api.post(
  '/ops/pools/:id/closure',
  requirePermission('ops.pool.close'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ action: z.enum(['CONFIRM', 'DISMISS', 'REOPEN']), note: z.string().optional() }).parse(req.body);
    const events = await withTenant(a.tenantId, (tx) => decideClosure(tx, a.tenantId, a.userId, uuid.parse(req.params.id), body.action, body.note));
    publish(events);
    res.json({ ok: true });
  }),
);

api.get(
  '/ops/status',
  requirePermission('ops.status.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const pools = await withTenant(a.tenantId, (tx) =>
      tx.poolBody.findMany({ where: { archivedAt: null }, select: { id: true, name: true, kind: true, status: true, facility: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } }),
    );
    res.json(pools);
  }),
);

api.post(
  '/ops/page-head-guard',
  requirePermission('ops.page_head_guard'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ facilityId: uuid, message: z.string().min(1).max(280) }).parse(req.body);
    publish({ type: 'frontdesk.page', tenantId: a.tenantId, facilityId: body.facilityId, fromUserId: a.userId, message: body.message });
    res.status(202).json({ ok: true });
  }),
);

api.post(
  '/incidents',
  requirePermission('incidents.create'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z
      .object({
        facilityId: uuid,
        occurredAt: z.coerce.date(),
        category: z.enum(['FIRST_AID', 'RESCUE', 'EMS_CALLED', 'INJURY', 'BEHAVIOUR', 'FACILITY', 'OTHER']),
        narrative: z.object({ summary: z.string().min(1), peopleInvolved: z.string(), actionsTaken: z.string(), emsCalled: z.boolean(), witnesses: z.string().optional() }),
      })
      .parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const created = await createIncident(tx, keys(), tenantKekId(a.tenantId), { ...body, tenantId: a.tenantId, reportedById: a.userId });
      // Serious incidents start private care check-ins for everyone involved.
      if ((await tenantFeatures(a.tenantId)).care) {
        await offerCare(tx, { id: created.id, tenantId: a.tenantId, facilityId: body.facilityId, reportedById: a.userId, occurredAt: body.occurredAt, category: body.category }, body.narrative.emsCalled);
      }
      return created;
    });
    res.status(201).json(out);
  }),
);

api.get(
  '/incidents/:id',
  requirePermission('incidents.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const purpose = z.string().min(3).parse(req.query.purpose);
    const id = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      if (a.scope && !(await tx.incidentReport.count({ where: { id, ...(await incidentsWhere(tx, a.scope)) } }))) throw notFound('Incident');
      return readIncident(tx, keys(), a.tenantId, a.userId, id, purpose);
    });
    res.json(out);
  }),
);

// ------------------------------------------------------------- Payroll / HR
api.get(
  '/payroll/export',
  requirePermission('payroll.export'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weeks: z.coerce.number().int().min(1).max(5) }).parse(req.query);
    // A supervisor limited to a department exports only their department's hours.
    const out = await withTenant(a.tenantId, async (tx) => runPayroll(tx, a.tenantId, q.periodStart, q.weeks, await peopleInScope(tx, a.scope)));
    if (!out.csv.ok) {
      res.status(422).json({ code: 'EXPORT_INVALID', problems: out.csv.problems, warnings: out.warnings });
      return;
    }
    if (out.warnings.length) res.setHeader('X-Flexcity-Warnings', encodeURIComponent(out.warnings.join(' | ')));
    res.type('text/csv').attachment(`payroll-${q.periodStart}.csv`).send(out.csv.csv);
  }),
);

api.get(
  '/users/:id/reliability',
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    // Staff can always see their own breakdown; managers need the permission.
    if (userId !== a.userId && !a.permissions.has('reliability.read')) throw forbidden();
    const out = await withTenant(a.tenantId, async (tx) => {
      const [events, leave] = await Promise.all([
        tx.reliabilityEvent.findMany({ where: { userId } }),
        tx.timeOffRequest.findMany({ where: { userId } }),
      ]);
      return computeReliability(events, leave, new Date());
    });
    res.json({ ...out, notice: 'Advisory only. Not used for automated scheduling or discipline decisions.' });
  }),
);

/** Everything held about one person, for a privacy access or freedom-of-information request. */
api.get(
  '/users/:id/records-export',
  requirePermission('users.privacy'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const data = await exportPersonRecords(tx, userId);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'privacy.records_export', entity: 'User', entityId: userId });
      return data;
    });
    res.attachment(`records-${userId}.json`).type('application/json').send(JSON.stringify(out, null, 2));
  }),
);

api.post(
  '/users/:id/erasure',
  requirePermission('users.privacy'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, (tx) => requestErasure(tx, a.tenantId, a.userId, uuid.parse(req.params.id)));
    res.json(out);
  }),
);
