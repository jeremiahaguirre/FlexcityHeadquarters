/** Workers' injuries and the employer's report to the compensation board, on time. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { type Tx, audit, withTenant } from '../lib/db.js';
import { HttpError, conflict, notFound } from '../lib/errors.js';
import { notify, usersWithPermission } from '../services/notifications/notifier.js';
import { BOARDS, reportDue, reportRequired } from '../services/injury/boards.js';
import { assertUserInScope, peopleInScope, hrRecordsBy } from '../services/people/scope.js';
import { h } from './context.js';

export const injuryRouter = Router();
injuryRouter.use('/injury-claims', requireFeature('injuryClaims'));
/** HR sees every claim; other supervisors only the ones they opened or filed. */
const involvedClaim = (a: ReturnType<typeof authOf>) => {
  const by = hrRecordsBy(a);
  return by ? { OR: [{ createdById: by }, { filedById: by }] } : {};
};
const uuid = z.string().uuid();

injuryRouter.get(
  '/injury-claims',
  requirePermission('injury.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const inScope = await peopleInScope(tx, a.scope);
      // Compensation-board claims are health information: every viewing of the list is on record.
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'injury.list.view', entity: 'Tenant', entityId: a.tenantId });
      const list = await tx.injuryClaim.findMany({ where: { OR: [{ status: 'OPEN' }, { createdAt: { gte: new Date(Date.now() - 365 * 86_400_000) } }], ...(inScope ? { userId: { in: [...inScope] } } : {}), AND: [involvedClaim(a)] }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 300 });
      const people = await tx.user.findMany({ where: { id: { in: [...new Set(list.map((c) => c.userId))] } }, select: { id: true, firstName: true, lastName: true } });
      return list.map((c) => {
        const p = people.find((x) => x.id === c.userId);
        return { ...c, person: p ? `${p.firstName} ${p.lastName}` : '', form: BOARDS[c.province].form, verified: BOARDS[c.province].verified };
      });
    });
    res.json({ claims: out, boards: BOARDS });
  }),
);

injuryRouter.post(
  '/injury-claims',
  requirePermission('injury.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z
      .object({
        userId: uuid,
        facilityId: uuid,
        incidentId: uuid.nullable().optional(),
        occurredAt: z.coerce.date(),
        learnedAt: z.coerce.date(),
        lostTime: z.boolean(),
        healthCare: z.boolean(),
        description: z.string().trim().min(5).max(300),
      })
      .parse(req.body);
    if (b.learnedAt < b.occurredAt) throw new HttpError(400, 'BAD_DATES', 'You can’t learn of an injury before it happened.');
    if (b.learnedAt.getTime() > Date.now() + 60_000) throw new HttpError(400, 'BAD_DATES', 'That date is in the future.');
    const out = await withTenant(a.tenantId, async (tx) => {
      await assertUserInScope(tx, a, b.userId);
      const f = await tx.facility.findUnique({ where: { id: b.facilityId } });
      if (!f) throw notFound('Facility');
      // The board is the province where the work happened.
      const rule = BOARDS[f.province];
      const required = reportRequired(b.lostTime, b.healthCare);
      const c = await tx.injuryClaim.create({
        data: { tenantId: a.tenantId, userId: b.userId, facilityId: f.id, incidentId: b.incidentId ?? null, occurredAt: b.occurredAt, learnedAt: b.learnedAt, province: f.province, board: rule.board, dueAt: reportDue(f.province, b.learnedAt), lostTime: b.lostTime, healthCare: b.healthCare, description: b.description, status: required ? 'OPEN' : 'NOT_REQUIRED', createdById: a.userId },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'injury.create', entity: 'InjuryClaim', entityId: c.id, after: { board: rule.board, required } });
      return c;
    });
    res.status(201).json(out);
  }),
);

/** Lost time or health care found later: the report becomes due. Or record that it was filed. */
injuryRouter.patch(
  '/injury-claims/:id',
  requirePermission('injury.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ lostTime: z.boolean().optional(), healthCare: z.boolean().optional(), accommodationId: uuid.nullable().optional() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const c = await tx.injuryClaim.findFirst({ where: { id, ...involvedClaim(a) } });
      if (!c) throw notFound('Injury');
      const lostTime = b.lostTime ?? c.lostTime;
      const healthCare = b.healthCare ?? c.healthCare;
      const status = c.status === 'FILED' ? 'FILED' : reportRequired(lostTime, healthCare) ? 'OPEN' : 'NOT_REQUIRED';
      await tx.injuryClaim.update({ where: { id }, data: { lostTime, healthCare, status, ...(b.accommodationId !== undefined ? { accommodationId: b.accommodationId } : {}) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'injury.update', entity: 'InjuryClaim', entityId: id, after: b });
    });
    res.json({ ok: true });
  }),
);

injuryRouter.post(
  '/injury-claims/:id/filed',
  requirePermission('injury.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { claimNumber } = z.object({ claimNumber: z.string().trim().max(40).nullable().optional() }).parse(req.body ?? {});
    await withTenant(a.tenantId, async (tx) => {
      const c = await tx.injuryClaim.findFirst({ where: { id, ...involvedClaim(a) } });
      if (!c) throw notFound('Injury');
      if (c.status === 'FILED') throw conflict('ALREADY_FILED', 'Already recorded as filed.');
      await tx.injuryClaim.update({ where: { id }, data: { status: 'FILED', filedAt: new Date(), filedById: a.userId, claimNumber: claimNumber ?? null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'injury.filed', entity: 'InjuryClaim', entityId: id, after: { claimNumber, late: new Date() > c.dueAt } });
    });
    res.json({ ok: true });
  }),
);

/** Hourly: a day before the deadline, and when it passes, to whoever handles injury reports. */
export async function injuryReminders(tx: Tx, now = new Date()): Promise<number> {
  const open = await tx.injuryClaim.findMany({ where: { status: 'OPEN' } });
  if (!open.length) return 0;
  const to = await usersWithPermission(tx, open[0]!.tenantId, 'injury.manage');
  let n = 0;
  for (const c of open) {
    const left = c.dueAt.getTime() - now.getTime();
    const kind = left <= 0 && !c.overdueSentAt ? 'overdue' : left > 0 && left <= 24 * 3_600_000 && !c.reminderSentAt ? 'soon' : null;
    if (!kind) continue;
    await tx.injuryClaim.update({ where: { id: c.id }, data: kind === 'overdue' ? { overdueSentAt: now } : { reminderSentAt: now } });
    await notify(tx, c.tenantId, to.map((userId) => ({ userId, type: kind === 'overdue' ? 'injury_overdue' : 'injury_due_soon', params: { board: c.board, due: c.dueAt.toISOString() }, link: '/manage/injuries', email: 'injury_report_due' })));
    n++;
  }
  return n;
}
