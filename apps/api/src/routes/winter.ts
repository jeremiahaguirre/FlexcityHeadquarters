/** Winter operations: settings, storm call-outs, patrol routes and patrol records. */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertShiftInScope } from '../services/people/scope.js';
import { forgetFeatures, resolveFeatures } from '../services/platform/features.js';
import { type Answer, answer, cancelCallOut, createCallOut } from '../services/winter/callOuts.js';
import { routeStatus } from '../services/winter/patrols.js';
import { asJson, parseWinter, winterSettingsBody } from '../services/winter/settings.js';
import { h } from './context.js';

export const winterRouter = Router();
winterRouter.use(['/call-outs', '/me/call-outs'], requireFeature('callOuts'));
winterRouter.use(['/patrols', '/me/patrols'], requireFeature('patrols'));
const uuid = z.string().uuid();
const anyOf = (...perms: Parameters<typeof requirePermission>) => (req: Parameters<ReturnType<typeof requirePermission>>[0], _res: unknown, next: (e?: unknown) => void) =>
  perms.some((p) => req.auth?.permissions.has(p)) ? next() : next(forbidden());

// ------------------------------------------------------------------ Settings
winterRouter.get(
  '/winter/settings',
  anyOf('winter.manage', 'winter.callout', 'winter.records', 'winter.patrol'),
  h(async (req, res) => {
    const a = authOf(req);
    const t = await withTenant(a.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { winterSettings: true, features: true } }));
    const f = resolveFeatures(t.features);
    res.json({ callOutsOn: f.callOuts, patrolsOn: f.patrols, ...parseWinter(t.winterSettings) });
  }),
);

/** The city's managers switch call-outs and patrol records on or off and set their own time frames. */
winterRouter.put(
  '/winter/settings',
  requirePermission('winter.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = winterSettingsBody.extend({ callOutsOn: z.boolean(), patrolsOn: z.boolean() }).parse(req.body);
    const { callOutsOn, patrolsOn, ...settings } = body;
    await withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { features: true } });
      const features = { ...(t.features as Record<string, boolean>), callOuts: callOutsOn, patrols: patrolsOn };
      await tx.tenant.update({ where: { id: a.tenantId }, data: { winterSettings: asJson(settings), features } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'winter.settings', entity: 'Tenant', entityId: a.tenantId, after: body });
    });
    forgetFeatures(a.tenantId);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------- Routes
const routeBody = z.object({ name: z.string().trim().min(2).max(80), roadClass: z.string().trim().max(20).nullable().optional(), intervalHours: z.number().int().min(1).max(24 * 31), active: z.boolean().optional() });

winterRouter.get(
  '/winter/routes',
  anyOf('winter.manage', 'winter.records', 'winter.patrol'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => routeStatus(tx)));
  }),
);

winterRouter.post(
  '/winter/routes',
  requirePermission('winter.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = routeBody.parse(req.body);
    const r = await withTenant(a.tenantId, async (tx) => {
      if (await tx.patrolRoute.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } })) throw conflict('ROUTE_EXISTS', 'There is already a route with that name.');
      return tx.patrolRoute.create({ data: { tenantId: a.tenantId, name: body.name, roadClass: body.roadClass ?? null, intervalHours: body.intervalHours, active: body.active ?? true } });
    });
    res.status(201).json(r);
  }),
);

winterRouter.patch(
  '/winter/routes/:id',
  requirePermission('winter.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = routeBody.partial().parse(req.body);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.patrolRoute.findUnique({ where: { id } }))) throw notFound('Route');
      await tx.patrolRoute.update({ where: { id }, data: body });
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- Call-outs
const contactView = (c: { id: string; userId: string; rank: number; status: string; skipReason: string | null; offeredAt: Date | null; respondedAt: Date | null }, names: Map<string, string>) => ({
  id: c.id, userId: c.userId, name: names.get(c.userId) ?? '', rank: c.rank, status: c.status, skipReason: c.skipReason, offeredAt: c.offeredAt, respondedAt: c.respondedAt,
});

winterRouter.get(
  '/call-outs',
  requirePermission('winter.callout'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const list = await tx.callOut.findMany({ where: { createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } }, include: { contacts: { orderBy: { rank: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 50 });
      const ids = [...new Set(list.flatMap((c) => c.contacts.map((x) => x.userId)))];
      const [people, facilities, positions] = await Promise.all([
        tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, phone: true } }),
        tx.facility.findMany({ select: { id: true, name: true } }),
        tx.position.findMany({ select: { id: true, name: true, nameFr: true } }),
      ]);
      const names = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
      const phones = new Map(people.map((p) => [p.id, p.phone]));
      return list.map((c) => ({
        id: c.id,
        reason: c.reason,
        status: c.status,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        responseMinutes: c.responseMinutes,
        facility: facilities.find((f) => f.id === c.facilityId)?.name ?? '',
        position: positions.find((p) => p.id === c.positionId) ?? null,
        filledBy: c.filledUserId ? names.get(c.filledUserId) ?? '' : null,
        createdAt: c.createdAt,
        contacts: c.contacts.map((x) => ({ ...contactView(x, names), phone: phones.get(x.userId) ?? null })),
      }));
    });
    res.json(out);
  }),
);

