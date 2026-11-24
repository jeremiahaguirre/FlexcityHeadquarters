/** Overtime equalization: standings, call-out records, the pre-assignment check and the city's policy. */
import { Prisma } from '../generated/prisma/client.js';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { updateTenantJson } from '../lib/tenantSettings.js';
import { HttpError, conflict, forbidden, invalid, notFound } from '../lib/errors.js';
import { dec } from '../lib/money.js';
import { entryHistory, fairnessCheck, parsePolicy, periodStart, shiftCharge, standings } from '../services/scheduling/overtime.js';
import { h } from './context.js';
import { assertPositionInScope, shiftInScope } from '../services/people/scope.js';

export const overtimeRouter = Router();
overtimeRouter.use('/overtime', requireFeature('overtime'));
const uuid = z.string().uuid();

/** Who is next in line for overtime in a position. Union stewards can read it too. */
overtimeRouter.get(
  '/overtime/standings',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('overtime.manage') && !a.permissions.has('seniority.read')) throw forbidden();
    const positionId = uuid.parse(req.query.positionId);
    assertPositionInScope(a, positionId);
    res.json(await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.position.findUnique({ where: { id: positionId } }))) throw notFound('Position');
      return standings(tx, positionId);
    }));
  }),
);

/** Record a call-out: accepted, refused or no answer. */
overtimeRouter.post(
  '/overtime/entries',
  requirePermission('overtime.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ userId: uuid, positionId: uuid, kind: z.enum(['ACCEPTED', 'REFUSED', 'NO_ANSWER']), hours: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/), occurredAt: z.string().datetime({ offset: true }), note: z.string().trim().max(300).nullable().default(null) }).parse(req.body);
    const id = await withTenant(a.tenantId, async (tx) => {
      assertPositionInScope(a, body.positionId);
      if (!(await tx.userPosition.findFirst({ where: { userId: body.userId, positionId: body.positionId } }))) throw notFound('Person in this position');
      const e = await tx.overtimeEntry.create({ data: { tenantId: a.tenantId, userId: body.userId, positionId: body.positionId, kind: body.kind, hours: body.hours, occurredAt: new Date(body.occurredAt), recordedById: a.userId, note: body.note } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'overtime.entry', entity: 'OvertimeEntry', entityId: e.id, after: body });
      return e.id;
    });
    res.status(201).json({ id });
  }),
);

/**
 * One person's call-out history in a position for this equalization period (or from a chosen
 * date): what was recorded, by whom, and which entries were voided and why. Union stewards can
 * read it too, since the ledger is what settles an overtime grievance.
 */
overtimeRouter.get(
  '/overtime/entries',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('overtime.manage') && !a.permissions.has('seniority.read')) throw forbidden();
    const q = z.object({ positionId: uuid, userId: uuid, from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    assertPositionInScope(a, q.positionId);
    res.json(await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.position.findUnique({ where: { id: q.positionId } }))) throw notFound('Position');
      const t = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true } });
      const from = q.from ? new Date(`${q.from}T00:00:00Z`) : periodStart(new Date(), parsePolicy(t.overtimePolicy).periodStartMonth);
      return entryHistory(tx, q.userId, q.positionId, from);
    }));
  }),
);

/**
 * Void a call-out recorded by mistake (wrong person, wrong outcome, wrong hours). The entry is
 * kept and a reversing entry cancels it, so the history still shows what happened and who
 * corrected it. To correct an entry, void it and record the right one.
 */
overtimeRouter.post(
  '/overtime/entries/:id/void',
  requirePermission('overtime.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().max(300) }).parse(req.body);
    if (reason.length < 3) throw invalid('REASON_REQUIRED', 'Say why the entry is being voided.');
    const reversalId = await withTenant(a.tenantId, async (tx) => {
      const e = await tx.overtimeEntry.findUnique({ where: { id } });
      if (!e) throw notFound('Overtime entry');
      if (e.positionId) assertPositionInScope(a, e.positionId);
      else if (a.scope) throw notFound('Overtime entry');
      if (e.userId === a.userId) throw new HttpError(403, 'OWN_OVERTIME', 'Someone else corrects your own overtime record.');
      if (e.reversesId || !dec(e.hours).gt(0)) throw conflict('OVERTIME_REVERSAL', 'This entry already cancels another one. Record a new call-out instead.');
      if (await tx.overtimeEntry.findUnique({ where: { reversesId: id }, select: { id: true } })) throw conflict('OVERTIME_VOIDED', 'This entry has already been voided.');
      // A shift's charge already taken back when the shift was unassigned or cancelled (an unlinked
      // negative entry): voiding it too would take the hours off twice.
      if (e.shiftId && e.kind === 'ACCEPTED' && !(await shiftCharge(tx, e.userId, e.shiftId)).gt(0)) throw conflict('OVERTIME_TAKEN_BACK', 'These hours were already taken back when the shift changed.');
      try {
        const r = await tx.overtimeEntry.create({
          data: { tenantId: a.tenantId, userId: e.userId, positionId: e.positionId, shiftId: e.shiftId, kind: e.kind, hours: dec(e.hours).neg().toFixed(2), occurredAt: e.occurredAt, recordedById: a.userId, note: reason, reversesId: e.id },
        });
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'overtime.void', entity: 'OvertimeEntry', entityId: e.id, before: { kind: e.kind, hours: e.hours.toString(), userId: e.userId }, after: { reversalId: r.id, reason } });
        return r.id;
      } catch (err) {
        // Two people voided it at the same moment: the unique index lets only one reversal in.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw conflict('OVERTIME_VOIDED', 'This entry has already been voided.');
        throw err;
      }
    });
    res.status(201).json({ id: reversalId });
  }),
);

/** Before approving or assigning overtime: who would be skipped? */
overtimeRouter.get(
  '/overtime/check',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('overtime.manage') && !a.permissions.has('shiftboard.approve')) throw forbidden();
    const q = z.object({ shiftId: uuid, userId: uuid }).parse(req.query);
    const out = await withTenant(a.tenantId, async (tx) => {
      const shift = await tx.shift.findUnique({ where: { id: q.shiftId }, select: { positionId: true, facilityId: true } });
      return shift && shiftInScope(a.scope, shift) ? fairnessCheck(tx, q.shiftId, q.userId) : null;
    });
    if (!out) throw notFound('Shift');
    res.json(out);
  }),
);

overtimeRouter.get(
  '/overtime/policy',
  requirePermission('overtime.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const t = await withTenant(a.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { overtimePolicy: true } }));
    res.json(parsePolicy(t.overtimePolicy));
  }),
);

overtimeRouter.put(
  '/overtime/policy',
  requirePermission('overtime.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ countRefusals: z.boolean(), clause: z.string().trim().max(200).nullable(), periodStartMonth: z.number().int().min(1).max(12) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      // Keep other settings stored alongside (Fill the schedule keeps its own under `solver`), under the row lock.
      await updateTenantJson(tx, a.tenantId, 'overtimePolicy', (kept) => ({ ...kept, ...body }));
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'overtime.policy', entity: 'Tenant', entityId: a.tenantId, after: body });
    });
    res.json(body);
  }),
);
