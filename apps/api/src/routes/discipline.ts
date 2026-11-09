import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../services/notifications/notifier.js';
import { h } from './context.js';

export const disciplineRouter = Router();
const uuid = z.string().uuid();
const MAX_SIGNATURE_BYTES = 200_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Row = { id: string; summary: string; issuedAt: Date; acknowledgedAt: Date | null; stewardPresent: boolean; issuedById: string };
const view = (r: Row) => ({
  id: r.id,
  summary: r.summary,
  issuedAt: r.issuedAt,
  acknowledgedAt: r.acknowledgedAt,
  stewardPresent: r.stewardPresent,
});

disciplineRouter.get(
  '/users/:id/discipline',
  requirePermission('discipline.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const rows = await withTenant(a.tenantId, async (tx) => {
      const list = await tx.disciplinaryRecord.findMany({ where: { userId }, orderBy: { issuedAt: 'desc' } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'discipline.view', entity: 'User', entityId: userId });
      return list;
    });
    res.json(rows.map(view));
  }),
);

disciplineRouter.post(
  '/users/:id/discipline',
  requirePermission('discipline.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    if (userId === a.userId) throw forbidden('You cannot write a record about yourself.');
    const body = z.object({ summary: z.string().trim().min(10).max(4000), stewardPresent: z.boolean().default(false) }).parse(req.body);
    const rec = await withTenant(a.tenantId, async (tx) => {
      const subject = await tx.user.findUnique({ where: { id: userId } });
      if (!subject || subject.anonymizedAt) throw notFound('Staff member');
      const r = await tx.disciplinaryRecord.create({
        data: { tenantId: a.tenantId, userId, issuedById: a.userId, issuedAt: new Date(), summary: body.summary, stewardPresent: body.stewardPresent },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'discipline.create', entity: 'DisciplinaryRecord', entityId: r.id });
      await notify(tx, a.tenantId, [{ userId, type: 'discipline_issued', link: '/profile' }]);
      return r;
    });
    res.status(201).json(view(rec));
  }),
);

disciplineRouter.get(
  '/me/discipline',
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) => tx.disciplinaryRecord.findMany({ where: { userId: a.userId }, orderBy: { issuedAt: 'desc' } }));
    res.json(rows.map(view));
  }),
);

/** The staff member signs to confirm they received the record (not that they agree). */
disciplineRouter.post(
  '/me/discipline/:id/acknowledge',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { signature } = z.object({ signature: z.string().startsWith('data:image/png;base64,').max(300_000) }).parse(req.body);
    const png = Buffer.from(signature.slice('data:image/png;base64,'.length), 'base64');
    if (png.length > MAX_SIGNATURE_BYTES || !png.subarray(0, 8).equals(PNG_MAGIC)) throw badRequest('The signature image could not be read. Sign again.');
    await withTenant(a.tenantId, async (tx) => {
      const r = await tx.disciplinaryRecord.findUnique({ where: { id } });
      if (!r || r.userId !== a.userId) throw notFound('Record');
      if (r.acknowledgedAt) throw conflict('ALREADY_ACKNOWLEDGED', 'You already signed this record.');
      await tx.disciplinaryRecord.update({ where: { id }, data: { acknowledgementSignature: png, acknowledgedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'discipline.acknowledge', entity: 'DisciplinaryRecord', entityId: id });
    });
    res.json({ ok: true });
  }),
);
