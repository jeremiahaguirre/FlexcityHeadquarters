/** "Fill the schedule" (whole-horizon solver), its settings, and the availability planning window. */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { notify } from '../services/notifications/notifier.js';
import { facilitiesOf, peopleWhere } from '../services/people/scope.js';
import { resolveFeatures } from '../services/platform/features.js';
import {
  ALL_DEPARTMENTS,
  NO_DEPARTMENT,
  acceptFillChunked,
  availabilityStatus,
  availabilityWindow,
  confirmAvailability,
  runFillWeek,
  schedulableDepartments,
  undoFill,
} from '../services/scheduling/fillRun.js';
import { departmentBody, effectiveSettings, horizonBody, limitsBody, orgExtrasBody, parseSolverSettings, togglesBody, weightsBody, withSolverSettings } from '../services/scheduling/solverSettings.js';
import { h } from './context.js';

export const fillRouter = Router();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const department = z.union([uuid, z.literal(NO_DEPARTMENT), z.literal(ALL_DEPARTMENTS)]);

/** What the Fill flow needs to start: departments this person may fill, defaults, facilities. */
fillRouter.get(
  '/schedule/fill/options',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const departments = await schedulableDepartments(tx, a);
        const tenant = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, features: true, payWeekStartDay: true } });
        const stored = parseSolverSettings(tenant.overtimePolicy);
        const only = facilitiesOf(a.scope);
        const facilities = await tx.facility.findMany({ where: only ? { id: { in: only } } : {}, select: { id: true, name: true, timezone: true }, orderBy: { name: 'asc' } });
        const own = departments.find((d) => d.own);
        const defaultDepartmentId = own?.id ?? departments[0]?.id ?? null;
        const orgSeniority = resolveFeatures(tenant.features).seniority;
        return {
          departments: departments.map((d) => ({ id: d.id, name: d.name, nameFr: d.nameFr, own: d.own, positionIds: d.positionIds, planAheadWeeks: d.planAheadWeeks, ...(orgSeniority ? { useSeniority: d.useSeniority } : {}) })),
          defaultDepartmentId,
          canAll: departments.length > 1,
          facilities,
          lastHorizonWeeks: stored.lastHorizonWeeks,
          settings: effectiveSettings(stored, defaultDepartmentId && defaultDepartmentId !== NO_DEPARTMENT ? defaultDepartmentId : null, orgSeniority),
          seniorityOn: orgSeniority,
          canConfigureOrganization: a.permissions.has('tenant.configure'),
        };
      }),
    );
  }),
);

const runBody = z.object({
  departmentId: department,
  facilityIds: z.array(uuid).max(30).optional(),
  weekStart: isoDate,
  horizonStart: isoDate,
  weekIndex: z.number().int().min(0).max(12),
  horizonWeeks: horizonBody,
  carry: z
    .array(z.object({ shiftId: z.union([uuid, z.string().regex(/^new:[\w:.-]{1,80}$/)]), userId: uuid, startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), positionId: uuid.optional(), facilityId: uuid.optional() }))
    .max(5000)
    .default([]),
  /** Forecast shifts to propose without creating them (created only on accept). */
  newShifts: z.array(z.object({ key: z.string().regex(/^[\w:.-]{1,80}$/), facilityId: uuid, positionId: uuid, startsAt: z.coerce.date(), endsAt: z.coerce.date() })).max(2000).default([]),
  toggles: togglesBody.optional(),
  weights: weightsBody.optional(),
  seed: z.number().int().min(0).max(1_000_000).optional(),
});

/** One week of a horizon: the client runs the weeks in order, carrying each week's proposals forward. */
fillRouter.post(
  '/schedule/fill/run',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = runBody.parse(req.body);
    res.json(await withTenant(a.tenantId, (tx) => runFillWeek(tx, a, body)));
  }),
);

