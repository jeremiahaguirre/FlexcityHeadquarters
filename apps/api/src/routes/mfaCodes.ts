/**
 * A one-time code by email or text as the second factor, for someone already signed in with their
 * password whose organization requires a second factor (auth/middleware.ts mfaPending). Passkeys
 * remain the stronger choice; an organization can allow passkeys only (Tenant.mfaCodes).
 * The Dev console keeps passkeys only: nothing here applies to it.
 *
 * Mounted under /api/auth so the refresh cookie (path /api/auth) comes with the verify request:
 * a successful code marks the whole session as having a second factor, through token refreshes.
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../auth/middleware.js';
import { allow } from '../auth/rateLimit.js';
import { epochSeconds, markReauthenticated, signAccessToken } from '../auth/tokens.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { CODE_MINUTES, MAX_ATTEMPTS, RESEND_SECONDS, codeMatches, codeOptions, hashCode, newCode } from '../services/auth/mfaCodes.js';
import { tenantSettings } from '../services/platform/features.js';
import { urgentSoon } from '../services/notifications/urgent.js';
import { COOKIE } from './auth.js';
import { h } from './context.js';

export const mfaCodeRouter = Router();

const MIN = 60_000;
const tooMany = (code: string, message: string) => new HttpError(429, code, message);

async function codesAllowed(tenantId: string): Promise<boolean> {
  const t = await withTenant(tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { mfaCodes: true } }));
  return t.mfaCodes;
}
const codesOff = () => new HttpError(403, 'MFA_CODES_OFF', 'Your organization accepts only passkeys as the second factor.');
/** Only a session that still owes a second factor sends or checks codes: they're not a general-purpose step-up. */
const notNeeded = () => new HttpError(409, 'MFA_NOT_NEEDED', 'This session doesn’t need a second factor.');

async function me(tenantId: string, userId: string) {
  const [u, { features }] = await Promise.all([
    withTenant(tenantId, (tx) => tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, firstName: true, lastName: true, locale: true, smsPhone: true, smsVerifiedAt: true, tenant: { select: { name: true } } } })),
    tenantSettings(tenantId),
  ]);
  return { u, textAlerts: features.textAlerts };
}

/** How the person can get a code: email always, a text when they confirmed a number. Masked destinations. */
mfaCodeRouter.get(
  '/auth/mfa/options',
  requireAuth,
  h(async (req, res) => {
    const a = authOf(req);
    if (!(await codesAllowed(a.tenantId))) return void res.json({ codes: false, channels: [] });
    const { u, textAlerts } = await me(a.tenantId, a.userId);
    res.json({ codes: true, channels: codeOptions(u, textAlerts), expiresInMinutes: CODE_MINUTES, resendAfterSeconds: RESEND_SECONDS });
  }),
);

