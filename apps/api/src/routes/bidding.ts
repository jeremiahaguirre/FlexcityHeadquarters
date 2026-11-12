/**
 * Shift bidding by seniority. Refused (404 FEATURE_OFF) unless the organization uses seniority and
 * has bidding on. Staff rank (bidding.bid), managers run rounds in their departments
 * (bidding.manage), union stewards read closed rounds' order and reasons (bidding.observe).
 */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { announceChange } from '../lib/changes.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { dispatchSoon, withEvents } from '../lib/events.js';
import { localIso } from '../lib/time.js';
import { peopleWhere } from '../services/people/scope.js';
import { type ChoiceOutcome, MAX_CHOICES, canSeeRound, cancelRound, confirmRound, createRound, liveOrder, overrideAward, roundBody, saveChoices, visibleRounds } from '../services/scheduling/bidding.js';
import { schedulableDepartments } from '../services/scheduling/fillRun.js';
import { visibleTemplates } from '../services/scheduling/shiftTemplates.js';
import { parseSolverSettings, withSolverSettings } from '../services/scheduling/solverSettings.js';
import type { Tx } from '../lib/db.js';
import { h } from './context.js';

export const biddingRouter = Router();
// Needs seniority: features.ts switches bidding off with it, so this refuses too.
biddingRouter.use(['/bids', '/me/bids'], requireFeature('seniority'), requireFeature('shiftBidding'));
const uuid = z.string().uuid();
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

type RoundRow = Prisma.BidRoundGetPayload<{ include: { items: true } }>;

/** Items as the screens show them: facility, position, local times, how many shifts. */
async function itemsView(tx: Tx, items: RoundRow['items']) {
  const [facilities, positions] = await Promise.all([
    tx.facility.findMany({ where: { id: { in: [...new Set(items.map((i) => i.facilityId))] } }, select: { id: true, name: true, timezone: true } }),
    tx.position.findMany({ where: { id: { in: [...new Set(items.map((i) => i.positionId))] } }, select: { id: true, name: true, nameFr: true } }),
  ]);
  const f = new Map(facilities.map((x) => [x.id, x]));
  const p = new Map(positions.map((x) => [x.id, x]));
  return items.map((i) => {
    const tz = f.get(i.facilityId)?.timezone ?? 'America/Toronto';
    return {
      id: i.id,
      facility: f.get(i.facilityId)?.name ?? '',
      position: p.get(i.positionId) ?? { id: i.positionId, name: '', nameFr: null },
      shifts: i.shiftIds.length,
      localStartsAt: localIso(i.firstStartsAt, tz),
      localEndsAt: localIso(i.lastEndsAt, tz),
      meta: i.meta as { daysOfWeek?: number[]; startMinute?: number; endMinute?: number },
    };
  });
}

const roundHead = (r: Pick<RoundRow, 'id' | 'name' | 'kind' | 'status' | 'opensAt' | 'closesAt' | 'maxAwardsPerPerson' | 'seniorityBasis' | 'awardOrder' | 'rangeFrom' | 'rangeTo'>) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  status: r.status,
  opensAt: r.opensAt.toISOString(),
  closesAt: r.closesAt.toISOString(),
  maxAwardsPerPerson: r.maxAwardsPerPerson,
  seniorityBasis: r.seniorityBasis,
  awardOrder: r.awardOrder,
  rangeFrom: iso(r.rangeFrom),
  rangeTo: iso(r.rangeTo),
});

// ------------------------------------------------------------------ staff

