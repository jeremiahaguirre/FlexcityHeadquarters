/**
 * Benefits administration: the plans the city offers (pension, health, dental,
 * life, disability, union dues…) and who is enrolled. Pay runs take each
 * person's shares automatically, with the right tax treatment.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { h } from './context.js';

export const benefitsRouter = Router();
benefitsRouter.use(['/benefits', '/me/benefits'], requireFeature('payroll'));

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const KINDS = ['PENSION', 'HEALTH', 'DENTAL', 'LIFE', 'DISABILITY', 'UNION_DUES', 'EAP', 'OTHER'] as const;
const planBody = z.object({
  name: z.string().trim().min(2).max(80),
  nameFr: z.string().trim().max(80).nullable().optional(),
  kind: z.enum(KINDS),
  provider: z.string().trim().max(80).nullable().optional(),
  employeePercent: z.number().min(0).max(100).default(0),
  employeeAmount: z.number().min(0).max(10_000).default(0),
  employerPercent: z.number().min(0).max(100).default(0),
  employerAmount: z.number().min(0).max(10_000).default(0),
  employerTaxable: z.boolean().default(false),
  active: z.boolean().default(true),
});

const planView = (p: { id: string; name: string; nameFr: string | null; kind: string; provider: string | null; employeePercent: unknown; employeeAmount: unknown; employerPercent: unknown; employerAmount: unknown; employerTaxable: boolean; active: boolean }) => ({
  ...p,
  employeePercent: Number(p.employeePercent),
  employeeAmount: Number(p.employeeAmount),
  employerPercent: Number(p.employerPercent),
  employerAmount: Number(p.employerAmount),
});

benefitsRouter.get(
  '/benefits',
  requirePermission('benefits.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const [plans, enrollments] = await Promise.all([
        tx.benefitPlan.findMany({ orderBy: [{ active: 'desc' }, { kind: 'asc' }, { name: 'asc' }] }),
        tx.benefitEnrollment.findMany({ include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { startsOn: 'desc' } }),
      ]);
      const today = new Date(new Date().toISOString().slice(0, 10));
      return {
        plans: plans.map((p) => ({ ...planView(p), enrolled: enrollments.filter((e) => e.planId === p.id && (!e.endsOn || e.endsOn >= today)).length })),
        enrollments: enrollments.map((e) => ({
          id: e.id,
          planId: e.planId,
          userId: e.userId,
          name: `${e.user.firstName} ${e.user.lastName}`,
          startsOn: e.startsOn.toISOString().slice(0, 10),
          endsOn: e.endsOn?.toISOString().slice(0, 10) ?? null,
          coverage: e.coverage,
          employeeAmount: e.employeeAmount != null ? Number(e.employeeAmount) : null,
        })),
      };
    });
    res.json(out);
  }),
);

benefitsRouter.post(
  '/benefits/plans',
  requirePermission('benefits.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = planBody.parse(req.body);
    const p = await withTenant(a.tenantId, async (tx) => {
      if (await tx.benefitPlan.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } })) throw conflict('PLAN_EXISTS', 'There is already a plan with that name.');
      const created = await tx.benefitPlan.create({ data: { ...body, nameFr: body.nameFr ?? null, provider: body.provider ?? null, tenantId: a.tenantId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'benefits.plan.create', entity: 'BenefitPlan', entityId: created.id, after: body });
      return created;
    });
    res.status(201).json(planView(p));
  }),
);

benefitsRouter.put(
  '/benefits/plans/:id',
  requirePermission('benefits.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = planBody.parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.benefitPlan.findUnique({ where: { id } }))) throw notFound('Plan');
      await tx.benefitPlan.update({ where: { id }, data: { ...body, nameFr: body.nameFr ?? null, provider: body.provider ?? null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'benefits.plan.update', entity: 'BenefitPlan', entityId: id, after: body });
    });
    res.json({ ok: true });
  }),
);

benefitsRouter.post(
  '/benefits/enrollments',
  requirePermission('benefits.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ planId: uuid, userId: uuid, startsOn: isoDate, coverage: z.string().trim().max(40).nullable().optional(), employeeAmount: z.number().min(0).max(10_000).nullable().optional() }).parse(req.body);
    const e = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.benefitPlan.findUnique({ where: { id: body.planId } }))) throw notFound('Plan');
      if (!(await tx.user.findUnique({ where: { id: body.userId } }))) throw notFound('Person');
      const open = await tx.benefitEnrollment.findFirst({ where: { planId: body.planId, userId: body.userId, OR: [{ endsOn: null }, { endsOn: { gte: new Date(body.startsOn) } }] } });
      if (open) throw conflict('ALREADY_ENROLLED', 'This person is already enrolled in this plan. End that enrollment first.');
      const created = await tx.benefitEnrollment.create({ data: { tenantId: a.tenantId, planId: body.planId, userId: body.userId, startsOn: new Date(body.startsOn), coverage: body.coverage ?? null, employeeAmount: body.employeeAmount ?? null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'benefits.enroll', entity: 'User', entityId: body.userId, after: body });
      return created;
    });
    res.status(201).json({ id: e.id });
  }),
);

benefitsRouter.post(
  '/benefits/enrollments/:id/end',
  requirePermission('benefits.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { endsOn } = z.object({ endsOn: isoDate }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const e = await tx.benefitEnrollment.findUnique({ where: { id } });
      if (!e) throw notFound('Enrollment');
      await tx.benefitEnrollment.update({ where: { id }, data: { endsOn: new Date(endsOn) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'benefits.end', entity: 'User', entityId: e.userId, after: { planId: e.planId, endsOn } });
    });
    res.json({ ok: true });
  }),
);

/** My benefits: what I'm enrolled in and what each costs me per pay. */
benefitsRouter.get(
  '/me/benefits',
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) => tx.benefitEnrollment.findMany({ where: { userId: a.userId, OR: [{ endsOn: null }, { endsOn: { gte: new Date(new Date().toISOString().slice(0, 10)) } }] }, include: { plan: true } }));
    res.json(rows.map((e) => ({ id: e.id, plan: planView(e.plan), startsOn: e.startsOn.toISOString().slice(0, 10), endsOn: e.endsOn?.toISOString().slice(0, 10) ?? null, coverage: e.coverage, employeeAmount: e.employeeAmount != null ? Number(e.employeeAmount) : null })));
  }),
);
