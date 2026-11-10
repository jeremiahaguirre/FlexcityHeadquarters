/** Shift trades between two people (services/shiftboard/trades.ts). */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import type { Tx } from '../lib/db.js';
import { withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { notify, usersWithPermission } from '../services/notifications/notifier.js';
import { shiftInScope } from '../services/people/scope.js';
import { approveTrade, checkTrade, denyTrade, proposeTrade, respondTrade, staleTrade } from '../services/shiftboard/trades.js';
import { h } from './context.js';

export const tradesRouter = Router();
tradesRouter.use(['/trades', '/me/trades'], requireFeature('shiftBoard'));
const uuid = z.string().uuid();
const WINDOW_DAYS = 14;

type TradeRow = { id: string; fromUserId: string; fromShiftId: string; toUserId: string; toShiftId: string; status: string; note: string | null; check: unknown; createdAt: Date; decisionNote: string | null };

/** Trades with both shifts and both names, for lists. */
async function views(tx: Tx, trades: TradeRow[]) {
  const shiftIds = [...new Set(trades.flatMap((t) => [t.fromShiftId, t.toShiftId]))];
  const userIds = [...new Set(trades.flatMap((t) => [t.fromUserId, t.toUserId]))];
  const [shifts, users] = await Promise.all([
    tx.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, startsAt: true, endsAt: true, positionId: true, facilityId: true, position: { select: { name: true, nameFr: true } }, facility: { select: { name: true, timezone: true } } } }),
    tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  const shift = (id: string) => {
    const s = shifts.find((x) => x.id === id);
    return s ? { id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, position: s.position.name, positionFr: s.position.nameFr, facility: s.facility.name, timezone: s.facility.timezone, positionId: s.positionId, facilityId: s.facilityId } : null;
  };
  const name = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : '';
  };
  return trades.map((t) => ({ id: t.id, status: t.status, note: t.note, decisionNote: t.decisionNote, createdAt: t.createdAt, from: { userId: t.fromUserId, name: name(t.fromUserId), shift: shift(t.fromShiftId) }, to: { userId: t.toUserId, name: name(t.toUserId), shift: shift(t.toShiftId) }, check: t.check }));
}

/** Shifts I could trade mine for: other people's, in positions I hold, within two weeks, where we're both eligible. */
tradesRouter.get(
  '/me/trades/options',
  requirePermission('shiftboard.post'),
  h(async (req, res) => {
    const a = authOf(req);
    const shiftId = uuid.parse(req.query.shiftId);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const mine = await tx.shift.findUnique({ where: { id: shiftId } });
        if (!mine || mine.userId !== a.userId) throw notFound('Shift');
        const positions = (await tx.userPosition.findMany({ where: { userId: a.userId }, select: { positionId: true } })).map((p) => p.positionId);
        const around = (d: number) => new Date(mine.startsAt.getTime() + d * 86_400_000);
        const now = new Date();
        const candidates = await tx.shift.findMany({
          where: { id: { not: shiftId }, status: 'PUBLISHED', userId: { notIn: [a.userId] }, NOT: { userId: null }, positionId: { in: positions }, startsAt: { gt: now > around(-WINDOW_DAYS) ? now : around(-WINDOW_DAYS), lt: around(WINDOW_DAYS) } },
          orderBy: { startsAt: 'asc' },
          take: 40,
          select: { id: true },
        });
        const busy = new Set((await tx.shiftTrade.findMany({ where: { status: { in: ['PROPOSED', 'ACCEPTED'] }, OR: [{ fromShiftId: { in: candidates.map((c) => c.id) } }, { toShiftId: { in: candidates.map((c) => c.id) } }] }, select: { fromShiftId: true, toShiftId: true } })).flatMap((t) => [t.fromShiftId, t.toShiftId]));
        const ok: string[] = [];
        for (const c of candidates) {
          if (busy.has(c.id)) continue;
          const check = await checkTrade(tx, shiftId, c.id).catch(() => null);
          if (check?.from.eligible && check.to.eligible) ok.push(c.id);
        }
        const shifts = await tx.shift.findMany({ where: { id: { in: ok } }, orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true, endsAt: true, userId: true, position: { select: { name: true, nameFr: true } }, facility: { select: { name: true, timezone: true } } } });
        const people = await tx.user.findMany({ where: { id: { in: shifts.map((s) => s.userId!) } }, select: { id: true, firstName: true, lastName: true } });
        return shifts.map((s) => {
          const p = people.find((x) => x.id === s.userId);
          return { id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, position: s.position.name, positionFr: s.position.nameFr, facility: s.facility.name, timezone: s.facility.timezone, person: p ? `${p.firstName} ${p.lastName}` : '' };
        });
      }),
    );
  }),
);

