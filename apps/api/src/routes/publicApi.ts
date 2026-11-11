/**
 * The public, versioned API for a city's own systems: /api/v1 (docs/PUBLIC-API.md). Reads here;
 * writes (opt-in write scopes, Idempotency-Key, If-Match) in routes/publicApiWrite.ts.
 *
 * - Authentication: `Authorization: Bearer fh_live_…`, an organization's API key, never a person's
 *   session. The organization comes from the key (api_key_tenant(), by its hash); every read then
 *   runs inside withTenant() under row-level security, so a key can't reach another city's rows.
 * - Each endpoint needs a scope; a scope whose feature is switched off answers 404 FEATURE_OFF.
 * - Rate limited per key in Postgres (shared by every API instance), counted in metrics by route
 *   pattern only, and every request is in the organization's audit log.
 * - Errors are problem details (application/problem+json) with a stable code, field errors and
 *   the request id; validation is 422.
 * - Stable, documented shapes (snake_case). Never: SINs, bank details, pay rates, dates of birth,
 *   phone numbers, documents, health or accommodation details, notes, discipline, reliability, or
 *   locations of punches. People whose processing is restricted (an erasure request) or who were
 *   anonymized keep their id and status only.
 */
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { databaseAllow } from '../auth/rateLimit.js';
import { captureError } from '../lib/errorReporter.js';
import { audit, db, withTenant } from '../lib/db.js';
import { HttpError, notFound } from '../lib/errors.js';
import { publicApiRequests, routePattern, statusClass } from '../lib/metrics.js';
import { hasModule } from '../services/billing/entitlements.js';
import { hashKey, ipAllowed, looksLikeKey } from '../services/integrations/apiKeys.js';
import { openApiSpec } from '../services/integrations/openapi.js';
import { tenantSettings } from '../services/platform/features.js';
import { h } from './context.js';
import { DEPARTMENT_SELECT, PERSON_SELECT, POSITION_SELECT, TIME_OFF_SELECT, day, department, etagOf, iso, money, need, person, position, read, sendProblem, timeOff, toProblem } from './publicApiShared.js';
import { publicApiWriteRouter } from './publicApiWrite.js';

export const publicApiRouter = Router();

// Counted by route pattern ("/api/v1/people/:id") and status class only.
publicApiRouter.use((req, res, next) => {
  res.once('finish', () => publicApiRequests.inc({ route: routePattern(req), status: statusClass(res.statusCode) }));
  next();
});

publicApiRouter.get('/openapi.json', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(openApiSpec());
});

const unauthenticated = (code: string, message: string) => new HttpError(401, code, message);

/** The key in the Authorization header: its organization, state, address, rate and scopes. */
async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization') ?? '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!key) throw unauthenticated('API_KEY_MISSING', 'Send your API key as `Authorization: Bearer <key>`.');
    if (!looksLikeKey(key)) throw unauthenticated('API_KEY_INVALID', 'That API key isn’t valid.');
    const hash = hashKey(key);
    const rows = await db().$queryRaw<Array<{ id: string | null }>>`SELECT api_key_tenant(${hash}) AS id`;
    const tenantId = rows[0]?.id;
    if (!tenantId) throw unauthenticated('API_KEY_INVALID', 'That API key isn’t valid.');
    const settings = await tenantSettings(tenantId);
    if (settings.disabledAt) throw new HttpError(403, 'ORG_DISABLED', 'This organization’s account is closed.');
    const k = await withTenant(tenantId, (tx) => tx.apiKey.findUnique({ where: { keyHash: hash } }));
    if (!k) throw unauthenticated('API_KEY_INVALID', 'That API key isn’t valid.');
    if (k.revokedAt) throw unauthenticated('API_KEY_REVOKED', 'This API key was revoked.');
    if (k.expiresAt && k.expiresAt <= new Date()) throw unauthenticated('API_KEY_EXPIRED', 'This API key has expired.');
    if (!hasModule(settings.billing, 'publicApi')) throw new HttpError(403, 'PLAN_REQUIRED', 'Your plan doesn’t include the API.', { module: 'publicApi' });
    if (!ipAllowed(k.allowedIps, req.ip)) throw new HttpError(403, 'IP_NOT_ALLOWED', 'This API key can’t be used from this address.');
    res.setHeader('X-RateLimit-Limit', String(k.rateLimitPerMinute));
    if (!(await databaseAllow(`api-key:${k.id}`, k.rateLimitPerMinute, 60_000))) {
      res.setHeader('Retry-After', '60');
      throw new HttpError(429, 'RATE_LIMITED', `This key is limited to ${k.rateLimitPerMinute} requests a minute. Try again shortly.`);
    }
    await withTenant(tenantId, async (tx) => {
      await tx.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date(), lastUsedIp: req.ip ?? null, requestCount: { increment: 1 } } });
      await audit(tx, { tenantId, actorId: null, action: 'api.request', entity: 'ApiKey', entityId: k.id, after: { method: req.method, path: req.originalUrl.split('?')[0], requestId: req.id } });
    });
    req.apiKey = { id: k.id, name: k.name, tenantId, scopes: k.scopes, createdById: k.createdById, rateLimitPerMinute: k.rateLimitPerMinute };
    next();
  } catch (e) {
    next(e);
  }
}

