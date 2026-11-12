/**
 * A private calendar feed of a person's own shifts, for Google, Outlook or Apple
 * Calendar. The link carries a long random secret; only its hash is stored, so the
 * link is shown once and can be replaced (which stops the old one) or turned off.
 * The feed holds the person's own shifts only: times, position and facility, no
 * other names. Calendar apps fetch it without signing in.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { allow } from '../auth/rateLimit.js';
import { addressKey } from '../lib/address.js';
import { config } from '../config.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, notFound } from '../lib/errors.js';
import { h } from './context.js';

export const calendarRouter = Router();
export const publicCalendarRouter = Router();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Where the feed lives: the API's public address, else the app's (whose /api goes to the API). */
function feedUrl(subdomain: string, tenantId: string, secret: string) {
  const base = process.env.PUBLIC_API_URL ?? config().PUBLIC_APP_URL.replace('{subdomain}', subdomain);
  return `${base.replace(/\/$/, '')}/api/calendar/${tenantId}/${secret}.ics`;
}

calendarRouter.get(
  '/me/calendar',
  requirePermission('shifts.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const u = await withTenant(a.tenantId, (tx) => tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { calendarTokenHash: true, calendarTokenAt: true } }));
    res.json({ active: !!u.calendarTokenHash, since: u.calendarTokenAt });
  }),
);

/** A new link; any older one stops working. The link is in this answer only. */
calendarRouter.post(
  '/me/calendar',
  requirePermission('shifts.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const secret = randomBytes(24).toString('base64url');
    const sub = await withTenant(a.tenantId, async (tx) => {
      await tx.user.update({ where: { id: a.userId }, data: { calendarTokenHash: sha(secret), calendarTokenAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'calendar.link', entity: 'User', entityId: a.userId });
      return (await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { subdomain: true } })).subdomain;
    });
    res.status(201).json({ url: feedUrl(sub, a.tenantId, secret) });
  }),
);

calendarRouter.delete(
  '/me/calendar',
  h(async (req, res) => {
    const a = authOf(req);
    await withTenant(a.tenantId, async (tx) => {
      await tx.user.update({ where: { id: a.userId }, data: { calendarTokenHash: null, calendarTokenAt: null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'calendar.unlink', entity: 'User', entityId: a.userId });
    });
    res.json({ ok: true });
  }),
);

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Lines longer than 75 octets are folded (RFC 5545 §3.1). */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let n = 75;
    while (Buffer.byteLength(rest.slice(0, n)) > 75) n--;
    out.push(rest.slice(0, n));
    rest = ` ${rest.slice(n)}`;
  }
  out.push(rest);
  return out.join('\r\n');
};

export function icsFor(name: string, shifts: Array<{ id: string; startsAt: Date; endsAt: Date; position: string; facility: string; status: string }>, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FlexcityHeadquarters//Shifts//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const s of shifts) {
    lines.push('BEGIN:VEVENT', `UID:${s.id}@flexcityhq`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(s.startsAt)}`, `DTEND:${stamp(s.endsAt)}`, `SUMMARY:${esc(`${s.position} · ${s.facility}`)}`, `LOCATION:${esc(s.facility)}`, `STATUS:${s.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Links that don't work, per address and organization per hour, before that address gets 429 for them (working links are unaffected). */
export const CALENDAR_MISSES_PER_HOUR = 300;

/** The feed itself: no sign-in, the secret in the link is the key. Unknown links look the same as a missing feed. */
publicCalendarRouter.get(
  '/calendar/:tenantId/:file',
  h(async (req, res) => {
    const tenantId = z.string().uuid().safeParse(req.params.tenantId);
    const m = /^([A-Za-z0-9_-]{20,64})\.ics$/.exec(String(req.params.file));
    if (!tenantId.success || !m) throw notFound('Calendar');
    // Calendar services (Google, Apple, Outlook) fetch many people's feeds from a few shared
    // addresses, so a working link is always served (each feed has its own limit), and only links
    // that don't work are limited, per address and organization, generously: one stale link
    // fetched by a shared service must never block everyone else's feeds. Guessing is hopeless
    // anyway: a link's secret is 24 random bytes (192 bits), stored only as a SHA-256 hash.
    const missKey = `ics-miss:${addressKey(req.ip)}:${tenantId.data}`;
    const out = await withTenant(tenantId.data, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId.data }, select: { disabledAt: true } });
      if (!tenant || tenant.disabledAt) return null;
      const u = await tx.user.findUnique({ where: { calendarTokenHash: sha(m[1]!) }, select: { id: true, status: true, locale: true } });
      if (!u || u.status !== 'ACTIVE') return null;
      if (!(await allow(`ics-feed:${u.id}`, 60, 3_600_000))) return 'busy' as const;
      const now = Date.now();
      const shifts = await tx.shift.findMany({
        where: { userId: u.id, status: { in: ['PUBLISHED', 'CANCELLED'] }, startsAt: { gte: new Date(now - 30 * 86_400_000), lt: new Date(now + 120 * 86_400_000) } },
        orderBy: { startsAt: 'asc' },
        take: 500,
        select: { id: true, startsAt: true, endsAt: true, status: true, position: { select: { name: true, nameFr: true } }, facility: { select: { name: true } } },
      });
      const fr = u.locale.startsWith('fr');
      return icsFor(fr ? 'Mes quarts (FH)' : 'My shifts (FH)', shifts.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, position: (fr && s.position.nameFr) || s.position.name, facility: s.facility.name })));
    });
    if (out === 'busy') throw new HttpError(429, 'RATE_LIMITED', 'Too many requests.');
    if (!out) {
      if (!(await allow(missKey, CALENDAR_MISSES_PER_HOUR, 3_600_000))) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests.');
      throw notFound('Calendar');
    }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.send(out);
  }),
);