fillRouter.post(
  '/schedule/fill/accept',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const item = z
      .object({
        shiftId: uuid.optional(),
        newShift: z.object({ facilityId: uuid, positionId: uuid, startsAt: z.coerce.date(), endsAt: z.coerce.date() }).optional(),
        key: z.string().regex(/^[\w:.-]{1,80}$/).optional(),
        userId: uuid.nullable(),
        expectedVersion: z.number().int().min(0).default(0),
        previousUserId: uuid.nullable().default(null),
      })
      .refine((x) => !!x.shiftId !== !!x.newShift, { message: 'Give a shift or a new shift.' })
      .refine((x) => x.userId !== null || !!x.newShift, { message: 'Choose who works it.' });
    const body = z.object({ items: z.array(item).min(1).max(3000), allowOvertime: z.boolean().default(false) }).parse(req.body);
    // One transaction per pay week (acceptFillChunked opens them).
    res.json(await acceptFillChunked(a, body.items, { allowOvertime: body.allowOvertime }));
  }),
);

fillRouter.post(
  '/schedule/fill/undo',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    // One accept can span several weeks (one undo id each): undo them together, latest first.
    const body = z.object({ undoId: uuid.optional(), undoIds: z.array(uuid).min(1).max(60).optional() }).refine((b) => b.undoId || b.undoIds, { message: 'Nothing to undo.' }).parse(req.body);
    const ids = [...new Set([...(body.undoIds ?? []), ...(body.undoId ? [body.undoId] : [])])].reverse();
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        let restored = 0;
        let of = 0;
        let leftOpen = 0;
        for (const id of ids) {
          const r = await undoFill(tx, a, id);
          restored += r.restored;
          of += r.of;
          leftOpen += r.leftOpen;
        }
        return { restored, of, leftOpen };
      }),
    );
  }),
);

/** The organization's settings and one department's own values (what it overrides). */
fillRouter.get(
  '/schedule/fill/settings',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('schedule.write') && !a.permissions.has('tenant.configure')) throw forbidden();
    const departmentId = z.union([uuid, z.literal(NO_DEPARTMENT)]).optional().parse(req.query.departmentId);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        if (departmentId && !(await schedulableDepartments(tx, a)).some((d) => d.id === departmentId)) throw notFound('Department');
        const tenant = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, features: true } });
        const s = parseSolverSettings(tenant.overtimePolicy);
        const orgSeniority = resolveFeatures(tenant.features).seniority;
        const dept = departmentId && departmentId !== NO_DEPARTMENT ? (s.departments[departmentId] ?? {}) : null;
        return {
          organization: { planAheadWeeks: s.planAheadWeeks, weights: s.weights, toggles: s.toggles, limits: s.limits, fullTimeTargetHours: s.fullTimeTargetHours, minShiftHours: s.minShiftHours, travelMinutes: s.travelMinutes, federallyRegulated: s.federallyRegulated, holidayClosedFacilityIds: s.holidayClosedFacilityIds },
          department: dept,
          effective: effectiveSettings(s, departmentId && departmentId !== NO_DEPARTMENT ? departmentId : null, orgSeniority),
          seniorityOn: orgSeniority,
        };
      }),
    );
  }),
);

/**
 * Saves settings. Organization-wide values need tenant.configure; a department's own values
 * can be set by anyone who schedules that department (schedule.assist).
 */