publicApiRouter.use(apiKeyAuth);

// Bodies for writes (after the key is checked, so nobody else's upload is parsed).
publicApiRouter.use(express.json({ limit: '100kb' }));
publicApiRouter.use(publicApiWriteRouter);

/* ---------- Paging: oldest change first, by (updated_at, id) ---------- */

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(200).optional(),
  updated_since: z.string().datetime({ offset: true }).optional(),
});

function decodeCursor(c: string | undefined): { u: Date; id: string } | null {
  if (!c) return null;
  try {
    const [u, id] = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as [string, string];
    const d = new Date(u);
    if (Number.isNaN(d.getTime()) || !z.string().uuid().safeParse(id).success) throw new Error('bad');
    return { u: d, id };
  } catch {
    throw new HttpError(400, 'BAD_CURSOR', 'That cursor isn’t valid. Start again without it.');
  }
}
const encodeCursor = (r: { updatedAt: Date; id: string }) => Buffer.from(JSON.stringify([r.updatedAt.toISOString(), r.id])).toString('base64url');

/** The where, order and take for one page. */
function paging(q: z.infer<typeof listQuery>) {
  const c = decodeCursor(q.cursor);
  const where = {
    AND: [
      q.updated_since ? { updatedAt: { gte: new Date(q.updated_since) } } : {},
      c ? { OR: [{ updatedAt: { gt: c.u } }, { updatedAt: c.u, id: { gt: c.id } }] } : {},
    ],
  };
  return { where, orderBy: [{ updatedAt: 'asc' as const }, { id: 'asc' as const }], take: q.limit + 1 };
}

function pageOf<T extends { updatedAt: Date; id: string }, R>(rows: T[], limit: number, shape: (r: T) => R) {
  const items = rows.slice(0, limit);
  return { data: items.map(shape), next_cursor: rows.length > limit ? encodeCursor(items[items.length - 1]!) : null };
}


/** A date range of at most 93 days, both required (shifts, timesheets). */
const rangeQuery = listQuery.extend({ from: z.string().datetime({ offset: true }).or(z.string().date()), to: z.string().datetime({ offset: true }).or(z.string().date()) });
function range(q: { from: string; to: string }) {
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (!(to > from)) throw new HttpError(400, 'BAD_RANGE', '`to` must be after `from`.');
  if (to.getTime() - from.getTime() > 93 * 86_400_000) throw new HttpError(400, 'BAD_RANGE', 'Ask for at most 93 days at a time.');
  return { from, to };
}
const uuid = z.string().uuid();

/* ---------- People ---------- */

publicApiRouter.get(
  '/people',
  need('people:read'),
  h(async (req, res) => {
    const q = listQuery.extend({ status: z.enum(['active', 'inactive', 'terminated']).optional() }).parse(req.query);
    const p = paging(q);
    const rows = await read(req, (tx) => tx.user.findMany({ where: { ...p.where, ...(q.status ? { status: q.status.toUpperCase() as 'ACTIVE' } : {}) }, orderBy: p.orderBy, take: p.take, select: PERSON_SELECT }));
    res.json(pageOf(rows, q.limit, person));
  }),
);

publicApiRouter.get(
  '/people/:id',
  need('people:read'),
  h(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const u = id.success ? await read(req, (tx) => tx.user.findUnique({ where: { id: id.data }, select: PERSON_SELECT })) : null;
    if (!u) throw notFound('Person');
    res.setHeader('ETag', etagOf(u.updatedAt));
    res.json(person(u));
  }),
);

/* ---------- Departments, positions, facilities ---------- */

publicApiRouter.get(
  '/departments',
  need('departments:read'),
  h(async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await read(req, (tx) => tx.department.findMany({ ...paging(q), select: DEPARTMENT_SELECT }));
    res.json(pageOf(rows, q.limit, department));
  }),
);

