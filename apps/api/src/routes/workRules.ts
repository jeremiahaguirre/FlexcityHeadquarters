/**
 * Work rules screens: unpaid meal breaks, minimum call-in pay, schedule-change notice and
 * premiums, shift premium rules and standby, organization-wide and per department (collective
 * agreements differ); positions' break and never-alone flags; late changes and their premiums.
 *
 * Who: tenant.configure sets everything. A scheduler (schedule.assist) for a department may set
 * its meal-break placement and warnings and its positions' breaks and never-alone flags; pay
 * rules (call-in, notice premiums, shift premiums, standby) stay organization policy.
 */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { localIso } from '../lib/time.js';
import { mealBreakRule, reportingPayRule } from '../services/compliance/provincialRules.js';
import { NO_DEPARTMENT, schedulableDepartments } from '../services/scheduling/fillRun.js';
import { SUPERSEDED, changeEffects, waiveShiftChange } from '../services/scheduling/changeNotice.js';
import { departmentWorkRulesBody, effectiveWorkRules, parseWorkRules, workRulesBody } from '../services/scheduling/workRules.js';
import { effectiveSettings, parseSolverSettings } from '../services/scheduling/solverSettings.js';
import { resolveFeatures } from '../services/platform/features.js';
import { shiftsWhere } from '../services/people/scope.js';
import { h } from './context.js';

export const workRulesRouter = Router();
const uuid = z.string().uuid();

const canSee = (p: ReadonlySet<string>) => p.has('tenant.configure') || p.has('schedule.write') || p.has('schedule.assist');

workRulesRouter.get(
  '/schedule/work-rules',
  h(async (req, res) => {
    const a = authOf(req);
    if (!canSee(a.permissions)) throw forbidden();
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const [tenant, facilities, positions] = await Promise.all([
          tx.tenant.findFirstOrThrow({ select: { workRules: true, overtimePolicy: true, features: true } }),
          tx.facility.findMany({ select: { province: true } }),
          tx.position.findMany({ select: { id: true, name: true, nameFr: true, departmentId: true, unpaidBreakMinutes: true, neverAlone: true }, orderBy: { name: 'asc' } }),
        ]);
        const w = parseWorkRules(tenant.workRules);
        const solver = parseSolverSettings(tenant.overtimePolicy);
        const orgSeniority = resolveFeatures(tenant.features).seniority;
        const configure = a.permissions.has('tenant.configure');
        const departments = (await schedulableDepartments(tx, a)).filter((d) => d.id !== NO_DEPARTMENT);
        const visiblePositions = new Set(configure ? positions.map((p) => p.id) : departments.flatMap((d) => d.positionIds));
        const { departments: _d, ...organization } = w;
        return {
          organization,
          departments: departments.map((d) => {
            const eff = effectiveSettings(solver, d.id, orgSeniority);
            return {
              id: d.id,
              name: d.name,
              nameFr: d.nameFr,
              own: w.departments[d.id] ?? {},
              effective: effectiveWorkRules(w, d.id),
              /** The department's scheduling limits and federal switch (Fill settings), for the same screen. */
              limits: solver.departments[d.id]?.limits ?? {},
              federallyRegulated: solver.departments[d.id]?.federallyRegulated ?? null,
              effectiveLimits: eff.limits,
              effectiveFederal: eff.federallyRegulated,
            };
          }),
          organizationLimits: solver.limits,
          organizationFederal: solver.federallyRegulated,
          provinces: [...new Set(facilities.map((f) => f.province))].sort().map((p) => ({ province: p, mealBreak: mealBreakRule(p), reportingPay: reportingPayRule(p) })),
          federal: { mealBreak: mealBreakRule('FED'), reportingPay: reportingPayRule('FED') },
          positions: positions.filter((p) => visiblePositions.has(p.id)),
          canConfigure: configure,
        };
      }),
    );
  }),
);

