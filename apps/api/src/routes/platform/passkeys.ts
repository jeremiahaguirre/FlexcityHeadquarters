import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { Router } from 'express';
import { z } from 'zod';
import { PLATFORM_COOKIE, markPlatformMfa, platformCookieOpts, platformMfaRequired, platformOf, requirePlatform, requirePlatformSession, startPlatformSession } from '../../auth/platform.js';
import { allow } from '../../auth/rateLimit.js';
import { db } from '../../lib/db.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { authenticationOptions, deviceName, platformRp, registrationOptions, verifyAuthentication, verifyRegistration } from '../../services/auth/passkeys.js';
import { h } from '../context.js';

const uuid = z.string().uuid();
const credential = z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length < 20_000, 'Too large');
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
    res.cookie(PLATFORM_COOKIE, await startPlatformSession(admin.id, true), platformCookieOpts());
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
  }),
);

// --------------------------------------- Second factor after a password
platformPasskeyRouter.post(
  '/auth/mfa/options',
  requirePlatformSession,
  h(async (req, res) => {
    const p = platformOf(req);
    const mine = await db().platformPasskey.findMany({ where: { adminId: p.adminId } });
    if (!mine.length) throw new HttpError(404, 'NO_PASSKEY', 'Set up a passkey first.');
    res.json(await authenticationOptions(platformRp(), 'platform-mfa', mine, { adminId: p.adminId }));
  }),
);

platformPasskeyRouter.post(
  '/auth/mfa',
  requirePlatformSession,
  h(async (req, res) => {
    const p = platformOf(req);
    if (!await allow(`platform-mfa:${p.adminId}`, 10, 10 * 60_000)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes.');
    const body = z.object({ challengeId: uuid, response: credential }).parse(req.body);
    const response = body.response as unknown as AuthenticationResponseJSON;
    const passkey = await db().platformPasskey.findFirst({ where: { credentialId: String(response.id ?? ''), adminId: p.adminId } });
    const { challenge, newCounter } = await verifyAuthentication(platformRp(), body.challengeId, 'platform-mfa', response, passkey);
    if (challenge.adminId !== p.adminId) throw new HttpError(401, 'PASSKEY_FAILED', 'That passkey didn’t work.');
    await db().platformPasskey.update({ where: { id: passkey!.id }, data: { counter: newCounter, lastUsedAt: new Date() } });
    await markPlatformMfa(p.sessionId);
    res.json({ mfa: true });
  }),
);

/**
 * Without a second factor yet, a session may add a passkey only when the
 * account has none: someone holding just the password can't add their own.
 */
async function mayEnrol(req: Parameters<typeof platformOf>[0]) {
  const p = platformOf(req);
  if (p.mfa || !platformMfaRequired()) return;
  if (await db().platformPasskey.count({ where: { adminId: p.adminId } })) throw new HttpError(403, 'MFA_REQUIRED', 'Confirm with your passkey to continue.');
}

/** Adding or removing a passkey needs a sign-in from the last 10 minutes. */
function recent(req: Parameters<typeof platformOf>[0]) {
  if (Date.now() - platformOf(req).signedInAt.getTime() > RECENT_MS) throw new HttpError(401, 'STEP_UP_REQUIRED', 'Sign in again to change your passkeys.');
}

platformPasskeyRouter.get(
  '/passkeys',
  requirePlatformSession,
  h(async (req, res) => {
    const list = await db().platformPasskey.findMany({ where: { adminId: platformOf(req).adminId }, orderBy: { createdAt: 'asc' } });
    res.json(list.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })));
  }),
);

platformPasskeyRouter.post(
  '/passkeys/options',
  requirePlatformSession,
  h(async (req, res) => {
    recent(req);
    await mayEnrol(req);
    const p = platformOf(req);
    const mine = await db().platformPasskey.findMany({ where: { adminId: p.adminId } });
    res.json(await registrationOptions(platformRp(), { id: p.adminId, email: p.email, displayName: p.name }, mine, 'platform-register', { adminId: p.adminId }));
  }),
);

platformPasskeyRouter.post(
  '/passkeys',
  requirePlatformSession,
  h(async (req, res) => {
    recent(req);
    await mayEnrol(req);
    const p = platformOf(req);
    const body = z.object({ challengeId: uuid, response: credential, name: z.string().trim().min(1).max(60).optional() }).parse(req.body);
    const r = await verifyRegistration(platformRp(), body.challengeId, 'platform-register', body.response as unknown as RegistrationResponseJSON);
    if (r.challenge.adminId !== p.adminId) throw new HttpError(400, 'PASSKEY_FAILED', 'That passkey could not be set up.');
    const created = await db().platformPasskey.create({
      data: { adminId: p.adminId, credentialId: r.credentialId, publicKey: r.publicKey, counter: r.counter, transports: r.transports, name: body.name ?? deviceName(req.header('user-agent')) },
    });
    await db().platformAudit.create({ data: { adminId: p.adminId, action: 'passkey.add', detail: { name: created.name } } });
    // Setting up the first passkey with the device's lock is the second factor.
    if (!p.mfa) await markPlatformMfa(p.sessionId);
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
