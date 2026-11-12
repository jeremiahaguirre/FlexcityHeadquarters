/**
 * Program planning for any facility (pool, arena, community centre): planners
 * keep the levels (Lifesaving Society, YMCA, CanSkate or the city's own), build a campaign (a
 * season of lessons, a club session, a camp) out of sets on any pattern, and
 * publish it for member services.
 */
import type { LessonClass } from '../generated/prisma/client.js';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { sessionDates } from '../services/lessons/lessons.js';
import { PRESETS } from '../services/programs/levels.js';
import { h } from './context.js';

export const programsRouter = Router();
programsRouter.use(['/swim-levels', '/campaigns'], requireFeature('registration'));
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const anyOf = (...perms: Parameters<typeof requirePermission>) => (req: Parameters<ReturnType<typeof requirePermission>>[0], _res: unknown, next: (e?: unknown) => void) =>
  perms.some((p) => req.auth?.permissions.has(p)) ? next() : next(notFound('Page'));

// -------------------------------------------------------------- Swim levels
const levelBody = z.object({
  program: z.string().trim().min(2).max(60),
  name: z.string().trim().min(1).max(60),
  nameFr: z.string().trim().max(60).nullable().optional(),
  minAgeMonths: z.number().int().min(0).max(1200),
  maxAgeMonths: z.number().int().min(1).max(1200).nullable().optional(),
  parentInWater: z.boolean().optional(),
  ratio: z.number().int().min(1).max(30),
  durationMinutes: z.number().int().min(10).max(240),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

programsRouter.get(
  '/swim-levels',
  anyOf('lessons.plan', 'members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => tx.swimLevel.findMany({ orderBy: [{ program: 'asc' }, { sortOrder: 'asc' }] })));
  }),
);

/** Adds a program's levels (Lifesaving Society, YMCA or CanSkate), skipping ones already there. */
programsRouter.post(
  '/swim-levels/presets',
  requirePermission('lessons.plan'),
  h(async (req, res) => {
    const a = authOf(req);
    const { preset, advanced } = z.object({ preset: z.enum(['LIFESAVING', 'YMCA', 'CANSKATE']), advanced: z.boolean().default(false) }).parse(req.body);
    const p = { ...PRESETS[preset], levels: PRESETS[preset].levels.filter((l) => advanced || !l.advanced) };
    const added = await withTenant(a.tenantId, async (tx) => {
      const existing = await tx.swimLevel.count({ where: { program: p.program } });
      const r = await tx.swimLevel.createMany({
        data: p.levels.map((l, i) => ({ tenantId: a.tenantId, program: p.program, name: l.name, nameFr: l.nameFr, minAgeMonths: l.minAgeMonths, maxAgeMonths: l.maxAgeMonths, parentInWater: !!l.parentInWater, ratio: l.ratio, durationMinutes: l.durationMinutes, sortOrder: existing + i })),
        skipDuplicates: true,
      });
      return r.count;
    });
    res.status(201).json({ added });
  }),
);

/** The level ladders a planner can load, with how many levels each adds. */
programsRouter.get(
  '/swim-levels/presets',
  requirePermission('lessons.plan'),
  h(async (_req, res) => {
    res.json(
      (['LIFESAVING', 'YMCA', 'CANSKATE'] as const).map((key) => ({
        key,
        program: PRESETS[key].program,
        levels: PRESETS[key].levels.filter((l) => !l.advanced).length,
        advanced: PRESETS[key].levels.filter((l) => l.advanced).map((l) => ({ name: l.name, note: l.note ?? null })),
      })),
    );
  }),
);

programsRouter.post(
  '/swim-levels',
  requirePermission('lessons.plan'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = levelBody.parse(req.body);
    const l = await withTenant(a.tenantId, (tx) => tx.swimLevel.create({ data: { ...b, tenantId: a.tenantId, nameFr: b.nameFr ?? null, maxAgeMonths: b.maxAgeMonths ?? null } }));
    res.status(201).json(l);
  }),
);

