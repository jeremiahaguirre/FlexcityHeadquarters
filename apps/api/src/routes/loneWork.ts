/** Working alone: the worker's own session, and the monitor's board. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { notify, usersWithPermission } from '../services/notifications/notifier.js';
import { INTERVALS, position, raiseHelp, view } from '../services/safety/loneWork.js';
import { h } from './context.js';

export const loneWorkRouter = Router();
loneWorkRouter.use(['/lone-work', '/me/lone-work'], requireFeature('loneWork'));

const uuid = z.string().uuid();
const coords = { latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional() };
const OPEN = ['ACTIVE', 'OVERDUE', 'ESCALATED', 'HELP'] as const;
const userSelect = { select: { firstName: true, lastName: true, phone: true } } as const;

async function mine(tx: Parameters<Parameters<typeof withTenant>[1]>[0], userId: string) {
  return tx.loneWorkSession.findFirst({ where: { userId, status: { in: [...OPEN] } }, orderBy: { startedAt: 'desc' } });
}

loneWorkRouter.get(
  '/me/lone-work',
  requirePermission('lonework.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const s = await withTenant(a.tenantId, (tx) => mine(tx, a.userId));
    res.json(s ? view(s) : null);
  }),
);

loneWorkRouter.post(
  '/me/lone-work',
  requirePermission('lonework.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z
      .object({
        location: z.string().trim().min(2).max(120),
        task: z.string().trim().max(200).nullable().optional(),
        facilityId: uuid.nullable().optional(),
        intervalMinutes: z.number().int().refine((n) => (INTERVALS as readonly number[]).includes(n), 'Choose a listed interval'),
        ...coords,
      })
      .parse(req.body);
    const s = await withTenant(a.tenantId, async (tx) => {
      if (await mine(tx, a.userId)) throw conflict('ALREADY_ALONE', 'You already have a working-alone session. End it first.');
      const now = new Date();
      const created = await tx.loneWorkSession.create({
        data: {
          tenantId: a.tenantId,
          userId: a.userId,
          facilityId: body.facilityId ?? null,
          location: body.location,
          task: body.task ?? null,
          intervalMinutes: body.intervalMinutes,
          startedAt: now,
          lastCheckInAt: now,
          nextDueAt: new Date(now.getTime() + body.intervalMinutes * 60_000),
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
        },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'lonework.start', entity: 'LoneWorkSession', entityId: created.id, after: { location: body.location, intervalMinutes: body.intervalMinutes } });
      return created;
    });
    res.status(201).json(view(s));
  }),
);

/** "I'm OK": resets the timer. Also clears a missed check-in (but not a help request). */
loneWorkRouter.post(
  '/me/lone-work/check-in',
  requirePermission('lonework.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object(coords).parse(req.body ?? {});
    const s = await withTenant(a.tenantId, async (tx) => {
      const cur = await mine(tx, a.userId);
      if (!cur) throw notFound('Working-alone session');
      const now = new Date();
      const wasLate = cur.status === 'OVERDUE' || cur.status === 'ESCALATED';
      const next = await tx.loneWorkSession.update({
        where: { id: cur.id },
        data: {
          lastCheckInAt: now,
          nextDueAt: new Date(now.getTime() + cur.intervalMinutes * 60_000),
          ...(cur.status === 'HELP' ? {} : { status: 'ACTIVE', overdueAt: null }),
          ...position(body.latitude, body.longitude),
        },
      });
      // Tell whoever was told about the missed check-in that it's resolved.
      if (wasLate) {
        const to = await usersWithPermission(tx, a.tenantId, 'lonework.monitor', [a.userId]);
        const u = await tx.user.findUnique({ where: { id: a.userId }, select: { firstName: true, lastName: true } });
        await notify(tx, a.tenantId, to.map((userId) => ({ userId, type: 'lonework_ok', params: { name: u ? `${u.firstName} ${u.lastName}` : '', location: cur.location }, link: '/manage/lone-work' })));
      }
      return next;
    });
    res.json(view(s));
  }),
);

