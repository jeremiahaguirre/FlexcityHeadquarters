/**
 * Dev console: telling organizations about FH's updates (docs/RELEASES.md).
 * - What's new notes (services/platform/releaseNotes.ts).
 * - Release rings and staged feature releases (services/platform/releases.ts).
 * Needs the "releases.manage" console permission; publishing, changing a published note and
 * withdrawing one also need a passkey confirmation from the last 10 minutes. Every change is in the
 * Dev console's audit log.
 */
import type { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { platformOf, requirePlatformStepUp } from '../../auth/platform.js';
import { db } from '../../lib/db.js';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { announceNote, consoleView, noteBody, resolveAudience } from '../../services/platform/releaseNotes.js';
import { applyStage, listRings, previewStage, releaseBody, releaseTick, rollbackRelease, rollbackStage, scheduleStage, setRingMembers, stageBody } from '../../services/platform/releases.js';
import { FEATURE_KEYS } from '../../services/platform/features.js';
import { h } from '../context.js';

export const updatesRouter = Router();
const uuid = z.string().uuid();

export const requireReleases = (req: Request, _res: Response, next: NextFunction) => {
  const p = req.platform;
  if (!p) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to the Dev console'));
  next(p.permissions.includes('releases.manage') ? undefined : forbidden('You don’t have access to releases and notices.'));
};
updatesRouter.use(['/notes', '/releases', '/rings', '/stages', '/maintenance'], requireReleases);

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
async function log(adminId: string, action: string, detail: unknown) {
  await db().platformAudit.create({ data: { adminId, tenantId: null, action, detail: json(detail) } });
}

updatesRouter.get(
  '/notes',
  h(async (_req, res) => {
    const rows = await db().releaseNote.findMany({ orderBy: [{ publishAt: 'desc' }, { createdAt: 'desc' }], take: 200 });
    const now = new Date();
    res.json(rows.map((n) => consoleView(n, now)));
  }),
);

/** A draft: nobody sees it until it's published. */
updatesRouter.post(
  '/notes',
  h(async (req, res) => {
    const p = platformOf(req);
    const b = noteBody.parse(req.body);
    const tenantIds = await resolveAudience(db(), b);
    const n = await db().releaseNote.create({ data: { ...b, tenantIds, createdById: p.adminId } });
    await log(p.adminId, 'note.create', { id: n.id, title: n.titleEn });
    res.status(201).json(consoleView(n));
  }),
);

/** Changing a note people may already be reading needs the passkey, as publishing does. */
const stepUpIfPublished = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const n = await db().releaseNote.findUnique({ where: { id: uuid.parse(req.params.id) }, select: { publishedAt: true } });
    if (!n) throw notFound('Note');
    if (n.publishedAt) return requirePlatformStepUp(req, res, next);
    next();
  } catch (e) {
    next(e);
  }
};

updatesRouter.put(
  '/notes/:id',
  stepUpIfPublished,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const b = noteBody.parse(req.body);
    const before = await db().releaseNote.findUniqueOrThrow({ where: { id } });
    if (before.withdrawnAt) throw conflict('NOTE_WITHDRAWN', 'This note was withdrawn.');
    const tenantIds = await resolveAudience(db(), b);
    const n = await db().releaseNote.update({ where: { id }, data: { ...b, tenantIds } });
    await log(p.adminId, 'note.update', { id, title: n.titleEn, published: !!n.publishedAt });
    // A published note that changed shows its new words straight away.
    if (n.publishedAt && n.publishAt <= new Date()) await announceNote(db(), n);
    res.json(consoleView(n));
  }),
);

updatesRouter.post(
  '/notes/:id/publish',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const before = await db().releaseNote.findUnique({ where: { id } });
    if (!before) throw notFound('Note');
    if (before.withdrawnAt) throw conflict('NOTE_WITHDRAWN', 'This note was withdrawn.');
    if (before.publishedAt) return res.json(consoleView(before));
    const now = new Date();
    const n = await db().releaseNote.update({ where: { id }, data: { publishedAt: now } });
    await log(p.adminId, 'note.publish', { id, title: n.titleEn, publishAt: n.publishAt, roles: n.roles, organizations: n.tenantIds.length || 'all' });
    // Due now: everyone it's for sees it without reloading. Later: the worker sends the signal then.
    if (n.publishAt <= now) await announceNote(db(), n);
    res.json(consoleView(await db().releaseNote.findUniqueOrThrow({ where: { id } })));
  }),
);

updatesRouter.post(
  '/notes/:id/withdraw',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const before = await db().releaseNote.findUnique({ where: { id } });
    if (!before) throw notFound('Note');
    const n = before.withdrawnAt ? before : await db().releaseNote.update({ where: { id }, data: { withdrawnAt: new Date() } });
    if (!before.withdrawnAt) {
      await log(p.adminId, 'note.withdraw', { id, title: n.titleEn });
      if (n.publishedAt) await announceNote(db(), n);
    }
    res.json(consoleView(n));
  }),
);