publicApiRouter.get(
  '/departments/:id',
  need('departments:read'),
  h(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const d = id.success ? await read(req, (tx) => tx.department.findUnique({ where: { id: id.data }, select: DEPARTMENT_SELECT })) : null;
    if (!d) throw notFound('Department');
    res.setHeader('ETag', etagOf(d.updatedAt));
    res.json(department(d));
  }),
);

publicApiRouter.get(
  '/positions',
  need('positions:read'),
  h(async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await read(req, (tx) => tx.position.findMany({ ...paging(q), select: POSITION_SELECT }));
    res.json(pageOf(rows, q.limit, position));
  }),
);

publicApiRouter.get(
  '/positions/:id',
  need('positions:read'),
  h(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const p = id.success ? await read(req, (tx) => tx.position.findUnique({ where: { id: id.data }, select: POSITION_SELECT })) : null;
    if (!p) throw notFound('Position');
    res.setHeader('ETag', etagOf(p.updatedAt));
    res.json(position(p));
  }),
);

publicApiRouter.get(
  '/facilities',
  need('facilities:read'),
  h(async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await read(req, (tx) => tx.facility.findMany({ ...paging(q), select: { id: true, name: true, province: true, timezone: true, costCenter: true, createdAt: true, updatedAt: true } }));
    res.json(pageOf(rows, q.limit, (f) => ({ id: f.id, name: f.name, province: f.province, timezone: f.timezone, cost_center: f.costCenter, created_at: iso(f.createdAt), updated_at: iso(f.updatedAt) })));
  }),
);

/* ---------- Shifts (published) ---------- */

publicApiRouter.get(
  '/shifts',
  need('schedule:read'),
  h(async (req, res) => {
    const q = rangeQuery.extend({ facility_id: uuid.optional(), person_id: uuid.optional(), include_cancelled: z.enum(['true', 'false']).optional() }).parse(req.query);
    const { from, to } = range(q);
    const p = paging(q);
    const rows = await read(req, (tx) =>
      tx.shift.findMany({
        where: {
          ...p.where,
          status: q.include_cancelled === 'true' ? { in: ['PUBLISHED', 'CANCELLED'] } : 'PUBLISHED',
          startsAt: { lt: to },
          endsAt: { gt: from },
          ...(q.facility_id ? { facilityId: q.facility_id } : {}),
          ...(q.person_id ? { userId: q.person_id } : {}),
        },
        orderBy: p.orderBy,
        take: p.take,
        select: { id: true, facilityId: true, positionId: true, userId: true, startsAt: true, endsAt: true, shiftType: true, customTitle: true, status: true, updatedAt: true },
      }),
    );
    res.json(
      pageOf(rows, q.limit, (s) => ({ id: s.id, facility_id: s.facilityId, position_id: s.positionId, person_id: s.userId, starts_at: iso(s.startsAt), ends_at: iso(s.endsAt), type: s.shiftType.toLowerCase(), title: s.customTitle, status: s.status.toLowerCase(), updated_at: iso(s.updatedAt) })),
    );
  }),
);

/* ---------- Timesheets (approved punches) ---------- */

publicApiRouter.get(
  '/timesheets',
  need('timesheets:read'),
  h(async (req, res) => {
    const q = rangeQuery.extend({ person_id: uuid.optional(), facility_id: uuid.optional() }).parse(req.query);
    const { from, to } = range(q);
    const p = paging(q);
    const rows = await read(req, (tx) =>
      tx.timePunch.findMany({
        where: { ...p.where, status: 'APPROVED', clockOut: { not: null }, clockIn: { gte: from, lt: to }, ...(q.person_id ? { userId: q.person_id } : {}), ...(q.facility_id ? { facilityId: q.facility_id } : {}) },
        orderBy: p.orderBy,
        take: p.take,
        select: { id: true, userId: true, facilityId: true, positionId: true, shiftId: true, clockIn: true, clockOut: true, reviewedAt: true, updatedAt: true },
      }),
    );
    res.json(
      pageOf(rows, q.limit, (t) => ({
        id: t.id,
        person_id: t.userId,
        facility_id: t.facilityId,
        position_id: t.positionId,
        shift_id: t.shiftId,
        clock_in: iso(t.clockIn),
        clock_out: iso(t.clockOut),
        hours: ((t.clockOut!.getTime() - t.clockIn.getTime()) / 3_600_000).toFixed(2),
        approved_at: iso(t.reviewedAt),
        updated_at: iso(t.updatedAt),
      })),
    );
  }),
);

