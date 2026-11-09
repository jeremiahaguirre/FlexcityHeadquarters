import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { Router } from 'express';
import { z } from 'zod';
import { PLATFORM_COOKIE, platformCookieOpts, platformOf, requirePlatform, startPlatformSession } from '../../auth/platform.js';
import { allow } from '../../auth/rateLimit.js';
import { db } from '../../lib/db.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { authenticationOptions, deviceName, platformRp, registrationOptions, verifyAuthentication, verifyRegistration } from '../../services/auth/passkeys.js';
import { h } from '../context.js';

const uuid = z.string().uuid();
const credential = z.record(z.unknown()).refine((v) => JSON.stringify(v).length < 20_000, 'Too large');
const RECENT_MS = 10 * 60_000;

export const platformPasskeyRouter = Router();

platformPasskeyRouter.post(
  '/auth/passkey/options',
  h(async (req, res) => {
    if (!await allow(`platform-passkey:${req.ip}`, 30, 10 * 60_000)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes.');
    res.json(await authenticationOptions(platformRp(), 'platform-login', [], {}));
  }),
);

platformPasskeyRouter.post(
  '/auth/passkey',
  h(async (req, res) => {
    const body = z.object({ challengeId: uuid, response: credential }).parse(req.body);
    const response = body.response as unknown as AuthenticationResponseJSON;
    const passkey = await db().platformPasskey.findUnique({ where: { credentialId: String(response.id ?? '') } });
    const { newCounter } = await verifyAuthentication(platformRp(), body.challengeId, 'platform-login', response, passkey);
    const admin = await db().platformAdmin.findUniqueOrThrow({ where: { id: passkey!.adminId } });
    if (admin.disabledAt) throw new HttpError(401, 'INVALID_CREDENTIALS', 'This account can’t sign in.');
    await db().platformPasskey.update({ where: { id: passkey!.id }, data: { counter: newCounter, lastUsedAt: new Date() } });
    await db().platformAdmin.update({ where: { id: admin.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    res.cookie(PLATFORM_COOKIE, await startPlatformSession(admin.id), platformCookieOpts());
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
  }),
);

/** Adding or removing a passkey needs a sign-in from the last 10 minutes. */
function recent(req: Parameters<typeof platformOf>[0]) {
  if (Date.now() - platformOf(req).signedInAt.getTime() > RECENT_MS) throw new HttpError(401, 'STEP_UP_REQUIRED', 'Sign in again to change your passkeys.');
}

platformPasskeyRouter.get(
  '/passkeys',
  requirePlatform,
  h(async (req, res) => {
    const list = await db().platformPasskey.findMany({ where: { adminId: platformOf(req).adminId }, orderBy: { createdAt: 'asc' } });
    res.json(list.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })));
  }),
);

platformPasskeyRouter.post(
  '/passkeys/options',
  requirePlatform,
  h(async (req, res) => {
    recent(req);
    const p = platformOf(req);
    const mine = await db().platformPasskey.findMany({ where: { adminId: p.adminId } });
    res.json(await registrationOptions(platformRp(), { id: p.adminId, email: p.email, displayName: p.name }, mine, 'platform-register', { adminId: p.adminId }));
  }),
);

platformPasskeyRouter.post(
  '/passkeys',
  requirePlatform,
  h(async (req, res) => {
    recent(req);
    const p = platformOf(req);
    const body = z.object({ challengeId: uuid, response: credential, name: z.string().trim().min(1).max(60).optional() }).parse(req.body);
    const r = await verifyRegistration(platformRp(), body.challengeId, 'platform-register', body.response as unknown as RegistrationResponseJSON);
    if (r.challenge.adminId !== p.adminId) throw new HttpError(400, 'PASSKEY_FAILED', 'That passkey could not be set up.');
    const created = await db().platformPasskey.create({
      data: { adminId: p.adminId, credentialId: r.credentialId, publicKey: r.publicKey, counter: r.counter, transports: r.transports, name: body.name ?? deviceName(req.header('user-agent')) },
    });
    await db().platformAudit.create({ data: { adminId: p.adminId, action: 'passkey.add', detail: { name: created.name } } });
    res.status(201).json({ id: created.id, name: created.name });
  }),
);

platformPasskeyRouter.delete(
  '/passkeys/:id',
  requirePlatform,
  h(async (req, res) => {
    recent(req);
    const p = platformOf(req);
    const gone = await db().platformPasskey.deleteMany({ where: { id: uuid.parse(req.params.id), adminId: p.adminId } });
    if (!gone.count) throw notFound('Passkey');
    await db().platformAudit.create({ data: { adminId: p.adminId, action: 'passkey.remove' } });
    res.status(204).end();
  }),
);