// ---- Release rings ------------------------------------------------------------------------------

updatesRouter.get('/rings', h(async (_req, res) => void res.json(await listRings())));

updatesRouter.post(
  '/rings',
  h(async (req, res) => {
    const p = platformOf(req);
    const { name } = z.object({ name: z.string().trim().min(2).max(40) }).parse(req.body);
    if (await db().releaseRing.findUnique({ where: { name } })) throw conflict('RING_EXISTS', 'There is already a ring with that name.');
    const last = await db().releaseRing.findFirst({ orderBy: { position: 'desc' } });
    const r = await db().releaseRing.create({ data: { name, position: (last?.position ?? 0) + 1 } });
    await log(p.adminId, 'ring.create', { id: r.id, name });
    res.status(201).json(r);
  }),
);

/** Which organizations are in the ring (an organization moves out of any other ring). */
updatesRouter.put(
  '/rings/:id/members',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const { tenantIds } = z.object({ tenantIds: z.array(uuid).max(5000) }).parse(req.body);
    const ring = await db().releaseRing.findUnique({ where: { id } });
    if (!ring) throw notFound('Ring');
    await setRingMembers(db(), id, [...new Set(tenantIds)]);
    await log(p.adminId, 'ring.members', { id, name: ring.name, organizations: tenantIds.length });
    res.json(await listRings());
  }),
);

// ---- Releases -----------------------------------------------------------------------------------

/** The feature switches a release can set. */
updatesRouter.get('/releases/features', (_req, res) => void res.json(FEATURE_KEYS));

updatesRouter.get(
  '/releases',
  h(async (_req, res) => {
    const rows = await db().release.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { stages: { orderBy: { scheduledAt: 'asc' }, include: { changes: { select: { status: true, skipped: true, noticeSentAt: true } } } } } });
    res.json(
      rows.map(({ stages, ...r }) => ({
        ...r,
        stages: stages.map(({ changes, ...s }) => ({ ...s, organizations: changes.length, applied: changes.filter((c) => c.status === 'APPLIED').length, noticesSent: changes.filter((c) => c.noticeSentAt).length, keptOwnChoice: changes.filter((c) => c.skipped.length).length })),
      })),
    );
  }),
);

updatesRouter.post(
  '/releases',
  h(async (req, res) => {
    const p = platformOf(req);
    const b = releaseBody.parse(req.body);
    const r = await db().release.create({ data: { ...b, createdById: p.adminId } });
    await log(p.adminId, 'release.create', { id: r.id, name: r.name, features: b.features });
    res.status(201).json({ ...r, stages: [] });
  }),
);

/** Its switches can change only while nothing of it is scheduled or applied. */
updatesRouter.put(
  '/releases/:id',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const b = releaseBody.parse(req.body);
    const live = await db().releaseStage.count({ where: { releaseId: id, status: { in: ['SCHEDULED', 'APPLIED'] } } });
    if (live) throw conflict('RELEASE_LIVE', 'Undo its scheduled rings first, then change it.');
    const r = await db().release.update({ where: { id }, data: b });
    await log(p.adminId, 'release.update', { id, name: r.name, features: b.features });
    res.json(r);
  }),
);

/** What scheduling it for a ring would change, organization by organization, and where their own choice wins. */
updatesRouter.get(
  '/releases/:id/preview/:ringId',
  h(async (req, res) => {
    res.json(await previewStage(db(), uuid.parse(req.params.id), uuid.parse(req.params.ringId)));
  }),
);

updatesRouter.post(
  '/releases/:id/stages',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const stage = await scheduleStage(db(), uuid.parse(req.params.id), stageBody.parse(req.body), p.adminId);
    // Due already: notices and switches now, not at the worker's next minute.
    if (stage.scheduledAt <= new Date()) await releaseTick(db());
    res.status(201).json(await db().releaseStage.findUniqueOrThrow({ where: { id: stage.id } }));
  }),
);

updatesRouter.post(
  '/stages/:id/apply',
  requireReleases,
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const id = uuid.parse(req.params.id);
    const s = await db().releaseStage.findUnique({ where: { id } });
    if (!s) throw notFound('Stage');
    if (s.status !== 'SCHEDULED') throw conflict('STAGE_CLOSED', 'This stage isn’t waiting to go out.');
    await log(p.adminId, 'release.apply_now', { stageId: id, releaseId: s.releaseId });
    const applied = await applyStage(db(), id);
    res.json({ applied });
  }),
);

updatesRouter.post(
  '/stages/:id/rollback',
  requireReleases,
  requirePlatformStepUp,
  h(async (req, res) => {
    res.json(await rollbackStage(db(), uuid.parse(req.params.id), platformOf(req).adminId));
  }),
);

updatesRouter.post(
  '/releases/:id/rollback',
  requirePlatformStepUp,
  h(async (req, res) => {
    res.json(await rollbackRelease(db(), uuid.parse(req.params.id), platformOf(req).adminId));
  }),
);