programsRouter.patch(
  '/swim-levels/:id',
  requirePermission('lessons.plan'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = levelBody.partial().parse(req.body);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.swimLevel.findUnique({ where: { id } }))) throw notFound('Level');
      await tx.swimLevel.update({ where: { id }, data: b });
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- Campaigns
const campaignBody = z.object({
  name: z.string().trim().min(2).max(80),
  nameFr: z.string().trim().max(80).nullable().optional(),
  kind: z.enum(['LESSONS', 'SWIM_CLUB', 'CAMP', 'OTHER']),
  startsOn: isoDate,
  endsOn: isoDate,
  registrationOpensAt: z.coerce.date().nullable().optional(),
  registrationClosesAt: z.coerce.date().nullable().optional(),
  skipDates: z.array(isoDate).max(60).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
const campaignData = (b: Partial<z.infer<typeof campaignBody>>) => ({
  ...b,
  ...(b.startsOn ? { startsOn: new Date(b.startsOn) } : {}),
  ...(b.endsOn ? { endsOn: new Date(b.endsOn) } : {}),
  ...(b.skipDates ? { skipDates: b.skipDates.map((d) => new Date(d)) } : {}),
});

export function setView(c: LessonClass & { _count?: { enrollments: number } }, enrolled: number, waitlisted: number, skip: string[]) {
  const dates = sessionDates(c, iso(c.startsOn), iso(c.endsOn), skip);
  return {
    id: c.id,
    name: c.name,
    level: c.level,
    levelId: c.levelId,
    facilityId: c.facilityId,
    positionId: c.positionId,
    daysOfWeek: c.daysOfWeek.length ? c.daysOfWeek : [c.dayOfWeek],
    startMinute: c.startMinute,
    endMinute: c.endMinute,
    startsOn: iso(c.startsOn),
    endsOn: iso(c.endsOn),
    sessions: dates.length,
    capacity: c.maxSwimmers,
    enrolled,
    waitlisted,
    spotsLeft: Math.max(0, c.maxSwimmers - enrolled),
    minAgeMonths: c.minAgeMonths,
    maxAgeMonths: c.maxAgeMonths,
    priceCents: c.priceCents,
    memberPriceCents: c.memberPriceCents,
    published: c.published,
  };
}

async function campaignOut(tx: Parameters<Parameters<typeof withTenant>[1]>[0], id: string) {
  const c = await tx.lessonCampaign.findUnique({ where: { id } });
  if (!c) throw notFound('Campaign');
  const sets = await tx.lessonClass.findMany({ where: { campaignId: id }, orderBy: [{ startsOn: 'asc' }, { startMinute: 'asc' }] });
  const counts = await tx.lessonEnrollment.groupBy({ by: ['classId', 'status'], where: { classId: { in: sets.map((s) => s.id) } }, _count: true });
  const n = (classId: string, status: string) => counts.find((x) => x.classId === classId && x.status === status)?._count ?? 0;
  const skip = c.skipDates.map(iso);
  return {
    ...c,
    startsOn: iso(c.startsOn),
    endsOn: iso(c.endsOn),
    skipDates: skip,
    sets: sets.map((s) => setView(s, n(s.id, 'ENROLLED'), n(s.id, 'WAITLISTED'), skip)),
  };
}

programsRouter.get(
  '/campaigns',
  anyOf('lessons.plan', 'members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const planner = a.permissions.has('lessons.plan');
    const out = await withTenant(a.tenantId, async (tx) => {
      // Member services see only what's published.
      const list = await tx.lessonCampaign.findMany({ where: planner ? {} : { status: 'PUBLISHED' }, orderBy: [{ status: 'asc' }, { startsOn: 'desc' }], take: 100 });
      const sets = await tx.lessonClass.groupBy({ by: ['campaignId'], where: { campaignId: { in: list.map((c) => c.id) } }, _count: true });
      return list.map((c) => ({ ...c, startsOn: iso(c.startsOn), endsOn: iso(c.endsOn), skipDates: c.skipDates.map(iso), setCount: sets.find((s) => s.campaignId === c.id)?._count ?? 0 }));
    });
    res.json(out);
  }),
);

programsRouter.get(
  '/campaigns/:id',
  anyOf('lessons.plan', 'members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, (tx) => campaignOut(tx, uuid.parse(req.params.id)));
    if (out.status === 'DRAFT' && !a.permissions.has('lessons.plan')) throw notFound('Campaign');
    res.json(out);
  }),
);

