/**
 * The facility logbook (handover, maintenance and safety notes, append-only) and
 * announcements to staff (everyone, some positions or some facilities), with who has read them.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import type { AuthContext } from '../auth/middleware.js';
import type { Tx } from '../lib/db.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { notify } from '../services/notifications/notifier.js';
import { h } from './context.js';

export const communicationRouter = Router();
communicationRouter.use('/logbook', requireFeature('logbook'));
communicationRouter.use(['/announcements', '/me/announcements'], requireFeature('announcements'));
const uuid = z.string().uuid();
const CATEGORIES = ['HANDOVER', 'MAINTENANCE', 'SAFETY', 'OTHER'] as const;

const facilityAllowed = (a: AuthContext, facilityId: string) => !a.scope || !a.scope.facilityIds.length || a.scope.facilityIds.includes(facilityId);

/* ---------- Logbook ---------- */
communicationRouter.get(
  '/logbook',
  requirePermission('logbook.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ facilityId: uuid, before: z.coerce.date().optional(), category: z.enum(CATEGORIES).optional() }).parse(req.query);
    if (!facilityAllowed(a, q.facilityId)) throw forbidden('This facility isn’t yours.');
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const rows = await tx.logEntry.findMany({ where: { facilityId: q.facilityId, ...(q.before ? { createdAt: { lt: q.before } } : {}), ...(q.category ? { category: q.category } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 });
        const people = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, firstName: true, lastName: true } });
        return rows.map((r) => {
          const p = people.find((x) => x.id === r.authorId);
          return { id: r.id, category: r.category, body: r.body, createdAt: r.createdAt, author: p ? `${p.firstName} ${p.lastName}` : '', mine: r.authorId === a.userId };
        });
      }),
    );
  }),
);

communicationRouter.post(
  '/logbook',
  requirePermission('logbook.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ facilityId: uuid, category: z.enum(CATEGORIES), body: z.string().trim().min(3).max(4000) }).parse(req.body);
    if (!facilityAllowed(a, b.facilityId)) throw forbidden('This facility isn’t yours.');
    const e = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.facility.findUnique({ where: { id: b.facilityId }, select: { id: true } }))) throw notFound('Facility');
      const e = await tx.logEntry.create({ data: { tenantId: a.tenantId, facilityId: b.facilityId, authorId: a.userId, category: b.category, body: b.body } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'logbook.add', entity: 'LogEntry', entityId: e.id, after: { facilityId: b.facilityId, category: b.category } });
      return e;
    });
    res.status(201).json({ id: e.id });
  }),
);

/* ---------- Announcements ---------- */
type A = { id: string; positionIds: string[]; facilityIds: string[]; expiresAt: Date | null };

/** Who an announcement is for: positions they hold, facilities they've worked or will work at (±30 days). */
async function audienceIds(tx: Tx, x: Pick<A, 'positionIds' | 'facilityIds'>): Promise<string[]> {
  const near = { gte: new Date(Date.now() - 30 * 86_400_000), lt: new Date(Date.now() + 30 * 86_400_000) };
  const users = await tx.user.findMany({
    where: {
      status: 'ACTIVE',
      anonymizedAt: null,
      ...(x.positionIds.length ? { positions: { some: { positionId: { in: x.positionIds } } } } : {}),
      ...(x.facilityIds.length ? { shifts: { some: { facilityId: { in: x.facilityIds }, startsAt: near } } } : {}),
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

function isFor(x: A, mine: { positions: Set<string>; facilities: Set<string> }) {
  if (x.positionIds.length && !x.positionIds.some((p) => mine.positions.has(p))) return false;
  if (x.facilityIds.length && !x.facilityIds.some((f) => mine.facilities.has(f))) return false;
  return true;
}

/** The positions someone holds and the facilities they've worked or will work at (±30 days). */
async function audienceOf(tx: Tx, userId: string) {
  const near = { gte: new Date(Date.now() - 30 * 86_400_000), lt: new Date(Date.now() + 30 * 86_400_000) };
  const [positions, shifts] = await Promise.all([
    tx.userPosition.findMany({ where: { userId }, select: { positionId: true } }),
    tx.shift.findMany({ where: { userId, startsAt: near }, select: { facilityId: true }, distinct: ['facilityId'] }),
  ]);
  return { positions: new Set(positions.map((p) => p.positionId)), facilities: new Set(shifts.map((s) => s.facilityId)) };
}

/**
 * A poster limited to a department manages the announcements they wrote and those addressed only to
 * their department (the rule for posting, below). Others' announcements to everyone or to another
 * department aren't theirs to list or end.
 */
function inMyDepartment(a: AuthContext, x: A & { authorId: string }) {
  if (!a.scope || x.authorId === a.userId) return true;
  const { positionIds: p, facilityIds: f } = a.scope;
  if (p.length && (!x.positionIds.length || x.positionIds.some((id) => !p.includes(id)))) return false;
  if (f.length && (!x.facilityIds.length || x.facilityIds.some((id) => !f.includes(id)))) return false;
  return true;
}

communicationRouter.get(
  '/me/announcements',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const now = new Date();
        const [mine, list, reads] = await Promise.all([
          audienceOf(tx, a.userId),
          tx.announcement.findMany({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], publishedAt: { gte: new Date(now.getTime() - 90 * 86_400_000) } }, orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }], take: 50 }),
          tx.announcementRead.findMany({ where: { userId: a.userId }, select: { announcementId: true } }),
        ]);
        const read = new Set(reads.map((r) => r.announcementId));
        const out = [];
        for (const x of list) if (x.authorId === a.userId || isFor(x, mine)) out.push({ id: x.id, title: x.title, body: x.body, pinned: x.pinned, publishedAt: x.publishedAt, expiresAt: x.expiresAt, read: read.has(x.id) });
        return out;
      }),
    );
  }),
);