/** Rounds I may bid in (open or opening soon), in review, or confirmed in the last 60 days, with my ranking and place. */
biddingRouter.get(
  '/me/bids',
  requirePermission('bidding.bid'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const holds = (await tx.userPosition.findMany({ where: { userId: a.userId }, select: { positionId: true } })).map((p) => p.positionId);
        const since = new Date(Date.now() - 60 * 86_400_000);
        const rounds = await tx.bidRound.findMany({
          where: { positionIds: { hasSome: holds.length ? holds : ['00000000-0000-0000-0000-000000000000'] }, OR: [{ status: { in: ['OPEN', 'REVIEW'] } }, { status: 'AWARDED', confirmedAt: { gte: since } }] },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { closesAt: 'asc' },
        });
        const out = [];
        for (const r of rounds) {
          const [choices, entrant, awards] = await Promise.all([
            tx.bidChoice.findMany({ where: { roundId: r.id, userId: a.userId }, orderBy: { rank: 'asc' }, select: { itemId: true } }),
            tx.bidEntrant.findUnique({ where: { roundId_userId: { roundId: r.id, userId: a.userId } } }),
            r.status === 'AWARDED' ? tx.bidAward.findMany({ where: { roundId: r.id, userId: a.userId }, select: { itemId: true } }) : Promise.resolve([]),
          ]);
          const order = await liveOrder(tx, r);
          const live = order.findIndex((x) => x.userId === a.userId);
          const mine = order[live];
          out.push({
            ...roundHead(r),
            // Only items in positions I hold.
            items: await itemsView(tx, r.items.filter((i) => holds.includes(i.positionId))),
            myChoices: choices.map((c) => c.itemId),
            // My place among everyone who may bid (live until the close; the close's snapshot after).
            seniority: { rank: entrant && r.status === 'AWARDED' ? entrant.seniorityRank : live + 1, of: order.length, seniorityDate: mine?.seniorityDate ?? null, seniorityHours: mine?.seniorityHours ?? 0, hireDate: mine?.hireDate ?? null },
            result: r.status === 'AWARDED' && entrant ? { awarded: awards.map((x) => x.itemId), outcomes: entrant.outcomes as unknown as ChoiceOutcome[] } : null,
            maxChoices: MAX_CHOICES,
          });
        }
        return out;
      }),
    );
  }),
);

biddingRouter.put(
  '/me/bids/:id/choices',
  requirePermission('bidding.bid'),
  h(async (req, res) => {
    const a = authOf(req);
    const { itemIds } = z.object({ itemIds: z.array(uuid).max(MAX_CHOICES) }).parse(req.body);
    res.json(await withTenant(a.tenantId, (tx) => saveChoices(tx, a, uuid.parse(req.params.id), itemIds)));
  }),
);

// ------------------------------------------------------------------ managers and stewards

const reader = (p: ReadonlySet<string>) => p.has('bidding.manage') || p.has('bidding.observe');

biddingRouter.get(
  '/bids/rounds',
  h(async (req, res) => {
    const a = authOf(req);
    if (!reader(a.permissions)) throw forbidden();
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const rows = await visibleRounds(tx, a);
        const t = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true } });
        const who = await tx.bidChoice.groupBy({ by: ['roundId', 'userId'], where: { roundId: { in: rows.map((r) => r.id) } } });
        return {
          rounds: rows.map((r) => ({ ...roundHead(r), items: r._count.items, bidders: who.filter((x) => x.roundId === r.id).length })),
          canManage: a.permissions.has('bidding.manage'),
          canConfigure: a.permissions.has('bidding.manage') && a.permissions.has('tenant.configure'),
          seniorityBasis: parseSolverSettings(t.overtimePolicy).bidSeniorityBasis,
          awardOrder: parseSolverSettings(t.overtimePolicy).bidAwardOrder,
        };
      }),
    );
  }),
);

/** What the "new round" form needs: positions by department, templates, the default basis. */
biddingRouter.get(
  '/bids/options',
  requirePermission('bidding.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const departments = await schedulableDepartments(tx, a);
        const positions = await tx.position.findMany({ where: { id: { in: departments.flatMap((d) => d.positionIds) } }, select: { id: true, name: true, nameFr: true, departmentId: true }, orderBy: { name: 'asc' } });
        const templates = (await visibleTemplates(tx, a)).filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, validFrom: iso(t.validFrom), validTo: iso(t.validTo), positionIds: [...new Set(t.slots.map((s) => s.positionId))] }));
        const t = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true } });
        return { departments: departments.map((d) => ({ id: d.id, name: d.name, nameFr: d.nameFr, useSeniority: d.useSeniority })), positions, templates, seniorityBasis: parseSolverSettings(t.overtimePolicy).bidSeniorityBasis, awardOrder: parseSolverSettings(t.overtimePolicy).bidAwardOrder };
      }),
    );
  }),
);

biddingRouter.post(
  '/bids/rounds',
  requirePermission('bidding.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = roundBody.parse(req.body);
    const r = await withTenant(a.tenantId, (tx) => createRound(tx, a, b));
    res.status(201).json({ id: r.id });
  }),
);

