/**
 * The signed-in organization API: sign-in, the department-scope guard and the consent check run
 * first, then every feature router is mounted here. A few smaller features' routes live in this file.
 */
import { exportPersonRecords } from '../services/privacy/recordsExport.js';
import { recordsPdf } from '../services/privacy/recordsPdf.js';
import { assertShiftInScope, hrRecordsBy, incidentsWhere, peopleInScope, peopleWhere, shiftInScope, userInScope } from '../services/people/scope.js';
import { offerCare } from '../services/people/care.js';
import { tenantFeatures } from '../services/platform/features.js';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { dispatchSoon, recordEvents, withEvents } from '../lib/events.js';
import { localDate, localIso } from '../lib/time.js';
import { resolveRules } from '../services/compliance/provincialRules.js';
import { createIncident, readIncident } from '../services/ops/incidents.js';
import { decideClosure, recordReading } from '../services/ops/poolOps.js';
import { runPayroll } from '../services/payroll/payrollRun.js';
import { requestErasure } from '../services/privacy/erasure.js';
import { loadReliability } from '../services/reliability/load.js';
import { RULES } from '../services/reliability/score.js';
import { proposeSchedule } from '../services/scheduling/assistant.js';
import { lockForAssignment } from '../services/scheduling/locks.js';
import { evaluateCandidate } from '../services/scheduling/eligibility.js';
import { evalOpts, loadAssistantCandidates, loadCandidate, loadShiftBundle } from '../services/scheduling/eligibilityLoader.js';
import { cancelOffer, claimOffer, decideOffer, postOffer } from '../services/shiftboard/offers.js';
import { clockIn, clockOut, editPunch } from '../services/timeclock/punches.js';
import { h, keys, tenantKekId } from './context.js';
import { notificationsRouter } from './notifications.js';
import { updatesRouter } from './updates.js';
import { schedulingRouter } from './scheduling.js';
import { fillRouter } from './fill.js';
import { workRulesRouter } from './workRules.js';
import { rotationsRouter } from './rotations.js';
import { shiftTemplatesRouter } from './shiftTemplates.js';
import { preferencesRouter } from './preferences.js';
import { biddingRouter } from './bidding.js';
import { plannerRouter } from './planner.js';
import { attendanceRouter } from './attendance.js';
import { staffRouter } from './staff.js';
import { opsRouter } from './ops.js';
import { disciplineRouter } from './discipline.js';
import { peopleRouter } from './people.js';
import { complianceRouter, deckRouter } from './deck.js';
import { forecastEventsRouter } from './forecastEvents.js';
import { onboardingRouter } from './onboarding.js';
import { overtimeRouter } from './overtime.js';
import { careRouter } from './care.js';
import { loneWorkRouter } from './loneWork.js';
import { emergencyContactsRouter } from './emergencyContacts.js';
import { smsRouter } from './sms.js';
import { lieuRouter } from './lieu.js';
import { tradesRouter } from './trades.js';
import { calendarRouter } from './calendar.js';
import { kioskAdminRouter } from './kiosk.js';
import { expensesRouter } from './expenses.js';
import { policiesRouter } from './policies.js';
import { communicationRouter } from './communication.js';
import { messagesRouter } from './messages.js';
import { surveysRouter } from './surveys.js';
import { applicationsRouter } from './applications.js';
import { payeesRouter } from './payees.js';
import { reportsRouter } from './reports.js';
import { consentRouter, requireConsent } from './consent.js';
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
import { reportingRouter } from './reporting.js';
import { payrollRouter } from './payroll.js';
import { payrollProviderRouter } from './payrollProvider.js';
import { payrollFullRouter } from './payrollFull.js';
import { benefitsRouter } from './benefits.js';
import { accountingRouter } from './accounting.js';
import { hrRouter } from './hr.js';
import { documentsRouter } from './documents.js';
import { supportRouter } from './support.js';
import { ssoRouter } from './sso.js';
import { integrationsRouter } from './integrations.js';
import { dataExportRouter } from './dataExport.js';
import { EXPORT_FORMATS } from '../services/payroll/export.js';
import { readSettings } from '../services/payroll/payRuns.js';

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
api.use(requireConsent);
api.use(notificationsRouter);
api.use(updatesRouter);
api.use(myPasskeysRouter);
api.use(rolesRouter);
api.use(departmentsRouter);
api.use(reportingRouter);
api.use(payrollRouter);
api.use(payrollProviderRouter);
api.use(payrollFullRouter);
api.use(benefitsRouter);
api.use(accountingRouter);
api.use(hrRouter);
api.use(documentsRouter);
api.use(supportRouter);
api.use(ssoRouter);
api.use(integrationsRouter);
api.use(dataExportRouter);
api.use(schedulingRouter);
api.use(fillRouter);
api.use(workRulesRouter);
api.use(rotationsRouter);
api.use(shiftTemplatesRouter);
api.use(preferencesRouter);
api.use(biddingRouter);
api.use(plannerRouter);
api.use(attendanceRouter);
api.use(staffRouter);
api.use(opsRouter);
api.use(disciplineRouter);
api.use(peopleRouter);
api.use(deckRouter);
api.use(complianceRouter);
api.use(forecastEventsRouter);
api.use(onboardingRouter);
api.use(overtimeRouter);
api.use(careRouter);
api.use(loneWorkRouter);
api.use(emergencyContactsRouter);
api.use(smsRouter);
api.use(lieuRouter);
api.use(tradesRouter);
api.use(calendarRouter);
api.use(kioskAdminRouter);
api.use(expensesRouter);
api.use(policiesRouter);
api.use(communicationRouter);
api.use(messagesRouter);
api.use(surveysRouter);
api.use(applicationsRouter);
api.use(payeesRouter);
api.use(reportsRouter);
api.use(consentRouter);
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
// The Union Hub runs here unless it has its own service (UNION_HUB_MODE=separate): then this API
// doesn't answer for it, and holds no union credentials.
api.use('/union', (_req, _res, next) => next(process.env.UNION_HUB_MODE === 'separate' ? new HttpError(404, 'UNION_ELSEWHERE', 'The Union Hub is served by its own service.') : undefined));
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
        // Only what the board shows (it was every column of every row: ~440 KB for a 300-person city).
        select: {
          id: true,
          status: true,
          source: true,
          shift: { select: { id: true, version: true, startsAt: true, endsAt: true, customTitle: true, premiumPerHour: true, positionId: true, facilityId: true, facility: { select: { name: true, timezone: true } }, position: { select: { name: true, nameFr: true } } } },
        },
        orderBy: { shift: { startsAt: 'asc' } },
        // The soonest 200: more than anyone scrolls, and the board stays light at shift change.
        take: 200,
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
    const out = await withTenant(actor.tenantId, (tx) => withEvents(tx, postOffer(tx, actor, uuid.parse(req.params.id))));
    dispatchSoon(actor.tenantId);
    res.status(201).json({ offerId: out.offerId });
  }),
);

