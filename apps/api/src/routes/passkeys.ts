/**
 * Passkey sign-in, setup and the "confirm it's you" second step for
 * organization users. See services/auth/passkeys.ts.
 */
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth, requireRecentAuth } from '../auth/middleware.js';
import { epochSeconds, issueRefreshToken, markReauthenticated, signAccessToken, verifyPassword } from '../auth/tokens.js';
import type { AuthContext } from '../auth/middleware.js';
import { allow } from '../auth/rateLimit.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, notFound } from '../lib/errors.js';
import { authenticationOptions, deviceName, registrationOptions, tenantRp, verifyAuthentication, verifyRegistration } from '../services/auth/passkeys.js';
import { COOKIE, cookieOpts } from './auth.js';
import { h, lookupTenant, subdomainOf } from './context.js';

const uuid = z.string().uuid();
// Shapes are checked by the WebAuthn library; here we only bound their size.
const credential = z.record(z.unknown()).refine((v) => JSON.stringify(v).length < 20_000, 'Too large');

async function rpFor(req: Parameters<typeof subdomainOf>[0]) {
  const sub = subdomainOf(req);
  const t = sub ? await lookupTenant(sub) : null;
  if (!sub || !t) throw notFound('Organization');
  return tenantRp(sub, t.name);
}

const stored = (p: { credentialId: string; publicKey: Uint8Array; counter: number; transports: string[] }) => p;

// ------------------------------------------------------------ Sign in (public)
export const passkeyAuthRouter = Router();

passkeyAuthRouter.post(
  '/auth/passkey/options',
  h(async (req, res) => {
    if (!await allow(`passkey:${req.ip}:${req.tenantId}`, 30, 10 * 60_000)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes.');
    // Discoverable credentials: the device offers this organization's passkeys itself.
    res.json(await authenticationOptions(await rpFor(req), 'login', [], { tenantId: req.tenantId }));
  }),
);

passkeyAuthRouter.post(
  '/auth/passkey',
  h(async (req, res) => {
    const body = z.object({ challengeId: uuid, response: credential }).parse(req.body);
    const response = body.response as unknown as AuthenticationResponseJSON;
    const tenantId = req.tenantId!;
    const rp = await rpFor(req);
    const passkey = await withTenant(tenantId, (tx) => tx.passkey.findUnique({ where: { credentialId: String(response.id ?? '') } }));
    const { newCounter } = await verifyAuthentication(rp, body.challengeId, 'login', response, passkey ? stored(passkey) : null);
    const out = await withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: passkey!.userId } });
      if (user.status !== 'ACTIVE' || user.processingRestrictedAt || user.anonymizedAt) throw new HttpError(401, 'INVALID_CREDENTIALS', 'This account can’t sign in.');
      await tx.passkey.update({ where: { id: passkey!.id }, data: { counter: newCounter, lastUsedAt: new Date() } });
      if (user.failedLoginCount || user.lockedUntil) await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
      // A passkey is something you have, unlocked by something you are or know: both factors.
      return { user, refresh: await issueRefreshToken(tx, tenantId, user.id, undefined, new Date(), new Date()) };
    });
    res.cookie(COOKIE, out.refresh, cookieOpts());
    res.json({
      accessToken: await signAccessToken({ sub: out.user.id, tid: tenantId, roles: out.user.roles, aat: epochSeconds(), mfa: true }),
      user: { id: out.user.id, firstName: out.user.firstName, lastName: out.user.lastName, roles: out.user.roles, locale: out.user.locale },
    });
  }),
);

// ------------------------------------------- Confirm it's you (signed in)
passkeyAuthRouter.post(
  '/auth/step-up/options',
  requireAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const mine = await withTenant(a.tenantId, (tx) => tx.passkey.findMany({ where: { userId: a.userId } }));
    if (!mine.length) throw new HttpError(404, 'NO_PASSKEY', 'No passkey on this account. Use your password.');
    res.json(await authenticationOptions(await rpFor(req), 'step-up', mine.map(stored), { tenantId: a.tenantId, userId: a.userId }));
  }),
);

