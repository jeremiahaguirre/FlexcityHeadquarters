/** Rotation templates (recurring shift patterns) and on-call rosters. */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { notify } from '../services/notifications/notifier.js';
import { schedulableDepartments } from '../services/scheduling/fillRun.js';
import { createOnCall, deleteOnCall, onCallRoster, recordCallBack, rotateOnCall, swapOnCall } from '../services/scheduling/onCall.js';
import { MAX_GENERATE_DAYS, type PresetKey, assertTemplateWritable, generateFromTemplates, occurrences, rotationPreset, templateBody } from '../services/scheduling/rotations.js';
import { h } from './context.js';

export const rotationsRouter = Router();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const scheduler = (p: ReadonlySet<string>) => p.has('schedule.write');

const view = (t: Prisma.RotationTemplateGetPayload<object>) => ({
  id: t.id,
  name: t.name,
  departmentId: t.departmentId,
  facilityId: t.facilityId,
  positionId: t.positionId,
  cycleDays: t.cycleDays,
  anchorDate: t.anchorDate.toISOString().slice(0, 10),
  pattern: t.pattern,
  crews: t.crews,
  unpaidBreakMinutes: t.unpaidBreakMinutes,
  active: t.active,
  updatedAt: t.updatedAt.toISOString(),
});

rotationsRouter.get(
  '/schedule/rotations',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const departments = await schedulableDepartments(tx, a);
        const positions = new Set(departments.flatMap((d) => d.positionIds));
        const rows = await tx.rotationTemplate.findMany({ orderBy: { name: 'asc' } });
        return {
          templates: rows.filter((t) => positions.has(t.positionId) && (!a.scope?.facilityIds.length || a.scope.facilityIds.includes(t.facilityId))).map(view),
          presets: (['FOUR_ON_FOUR_OFF', 'PITMAN_2_2_3', 'WEEKDAYS', 'DAYS_NIGHTS_4_WEEK'] as PresetKey[]).map((key) => ({ key, ...rotationPreset(key) })),
          maxDays: MAX_GENERATE_DAYS,
        };
      }),
    );
  }),
);

rotationsRouter.post(
  '/schedule/rotations',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    const b = templateBody.parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const departmentId = await assertTemplateWritable(tx, a, b);
      const t = await tx.rotationTemplate.create({ data: { ...b, departmentId: b.departmentId ?? departmentId, anchorDate: new Date(`${b.anchorDate}T00:00:00Z`), pattern: b.pattern, crews: b.crews, unpaidBreakMinutes: b.unpaidBreakMinutes ?? null, tenantId: a.tenantId, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'rotation.create', entity: 'RotationTemplate', entityId: t.id, after: b });
      return view(t);
    });
    res.status(201).json(out);
  }),
);

rotationsRouter.put(
  '/schedule/rotations/:id',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    const id = uuid.parse(req.params.id);
    const b = templateBody.parse(req.body);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const before = await tx.rotationTemplate.findUnique({ where: { id } });
        if (!before) throw notFound('Rotation');
        await assertTemplateWritable(tx, a, { ...before, crews: [] });
        const departmentId = await assertTemplateWritable(tx, a, b);
        const t = await tx.rotationTemplate.update({ where: { id }, data: { ...b, departmentId: b.departmentId ?? departmentId, anchorDate: new Date(`${b.anchorDate}T00:00:00Z`), pattern: b.pattern, crews: b.crews, unpaidBreakMinutes: b.unpaidBreakMinutes ?? null } });
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'rotation.update', entity: 'RotationTemplate', entityId: id, before: view(before), after: b });
        return view(t);
      }),
    );
  }),
);

rotationsRouter.delete(
  '/schedule/rotations/:id',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const t = await tx.rotationTemplate.findUnique({ where: { id } });
      if (!t) throw notFound('Rotation');
      await assertTemplateWritable(tx, a, { ...t, crews: [] });
      // Shifts it made stay; they just no longer belong to a template.
      await tx.shift.updateMany({ where: { rotationTemplateId: id }, data: { rotationTemplateId: null } });
      await tx.rotationTemplate.delete({ where: { id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'rotation.delete', entity: 'RotationTemplate', entityId: id, before: view(t) });
    });
    res.json({ ok: true });
  }),
);