programsRouter.post(
  '/campaigns',
  requirePermission('lessons.plan'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = campaignBody.parse(req.body);
    if (b.endsOn < b.startsOn) throw badRequest('The campaign must end after it starts.');
    const c = await withTenant(a.tenantId, async (tx) => {
      const created = await tx.lessonCampaign.create({ data: { ...campaignData(b), name: b.name, kind: b.kind, startsOn: new Date(b.startsOn), endsOn: new Date(b.endsOn), tenantId: a.tenantId, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'campaign.create', entity: 'LessonCampaign', entityId: created.id, after: b });
      return created;
    });
    res.status(201).json({ id: c.id });
  }),
);

programsRouter.patch(
  '/campaigns/:id',
  requirePermission('lessons.plan'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = campaignBody.partial().parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.lessonCampaign.findUnique({ where: { id } }))) throw notFound('Campaign');
      await tx.lessonCampaign.update({ where: { id }, data: campaignData(b) });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'campaign.update', entity: 'LessonCampaign', entityId: id, after: b });
    });
    res.json({ ok: true });
  }),
);

/** Publish: sets appear for member services to register into, and on instructors' lesson lists. */
programsRouter.post(
  '/campaigns/:id/:action(publish|close|reopen)',
  requirePermission('lessons.plan'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const action = req.params.action as 'publish' | 'close' | 'reopen';
    await withTenant(a.tenantId, async (tx) => {
      const c = await tx.lessonCampaign.findUnique({ where: { id } });
      if (!c) throw notFound('Campaign');
      if (action === 'publish') {
        if (!(await tx.lessonClass.count({ where: { campaignId: id } }))) throw conflict('NO_SETS', 'Add at least one set before publishing.');
        await tx.lessonCampaign.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: c.publishedAt ?? new Date() } });
        await tx.lessonClass.updateMany({ where: { campaignId: id }, data: { published: true } });
      } else {
        await tx.lessonCampaign.update({ where: { id }, data: { status: action === 'close' ? 'CLOSED' : 'PUBLISHED' } });
      }
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: `campaign.${action}`, entity: 'LessonCampaign', entityId: id });
    });
    res.json({ ok: true });
  }),
);

// --------------------------------------------------------------------- Sets
const setBody = z.object({
  facilityId: uuid,
  positionId: uuid,
  levelId: uuid.nullable().optional(),
  name: z.string().trim().max(80).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  startsOn: isoDate,
  endsOn: isoDate,
  capacity: z.number().int().min(1).max(60).optional(),
  priceCents: z.number().int().min(0).max(1_000_000),
  memberPriceCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  minAgeMonths: z.number().int().min(0).max(1200).nullable().optional(),
  maxAgeMonths: z.number().int().min(1).max(1200).nullable().optional(),
});

