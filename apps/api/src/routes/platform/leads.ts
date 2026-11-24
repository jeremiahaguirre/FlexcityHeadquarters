import { Router } from 'express';
import { z } from 'zod';
import { platformOf } from '../../auth/platform.js';
import { platformDb } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { h } from '../context.js';
import { REMOVED, UNSUBSCRIBE_KIND, consentFrom } from '../../services/marketing/casl.js';

/** Marketing-site enquiries for FH staff to follow up. */
export const leadsRouter = Router();
const statuses = z.enum(['NEW', 'CONTACTED', 'WON', 'CLOSED']);

leadsRouter.get(
  '/leads',
  h(async (req, res) => {
    const q = z.object({ status: statuses.optional() }).parse(req.query);
    const leads = await platformDb().lead.findMany({ where: { kind: { not: UNSUBSCRIBE_KIND }, name: { not: REMOVED }, ...(q.status ? { status: q.status } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
    // CASL consent per address (express with its wording and date, implied for six months after an
    // enquiry, or withdrawn by an unsubscribe), so follow-ups only go to people who may be emailed.
    const ledger = await platformDb().lead.findMany({ where: { email: { in: [...new Set(leads.map((l) => l.email))] } }, select: { email: true, kind: true, marketingConsent: true, consentText: true, createdAt: true } });
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
    const gone = await platformDb().lead.updateMany({ where: { id }, data: body });
    if (!gone.count) throw notFound('Lead');
    await platformDb().platformAudit.create({ data: { adminId: p.adminId, action: 'lead.update', detail: { id, ...body } } });
    res.json({ ok: true });
  }),
);
