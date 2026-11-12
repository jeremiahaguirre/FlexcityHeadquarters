/**
 * Passkeys (WebAuthn): Windows Hello, Face ID / Touch ID, Android fingerprint
 * or face unlock, and security keys all speak the same protocol. The device
 * keeps the private key and only unlocks it after the person's fingerprint,
 * face or PIN; the server stores the public key.
 *
 * Passkeys are bound to the exact web address (an organization's subdomain, or
 * the Dev console), so one city's passkey can't be used anywhere else.
 */
import {
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { appUrl } from '../../auth/authTokens.js';
import { config } from '../../config.js';
import { db } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';

export type ChallengePurpose = 'register' | 'login' | 'step-up' | 'platform-register' | 'platform-login' | 'platform-mfa';
const CHALLENGE_MS = 5 * 60_000;

export interface RelyingParty { rpID: string; origin: string; name: string }

export function tenantRp(subdomain: string, name: string): RelyingParty {
  const origin = appUrl(subdomain, '');
  return { origin, rpID: new URL(origin).hostname, name: `${name} · FlexcityHeadquarters` };
}

export function platformRp(): RelyingParty {
  const origin = config().PUBLIC_APP_URL.replace('{subdomain}.', '');
  return { origin, rpID: new URL(origin).hostname, name: 'FlexcityHeadquarters Dev console' };
}

async function saveChallenge(challenge: string, purpose: ChallengePurpose, ids: { tenantId?: string; userId?: string; adminId?: string }) {
  const c = await db().webAuthnChallenge.create({ data: { challenge, purpose, ...ids, expiresAt: new Date(Date.now() + CHALLENGE_MS) } });
  // Housekeeping: old challenges are useless.
  await db().webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 3_600_000) } } });
  return c.id;
}

/** Single use: the first verification attempt consumes it, pass or fail. */
async function takeChallenge(id: string, purpose: ChallengePurpose) {
  const claimed = await db().webAuthnChallenge.updateMany({ where: { id, purpose, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(400, 'PASSKEY_EXPIRED', 'That took too long. Try again.');
  return db().webAuthnChallenge.findUniqueOrThrow({ where: { id } });
}

/**
 * Public key algorithms, kept as SimpleWebAuthn 13 had them by default: offered at registration
 * EdDSA, ES256, RS256; accepted when verifying a registration, every algorithm it could verify.
 * (Version 14 would also offer ML-DSA-44 and accept fewer.)
 */
const OFFERED_ALGORITHMS = [-8, -7, -257];
const ACCEPTED_ALGORITHMS = [-8, -7, -36, -37, -38, -39, -257, -258, -259, -65535];

export interface StoredPasskey { credentialId: string; publicKey: Uint8Array; counter: number; transports: string[] }

export async function registrationOptions(
  rp: RelyingParty,
  who: { id: string; email: string; displayName: string },
  existing: StoredPasskey[],
  purpose: 'register' | 'platform-register',
  ids: { tenantId?: string; userId?: string; adminId?: string },
) {
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.rpID,
    userName: who.email,
    userDisplayName: who.displayName,
    userID: new TextEncoder().encode(who.id),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    // Discoverable, so it can sign in without typing an email; the device must check it's you.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    supportedAlgorithmIDs: OFFERED_ALGORITHMS,
  });
  return { challengeId: await saveChallenge(options.challenge, purpose, ids), options };
}

export async function verifyRegistration(rp: RelyingParty, challengeId: string, purpose: 'register' | 'platform-register', response: RegistrationResponseJSON) {
  const ch = await takeChallenge(challengeId, purpose);
  const v = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true, supportedAlgorithmIDs: ACCEPTED_ALGORITHMS }).catch(() => null);
  if (!v?.verified || !v.registrationInfo) throw new HttpError(400, 'PASSKEY_FAILED', 'That passkey could not be set up.');
  const c = v.registrationInfo.credential;
  return { challenge: ch, credentialId: c.id, publicKey: Buffer.from(c.publicKey), counter: c.counter, transports: c.transports ?? [] };
}

export async function authenticationOptions(rp: RelyingParty, purpose: 'login' | 'step-up' | 'platform-login' | 'platform-mfa', allow: StoredPasskey[], ids: { tenantId?: string; userId?: string; adminId?: string }) {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'required',
    allowCredentials: allow.map((p) => ({ id: p.credentialId, transports: p.transports })),
  });
  return { challengeId: await saveChallenge(options.challenge, purpose, ids), options };
}

/** Checks the signature against the stored public key; returns the new signature counter. */
export async function verifyAuthentication(rp: RelyingParty, challengeId: string, purpose: 'login' | 'step-up' | 'platform-login' | 'platform-mfa', response: AuthenticationResponseJSON, passkey: StoredPasskey | null) {
  const ch = await takeChallenge(challengeId, purpose);
  if (!passkey) throw new HttpError(401, 'PASSKEY_UNKNOWN', 'This passkey isn’t registered here. Sign in with your password.');
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: ch.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    credential: { id: passkey.credentialId, publicKey: passkey.publicKey, counter: passkey.counter, transports: passkey.transports },
  }).catch(() => null);
  if (!v?.verified) throw new HttpError(401, 'PASSKEY_FAILED', 'That passkey didn’t work. Try again or use your password.');
  return { challenge: ch, newCounter: v.authenticationInfo.newCounter };
}

/** "Windows Hello", "iPhone", … from the browser, so people can tell their passkeys apart. */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows Hello';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'Chromebook';
  return 'Passkey';
}
