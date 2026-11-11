import type { JobPosting } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { workAge } from '../services/legal/ages.js';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { h } from './context.js';

const today = () => new Date(new Date().toISOString().slice(0, 10));
const money = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).nullable();
const body = z.object({
  title: z.string().trim().min(3).max(120),
  titleFr: z.string().trim().max(120).nullable(),
  description: z.string().trim().min(20).max(6000),
  descriptionFr: z.string().trim().max(6000).nullable(),
  facilityId: z.string().uuid().nullable(),
  employmentStatus: z.enum(['FULL_TIME', 'PART_TIME', 'CASUAL', 'ON_CALL', 'VOLUNTEER']),
  payMin: money,
  payMax: money,
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  applyUrl: z.string().max(400).refine((u) => /^https:\/\/\S+$/.test(u) || /^mailto:[^\s@]+@[^\s@]+$/.test(u), 'Use an https:// link or a mailto: address.').nullable().optional(),
  /** Take applications on the careers page, into FH. */
  applyInApp: z.boolean().default(false),
  published: z.boolean(),
});

const view = (j: JobPosting & { facility?: { name: string } | null }) => ({
  id: j.id,
  title: j.title,
  titleFr: j.titleFr,
  description: j.description,
  descriptionFr: j.descriptionFr,
  facilityId: j.facilityId,
  facility: j.facility?.name ?? null,
  employmentStatus: j.employmentStatus,
  payMin: j.payMin?.toString() ?? null,
  payMax: j.payMax?.toString() ?? null,
  closesOn: j.closesOn.toISOString().slice(0, 10),
  applyUrl: j.applyUrl,
  applyInApp: j.applyInApp,
  published: j.published,
});

/** Public, no sign-in: mounted beside the auth routes (tenant from the subdomain). */
export const publicJobsRouter = Router();
const publicView = (r: Parameters<typeof view>[0], facility: { name: string; province: string } | null) => {
  const { published: _p, ...j } = view({ ...r, facility });
  // For search engines (JobPosting structured data): when it was posted and where.
  return { ...j, postedOn: r.createdAt.toISOString().slice(0, 10), province: facility?.province ?? null, workAge: workAge(facility?.province) };
};

publicJobsRouter.get(
  '/public/jobs',
  requireFeature('jobs'),
  h(async (req, res) => {
    const jobs = await withTenant(req.tenantId!, async (tx) => {
      const rows = await tx.jobPosting.findMany({ where: { published: true, closesOn: { gte: today() } }, orderBy: { closesOn: 'asc' } });
      const facilities = await tx.facility.findMany({ where: { id: { in: rows.map((r) => r.facilityId).filter((x): x is string => !!x) } }, select: { id: true, name: true, province: true } });
      return rows.map((r) => publicView(r, facilities.find((f) => f.id === r.facilityId) ?? null));
    });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(jobs);
  }),
);

/** One open posting, for its own page (shareable, and indexable by search engines). */
publicJobsRouter.get(
  '/public/jobs/:id',
  requireFeature('jobs'),
  h(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw notFound('Job');
    const job = await withTenant(req.tenantId!, async (tx) => {
      const r = await tx.jobPosting.findFirst({ where: { id: id.data, published: true, closesOn: { gte: today() } } });
      if (!r) return null;
      const f = r.facilityId ? await tx.facility.findUnique({ where: { id: r.facilityId }, select: { name: true, province: true } }) : null;
      return publicView(r, f);
    });
    if (!job) throw notFound('Job');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(job);
  }),
);

export const jobsRouter = Router();
jobsRouter.use('/jobs', requirePermission('jobs.manage'));

jobsRouter.get(
  '/jobs',
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) => tx.jobPosting.findMany({ orderBy: [{ published: 'desc' }, { closesOn: 'asc' }] }));
    res.json(rows.map((r) => view(r)));
  }),
);

function check(b: Partial<z.infer<typeof body>>, existing?: { applyUrl: string | null; applyInApp: boolean }) {
  if (b.payMin && b.payMax && Number(b.payMin) > Number(b.payMax)) throw badRequest('The pay range minimum is above the maximum.');
  const inApp = b.applyInApp ?? existing?.applyInApp ?? false;
  const url = b.applyUrl !== undefined ? b.applyUrl : (existing?.applyUrl ?? null);
  if (!inApp && !url) throw badRequest('Take applications in the app, or give a link or email address to apply.');
}

jobsRouter.post(
  '/jobs',
  h(async (req, res) => {
    const a = authOf(req);
    const b = body.parse(req.body);
    check(b);
    const j = await withTenant(a.tenantId, async (tx) => {
      const created = await tx.jobPosting.create({ data: { ...b, tenantId: a.tenantId, closesOn: new Date(b.closesOn) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'job.create', entity: 'JobPosting', entityId: created.id });
      return created;
    });
    res.status(201).json(view(j));
  }),
);

jobsRouter.patch(
  '/jobs/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = z.string().uuid().parse(req.params.id);
    const b = body.partial().parse(req.body);
    const j = await withTenant(a.tenantId, async (tx) => {
      const existing = await tx.jobPosting.findUnique({ where: { id } });
      if (!existing) throw notFound('Job posting');
      check(b, existing);
      const updated = await tx.jobPosting.update({ where: { id }, data: { ...b, closesOn: b.closesOn ? new Date(b.closesOn) : undefined } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'job.update', entity: 'JobPosting', entityId: id, after: b });
      return updated;
    });
    res.json(view(j));
  }),
);