workRulesRouter.put(
  '/schedule/work-rules',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('tenant.configure')) throw forbidden();
    const body = workRulesBody.parse(req.body);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const tenant = await tx.tenant.findFirstOrThrow({ select: { workRules: true } });
        const before = parseWorkRules(tenant.workRules);
        const next = {
          ...before,
          breaks: { ...before.breaks, ...(body.breaks ?? {}) },
          callIn: { ...before.callIn, ...(body.callIn ?? {}) },
          notice: { ...before.notice, ...(body.notice ?? {}) },
          standby: { ...before.standby, ...(body.standby ?? {}) },
          premiums: body.premiums ?? before.premiums,
        };
        await tx.tenant.update({ where: { id: a.tenantId }, data: { workRules: next as unknown as Prisma.InputJsonValue } });
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'schedule.work_rules', entity: 'Tenant', entityId: a.tenantId, before: { ...before, departments: undefined }, after: body });
        const { departments: _d, ...organization } = parseWorkRules(next);
        return organization;
      }),
    );
  }),
);

workRulesRouter.put(
  '/schedule/work-rules/departments/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = departmentWorkRulesBody.extend({ reset: z.boolean().optional() }).parse(req.body);
    const configure = a.permissions.has('tenant.configure');
    // Pay rules are organization policy; a department's scheduler may set its meal-break placement and warnings.
    if (!configure && (!a.permissions.has('schedule.assist') || body.callIn || body.notice || body.standby || body.reset)) throw forbidden();
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        if (!(await schedulableDepartments(tx, a)).some((d) => d.id === id)) throw notFound('Department');
        const tenant = await tx.tenant.findFirstOrThrow({ select: { workRules: true } });
        const w = parseWorkRules(tenant.workRules);
        const prev = w.departments[id] ?? {};
        const own = body.reset
          ? {}
          : departmentWorkRulesBody.parse({
              ...prev,
              ...(body.breaks ? { breaks: { ...(prev.breaks ?? {}), ...body.breaks } } : {}),
              ...(body.callIn ? { callIn: { ...(prev.callIn ?? {}), ...body.callIn } } : {}),
              ...(body.notice ? { notice: { ...(prev.notice ?? {}), ...body.notice } } : {}),
              ...(body.standby ? { standby: { ...(prev.standby ?? {}), ...body.standby } } : {}),
            });
        w.departments[id] = own;
        await tx.tenant.update({ where: { id: a.tenantId }, data: { workRules: w as unknown as Prisma.InputJsonValue } });
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'schedule.work_rules.department', entity: 'Department', entityId: id, before: prev, after: body });
        return { own, effective: effectiveWorkRules(w, id) };
      }),
    );
  }),
);

workRulesRouter.patch(
  '/schedule/work-rules/positions/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = z.object({ unpaidBreakMinutes: z.number().int().min(0).max(240).nullable().optional(), neverAlone: z.boolean().optional() }).parse(req.body);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const pos = await tx.position.findUnique({ where: { id }, select: { id: true, unpaidBreakMinutes: true, neverAlone: true } });
        if (!pos) throw notFound('Position');
        const mine = a.permissions.has('schedule.assist') && (await schedulableDepartments(tx, a)).some((d) => d.positionIds.includes(id));
        if (!a.permissions.has('tenant.configure') && !a.permissions.has('positions.manage') && !mine) throw forbidden();
        const out = await tx.position.update({
          where: { id },
          data: { ...(body.unpaidBreakMinutes !== undefined ? { unpaidBreakMinutes: body.unpaidBreakMinutes || null } : {}), ...(body.neverAlone !== undefined ? { neverAlone: body.neverAlone } : {}) },
          select: { id: true, unpaidBreakMinutes: true, neverAlone: true },
        });
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'position.work_rules', entity: 'Position', entityId: id, before: pos, after: body });
        return out;
      }),
    );
  }),
);