/** Sends a new 6-digit code, superseding any earlier one. */
mfaCodeRouter.post(
  '/auth/mfa/code',
  requireAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const { channel } = z.object({ channel: z.enum(['email', 'sms']) }).parse(req.body);
    if (!a.mfaPending) throw notNeeded();
    if (!(await codesAllowed(a.tenantId))) throw codesOff();
    const { u, textAlerts } = await me(a.tenantId, a.userId);
    const option = codeOptions(u, textAlerts).find((o) => o.channel === channel);
    // Already password-authenticated, so saying why is no leak, and it tells them what to do instead.
    if (!option) throw new HttpError(409, 'NO_VERIFIED_PHONE', 'There’s no confirmed mobile number on this account. Use email instead.');
    if (!(await allow(`mfa-send:${a.userId}`, 3, 15 * MIN)) || !(await allow(`mfa-send-day:${a.userId}`, 10, 24 * 60 * MIN))) {
      throw tooMany('TOO_MANY_CODES', 'Too many codes sent. Wait a few minutes, or use a passkey.');
    }
    const code = newCode();
    const id = randomUUID();
    const now = new Date();
    await withTenant(a.tenantId, async (tx) => {
      // Earlier codes stop working, and any still waiting to go out are dropped.
      await tx.mfaCode.updateMany({ where: { userId: a.userId, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
      await tx.emailOutbox.deleteMany({ where: { tenantId: a.tenantId, toEmail: u.email, template: 'mfa_code', sentAt: null } });
      await tx.smsOutbox.deleteMany({ where: { userId: a.userId, template: 'mfa_code', sentAt: null } });
      await tx.mfaCode.create({ data: { id, tenantId: a.tenantId, userId: a.userId, channel: channel === 'sms' ? 'SMS' : 'EMAIL', codeHash: hashCode(id, a.userId, code), expiresAt: new Date(now.getTime() + CODE_MINUTES * MIN) } });
      const params = { code, name: `${u.firstName} ${u.lastName}`.trim(), organization: u.tenant.name };
      if (channel === 'sms') {
        await tx.smsOutbox.create({ data: { tenantId: a.tenantId, userId: a.userId, toPhone: u.smsPhone!, template: 'mfa_code', params: { code, organization: u.tenant.name }, locale: u.locale } });
      } else {
        await tx.emailOutbox.create({ data: { tenantId: a.tenantId, toEmail: u.email, template: 'mfa_code', params, locale: u.locale } });
      }
      // Out as soon as this commits, not at the worker's next round.
      await urgentSoon(tx, a.tenantId);
    });
    res.status(202).json({ channel, destination: option.destination, expiresInMinutes: CODE_MINUTES, resendAfterSeconds: RESEND_SECONDS });
  }),
);

type Outcome = { ok: true; channel: string } | { ok: false; code: 'MFA_CODE_EXPIRED' | 'MFA_CODE_LOCKED' } | { ok: false; code: 'MFA_CODE_WRONG'; left: number };

/** Checks the code. Success gives the session its second factor, as a passkey does. */
mfaCodeRouter.post(
  '/auth/mfa/code/verify',
  requireAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).parse(req.body);
    if (!a.mfaPending) throw notNeeded();
    if (!(await codesAllowed(a.tenantId))) throw codesOff();
    if (!(await allow(`mfa-verify-ip:${req.ip}`, 30, 15 * MIN)) || !(await allow(`mfa-verify:${a.userId}`, 10, 15 * MIN))) {
      throw tooMany('TOO_MANY_TRIES', 'Too many tries. Wait 15 minutes, or use a passkey.');
    }
    const now = new Date();
    // Failures are recorded and returned rather than thrown, so the count of wrong tries is kept.
    const out = await withTenant(a.tenantId, async (tx): Promise<Outcome> => {
      const row = await tx.mfaCode.findFirst({ where: { userId: a.userId, usedAt: null }, orderBy: { createdAt: 'desc' } });
      if (!row || row.expiresAt <= now) return { ok: false, code: 'MFA_CODE_EXPIRED' };
      if (row.attempts >= MAX_ATTEMPTS) return { ok: false, code: 'MFA_CODE_LOCKED' };
      if (!codeMatches(row.codeHash, row.id, a.userId, code)) {
        // Conditional, so concurrent wrong tries can't go past the limit.
        await tx.mfaCode.updateMany({ where: { id: row.id, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
        const left = MAX_ATTEMPTS - (row.attempts + 1);
        if (left <= 0) {
          await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'mfa.code.locked', entity: 'User', entityId: a.userId, after: { channel: row.channel } });
          return { ok: false, code: 'MFA_CODE_LOCKED' };
        }
        return { ok: false, code: 'MFA_CODE_WRONG', left };
      }
      // Once only: a second request with the same code finds it used.
      const used = await tx.mfaCode.updateMany({ where: { id: row.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS }, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (!used.count) return { ok: false, code: 'MFA_CODE_EXPIRED' };
      const raw = req.cookies?.[COOKIE] as string | undefined;
      if (raw) await markReauthenticated(tx, raw, now, true);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'mfa.code', entity: 'User', entityId: a.userId, after: { channel: row.channel } });
      return { ok: true, channel: row.channel };
    });
    if (!out.ok) {
      if (out.code === 'MFA_CODE_WRONG') throw new HttpError(400, out.code, 'That code isn’t right.', { attemptsLeft: out.left });
      if (out.code === 'MFA_CODE_LOCKED') throw new HttpError(400, out.code, 'Too many wrong tries for this code. Ask for a new one.');
      throw new HttpError(400, out.code, 'This code has expired or was already used. Ask for a new one.');
    }
    res.json({ accessToken: await signAccessToken({ sub: a.userId, tid: a.tenantId, roles: a.roles, aat: epochSeconds(now), mfa: true }) });
  }),
);
