/**
 * Facility kiosks: a shared tablet where staff without the app on a phone punch
 * in and out with their employee number and a PIN they set themselves.
 *
 * A supervisor registers the tablet once (its secret goes into the tablet's
 * address and is shown only then); the tablet then talks to the API with that
 * secret, not a person's session. The tablet is the facility, so its punches
 * count as on site. Wrong PINs are limited per person and per tablet.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import { allow, reached, record } from '../auth/rateLimit.js';
import { hashPassword, verifyPassword } from '../auth/tokens.js';
import { config } from '../config.js';
import type { Tx } from '../lib/db.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { resolveFeatures } from '../services/platform/features.js';
import { clockIn, clockOut } from '../services/timeclock/punches.js';
import { h } from './context.js';

export const kioskAdminRouter = Router();
export const kioskRouter = Router();
kioskAdminRouter.use(['/kiosks', '/me/kiosk-pin'], requireFeature('timeclock'));
const uuid = z.string().uuid();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/* ---------- Set-up (supervisors) ---------- */
kioskAdminRouter.get(
  '/kiosks',
  requirePermission('timeclock.review'),
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) => tx.kiosk.findMany({ where: { revokedAt: null }, orderBy: { createdAt: 'asc' } }));
    const facilities = await withTenant(a.tenantId, (tx) => tx.facility.findMany({ select: { id: true, name: true } }));
    res.json(rows.map((k) => ({ id: k.id, name: k.name, facilityId: k.facilityId, facility: facilities.find((f) => f.id === k.facilityId)?.name ?? '', createdAt: k.createdAt, lastSeenAt: k.lastSeenAt })));
  }),
);

kioskAdminRouter.post(
  '/kiosks',
  requirePermission('timeclock.review'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ facilityId: uuid, name: z.string().trim().min(2).max(60) }).parse(req.body);
    const secret = randomBytes(24).toString('base64url');
    const out = await withTenant(a.tenantId, async (tx) => {
      const f = await tx.facility.findUnique({ where: { id: b.facilityId }, select: { id: true } });
      if (!f) throw notFound('Facility');
      if (a.scope && a.scope.facilityIds.length && !a.scope.facilityIds.includes(b.facilityId)) throw forbidden('This facility isn’t yours to set up.');
      const k = await tx.kiosk.create({ data: { tenantId: a.tenantId, facilityId: b.facilityId, name: b.name, tokenHash: sha(secret), createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'kiosk.create', entity: 'Kiosk', entityId: k.id, after: b });
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { subdomain: true } });
      return { id: k.id, setupUrl: `${config().PUBLIC_APP_URL.replace('{subdomain}', t.subdomain)}/kiosk#${a.tenantId}.${secret}` };
    });
    res.status(201).json(out);
  }),
);

kioskAdminRouter.delete(
  '/kiosks/:id',
  requirePermission('timeclock.review'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const done = await tx.kiosk.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!done.count) throw notFound('Kiosk');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'kiosk.revoke', entity: 'Kiosk', entityId: id });
    });
    res.status(204).end();
  }),
);

/** Each person sets their own kiosk PIN (after confirming it's them). */
kioskAdminRouter.get(
  '/me/kiosk-pin',
  h(async (req, res) => {
    const a = authOf(req);
    const u = await withTenant(a.tenantId, (tx) => tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { kioskPinHash: true, employeeNumber: true } }));
    res.json({ set: !!u.kioskPinHash, employeeNumber: u.employeeNumber });
  }),
);

const WEAK = new Set(['0000', '1111', '1234', '4321', '2222', '9999', '000000', '123456', '111111', '654321', '121212']);
kioskAdminRouter.put(
  '/me/kiosk-pin',
  requirePermission('timeclock.punch'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const { pin } = z.object({ pin: z.string().regex(/^\d{4,6}$/, 'Use 4 to 6 digits.') }).parse(req.body);
    if (WEAK.has(pin) || /^(\d)\1+$/.test(pin)) throw badRequest('Choose a PIN that’s harder to guess.');
    await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { employeeNumber: true } });
      if (!u.employeeNumber) throw new HttpError(409, 'NO_EMPLOYEE_NUMBER', 'Ask HR to add your employee number first: you enter it at the kiosk.');
      await tx.user.update({ where: { id: a.userId }, data: { kioskPinHash: await hashPassword(`kiosk:${pin}`) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'kiosk.pin_set', entity: 'User', entityId: a.userId });
    });
    res.json({ ok: true });
  }),
);