/** What a change to a published shift would mean for notice, before saving it (the warning). */
workRulesRouter.post(
  '/shifts/:id/change-preview',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('schedule.write')) throw forbidden();
    const body = z.object({ startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), userId: uuid.nullable().optional(), cancel: z.boolean().optional() }).parse(req.body);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const s = await tx.shift.findFirst({ where: { AND: [{ id: uuid.parse(req.params.id) }, shiftsWhere(a.scope)] } });
        if (!s) throw notFound('Shift');
        const effects = await changeEffects(tx, s, { startsAt: body.startsAt ?? s.startsAt, endsAt: body.endsAt ?? s.endsAt, userId: body.userId === undefined ? s.userId : body.userId, status: body.cancel ? 'CANCELLED' : s.status });
        return { published: s.status === 'PUBLISHED', late: effects.some((e) => e.late), effects };
      }),
    );
  }),
);

/** Changes to published shifts in a range, late ones first, with their premiums. */
workRulesRouter.get(
  '/schedule/changes',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('schedule.write') && !a.permissions.has('payroll.export')) throw forbidden();
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date(), lateOnly: z.coerce.boolean().default(true) }).parse(req.query);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const rows = await tx.shiftChange.findMany({ where: { createdAt: { gte: q.from, lt: q.to }, ...(q.lateOnly ? { late: true } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
        const shifts = await tx.shift.findMany({ where: { AND: [{ id: { in: rows.map((r) => r.shiftId) } }, shiftsWhere(a.scope)] }, select: { id: true, facility: { select: { name: true, timezone: true } }, position: { select: { name: true, nameFr: true } } } });
        const users = await tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, firstName: true, lastName: true } });
        return rows
          .filter((r) => shifts.some((s) => s.id === r.shiftId))
          .map((r) => {
            const s = shifts.find((x) => x.id === r.shiftId)!;
            const u = users.find((x) => x.id === r.userId);
            const tz = s.facility.timezone;
            return {
              id: r.id,
              shiftId: r.shiftId,
              kind: r.kind,
              person: u ? `${u.firstName} ${u.lastName}` : '',
              facility: s.facility.name,
              position: s.position,
              oldStartsAt: r.oldStartsAt ? localIso(r.oldStartsAt, tz) : null,
              oldEndsAt: r.oldEndsAt ? localIso(r.oldEndsAt, tz) : null,
              newStartsAt: r.newStartsAt ? localIso(r.newStartsAt, tz) : null,
              newEndsAt: r.newEndsAt ? localIso(r.newEndsAt, tz) : null,
              noticeHours: Number(r.noticeHours),
              requiredHours: r.requiredHours ? Number(r.requiredHours) : null,
              late: r.late,
              premiumHours: r.premiumHours ? Number(r.premiumHours) : null,
              multiplier: r.multiplier ? Number(r.multiplier) : null,
              flatAmount: r.flatAmount ? Number(r.flatAmount) : null,
              payOn: r.payOn?.toISOString().slice(0, 10) ?? null,
              waived: !!r.waivedAt,
              /** Replaced by a later change to the same shift (its premium is counted there). */
              superseded: !!r.waivedAt && r.waiveReason === SUPERSEDED,
              waiveReason: r.waiveReason,
              createdAt: r.createdAt.toISOString(),
            };
          });
      }),
    );
  }),
);

workRulesRouter.post(
  '/schedule/changes/:id/waive',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('tenant.configure') && !a.permissions.has('payroll.export')) throw forbidden();
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    const id = uuid.parse(req.params.id);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        // Only changes to shifts in the caller's own departments and facilities.
        const c = await tx.shiftChange.findUnique({ where: { id }, select: { shiftId: true } });
        if (!c || !(await tx.shift.findFirst({ where: { AND: [{ id: c.shiftId }, shiftsWhere(a.scope)] }, select: { id: true } }))) throw notFound('Change');
        const out = await waiveShiftChange(tx, a, id, reason);
        return { id: out.id, waived: !!out.waivedAt };
      }),
    );
  }),
);