fillRouter.put(
  '/schedule/fill/settings',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z
      .object({
        departmentId: uuid.nullable(),
        planAheadWeeks: horizonBody.optional(),
        weights: weightsBody.optional(),
        toggles: togglesBody.optional(),
        limits: limitsBody.optional(),
        useSeniority: z.boolean().nullable().optional(),
        targetHours: z.number().min(0).max(60).nullable().optional(),
        /** Organization: full-time target, minimum shift length, travel time, federal rules, holiday closures. */
        organization: orgExtrasBody.optional(),
        /** Department: schedule under the Canada Labour Code (null = the organization's). Needs tenant.configure, like its limits. */
        federallyRegulated: z.boolean().nullable().optional(),
        /** Department only: drop its own values and use the organization's again. */
        reset: z.boolean().optional(),
      })
      .parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, features: true } });
      const s = parseSolverSettings(tenant.overtimePolicy);
      const before = structuredClone(s);
      if (body.departmentId === null) {
        if (!a.permissions.has('tenant.configure')) throw forbidden();
        if (body.planAheadWeeks) s.planAheadWeeks = body.planAheadWeeks;
        s.weights = { ...s.weights, ...(body.weights ?? {}) };
        s.toggles = { ...s.toggles, ...(body.toggles ?? {}) };
        s.limits = { ...s.limits, ...(body.limits ?? {}) };
        Object.assign(s, body.organization ?? {});
      } else {
        if (!a.permissions.has('schedule.assist')) throw forbidden();
        // Limits and the federal switch are organization policy, even per department.
        if ((body.limits || body.federallyRegulated !== undefined) && !a.permissions.has('tenant.configure')) throw forbidden();
        if (!(await schedulableDepartments(tx, a)).some((d) => d.id === body.departmentId)) throw notFound('Department');
        const prev = s.departments[body.departmentId] ?? {};
        s.departments[body.departmentId] = body.reset
          ? {}
          : departmentBody.parse({
              ...prev,
              ...(body.planAheadWeeks ? { planAheadWeeks: body.planAheadWeeks } : {}),
              weights: { ...(prev.weights ?? {}), ...(body.weights ?? {}) },
              toggles: { ...(prev.toggles ?? {}), ...(body.toggles ?? {}) },
              ...(body.useSeniority !== undefined ? { useSeniority: body.useSeniority } : {}),
              ...(body.targetHours !== undefined ? { targetHours: body.targetHours } : {}),
              ...(body.limits ? { limits: { ...(prev.limits ?? {}), ...body.limits } } : {}),
              ...(body.federallyRegulated !== undefined ? { federallyRegulated: body.federallyRegulated } : {}),
            });
      }
      await tx.tenant.update({ where: { id: a.tenantId }, data: { overtimePolicy: withSolverSettings(tenant.overtimePolicy, s) as Prisma.InputJsonValue } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'schedule.fill.settings', entity: body.departmentId ? 'Department' : 'Tenant', entityId: body.departmentId ?? a.tenantId, before: body.departmentId ? before.departments[body.departmentId] ?? null : { planAheadWeeks: before.planAheadWeeks, weights: before.weights, toggles: before.toggles, limits: before.limits }, after: body });
      return effectiveSettings(s, body.departmentId, resolveFeatures(tenant.features).seniority);
    });
    res.json(out);
  }),
);

// ------------------------------------------------------- Availability planning window
fillRouter.get(
  '/me/availability/window',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => availabilityWindow(tx, a.userId)));
  }),
);

fillRouter.post(
  '/me/availability/confirm',
  requirePermission('availability.self'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => confirmAvailability(tx, a.tenantId, a.userId, 'availability.confirm')));
  }),
);

/** Who in a department hasn't confirmed or updated availability through the window. */
fillRouter.get(
  '/availability/status',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const departmentId = department.parse(req.query.departmentId);
    res.json(await withTenant(a.tenantId, (tx) => availabilityStatus(tx, a, departmentId)));
  }),
);

/** A gentle in-app reminder to everyone in the department who isn't current. */
fillRouter.post(
  '/availability/remind',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const { departmentId } = z.object({ departmentId: department }).parse(req.body);
    const sent = await withTenant(a.tenantId, async (tx) => {
      const st = await availabilityStatus(tx, a, departmentId);
      // Re-check scope on the exact people we notify.
      const due = st.people.filter((p) => !p.current).map((p) => p.id);
      const allowed = due.length ? new Set((await tx.user.findMany({ where: { id: { in: due }, ...peopleWhere(a.scope) }, select: { id: true } })).map((u) => u.id)) : new Set<string>();
      const ids = due.filter((id) => allowed.has(id));
      const n = await notify(tx, a.tenantId, ids.map((userId) => ({ userId, type: 'availability_reminder', params: { through: st.through, weeks: st.planAheadWeeks }, link: '/availability' })));
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'availability.remind', entity: 'Department', entityId: departmentId, after: { sent: n } });
      return n;
    });
    res.json({ sent });
  }),
);