communicationRouter.post(
  '/me/announcements/:id/read',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      // Only an announcement addressed to them (or written by them) can be marked read.
      const x = await tx.announcement.findUnique({ where: { id } });
      if (!x || (x.authorId !== a.userId && !isFor(x, await audienceOf(tx, a.userId)))) throw notFound('Announcement');
      await tx.announcementRead.upsert({ where: { announcementId_userId: { announcementId: id, userId: a.userId } }, update: {}, create: { tenantId: a.tenantId, announcementId: id, userId: a.userId } });
    });
    res.json({ ok: true });
  }),
);

communicationRouter.get(
  '/announcements',
  requirePermission('announcements.post'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const list = await tx.announcement.findMany({ orderBy: { publishedAt: 'desc' }, take: 50, include: { _count: { select: { reads: true } } } });
        const out = [];
        for (const x of list) if (inMyDepartment(a, x)) out.push({ id: x.id, title: x.title, body: x.body, pinned: x.pinned, positionIds: x.positionIds, facilityIds: x.facilityIds, publishedAt: x.publishedAt, expiresAt: x.expiresAt, read: x._count.reads, of: (await audienceIds(tx, x)).length });
        return out;
      }),
    );
  }),
);

communicationRouter.post(
  '/announcements',
  requirePermission('announcements.post'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ title: z.string().trim().min(3).max(140), body: z.string().trim().min(3).max(4000), positionIds: z.array(uuid).max(100).default([]), facilityIds: z.array(uuid).max(100).default([]), pinned: z.boolean().default(false), expiresAt: z.coerce.date().nullable().optional() }).parse(req.body);
    if (a.scope?.facilityIds.length && (!b.facilityIds.length || b.facilityIds.some((f) => !a.scope!.facilityIds.includes(f)))) throw forbidden('Choose facilities in your department.');
    // A department's poster writes to their department's positions, not to everyone (an empty list).
    if (a.scope?.positionIds.length && (!b.positionIds.length || b.positionIds.some((p) => !a.scope!.positionIds.includes(p)))) throw forbidden('Choose positions in your department.');
    const x = await withTenant(a.tenantId, async (tx) => {
      const x = await tx.announcement.create({ data: { tenantId: a.tenantId, title: b.title, body: b.body, positionIds: b.positionIds, facilityIds: b.facilityIds, pinned: b.pinned, expiresAt: b.expiresAt ?? null, authorId: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'announcement.post', entity: 'Announcement', entityId: x.id, after: { title: b.title, positions: b.positionIds.length, facilities: b.facilityIds.length } });
      const to = (await audienceIds(tx, b)).filter((u) => u !== a.userId);
      await notify(tx, a.tenantId, to.map((userId) => ({ userId, type: 'announcement', params: { title: b.title }, link: '/announcements' })));
      return x;
    });
    res.status(201).json({ id: x.id });
  }),
);

communicationRouter.post(
  '/announcements/:id/end',
  requirePermission('announcements.post'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const x = await tx.announcement.findUnique({ where: { id } });
      if (!x || !inMyDepartment(a, x)) throw notFound('Announcement');
      await tx.announcement.update({ where: { id }, data: { expiresAt: new Date(), pinned: false } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'announcement.end', entity: 'Announcement', entityId: id });
    });
    res.json({ ok: true });
  }),
);
