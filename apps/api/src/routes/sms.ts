/**
 * A person's mobile number for urgent texts and calls. It's used only after they
 * confirm it with a texted code, and only where the organization has text alerts on.
 */
import { createHmac, randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/middleware.js';
import { config } from '../config.js';
import { allow } from '../auth/rateLimit.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { tenantSettings } from '../services/platform/features.js';
import { maskPhone, toE164 } from '../services/notifications/sms.js';
import { urgentSoon } from '../services/notifications/urgent.js';
import { h } from './context.js';

export const smsRouter = Router();
const CODE_MINUTES = 10;
// Keyed with the server secret: a 6-digit code is too short to keep from someone who could read the hash.
const hashCode = (userId: string, phone: string, code: string) => createHmac('sha256', config().JWT_SECRET).update(`sms:${userId}:${phone}:${code}`).digest('hex');
const phoneBody = z.object({ phone: z.string().trim().min(10).max(25) });

/** Where things stand: masked number, whether it's confirmed, the city's switch. */
smsRouter.get(
  '/me/sms',
  h(async (req, res) => {
    const a = authOf(req);
    const { features } = await tenantSettings(a.tenantId);
    const u = await withTenant(a.tenantId, (tx) => tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { smsPhone: true, smsVerifiedAt: true, smsUrgentShifts: true } }));
    res.json({ enabled: features.textAlerts, phone: u.smsPhone ? maskPhone(u.smsPhone) : null, verified: !!u.smsVerifiedAt, urgentShifts: u.smsUrgentShifts });
  }),
);

/** Texts a 6-digit code to the number. */
smsRouter.post(
  '/me/sms',
  h(async (req, res) => {
    const a = authOf(req);
    const { features } = await tenantSettings(a.tenantId);
    if (!features.textAlerts) throw new HttpError(409, 'TEXT_ALERTS_OFF', 'Your organization hasn’t turned on text alerts.');
    const phone = toE164(phoneBody.parse(req.body).phone);
    if (!phone) throw badRequest('Use a 10-digit Canadian or US mobile number.');
    if (!(await allow(`sms-code:${a.userId}`, 5, 3_600_000))) throw new HttpError(429, 'TOO_MANY_CODES', 'Too many codes sent. Try again in an hour.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await withTenant(a.tenantId, async (tx) => {
      await tx.authToken.updateMany({ where: { userId: a.userId, purpose: 'SMS_VERIFY', usedAt: null }, data: { usedAt: new Date() } });
      await tx.authToken.create({ data: { tenantId: a.tenantId, userId: a.userId, purpose: 'SMS_VERIFY', tokenHash: hashCode(a.userId, phone, code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) } });
      const me = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { locale: true } });
      await tx.smsOutbox.create({ data: { tenantId: a.tenantId, userId: a.userId, toPhone: phone, template: 'sms_verify', params: { code }, locale: me.locale } });
      // Texted as soon as this commits, not at the worker's next round.
      await urgentSoon(tx, a.tenantId);
    });
    res.status(202).json({ phone: maskPhone(phone), expiresInMinutes: CODE_MINUTES });
  }),
);

/** Confirms the number with the texted code. */
smsRouter.post(
  '/me/sms/verify',
  h(async (req, res) => {
    const a = authOf(req);
    const b = phoneBody.extend({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).parse(req.body);
    const phone = toE164(b.phone);
    if (!phone) throw badRequest('Use a 10-digit Canadian or US mobile number.');
    if (!(await allow(`sms-verify:${a.userId}`, 10, 3_600_000))) throw new HttpError(429, 'TOO_MANY_TRIES', 'Too many tries. Ask for a new code in an hour.');
    const ok = await withTenant(a.tenantId, async (tx) => {
      const t = await tx.authToken.findFirst({ where: { userId: a.userId, purpose: 'SMS_VERIFY', usedAt: null, expiresAt: { gt: new Date() }, tokenHash: hashCode(a.userId, phone, b.code) } });
      if (!t) return false;
      await tx.authToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: a.userId }, data: { smsPhone: phone, smsVerifiedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'sms.verified', entity: 'User', entityId: a.userId, after: { phone: maskPhone(phone) } });
      return true;
    });
    if (!ok) throw new HttpError(400, 'WRONG_CODE', 'That code doesn’t match, or it expired. Ask for a new one.');
    res.json({ phone: maskPhone(phone), verified: true });
  }),
);

smsRouter.patch(
  '/me/sms',
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ urgentShifts: z.boolean() }).parse(req.body);
    await withTenant(a.tenantId, (tx) => tx.user.update({ where: { id: a.userId }, data: { smsUrgentShifts: b.urgentShifts } }));
    res.json(b);
  }),
);

/** Stop all texts and calls. */
smsRouter.delete(
  '/me/sms',
  h(async (req, res) => {
    const a = authOf(req);
    await withTenant(a.tenantId, async (tx) => {
      await tx.user.update({ where: { id: a.userId }, data: { smsPhone: null, smsVerifiedAt: null, smsUrgentShifts: false } });
      await tx.smsOutbox.deleteMany({ where: { userId: a.userId, sentAt: null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'sms.removed', entity: 'User', entityId: a.userId });
    });
    res.json({ ok: true });
  }),
);