api.post(
  '/offers/:id/claim',
  requirePermission('shiftboard.claim'),
  h(async (req, res) => {
    const actor = actorOf(req);
    const body = z.object({ expectedShiftVersion: z.number().int().optional() }).parse(req.body ?? {});
    const out = await withTenant(actor.tenantId, (tx) => withEvents(tx, claimOffer(tx, actor, uuid.parse(req.params.id), body.expectedShiftVersion)));
    dispatchSoon(actor.tenantId);
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
    await withTenant(actor.tenantId, async (tx) => {
      const offer = await tx.shiftOffer.findUnique({ where: { id: uuid.parse(req.params.id) }, select: { shift: { select: { positionId: true, facilityId: true } } } });
      if (offer) assertShiftInScope(a, offer.shift);
      await recordEvents(tx, await decideOffer(tx, actor, uuid.parse(req.params.id), decision));
    });
    dispatchSoon(actor.tenantId);
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
        /** One facility, or several planned together (staff shared between them). */
        facilityId: uuid.optional(),
        facilityIds: z.array(uuid).min(1).max(30).optional(),
        from: z.coerce.date(),
        to: z.coerce.date(),
        distributionMode: z.enum(['SENIORITY', 'EGALITARIAN']),
        useShadowTiers: z.boolean().default(false),
        /** Default: the organization's travel-time setting. */
        travelMinutes: z.number().int().min(0).max(240).optional(),
        apply: z.boolean().default(false),
      })
      .refine((b) => b.facilityId || b.facilityIds?.length, { message: 'Choose at least one facility.' })
      .parse(req.body);
    const facilityIds = [...new Set([...(body.facilityIds ?? []), ...(body.facilityId ? [body.facilityId] : [])])];
    if (body.to <= body.from) throw badRequest('`to` must be after `from`');

    const out = await withTenant(a.tenantId, async (tx) => {
      const facilities = await tx.facility.findMany({ where: { id: { in: facilityIds } }, include: { tenant: true } });
      if (facilities.length !== facilityIds.length) throw notFound('Facility');
      const facility = facilities[0]!;
      const open = await tx.shift.findMany({
        where: { facilityId: { in: facilityIds }, userId: null, status: { in: ['DRAFT', 'PUBLISHED'] }, startsAt: { gte: body.from, lt: body.to } },
      });
      // Only shifts and people in the caller's scope; the same rules and limits as every other path.
      const bundles = (await Promise.all(open.filter((s) => shiftInScope(a.scope, s)).map((s) => loadShiftBundle(tx, s.id)))).filter((b) => b !== null);
      const candidates = await loadAssistantCandidates(tx, body.from, body.to, peopleWhere(a.scope));
      const proposal = proposeSchedule({
        // Each shift with its own facility's rules (provinces can differ), school calendar and limits.
        shifts: bundles.map((b) => ({ shift: b.shift, position: b.position, rules: b.rules, schoolCalendar: b.schoolCalendar, limits: b.limits })),
        candidates,
        travelMinutes: body.travelMinutes ?? bundles[0]?.travelMinutes ?? 30,
        // Same rules (incl. collective-agreement overrides) and school calendar as every other check.
        rules: bundles[0]?.rules ?? resolveRules(facility.province, localDate(body.from, facility.timezone)),
        payWeekStartDay: facility.tenant.payWeekStartDay,
        // By seniority only where the organization uses seniority.
        distributionMode: (await tenantFeatures(a.tenantId)).seniority ? body.distributionMode : 'EGALITARIAN',
        useShadowTiers: body.useShadowTiers,
        schoolCalendar: bundles[0]?.schoolCalendar,
      });
      if (body.apply) {
        // Drafts only — a supervisor still publishes. Compare-and-set on version, under the same locks.
        await lockForAssignment(tx, { shiftIds: proposal.assignments.map((x) => x.shiftId), userIds: proposal.assignments.map((x) => x.userId) });
        for (const asg of proposal.assignments) {
          const b = bundles.find((x) => x.shift.id === asg.shiftId)!;
          const v = b.shift.version;
          // Re-checked under the lock (another writer may have booked this person meanwhile).
          const c = await loadCandidate(tx, b, asg.userId);
          if (!c || !evaluateCandidate(c, b.shift, b.position, evalOpts(b, true)).eligible) continue;
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
/** A phone may send a punch it saved without a connection: its id, when it happened and its own clock. */
const timing = {
  clientId: uuid.optional(),
  occurredAt: z.coerce.date().optional(),
  sentAt: z.coerce.date().optional(),
  offline: z.boolean().optional(),
};
const punchView = (p: { id: string; locationStatus: string; recordedOffline: boolean; clockIn: Date; clockOut: Date | null }) => ({
  id: p.id,
  locationStatus: p.locationStatus,
  recordedOffline: p.recordedOffline,
  clockIn: p.clockIn,
  clockOut: p.clockOut,
});

api.post(
  '/timeclock/in',
  requirePermission('timeclock.punch'),
  h(async (req, res) => {
    const a = authOf(req);
    const { clientId, occurredAt, sentAt, offline, ...body } = z.object({ facilityId: uuid, shiftId: uuid.optional(), positionId: uuid.optional(), location: location.optional().default(null), ...timing }).parse(req.body);
    const punch = await withTenant(a.tenantId, (tx) => clockIn(tx, { ...body, tenantId: a.tenantId, userId: a.userId, ip: req.ip ?? null, timing: { clientId, occurredAt, sentAt, offline } }));
    // A re-sent punch gets the same answer as the first time.
    res.status(punch.duplicate ? 200 : 201).json(punchView(punch));
  }),
);

api.post(
  '/timeclock/out',
  requirePermission('timeclock.punch'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object(timing).parse(req.body ?? {});
    const punch = await withTenant(a.tenantId, (tx) => clockOut(tx, a.userId, body));
    res.json(punchView(punch));
  }),
);

api.patch(
  '/punches/:id',
  requirePermission('timeclock.review'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ clockIn: z.coerce.date().optional(), clockOut: z.coerce.date().optional(), reason: z.string().min(3) }).parse(req.body);
    const p = await withTenant(a.tenantId, (tx) => editPunch(tx, { ...body, tenantId: a.tenantId, actorId: a.userId, punchId: uuid.parse(req.params.id), inScope: (userId) => userInScope(tx, a.scope, userId) }));
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
    const out = await withTenant(a.tenantId, (tx) => withEvents(tx, recordReading(tx, a.tenantId, a.userId, body)));
    dispatchSoon(a.tenantId);
    res.status(201).json({ id: out.reading.id, outOfRange: out.outOfRange, reasons: out.reasons });
  }),
);

api.post(
  '/ops/pools/:id/closure',
  requirePermission('ops.pool.close'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ action: z.enum(['CONFIRM', 'DISMISS', 'REOPEN']), note: z.string().optional() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => recordEvents(tx, await decideClosure(tx, a.tenantId, a.userId, uuid.parse(req.params.id), body.action, body.note)));
    dispatchSoon(a.tenantId);
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
    await withTenant(a.tenantId, (tx) => recordEvents(tx, { type: 'frontdesk.page', tenantId: a.tenantId, facilityId: body.facilityId, fromUserId: a.userId, message: body.message }));
    dispatchSoon(a.tenantId);
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
    const q = z.object({ periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weeks: z.coerce.number().int().min(1).max(5), format: z.enum(EXPORT_FORMATS).optional() }).parse(req.query);
    // A supervisor limited to a department exports only their department's hours.
    const out = await withTenant(a.tenantId, async (tx) => {
      const saved = readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings).providerExport;
      const options = { ...saved, format: q.format ?? saved?.format ?? 'generic' };
      return { ...(await runPayroll(tx, a.tenantId, q.periodStart, q.weeks, await peopleInScope(tx, a.scope), null, options)), format: options.format };
    }, { timeoutMs: 120_000 });
    if (!out.csv.ok) {
      res.status(422).json({ code: 'EXPORT_INVALID', problems: out.csv.problems, warnings: out.warnings });
      return;
    }
    // Codes and details (JSON), so the screen shows them in the reader's language.
    if (out.warnings.length) res.setHeader('X-Flexcity-Warnings', encodeURIComponent(JSON.stringify(out.warnings)));
    res.type('text/csv').attachment(`payroll-${out.format}-${q.periodStart}.csv`).send(out.csv.csv);
  }),
);

