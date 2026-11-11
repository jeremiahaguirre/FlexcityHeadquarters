import { Router } from 'express';
import { z } from 'zod';
import { platformOf } from '../../auth/platform.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { h } from '../context.js';
import { UNSUBSCRIBE_KIND, consentFrom } from '../../services/marketing/casl.js';

/** Marketing-site enquiries for FH staff to follow up. */
export const leadsRouter = Router();
const statuses = z.enum(['NEW', 'CONTACTED', 'WON', 'CLOSED']);

leadsRouter.get(
  '/leads',
  h(async (req, res) => {
    const q = z.object({ status: statuses.optional() }).parse(req.query);
    const leads = await db().lead.findMany({ where: { kind: { not: UNSUBSCRIBE_KIND }, ...(q.status ? { status: q.status } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
    // CASL consent per address (express with its wording and date, implied for six months after an
    // enquiry, or withdrawn by an unsubscribe), so follow-ups only go to people who may be emailed.
    const ledger = await db().lead.findMany({ where: { email: { in: [...new Set(leads.map((l) => l.email))] } }, select: { email: true, kind: true, marketingConsent: true, consentText: true, createdAt: true } });
    res.json(leads.map((l) => {
      const c = consentFrom(ledger.filter((r) => r.email === l.email));
      return { ...l, consent: { state: c.state, since: c.since, expires: c.expires } };
    }));
  }),
);

leadsRouter.patch(
  '/leads/:id',
  h(async (req, res) => {
    const p = platformOf(req);
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ status: statuses.optional(), notes: z.string().trim().max(2000).nullable().optional() }).parse(req.body);
    const gone = await db().lead.updateMany({ where: { id }, data: body });
    if (!gone.count) throw notFound('Lead');
    await db().platformAudit.create({ data: { adminId: p.adminId, action: 'lead.update', detail: { id, ...body } } });
    res.json({ ok: true });
  }),
);