/* ---------- Time off (approved) ---------- */

publicApiRouter.get(
  '/time-off',
  need('timeoff:read'),
  h(async (req, res) => {
    const q = listQuery.extend({ from: z.string().datetime({ offset: true }).or(z.string().date()).optional(), to: z.string().datetime({ offset: true }).or(z.string().date()).optional(), person_id: uuid.optional() }).parse(req.query);
    const p = paging(q);
    const rows = await read(req, (tx) =>
      tx.timeOffRequest.findMany({
        where: { ...p.where, status: 'APPROVED', ...(q.to ? { startsAt: { lt: new Date(q.to) } } : {}), ...(q.from ? { endsAt: { gt: new Date(q.from) } } : {}), ...(q.person_id ? { userId: q.person_id } : {}) },
        orderBy: p.orderBy,
        take: p.take,
        select: TIME_OFF_SELECT,
      }),
    );
    res.json(pageOf(rows, q.limit, timeOff));
  }),
);

/** One request in any status: a system that sent it in follows it here (or with the timeoff.* webhooks). */
publicApiRouter.get(
  '/time-off/:id',
  need('timeoff:read', 'timeoff:write'),
  h(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const r = id.success ? await read(req, (tx) => tx.timeOffRequest.findUnique({ where: { id: id.data }, select: TIME_OFF_SELECT })) : null;
    if (!r) throw notFound('Time-off request');
    res.setHeader('ETag', etagOf(r.updatedAt));
    res.json(timeOff(r));
  }),
);

/* ---------- Pay runs (approved) ---------- */

const APPROVED_RUNS = { status: { in: ['APPROVED', 'PAID'] as Array<'APPROVED' | 'PAID'> } };
const num = (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : null);

publicApiRouter.get(
  '/pay-runs',
  need('payroll:read'),
  h(async (req, res) => {
    const q = listQuery.parse(req.query);
    const p = paging(q);
    const rows = await read(req, (tx) => tx.payRun.findMany({ where: { ...p.where, ...APPROVED_RUNS }, orderBy: p.orderBy, take: p.take }));
    res.json(
      pageOf(rows, q.limit, (r) => {
        const t = (r.totals ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          department_id: r.departmentId,
          kind: r.kind.toLowerCase(),
          status: r.status.toLowerCase(),
          period_start: day(r.periodStart),
          period_end: day(r.periodEnd),
          pay_date: day(r.payDate),
          approved_at: iso(r.approvedAt),
          paid_at: iso(r.paidAt),
          totals: { gross: num(t.gross), deductions: num(t.deductions), net: num(t.net), employer_cpp: num(t.employerCpp), employer_ei: num(t.employerEi), people: typeof t.people === 'number' ? t.people : null },
          updated_at: iso(r.updatedAt),
        };
      }),
    );
  }),
);

publicApiRouter.get(
  '/pay-runs/:id/statements',
  need('payroll:read'),
  h(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().uuid().optional() }).parse(req.query);
    const rows = id.success
      ? await read(req, async (tx) => {
          const run = await tx.payRun.findFirst({ where: { id: id.data, ...APPROVED_RUNS }, select: { id: true } });
          if (!run) return null;
          return tx.payStatement.findMany({ where: { payRunId: run.id, ...(q.cursor ? { id: { gt: q.cursor } } : {}) }, orderBy: { id: 'asc' }, take: q.limit + 1, select: { id: true, userId: true, hours: true, gross: true, net: true } });
        })
      : null;
    if (!rows) throw notFound('Pay run');
    const items = rows.slice(0, q.limit);
    // Gross and net only: never deductions by type, deposit accounts or year-to-date figures.
    res.json({ data: items.map((s) => ({ id: s.id, person_id: s.userId, hours: money(s.hours), gross: money(s.gross), net: money(s.net) })), next_cursor: rows.length > q.limit ? items[items.length - 1]!.id : null });
  }),
);

publicApiRouter.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'There’s no such API endpoint. See /api/v1/openapi.json.')));

/** Every error under /api/v1 as problem details; anything unexpected is reported and answered without detail. */
publicApiRouter.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const p = toProblem(err, req.id);
  if (p && p.status < 500) return sendProblem(res, p);
  captureError(err, { source: 'request', requestId: req.id, method: req.method, route: routePattern(req), tenantId: req.apiKey?.tenantId });
  sendProblem(res, toProblem(new HttpError(500, 'INTERNAL', 'Something went wrong'), req.id)!);
});