/* ---------- The tablet ---------- */
async function kioskOf(tx: Tx, header: string | undefined) {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,64})$/.exec(header ?? '');
  if (!m) return null;
  const k = await tx.kiosk.findUnique({ where: { tokenHash: sha(m[2]!) } });
  return k && !k.revokedAt && k.tenantId === m[1] ? k : null;
}
const tenantOfHeader = (header: string | undefined) => /^([0-9a-f-]{36})\./.exec(header ?? '')?.[1] ?? null;

/**
 * The tablet's secret lives in an HttpOnly cookie (set by POST /kiosk/pair), so no script on the
 * page can read it. The cookie only counts with the x-fh-kiosk header, which a page on another site
 * can't add to a request without our permission (no cross-site request forgery). The old
 * x-kiosk-token header still works for tablets paired before the cookie, until they pair again.
 */
export const KIOSK_COOKIE = 'fh_kiosk';
type KioskReq = { header: (n: string) => string | undefined; cookies?: Record<string, string> };
const kioskCredential = (req: KioskReq) => req.header('x-kiosk-token') ?? (req.header('x-fh-kiosk') === '1' ? req.cookies?.[KIOSK_COOKIE] : undefined);
const kioskCookieOpts = () => ({ httpOnly: true, secure: config().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/kiosk', maxAge: 400 * 86_400_000 });

async function withKiosk<T>(req: KioskReq, fn: (tx: Tx, k: NonNullable<Awaited<ReturnType<typeof kioskOf>>>) => Promise<T>) {
  const header = kioskCredential(req);
  const tenantId = tenantOfHeader(header);
  if (!tenantId || !uuid.safeParse(tenantId).success) throw new HttpError(401, 'KIOSK_UNKNOWN', 'This tablet isn’t set up. Ask a supervisor.');
  return withTenant(tenantId, async (tx) => {
    const k = await kioskOf(tx, header);
    if (!k) throw new HttpError(401, 'KIOSK_UNKNOWN', 'This tablet isn’t set up. Ask a supervisor.');
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { features: true, disabledAt: true } });
    if (t.disabledAt || !resolveFeatures(t.features).timeclock) throw new HttpError(403, 'KIOSK_OFF', 'Punching is turned off for this organization.');
    return fn(tx, k);
  });
}

/**
 * Pair the tablet: the secret from the setup link (or one an older tablet kept in its storage)
 * becomes an HttpOnly cookie, and the page keeps nothing. Refused for an unknown or revoked secret.
 */
kioskRouter.post(
  '/kiosk/pair',
  h(async (req, res) => {
    if (!(await allow(`kiosk-pair:${req.ip}`, 20, 15 * 60_000))) throw new HttpError(429, 'KIOSK_SLOW_DOWN', 'Too many tries on this tablet. Wait a few minutes.');
    const { token } = z.object({ token: z.string().min(40).max(120) }).parse(req.body);
    await withKiosk({ header: (n) => (n === 'x-kiosk-token' ? token : undefined) }, async () => undefined);
    res.cookie(KIOSK_COOKIE, token, kioskCookieOpts());
    res.json({ ok: true });
  }),
);

/** Forget this tablet (a supervisor setting it up again elsewhere). */
kioskRouter.post(
  '/kiosk/unpair',
  h(async (_req, res) => {
    res.clearCookie(KIOSK_COOKIE, { ...kioskCookieOpts(), maxAge: undefined });
    res.json({ ok: true });
  }),
);