/** Proves it's still you, with a passkey or your password; the session counts as freshly signed in. */
passkeyAuthRouter.post(
  '/auth/step-up',
  requireAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.union([z.object({ challengeId: uuid, response: credential }), z.object({ password: z.string().min(1) })]).parse(req.body);
    if (!await allow(`stepup:${a.userId}`, 10, 10 * 60_000)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes.');
    if ('password' in body) {
      // A password can't give the second factor it's missing.
      if (a.mfaPending) throw new HttpError(403, 'MFA_REQUIRED', 'Your organization requires a passkey for this account.');
      const user = await withTenant(a.tenantId, (tx) => tx.user.findUniqueOrThrow({ where: { id: a.userId } }));
      if (!user.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) throw new HttpError(401, 'WRONG_PASSWORD', 'That password isn’t right.');
    } else {
      const response = body.response as unknown as AuthenticationResponseJSON;
      const passkey = await withTenant(a.tenantId, (tx) => tx.passkey.findFirst({ where: { credentialId: String(response.id ?? ''), userId: a.userId } }));
      const { newCounter } = await verifyAuthentication(await rpFor(req), body.challengeId, 'step-up', response, passkey ? stored(passkey) : null);
      await withTenant(a.tenantId, (tx) => tx.passkey.update({ where: { id: passkey!.id }, data: { counter: newCounter, lastUsedAt: new Date() } }));
    }
    const usedPasskey = !('password' in body);
    const raw = req.cookies?.[COOKIE] as string | undefined;
    if (raw) await withTenant(a.tenantId, (tx) => markReauthenticated(tx, raw, new Date(), usedPasskey));
    res.json({ accessToken: await signAccessToken({ sub: a.userId, tid: a.tenantId, roles: a.roles, aat: epochSeconds(), mfa: a.mfa || usedPasskey }) });
  }),
);

// ------------------------------------------------ Manage my passkeys
export const myPasskeysRouter = Router();

/**
 * While a required second factor is missing, someone holding only the password
 * may add a first passkey, but not add more or remove any.
 */
function enrolmentOnly(a: AuthContext, existing: number) {
  if (a.mfaPending && existing > 0) throw new HttpError(403, 'MFA_REQUIRED', 'Confirm with your passkey to continue.');
}

myPasskeysRouter.get(
  '/me/passkeys',
  h(async (req, res) => {
    const a = authOf(req);
    const list = await withTenant(a.tenantId, (tx) => tx.passkey.findMany({ where: { userId: a.userId }, orderBy: { createdAt: 'asc' } }));
    res.json(list.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })));
  }),
);

myPasskeysRouter.post(
  '/me/passkeys/options',
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const [user, mine] = await withTenant(a.tenantId, (tx) => Promise.all([tx.user.findUniqueOrThrow({ where: { id: a.userId } }), tx.passkey.findMany({ where: { userId: a.userId } })]));
    enrolmentOnly(a, mine.length);
    if (mine.length >= 10) throw new HttpError(400, 'TOO_MANY_PASSKEYS', 'Remove a passkey before adding another.');
    res.json(await registrationOptions(await rpFor(req), { id: user.id, email: user.email, displayName: `${user.firstName} ${user.lastName}` }, mine.map(stored), 'register', { tenantId: a.tenantId, userId: a.userId }));
  }),
);

myPasskeysRouter.post(
  '/me/passkeys',
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ challengeId: uuid, response: credential, name: z.string().trim().min(1).max(60).optional() }).parse(req.body);
    const r = await verifyRegistration(await rpFor(req), body.challengeId, 'register', body.response as unknown as RegistrationResponseJSON);
    if (r.challenge.userId !== a.userId) throw new HttpError(400, 'PASSKEY_FAILED', 'That passkey could not be set up.');
    const p = await withTenant(a.tenantId, async (tx) => {
      enrolmentOnly(a, await tx.passkey.count({ where: { userId: a.userId } }));
      const created = await tx.passkey.create({
        data: { tenantId: a.tenantId, userId: a.userId, credentialId: r.credentialId, publicKey: r.publicKey, counter: r.counter, transports: r.transports, name: body.name ?? deviceName(req.header('user-agent')) },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'passkey.add', entity: 'User', entityId: a.userId, after: { name: created.name } });
      return created;
    });
    // Setting up a first passkey with the device's lock counts as the second factor.
    if (a.mfaPending) {
      const raw = req.cookies?.[COOKIE] as string | undefined;
      if (raw) await withTenant(a.tenantId, (tx) => markReauthenticated(tx, raw, new Date(), true));
      const accessToken = await signAccessToken({ sub: a.userId, tid: a.tenantId, roles: a.roles, aat: epochSeconds(), mfa: true });
      return void res.status(201).json({ id: p.id, name: p.name, accessToken });
    }
    res.status(201).json({ id: p.id, name: p.name });
  }),
);

myPasskeysRouter.delete(
  '/me/passkeys/:id',
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    if (a.mfaPending) throw new HttpError(403, 'MFA_REQUIRED', 'Confirm with your passkey to continue.');
    await withTenant(a.tenantId, async (tx) => {
      const gone = await tx.passkey.deleteMany({ where: { id, userId: a.userId } });
      if (!gone.count) throw notFound('Passkey');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'passkey.remove', entity: 'User', entityId: a.userId });
    });
    res.status(204).end();
  }),
);
