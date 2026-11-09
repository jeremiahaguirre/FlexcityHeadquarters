/** Care after critical incidents: check-ins for leads, and the employee's own options. */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { notify, usersWithRoles } from '../services/notifications/notifier.js';
import { parseCare } from '../services/people/care.js';
import { h } from './context.js';

export const careRouter = Router();
careRouter.use(['/care', '/me/care'], requireFeature('care'));
const uuid = z.string().uuid();

/** Open check-ins (and the last 30 days of completed ones) for supervisors and HR. */
careRouter.get(
  '/care/checkins',
  requirePermission('care.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, async (tx) => {
      const list = await tx.careCheckIn.findMany({ where: { OR: [{ status: 'OFFERED' }, { completedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] });
      const [users, incidents] = await Promise.all([
        tx.user.findMany({ where: { id: { in: [...new Set(list.map((c) => c.userId))] } }, select: { id: true, firstName: true, lastName: true } }),
        tx.incidentReport.findMany({ where: { id: { in: [...new Set(list.map((c) => c.incidentId))] } }, select: { id: true, category: true, occurredAt: true, facility: { select: { name: true } } } }),
      ]);
      return list.map((c) => {
        const u = users.find((x) => x.id === c.userId);
        const i = incidents.find((x) => x.id === c.incidentId);
        return { id: c.id, status: c.status, dueAt: c.dueAt, breakAskedAt: c.breakAskedAt, completedAt: c.completedAt, person: u ? `${u.firstName} ${u.lastName}` : '—', userId: c.userId, incident: i ? { category: i.category, occurredAt: i.occurredAt, facility: i.facility.name } : null };
      });
    });
    res.json(rows);
  }),
);

/** A lead records that the check-in happened. Nothing about the conversation is stored. */
careRouter.post(
  '/care/checkins/:id/done',
  requirePermission('care.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const c = await tx.careCheckIn.findUnique({ where: { id } });
      if (!c) throw notFound('Check-in');
      if (c.status !== 'OFFERED') throw conflict('ALREADY_DONE', 'This check-in is already closed.');
      await tx.careCheckIn.update({ where: { id }, data: { status: 'CHECKED_IN', completedAt: new Date(), completedById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'care.checkin', entity: 'CareCheckIn', entityId: id });
    });
    res.json({ ok: true });
  }),
);

careRouter.get(
  '/care/settings',
  requirePermission('care.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const t = await withTenant(a.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { careSettings: true } }));
    res.json(parseCare(t.careSettings));
  }),
);

careRouter.put(
  '/care/settings',
  requirePermission('care.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ eap: z.string().trim().max(500).nullable() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      await tx.tenant.update({ where: { id: a.tenantId }, data: { careSettings: body as Prisma.InputJsonValue } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'care.settings', entity: 'Tenant', entityId: a.tenantId });
    });
    res.json(body);
  }),
);

/** The employee's open check-ins, with the city's support details. */
careRouter.get(
  '/me/care',
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const [open, t] = await Promise.all([
        tx.careCheckIn.findMany({ where: { userId: a.userId, status: 'OFFERED' }, orderBy: { createdAt: 'desc' } }),
        tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { careSettings: true } }),
      ]);
      return { open: open.map((c) => ({ id: c.id, breakAskedAt: c.breakAskedAt, createdAt: c.createdAt })), eap: parseCare(t.careSettings).eap };
    });
    res.json(out);
  }),
);

/** Ask for time away from the chair: the leads on duty (or all supervisors) are told right away. */
careRouter.post(
  '/me/care/:id/break',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const c = await tx.careCheckIn.findUnique({ where: { id } });
      if (!c || c.userId !== a.userId) throw notFound('Check-in');
      await tx.careCheckIn.update({ where: { id }, data: { breakAskedAt: new Date() } });
      const me = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { firstName: true, lastName: true } });
      const leads = await usersWithRoles(tx, ['AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD'], [a.userId]);
      await notify(tx, a.tenantId, leads.map((userId) => ({ userId, type: 'care_break_requested', params: { name: `${me.firstName} ${me.lastName}` }, link: '/manage/care' })));
    });
    res.json({ ok: true });
  }),
);

/** "I'm okay, no follow-up needed." */
careRouter.post(
  '/me/care/:id/decline',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const c = await tx.careCheckIn.findUnique({ where: { id } });
      if (!c || c.userId !== a.userId) throw notFound('Check-in');
      await tx.careCheckIn.update({ where: { id }, data: { status: 'DECLINED', completedAt: new Date(), completedById: a.userId } });
    });
    res.json({ ok: true });
  }),
);