/** What the tablet shows: the facility and organization. */
kioskRouter.get(
  '/kiosk',
  h(async (req, res) => {
    res.json(
      await withKiosk(req, async (tx, k) => {
        await tx.kiosk.update({ where: { id: k.id }, data: { lastSeenAt: new Date() } });
        const [f, t] = await Promise.all([tx.facility.findUniqueOrThrow({ where: { id: k.facilityId }, select: { name: true, timezone: true } }), tx.tenant.findUniqueOrThrow({ where: { id: k.tenantId }, select: { name: true, id: true, defaultLocale: true } })]);
        return { kiosk: k.name, facility: f.name, timezone: f.timezone, organization: t.name, tenantId: t.id, locale: t.defaultLocale };
      }),
    );
  }),
);

/** Punch in, or out if already in. */
kioskRouter.post(
  '/kiosk/punch',
  h(async (req, res) => {
    const b = z.object({ employeeNumber: z.string().trim().min(1).max(30), pin: z.string().regex(/^\d{4,6}$/) }).parse(req.body);
    const header = kioskCredential(req);
    const tenantId = tenantOfHeader(header) ?? 'none';
    // Wrong guesses: a few per person, more per tablet, then a pause.
    if (!(await allow(`kiosk-tablet:${tenantId}:${sha(header ?? '').slice(0, 16)}`, 60, 15 * 60_000))) throw new HttpError(429, 'KIOSK_SLOW_DOWN', 'Too many tries on this tablet. Wait a few minutes.');
    const out = await withKiosk(req, async (tx, k) => {
      const u = await tx.user.findFirst({ where: { employeeNumber: b.employeeNumber, status: 'ACTIVE', anonymizedAt: null }, select: { id: true, firstName: true, kioskPinHash: true, locale: true } });
      const key = `kiosk-pin:${k.tenantId}:${b.employeeNumber}`;
      // Only wrong PINs count toward the lock: someone punching in and out all day is never locked out.
      if (await reached(key, 5, 15 * 60_000)) return { error: new HttpError(429, 'KIOSK_LOCKED', 'Too many wrong PINs. Try again in 15 minutes, or punch on your phone.') };
      if (!u || !u.kioskPinHash || !(await verifyPassword(`kiosk:${b.pin}`, u.kioskPinHash))) {
        await record(key);
        return { error: new HttpError(401, 'KIOSK_WRONG', 'That number and PIN don’t match.') };
      }
      const open = await tx.timePunch.findFirst({ where: { userId: u.id, clockOut: null } });
      if (open) {
        const p = await clockOut(tx, u.id);
        await audit(tx, { tenantId: k.tenantId, actorId: u.id, action: 'kiosk.punch_out', entity: 'TimePunch', entityId: p.id, after: { kioskId: k.id } });
        return { action: 'OUT' as const, name: u.firstName, at: p.clockOut, locale: u.locale };
      }
      // Their shift here around now, else unscheduled in their first position.
      const now = Date.now();
      const shift = await tx.shift.findFirst({ where: { userId: u.id, facilityId: k.facilityId, status: 'PUBLISHED', startsAt: { lte: new Date(now + 2 * 3_600_000) }, endsAt: { gte: new Date(now) } }, orderBy: { startsAt: 'asc' } });
      const positionId = shift?.positionId ?? (await tx.userPosition.findFirst({ where: { userId: u.id }, select: { positionId: true } }))?.positionId;
      if (!positionId) return { error: new HttpError(409, 'KIOSK_NO_POSITION', 'You have no position yet. Ask a supervisor.') };
      const p = await clockIn(tx, { tenantId: k.tenantId, userId: u.id, facilityId: k.facilityId, shiftId: shift?.id, positionId, location: null, ip: null, kioskId: k.id });
      await audit(tx, { tenantId: k.tenantId, actorId: u.id, action: 'kiosk.punch_in', entity: 'TimePunch', entityId: p.id, after: { kioskId: k.id, shiftId: shift?.id ?? null } });
      return { action: 'IN' as const, name: u.firstName, at: p.clockIn, scheduled: !!shift, locale: u.locale };
    });
    if ('error' in out) throw out.error;
    res.json(out);
  }),
);