/** What a template would make in a range, without saving it (the editor's preview). */
rotationsRouter.post(
  '/schedule/rotations/preview',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    const b = templateBody.extend({ from: isoDate, days: z.number().int().min(1).max(84).default(28) }).parse(req.body);
    const tz = await withTenant(a.tenantId, async (tx) => (await tx.facility.findUnique({ where: { id: b.facilityId }, select: { timezone: true } }))?.timezone);
    if (!tz) throw notFound('Facility');
    const to = new Date(Date.parse(`${b.from}T12:00:00Z`) + b.days * 86_400_000).toISOString().slice(0, 10);
    res.json(occurrences(b, b.from, to, tz).map((o) => ({ date: o.date, crew: o.crew, label: o.label, startsAt: o.start.toISOString(), endsAt: o.end.toISOString(), people: o.userIds.length + o.openSlots })));
  }),
);

/** "Generate shifts": drafts from the active templates for a range (dryRun = count only). */
rotationsRouter.post(
  '/schedule/rotations/generate',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    const b = z.object({ templateIds: z.array(uuid).max(100).optional(), departmentId: z.string().max(64).optional(), from: isoDate, to: isoDate, dryRun: z.boolean().default(false) }).parse(req.body);
    res.json(await withTenant(a.tenantId, (tx) => generateFromTemplates(tx, a, b)));
  }),
);

// ------------------------------------------------------------------ On call

const onCallReader = (p: ReadonlySet<string>) => p.has('schedule.write') || p.has('winter.callout');

rotationsRouter.get(
  '/schedule/on-call',
  h(async (req, res) => {
    const a = authOf(req);
    if (!onCallReader(a.permissions)) throw forbidden();
    const q = z.object({ departmentId: uuid.optional(), from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    res.json(await withTenant(a.tenantId, (tx) => onCallRoster(tx, a, q)));
  }),
);

/** The signed-in person's own on-call periods (their schedule shows them). */
rotationsRouter.get(
  '/me/on-call',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const rows = await tx.onCallPeriod.findMany({ where: { userId: a.userId, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' }, take: 20 });
        const depts = await tx.department.findMany({ where: { id: { in: rows.map((r) => r.departmentId) } }, select: { id: true, name: true, nameFr: true } });
        return rows.map((r) => ({ id: r.id, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), department: depts.find((d) => d.id === r.departmentId) ?? null, note: r.note }));
      }),
    );
  }),
);

const periodBody = z.object({ departmentId: uuid, userId: uuid, startsAt: z.coerce.date(), endsAt: z.coerce.date(), note: z.string().trim().max(200).nullable().optional() });

rotationsRouter.post(
  '/schedule/on-call',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    const b = periodBody.parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const r = await createOnCall(tx, a, b);
      await notify(tx, a.tenantId, r.drafts);
      return { id: r.period.id };
    });
    res.status(201).json(out);
  }),
);

rotationsRouter.post(
  '/schedule/on-call/rotate',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    const b = z.object({ departmentId: uuid, userIds: z.array(uuid).min(1).max(30), startDate: isoDate, periods: z.number().int().min(1).max(26), days: z.number().int().min(1).max(14).default(7), startHour: z.number().int().min(0).max(23).default(8) }).parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const tz = (await tx.facility.findFirst({ select: { timezone: true }, orderBy: { name: 'asc' } }))?.timezone ?? 'America/Toronto';
      const r = await rotateOnCall(tx, a, { ...b, timezone: tz });
      await notify(tx, a.tenantId, r.drafts);
      return { created: r.periods.length };
    });
    res.status(201).json(out);
  }),
);

rotationsRouter.post(
  '/schedule/on-call/:id/swap',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    const b = z.object({ withId: uuid.optional(), userId: uuid.optional() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const r = await swapOnCall(tx, a, uuid.parse(req.params.id), b);
      await notify(tx, a.tenantId, r.drafts);
    });
    res.json({ ok: true });
  }),
);

rotationsRouter.delete(
  '/schedule/on-call/:id',
  h(async (req, res) => {
    const a = authOf(req);
    if (!scheduler(a.permissions)) throw forbidden();
    await withTenant(a.tenantId, async (tx) => {
      const r = await deleteOnCall(tx, a, uuid.parse(req.params.id));
      await notify(tx, a.tenantId, r.drafts);
    });
    res.json({ ok: true });
  }),
);

/** Calls the person on call back in (or someone named): a published call-back shift. */
rotationsRouter.post(
  '/schedule/on-call/call-back',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('schedule.write') && !a.permissions.has('winter.callout')) throw forbidden();
    const b = z.object({ departmentId: uuid, userId: uuid.optional(), facilityId: uuid, positionId: uuid, startsAt: z.coerce.date(), endsAt: z.coerce.date(), reason: z.string().trim().min(3).max(200), emergency: z.boolean().default(false) }).parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const r = await recordCallBack(tx, a, b);
      await notify(tx, a.tenantId, r.drafts);
      const { drafts: _d, ...rest } = r;
      return rest;
    });
    res.status(201).json(out);
  }),
);