winterRouter.post(
  '/call-outs',
  requirePermission('winter.callout'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ facilityId: uuid, positionId: uuid, reason: z.string().trim().min(3).max(200), startsAt: z.coerce.date(), endsAt: z.coerce.date() }).parse(req.body);
    if (body.endsAt.getTime() - body.startsAt.getTime() > 24 * 3_600_000) throw new HttpError(400, 'TOO_LONG', 'A call-out can be at most 24 hours.');
    assertShiftInScope(a, body);
    const c = await withTenant(a.tenantId, (tx) => createCallOut(tx, { tenantId: a.tenantId, userId: a.userId }, body));
    res.status(201).json({ id: c.id });
  }),
);

/** A supervisor records an answer given by phone. */
winterRouter.post(
  '/call-outs/:id/contacts/:contactId',
  requirePermission('winter.callout'),
  h(async (req, res) => {
    const a = authOf(req);
    const { answer: ans } = z.object({ answer: z.enum(['ACCEPTED', 'DECLINED', 'NO_ANSWER']) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const c = await tx.callOutContact.findFirst({ where: { id: uuid.parse(req.params.contactId), callOutId: uuid.parse(req.params.id) } });
      if (!c) throw notFound('Contact');
      await answer(tx, c, ans as Answer, a.userId);
    });
    res.json({ ok: true });
  }),
);

winterRouter.post(
  '/call-outs/:id/cancel',
  requirePermission('winter.callout'),
  h(async (req, res) => {
    const a = authOf(req);
    await withTenant(a.tenantId, (tx) => cancelCallOut(tx, { tenantId: a.tenantId, userId: a.userId }, uuid.parse(req.params.id)));
    res.json({ ok: true });
  }),
);

/** Call-outs offered to me right now. */
winterRouter.get(
  '/me/call-outs',
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) =>
      tx.callOutContact.findMany({ where: { userId: a.userId, status: 'OFFERED', callOut: { status: 'OPEN' } }, include: { callOut: true } }),
    );
    const facilities = await withTenant(a.tenantId, (tx) => tx.facility.findMany({ select: { id: true, name: true } }));
    res.json(
      rows.map((r) => ({
        id: r.id,
        reason: r.callOut.reason,
        startsAt: r.callOut.startsAt,
        endsAt: r.callOut.endsAt,
        facility: facilities.find((f) => f.id === r.callOut.facilityId)?.name ?? '',
        answerBy: new Date((r.offeredAt ?? new Date()).getTime() + r.callOut.responseMinutes * 60_000),
      })),
    );
  }),
);

winterRouter.post(
  '/me/call-outs/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const { answer: ans } = z.object({ answer: z.enum(['ACCEPTED', 'DECLINED']) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const c = await tx.callOutContact.findFirst({ where: { id: uuid.parse(req.params.id), userId: a.userId } });
      if (!c) throw notFound('Call-out');
      if (c.status !== 'OFFERED') throw conflict('NOT_YOUR_TURN', 'This call-out isn’t offered to you right now.');
      await answer(tx, c, ans, null);
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ Patrols
const coord = z.number().min(-180).max(180).nullable().optional();
const finishBody = z.object({
  conditions: z.array(z.enum(['CLEAR', 'WET', 'SLUSH', 'SNOW_PACKED', 'LOOSE_SNOW', 'ICE', 'BLACK_ICE', 'DRIFTING', 'FREEZING_RAIN'])).min(1).max(9),
  actions: z.array(z.enum(['INSPECTED', 'PLOWED', 'SALTED', 'SANDED', 'BRINE', 'HAZARD_REPORTED'])).min(1).max(6),
  snowCm: z.number().min(0).max(500).nullable().optional(),
  airTempC: z.number().min(-60).max(40).nullable().optional(),
  roadTempC: z.number().min(-60).max(40).nullable().optional(),
  materialTonnes: z.number().min(0).max(500).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  endLat: coord,
  endLng: coord,
});
const patrolView = (p: Prisma.PatrolRecordGetPayload<object>, names: Map<string, string>, routes: Map<string, string>) => ({
  id: p.id,
  routeId: p.routeId,
  route: routes.get(p.routeId) ?? '',
  userId: p.userId,
  person: names.get(p.userId) ?? '',
  startedAt: p.startedAt,
  endedAt: p.endedAt,
  conditions: p.conditions,
  actions: p.actions,
  snowCm: p.snowCm === null ? null : Number(p.snowCm),
  airTempC: p.airTempC === null ? null : Number(p.airTempC),
  roadTempC: p.roadTempC === null ? null : Number(p.roadTempC),
  materialTonnes: p.materialTonnes === null ? null : Number(p.materialTonnes),
  vehicle: p.vehicle,
  notes: p.notes,
});

winterRouter.post(
  '/patrols',
  requirePermission('winter.patrol'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ routeId: uuid, vehicle: z.string().trim().max(40).nullable().optional(), startLat: coord, startLng: coord }).parse(req.body);
    const p = await withTenant(a.tenantId, async (tx) => {
      const route = await tx.patrolRoute.findUnique({ where: { id: body.routeId } });
      if (!route || !route.active) throw notFound('Route');
      if (await tx.patrolRecord.findFirst({ where: { userId: a.userId, endedAt: null } })) throw conflict('PATROL_OPEN', 'Finish your current patrol first.');
      return tx.patrolRecord.create({ data: { tenantId: a.tenantId, routeId: route.id, userId: a.userId, vehicle: body.vehicle ?? null, startLat: body.startLat ?? null, startLng: body.startLng ?? null, conditions: [], actions: [] } });
    });
    res.status(201).json({ id: p.id });
  }),
);