programsRouter.post(
  '/campaigns/:id/sets',
  requirePermission('lessons.plan'),
  h(async (req, res) => {
    const a = authOf(req);
    const campaignId = uuid.parse(req.params.id);
    const b = setBody.parse(req.body);
    if (b.endMinute <= b.startMinute) throw badRequest('A set must end after it starts.');
    if (b.endsOn < b.startsOn) throw badRequest('The last day must be after the first.');
    const s = await withTenant(a.tenantId, async (tx) => {
      const c = await tx.lessonCampaign.findUnique({ where: { id: campaignId } });
      if (!c) throw notFound('Campaign');
      if (c.status === 'CLOSED') throw conflict('CAMPAIGN_CLOSED', 'This campaign is closed.');
      const level = b.levelId ? await tx.swimLevel.findUnique({ where: { id: b.levelId } }) : null;
      if (b.levelId && !level) throw notFound('Level');
      const days = [...new Set(b.daysOfWeek)].sort();
      const created = await tx.lessonClass.create({
        data: {
          tenantId: a.tenantId,
          campaignId,
          facilityId: b.facilityId,
          positionId: b.positionId,
          levelId: level?.id ?? null,
          level: level?.name ?? null,
          name: b.name || level?.name || c.name,
          dayOfWeek: days[0]!,
          daysOfWeek: days,
          startMinute: b.startMinute,
          endMinute: b.endMinute,
          startsOn: new Date(b.startsOn),
          endsOn: new Date(b.endsOn),
          // The level's swimmer-to-instructor ratio is the default size.
          maxSwimmers: b.capacity ?? level?.ratio ?? 8,
          priceCents: b.priceCents,
          memberPriceCents: b.memberPriceCents ?? null,
          minAgeMonths: b.minAgeMonths !== undefined ? b.minAgeMonths : level?.minAgeMonths ?? null,
          maxAgeMonths: b.maxAgeMonths !== undefined ? b.maxAgeMonths : level?.maxAgeMonths ?? null,
          published: c.status === 'PUBLISHED',
        },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'set.create', entity: 'LessonClass', entityId: created.id, after: b });
      return created;
    });
    res.status(201).json({ id: s.id });
  }),
);

programsRouter.patch(
  '/campaigns/:id/sets/:setId',
  requirePermission('lessons.plan'),
  h(async (req, res) => {
    const a = authOf(req);
    const setId = uuid.parse(req.params.setId);
    const b = setBody.partial().parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const s = await tx.lessonClass.findFirst({ where: { id: setId, campaignId: uuid.parse(req.params.id) } });
      if (!s) throw notFound('Set');
      const { capacity, daysOfWeek, startsOn, endsOn, name, ...rest } = b;
      if (capacity !== undefined && capacity < (await tx.lessonEnrollment.count({ where: { classId: setId, status: 'ENROLLED' } }))) throw conflict('BELOW_ENROLLED', 'More people are already registered than that.');
      await tx.lessonClass.update({
        where: { id: setId },
        data: { ...rest, ...(name ? { name } : {}), ...(capacity !== undefined ? { maxSwimmers: capacity } : {}), ...(daysOfWeek ? { daysOfWeek: [...new Set(daysOfWeek)].sort(), dayOfWeek: Math.min(...daysOfWeek) } : {}), ...(startsOn ? { startsOn: new Date(startsOn) } : {}), ...(endsOn ? { endsOn: new Date(endsOn) } : {}) },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'set.update', entity: 'LessonClass', entityId: setId, after: b });
    });
    res.json({ ok: true });
  }),
);

programsRouter.delete(
  '/campaigns/:id/sets/:setId',
  requirePermission('lessons.plan'),
  h(async (req, res) => {
    const a = authOf(req);
    const setId = uuid.parse(req.params.setId);
    await withTenant(a.tenantId, async (tx) => {
      const s = await tx.lessonClass.findFirst({ where: { id: setId, campaignId: uuid.parse(req.params.id) } });
      if (!s) throw notFound('Set');
      if (await tx.lessonEnrollment.count({ where: { classId: setId } })) throw conflict('HAS_REGISTRATIONS', 'People are registered in this set. Cancel their registrations first.');
      await tx.lessonClass.delete({ where: { id: setId } });
    });
    res.status(204).end();
  }),
);