tradesRouter.get(
  '/me/trades',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const list = await tx.shiftTrade.findMany({ where: { OR: [{ fromUserId: a.userId }, { toUserId: a.userId }], createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { createdAt: 'desc' }, take: 50 });
        return views(tx, list);
      }),
    );
  }),
);

tradesRouter.post(
  '/me/trades',
  requirePermission('shiftboard.post'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ myShiftId: uuid, theirShiftId: uuid, note: z.string().trim().max(300).nullable().optional() }).parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const t = await proposeTrade(tx, a.tenantId, a.userId, b.myShiftId, b.theirShiftId, b.note ?? null);
      const me = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { firstName: true, lastName: true } });
      await notify(tx, a.tenantId, [{ userId: t.toUserId, type: 'trade_proposed', params: { name: `${me.firstName} ${me.lastName}`, tradeId: t.id }, link: '/board' }]);
      return (await views(tx, [t]))[0];
    });
    res.status(201).json(out);
  }),
);

for (const [path, accept] of [['accept', true], ['decline', false]] as const) {
  tradesRouter.post(
    `/me/trades/:id/${path}`,
    h(async (req, res) => {
      const a = authOf(req);
      const id = uuid.parse(req.params.id);
      const stale = await withTenant(a.tenantId, async (tx) => {
        const r = await respondTrade(tx, a.tenantId, a.userId, id, accept);
        if (r.stale) return true;
        const t = r.trade;
        const me = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { firstName: true, lastName: true } });
        const name = `${me.firstName} ${me.lastName}`;
        await notify(tx, a.tenantId, [{ userId: t.fromUserId, type: accept ? 'trade_accepted' : 'trade_declined', params: { name, tradeId: id }, link: '/board' }]);
        if (accept) {
          const shifts = await tx.shift.findMany({ where: { id: { in: [t.fromShiftId, t.toShiftId] } }, select: { positionId: true, facilityId: true } });
          const approvers = await usersWithPermission(tx, a.tenantId, 'shiftboard.approve', [t.fromUserId, t.toUserId]);
          await notify(tx, a.tenantId, approvers.map((userId) => ({ userId, type: 'trade_to_approve', params: { tradeId: id, count: shifts.length }, link: '/manage/approvals' })));
        }
        return false;
      });
      if (stale) throw staleTrade();
      res.json({ ok: true });
    }),
  );
}

tradesRouter.post(
  '/me/trades/:id/cancel',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const t = await tx.shiftTrade.findUnique({ where: { id } });
      if (!t || t.fromUserId !== a.userId) throw notFound('Trade');
      const done = await tx.shiftTrade.updateMany({ where: { id, status: { in: ['PROPOSED', 'ACCEPTED'] } }, data: { status: 'CANCELLED' } });
      if (done.count && t.status === 'ACCEPTED') await notify(tx, a.tenantId, [{ userId: t.toUserId, type: 'trade_cancelled', params: { tradeId: id }, link: '/board' }]);
    });
    res.json({ ok: true });
  }),
);

/** Supervisors: trades both people agreed to, in their department. */
tradesRouter.get(
  '/trades',
  requirePermission('shiftboard.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const list = await tx.shiftTrade.findMany({ where: { status: 'ACCEPTED' }, orderBy: { createdAt: 'asc' }, take: 100 });
        const all = await views(tx, list);
        return all.filter((t) => t.from.shift && t.to.shift && shiftInScope(a.scope, t.from.shift) && shiftInScope(a.scope, t.to.shift));
      }),
    );
  }),
);

tradesRouter.post(
  '/trades/:id/decision',
  requirePermission('shiftboard.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ decision: z.enum(['APPROVE', 'DENY']), note: z.string().trim().max(300).nullable().optional() }).parse(req.body);
    const stale = await withTenant(a.tenantId, async (tx) => {
      const t = await tx.shiftTrade.findUnique({ where: { id } });
      if (!t) throw notFound('Trade');
      const shifts = await tx.shift.findMany({ where: { id: { in: [t.fromShiftId, t.toShiftId] } }, select: { positionId: true, facilityId: true } });
      if (!shifts.every((s) => shiftInScope(a.scope, s))) throw forbidden('These shifts aren’t in your department.');
      if (b.decision === 'APPROVE') {
        if ((await approveTrade(tx, a.tenantId, a.userId, id, b.note ?? null)).stale) return true;
      } else await denyTrade(tx, a.tenantId, a.userId, id, b.note ?? null);
      const type = b.decision === 'APPROVE' ? 'trade_approved' : 'trade_denied';
      await notify(tx, a.tenantId, [t.fromUserId, t.toUserId].map((userId) => ({ userId, type, params: { tradeId: id, note: b.note ?? '' }, link: '/schedule' })));
      return false;
    });
    if (stale) throw staleTrade();
    res.json({ ok: true });
  }),
);