/** A round: items and how popular each is; after the close, the order, every choice's outcome and the awards. */
biddingRouter.get(
  '/bids/rounds/:id',
  h(async (req, res) => {
    const a = authOf(req);
    if (!reader(a.permissions)) throw forbidden();
    const id = uuid.parse(req.params.id);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const round = await tx.bidRound.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
        if (!round) throw notFound('Bid round');
        const access = await canSeeRound(tx, a, round);
        if (!access) throw notFound('Bid round');
        const [choices, entrants, awards, eligibleCount] = await Promise.all([
          tx.bidChoice.groupBy({ by: ['itemId'], where: { roundId: id }, _count: { _all: true } }),
          tx.bidEntrant.findMany({ where: { roundId: id }, orderBy: { seniorityRank: 'asc' } }),
          tx.bidAward.findMany({ where: { roundId: id } }),
          tx.user.count({ where: { status: 'ACTIVE', anonymizedAt: null, positions: { some: { positionId: { in: round.positionIds } } } } }),
        ]);
        const bidders = (await tx.bidChoice.findMany({ where: { roundId: id }, distinct: ['userId'], select: { userId: true } })).length;
        const names = new Map((await tx.user.findMany({ where: { id: { in: [...new Set([...entrants.map((e) => e.userId), ...awards.flatMap((x) => [x.userId, x.overriddenById, x.previousUserId].filter((y): y is string => !!y))])] } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
        const closed = round.status === 'REVIEW' || round.status === 'AWARDED';
        // Override candidates: everyone who may bid and whom this manager may schedule.
        const eligible = access === 'manage' && round.status === 'REVIEW' ? await tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null, positions: { some: { positionId: { in: round.positionIds } } }, ...peopleWhere(a.scope) }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: 500 }) : [];
        return {
          ...roundHead(round),
          access,
          items: (await itemsView(tx, round.items)).map((i) => ({ ...i, choices: choices.find((c) => c.itemId === i.id)?._count._all ?? 0 })),
          eligibleCount,
          bidders,
          order: closed
            ? entrants.map((e) => ({ userId: e.userId, name: names.get(e.userId) ?? '', rank: e.seniorityRank, seniorityDate: iso(e.seniorityDate), seniorityHours: Number(e.seniorityHours), hireDate: iso(e.hireDate), tiebreak: e.tiebreak, outcomes: e.outcomes as unknown as ChoiceOutcome[] }))
            : [],
          awards: closed ? awards.map((x) => ({ itemId: x.itemId, userId: x.userId, name: names.get(x.userId) ?? '', pass: x.pass, choiceRank: x.choiceRank, overridden: x.overridden, reason: x.overrideReason, by: x.overriddenById ? names.get(x.overriddenById) ?? null : null, previous: x.previousUserId ? names.get(x.previousUserId) ?? null : null })) : [],
          eligible: eligible.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })),
        };
      }),
    );
  }),
);

biddingRouter.put(
  '/bids/rounds/:id/awards/:itemId',
  requirePermission('bidding.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ userId: uuid.nullable(), reason: z.string().trim().min(5).max(500) }).parse(req.body);
    res.json(await withTenant(a.tenantId, (tx) => overrideAward(tx, a, uuid.parse(req.params.id), uuid.parse(req.params.itemId), b.userId, b.reason)));
  }),
);

biddingRouter.post(
  '/bids/rounds/:id/confirm',
  requirePermission('bidding.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const r = await withTenant(a.tenantId, (tx) => withEvents(tx, confirmRound(tx, a, uuid.parse(req.params.id))));
    dispatchSoon(a.tenantId);
    res.json({ assigned: r.assigned, posted: r.posted, dropped: r.dropped });
  }),
);

biddingRouter.post(
  '/bids/rounds/:id/cancel',
  requirePermission('bidding.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    await withTenant(a.tenantId, (tx) => cancelRound(tx, a, uuid.parse(req.params.id)));
    res.json({ ok: true });
  }),
);

/** The organization's defaults for bidding: seniority basis and award order (each round can set its own). Either or both. */
biddingRouter.put(
  '/bids/settings',
  requirePermission('bidding.manage', 'tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ seniorityBasis: z.enum(['DATE', 'HOURS']), awardOrder: z.enum(['ROUND_ROBIN', 'SENIOR_FIRST']) }).partial().parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true } });
      const s = parseSolverSettings(t.overtimePolicy);
      const next = { ...s, bidSeniorityBasis: b.seniorityBasis ?? s.bidSeniorityBasis, bidAwardOrder: b.awardOrder ?? s.bidAwardOrder };
      await tx.tenant.update({ where: { id: a.tenantId }, data: { overtimePolicy: withSolverSettings(t.overtimePolicy, next) as Prisma.InputJsonValue } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'bid.settings', entity: 'Tenant', entityId: a.tenantId, before: { seniorityBasis: s.bidSeniorityBasis, awardOrder: s.bidAwardOrder }, after: { seniorityBasis: next.bidSeniorityBasis, awardOrder: next.bidAwardOrder } });
      await announceChange(tx, a.tenantId, 'bids');
      return { seniorityBasis: next.bidSeniorityBasis, awardOrder: next.bidAwardOrder };
    });
    res.json(out);
  }),
);
