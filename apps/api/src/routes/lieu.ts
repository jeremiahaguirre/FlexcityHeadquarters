/** Time in lieu: each person's bank and choice, HR's view and corrections (services/payroll/lieu.ts). */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { banks, expiredHours, lieuAvailable, lieuPolicy } from '../services/payroll/lieu.js';
import { readSettings } from '../services/payroll/payRuns.js';
import type { Tx } from '../lib/db.js';
import { assertUserInScope, peopleWhere } from '../services/people/scope.js';
import { h } from './context.js';

export const lieuRouter = Router();
const uuid = z.string().uuid();
const policyOf = async (tx: Tx) => lieuPolicy(readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings));
const today = () => new Date().toISOString().slice(0, 10);

lieuRouter.get(
  '/me/lieu',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const policy = await policyOf(tx);
        const me = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { bankOvertime: true, bankOvertimeAt: true } });
        const bank = (await banks(tx, [a.userId])).get(a.userId)!;
        return { policy, bankOvertime: me.bankOvertime, chosenAt: me.bankOvertimeAt, balance: bank.balance, available: await lieuAvailable(tx, a.userId), expiring: expiredHours(bank, policy, today()), history: bank.history.slice(-50).reverse() };
      }),
    );
  }),
);

/** The person's choice: bank overtime (their agreement, recorded) or be paid for it. Applies from the next pay run. */
lieuRouter.put(
  '/me/lieu',
  h(async (req, res) => {
    const a = authOf(req);
    const { bank } = z.object({ bank: z.boolean() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (bank && !(await policyOf(tx)).enabled) throw new HttpError(409, 'LIEU_OFF', 'Your organization doesn’t use time in lieu.');
      await tx.user.update({ where: { id: a.userId }, data: { bankOvertime: bank, bankOvertimeAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: bank ? 'lieu.agreed' : 'lieu.withdrawn', entity: 'User', entityId: a.userId });
    });
    res.json({ bankOvertime: bank });
  }),
);

/** HR and payroll: everyone's bank. */
lieuRouter.get(
  '/lieu',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('leave.manage') && !a.permissions.has('payroll.export')) throw forbidden();
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const policy = await policyOf(tx);
        const people = await tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null, ...peopleWhere(a.scope) }, select: { id: true, firstName: true, lastName: true, bankOvertime: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
        const all = await banks(tx, people.map((p) => p.id));
        const rows = people
          .map((p) => {
            const b = all.get(p.id)!;
            return { userId: p.id, name: `${p.firstName} ${p.lastName}`, bankOvertime: p.bankOvertime, balance: b.balance, expiring: expiredHours(b, policy, today()) };
          })
          .filter((r) => r.bankOvertime || r.balance !== 0);
        return { policy, people: rows };
      }),
    );
  }),
);

/** HR: an opening balance or a correction, with the reason. */
lieuRouter.post(
  '/users/:id/lieu/adjust',
  requirePermission('leave.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const b = z.object({ hours: z.number().min(-1000).max(1000).refine((n) => n !== 0, 'Enter the hours to add or remove.'), note: z.string().trim().min(3).max(200) }).parse(req.body);
    if (userId === a.userId) throw forbidden('You can’t change your own banked time.');
    const out = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound('Person');
      await assertUserInScope(tx, a, userId);
      const bank = (await banks(tx, [userId])).get(userId)!;
      if (bank.balance + b.hours < -0.001) throw new HttpError(400, 'LIEU_SHORT', `They have ${bank.balance} hours banked.`, { have: bank.balance });
      const x = await tx.lieuAdjustment.create({ data: { tenantId: a.tenantId, userId, hours: b.hours, note: b.note, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'lieu.adjust', entity: 'User', entityId: userId, after: b });
      return { id: x.id, balance: Math.round((bank.balance + b.hours) * 100) / 100 };
    });
    res.status(201).json(out);
  }),
);