loneWorkRouter.post(
  '/me/lone-work/help',
  requirePermission('lonework.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ note: z.string().trim().max(300).nullable().optional(), ...coords }).parse(req.body ?? {});
    const s = await withTenant(a.tenantId, async (tx) => {
      const cur = await mine(tx, a.userId);
      if (!cur) throw notFound('Working-alone session');
      if (body.latitude != null) await tx.loneWorkSession.update({ where: { id: cur.id }, data: position(body.latitude, body.longitude) });
      await raiseHelp(tx, cur, body.note ?? null);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'lonework.help', entity: 'LoneWorkSession', entityId: cur.id });
      return tx.loneWorkSession.findUniqueOrThrow({ where: { id: cur.id } });
    });
    res.json(view(s));
  }),
);

loneWorkRouter.post(
  '/me/lone-work/end',
  requirePermission('lonework.self'),
  h(async (req, res) => {
    const a = authOf(req);
    await withTenant(a.tenantId, async (tx) => {
      const cur = await mine(tx, a.userId);
      if (!cur) throw notFound('Working-alone session');
      await tx.loneWorkSession.update({ where: { id: cur.id }, data: { status: 'ENDED', endedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'lonework.end', entity: 'LoneWorkSession', entityId: cur.id });
    });
    res.json({ ok: true });
  }),
);

/** Monitors: everyone working alone now, problems first, plus the last 24 hours. */
loneWorkRouter.get(
  '/lone-work',
  requirePermission('lonework.monitor'),
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, async (tx) => {
      const list = await tx.loneWorkSession.findMany({
        where: { OR: [{ status: { in: [...OPEN] } }, { endedAt: { gte: new Date(Date.now() - 86_400_000) } }], ...(a.scope?.positionIds.length ? { userId: { in: (await tx.userPosition.findMany({ where: { positionId: { in: a.scope.positionIds } }, select: { userId: true } })).map((u) => u.userId) } } : {}) },
        orderBy: { nextDueAt: 'asc' },
        take: 200,
      });
      const people = await tx.user.findMany({ where: { id: { in: [...new Set(list.flatMap((s) => [s.userId, s.respondingId ?? s.userId]))] } }, select: { id: true, ...userSelect.select } });
      const rank = { HELP: 0, ESCALATED: 1, OVERDUE: 2, ACTIVE: 3, ENDED: 4 } as const;
      return list
        .map((s) => {
          const r = people.find((p) => p.id === s.respondingId);
          return view({ ...s, user: people.find((p) => p.id === s.userId) ?? null, responder: r ? `${r.firstName} ${r.lastName}` : null });
        })
        .sort((x, y) => rank[x.status] - rank[y.status]);
    });
    res.json(rows);
  }),
);

/** "I'm on it": the worker and other monitors see who is responding. */
loneWorkRouter.post(
  '/lone-work/:id/respond',
  requirePermission('lonework.monitor'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const s = await tx.loneWorkSession.findUnique({ where: { id } });
      if (!s) throw notFound('Working-alone session');
      if (s.status === 'ENDED') throw conflict('ALREADY_ENDED', 'This session has ended.');
      await tx.loneWorkSession.update({ where: { id }, data: { respondingId: a.userId, respondingAt: new Date() } });
      const me = await tx.user.findUnique({ where: { id: a.userId }, select: { firstName: true, lastName: true } });
      await notify(tx, a.tenantId, [{ userId: s.userId, type: 'lonework_responding', params: { name: me ? `${me.firstName} ${me.lastName}` : '' }, link: '/alone' }]);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'lonework.respond', entity: 'LoneWorkSession', entityId: id });
    });
    res.json({ ok: true });
  }),
);

/** A monitor closes a session once the person is safe (e.g. they went home without ending it). */
loneWorkRouter.post(
  '/lone-work/:id/close',
  requirePermission('lonework.monitor'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { note } = z.object({ note: z.string().trim().min(3).max(300) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const s = await tx.loneWorkSession.findUnique({ where: { id } });
      if (!s) throw notFound('Working-alone session');
      if (s.status === 'ENDED') throw conflict('ALREADY_ENDED', 'This session has ended.');
      await tx.loneWorkSession.update({ where: { id }, data: { status: 'ENDED', endedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'lonework.close', entity: 'LoneWorkSession', entityId: id, after: { note } });
    });
    res.json({ ok: true });
  }),
);
