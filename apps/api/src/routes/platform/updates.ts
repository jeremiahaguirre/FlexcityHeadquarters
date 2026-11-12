/**
 * Dev console: telling organizations about FH's updates (docs/RELEASES.md).
 * - What's new notes (services/platform/releaseNotes.ts).
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
import { h } from '../context.js';

export const updatesRouter = Router();
const uuid = z.string().uuid();

export const requireReleases = (req: Request, _res: Response, next: NextFunction) => {
  const p = req.platform;
  if (!p) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to the Dev console'));
  next(p.permissions.includes('releases.manage') ? undefined : forbidden('You don’t have access to releases and notices.'));
};
updatesRouter.use(['/notes', '/releases', '/rings', '/maintenance'], requireReleases);

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
