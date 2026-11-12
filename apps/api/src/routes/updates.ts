/**
 * What staff see of FH's updates: What's new notes (shown once, then in the list), and for HR
 * admins (tenant.configure) the feature changes FH has scheduled for their organization.
 * Every signed-in person may read the notes meant for them; nothing here is a switchable feature.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { withTenant } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { markRead, notesFor } from '../services/platform/releaseNotes.js';
import { changesFor } from '../services/platform/releases.js';
import { bannersFor, upcomingFor } from '../services/platform/maintenance.js';
import { h } from './context.js';

export const updatesRouter = Router();

async function me(tx: Parameters<Parameters<typeof withTenant>[1]>[0], userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true, roles: true, createdAt: true } });
  if (!u) throw notFound('Person');
  return u;
}

updatesRouter.get(
  '/me/whats-new',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, async (tx) => notesFor(tx, a.tenantId, { ...(await me(tx, a.userId)), roles: a.roles })));
  }),
);

/** Dismissing the sheet (or opening a note in the list) marks those notes read for this person. */
updatesRouter.post(
  '/me/whats-new/read',
  h(async (req, res) => {
    const a = authOf(req);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(req.body);
    const marked = await withTenant(a.tenantId, async (tx) => markRead(tx, a.tenantId, { ...(await me(tx, a.userId)), roles: a.roles }, ids));
    res.json({ marked });
  }),
);

/** Feature changes coming to this organization from FH's releases (and the last month's), with what its own choices keep. */
updatesRouter.get(
  '/updates/changes',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => changesFor(tx)));
  }),
);

/** Maintenance: banners (on now, or starting within a day) and what's planned for the next two weeks. */
updatesRouter.get(
  '/maintenance',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, async (tx) => ({ banners: await bannersFor(tx, a.tenantId), upcoming: await upcomingFor(tx, a.tenantId) })));
  }),
);

/** The sign-in page's banner: no one is signed in yet, so only the times and the message. */
export const publicMaintenanceRouter = Router();
publicMaintenanceRouter.get(
  '/public/maintenance',
  h(async (req, res) => {
    if (!req.tenantId) return void res.json({ banners: [] });
    const tenantId = req.tenantId;
    res.json({ banners: await withTenant(tenantId, (tx) => bannersFor(tx, tenantId)) });
  }),
);