/** Which payroll provider the export is laid out for (and ADP's codes). */
api.get(
  '/payroll/export-settings',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const t = await withTenant(a.tenantId, (tx) => tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } }));
    res.json({ formats: EXPORT_FORMATS, ...(readSettings(t.payrollSettings).providerExport ?? { format: 'generic', adpCompanyCode: null, adpBatchId: null }) });
  }),
);

api.put(
  '/payroll/export-settings',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('The export layout is set by HR.');
    const b = z
      .object({
        format: z.enum(EXPORT_FORMATS),
        adpCompanyCode: z.string().trim().regex(/^[A-Za-z0-9]{3}$/, 'ADP company codes are three letters or numbers.').nullable().optional(),
        adpBatchId: z.string().trim().max(10).nullable().optional(),
      })
      .parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } });
      const next = { ...readSettings(t.payrollSettings), providerExport: { format: b.format, adpCompanyCode: b.adpCompanyCode?.toUpperCase() ?? null, adpBatchId: b.adpBatchId ?? null } };
      await tx.tenant.update({ where: { id: a.tenantId }, data: { payrollSettings: JSON.parse(JSON.stringify(next)) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.export_settings', entity: 'Tenant', entityId: a.tenantId, after: b });
    });
    res.json({ ok: true });
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
      // HR (and the person themselves) see every event; other supervisors only those they recorded.
      // Someone in another organization (or erased) reads as not found.
      const u = await tx.user.findUnique({ where: { id: userId }, select: { anonymizedAt: true } });
      if (!u || u.anonymizedAt) throw notFound('Staff member');
      const by = userId === a.userId ? null : hrRecordsBy(a);
      return loadReliability(tx, userId, new Date(), by);
    });
    res.json({ ...out, rules: RULES, notice: 'Advisory only. Not used for automated scheduling or discipline decisions.' });
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

/** The same records as a printable PDF, in English or French. */
api.get(
  '/users/:id/records-export.pdf',
  requirePermission('users.privacy'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const lang = req.query.lang === 'fr' ? 'fr' : 'en';
    const { data, organization, preparedBy } = await withTenant(a.tenantId, async (tx) => {
      const data = await exportPersonRecords(tx, userId);
      const [org, me] = await Promise.all([tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { name: true } }), tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { firstName: true, lastName: true } })]);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'privacy.records_export', entity: 'User', entityId: userId, after: { format: 'pdf' } });
      return { data, organization: org.name, preparedBy: `${me.firstName} ${me.lastName}` };
    });
    const pdf = await recordsPdf(data, { organization, preparedBy, lang });
    res.setHeader('Cache-Control', 'no-store');
    res.attachment(`records-${userId}.pdf`).type('application/pdf').send(pdf);
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