winterRouter.post(
  '/patrols/:id/finish',
  requirePermission('winter.patrol'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = finishBody.parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const p = await tx.patrolRecord.findFirst({ where: { id: uuid.parse(req.params.id), userId: a.userId } });
      if (!p) throw notFound('Patrol');
      if (p.endedAt) throw conflict('PATROL_DONE', 'This patrol is already finished.');
      await tx.patrolRecord.update({ where: { id: p.id }, data: { ...body, endedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'patrol.record', entity: 'PatrolRecord', entityId: p.id, after: body });
    });
    res.json({ ok: true });
  }),
);

winterRouter.get(
  '/me/patrols',
  requirePermission('winter.patrol'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const [list, routes] = await Promise.all([
        tx.patrolRecord.findMany({ where: { userId: a.userId }, orderBy: { startedAt: 'desc' }, take: 20 }),
        tx.patrolRoute.findMany({ select: { id: true, name: true } }),
      ]);
      return list.map((p) => patrolView(p, new Map(), new Map(routes.map((r) => [r.id, r.name]))));
    });
    res.json(out);
  }),
);

const recordsQuery = z.object({ from: z.coerce.date(), to: z.coerce.date(), routeId: uuid.optional() });
async function records(tenantId: string, q: z.infer<typeof recordsQuery>) {
  return withTenant(tenantId, async (tx) => {
    const list = await tx.patrolRecord.findMany({ where: { startedAt: { gte: q.from, lt: q.to }, ...(q.routeId ? { routeId: q.routeId } : {}) }, orderBy: { startedAt: 'asc' }, take: 5000 });
    const [people, routes] = await Promise.all([
      tx.user.findMany({ where: { id: { in: [...new Set(list.map((p) => p.userId))] } }, select: { id: true, firstName: true, lastName: true } }),
      tx.patrolRoute.findMany({ select: { id: true, name: true } }),
    ]);
    const names = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
    return list.map((p) => patrolView(p, names, new Map(routes.map((r) => [r.id, r.name]))));
  });
}

winterRouter.get(
  '/patrols',
  requirePermission('winter.records'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await records(a.tenantId, recordsQuery.parse(req.query)));
  }),
);

/** Evidence for claims and minimum maintenance standards: one row per patrol. */
winterRouter.get(
  '/patrols/export',
  requirePermission('winter.records'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = recordsQuery.parse(req.query);
    const rows = await records(a.tenantId, q);
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' ') : v instanceof Date ? v.toISOString() : String(v);
      // Neutralise spreadsheet formulas, then quote.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const head = ['route', 'person', 'started_at', 'ended_at', 'conditions', 'actions', 'snow_cm', 'air_temp_c', 'road_temp_c', 'material_tonnes', 'vehicle', 'notes'];
    const lines = [head.join(','), ...rows.map((r) => [r.route, r.person, r.startedAt, r.endedAt, r.conditions, r.actions, r.snowCm, r.airTempC, r.roadTempC, r.materialTonnes, r.vehicle, r.notes].map(cell).join(','))];
    await withTenant(a.tenantId, (tx) => audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'patrol.export', entity: 'PatrolRecord', entityId: a.tenantId, after: { from: q.from, to: q.to, rows: rows.length } }));
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="patrols-${q.from.toISOString().slice(0, 10)}-${q.to.toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  }),
);
