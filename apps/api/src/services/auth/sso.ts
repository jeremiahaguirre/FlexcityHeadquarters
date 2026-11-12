/**
 * Single sign-on: Microsoft Entra ID (or any OpenID Connect provider) and SAML 2.0.
 *
 * Safeguards:
 * - SSO only signs in people who already have an account here; it never creates one.
 * - Each sign-in is bound to the browser that started it (a signed, short-lived cookie
 *   holding the OIDC state, nonce and PKCE verifier, or the SAML request id), so a
 *   response that wasn't asked for, including an IdP-initiated SAML post, is refused.
 * - OIDC ID tokens are checked against the provider's published keys, issuer, audience
 *   and nonce; SAML responses must be signed with the certificate HR entered.
 * - After the first sign-in the account is bound to the provider's subject, so a later
 *   directory account that reuses the email can't take it over.
 * - The browser leaves with a two-minute one-time code, traded on the organization's own
 *   site for a session, so no session cookie is set on a cross-site request.
 */
import { createHash, randomBytes } from 'node:crypto';
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from '@node-saml/node-saml';
import type { SsoConnection } from '@prisma/client';
import { createLocalJWKSet, jwtVerify, SignJWT, type JSONWebKeySet } from 'jose';
import { appUrl, issueAuthToken } from '../../auth/authTokens.js';
import { config } from '../../config.js';
import { audit, withTenant, type Tx } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { assertPublicUrl, publicRequest } from '../../lib/egress.js';
import { safeNext } from '../../lib/safeNext.js';
import { keys, tenantKekId } from '../../routes/context.js';
import { open, seal } from '../crypto/envelope.js';

export const STATE_COOKIE = 'fc_sso';
const STATE_TTL_S = 10 * 60;
const b64url = (b: Buffer) => b.toString('base64url');
const secret = () => new TextEncoder().encode(config().JWT_SECRET);

export class SsoError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/* ---------------- Where the provider sends people back ---------------- */

export const spUrls = (sub: string) => ({
  redirectUri: appUrl(sub, '/api/auth/sso/oidc/callback'),
  acsUrl: appUrl(sub, '/api/auth/sso/saml/acs'),
  entityId: appUrl(sub, '/api/auth/sso/saml/metadata'),
  metadataUrl: appUrl(sub, '/api/auth/sso/saml/metadata'),
});

/* ---------------- Sealed OIDC client secret ---------------- */

type Sealed = { c: string; iv: string; t: string; k: string; kek: string };
const secretAad = (tenantId: string) => `sso-oidc:${tenantId}`;
export async function sealClientSecret(tenantId: string, value: string): Promise<Sealed> {
  const s = await seal(keys(), tenantKekId(tenantId), value, secretAad(tenantId));
  return { c: s.ciphertext.toString('base64'), iv: s.iv.toString('base64'), t: s.authTag.toString('base64'), k: s.wrappedDataKey.toString('base64'), kek: s.kekId };
}
async function openClientSecret(tenantId: string, c: Sealed) {
  return open(keys(), { ciphertext: Buffer.from(c.c, 'base64'), iv: Buffer.from(c.iv, 'base64'), authTag: Buffer.from(c.t, 'base64'), wrappedDataKey: Buffer.from(c.k, 'base64'), kekId: c.kek }, secretAad(tenantId));
}

/* ---------------- Browser-bound state ---------------- */

interface State {
  tid: string;
  p: 'OIDC' | 'SAML';
  state?: string;
  nonce?: string;
  verifier?: string;
  rid?: string;
  /** When the SAML request was made (ms). */
  rat?: number;
  /** Where to go after signing in (a path on this site). */
  nx?: string;
}
async function signState(s: State) {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: 'HS256' }).setAudience('fh-sso-state').setIssuedAt().setExpirationTime(`${STATE_TTL_S}s`).sign(secret());
}
export async function readState(raw: string | undefined, tenantId: string, p: State['p']): Promise<State> {
  if (!raw) throw new SsoError('SSO_STATE_MISSING');
  try {
    const { payload } = await jwtVerify(raw, secret(), { audience: 'fh-sso-state' });
    const s = payload as unknown as State;
    if (s.tid !== tenantId || s.p !== p) throw new Error('mismatch');
    return s;
  } catch {
    throw new SsoError('SSO_STATE_INVALID');
  }
}
/** OIDC comes back as a top-level GET (Lax is enough); SAML as a cross-site POST (needs None). */
export const stateCookieOpts = (p: State['p']) => ({
  httpOnly: true,
  secure: p === 'SAML' || config().NODE_ENV === 'production',
  sameSite: p === 'SAML' ? ('none' as const) : ('lax' as const),
  path: '/api/auth/sso',
  maxAge: STATE_TTL_S * 1000,
});

/* ---------------- OpenID Connect ---------------- */

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
const discoveries = new Map<string, { at: number; doc: Discovery }>();
const jwks = new Map<string, { at: number; set: ReturnType<typeof createLocalJWKSet> }>();
const JWKS_TTL_MS = 10 * 60_000;
/** A key the cached set doesn't have (the provider rotated): fetch again, but not more often than this. */
const JWKS_REFRESH_MS = 30_000;

/**
 * Every call to the provider (discovery, token, keys) goes through lib/egress.ts publicRequest: the
 * name is resolved and checked once and the connection goes to that checked address, so a DNS
 * answer that changes between the check and the call (DNS rebinding) can't reach FH's own network.
 */
const providerCall = (url: string, init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } = {}) =>
  publicRequest(url, 'The sign-in service', { ...init, timeoutMs: 8000, maxBytes: 1_000_000 }).catch(() => null);
const json = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
};

async function keySet(uri: string, force = false) {
  const hit = jwks.get(uri);
  if (hit && Date.now() - hit.at < (force ? JWKS_REFRESH_MS : JWKS_TTL_MS)) return hit.set;
  const res = await providerCall(uri);
  if (!res || res.status !== 200) throw new SsoError('SSO_PROVIDER_UNREACHABLE');
  const doc = json(res.body) as JSONWebKeySet;
  if (!doc || !Array.isArray(doc.keys)) throw new SsoError('SSO_PROVIDER_MISCONFIGURED');
  const set = createLocalJWKSet(doc);
  jwks.set(uri, { at: Date.now(), set });
  return set;
}

export async function checkIssuerHost(issuer: string) {
  await assertPublicUrl(issuer, 'The issuer');
}

export function checkIssuerUrl(issuer: string) {
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    throw new HttpError(400, 'BAD_ISSUER', 'The issuer must be a web address.');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && config().NODE_ENV !== 'production')) throw new HttpError(400, 'BAD_ISSUER', 'The issuer must use https.');
  // Entra's shared "common"/"organizations" endpoints accept any company's accounts.
  if (/login\.microsoftonline\.com\/(common|organizations|consumers)\b/i.test(issuer)) {
    throw new HttpError(400, 'BAD_ISSUER', 'Use your own directory’s issuer (with your tenant ID), not “common” or “organizations”.');
  }
}

async function discover(issuer: string): Promise<Discovery> {
  const hit = discoveries.get(issuer);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.doc;
  // Only public servers, no redirects: the issuer and the addresses it lists are typed in by a city.
  const safe = async (u: string) => assertPublicUrl(u, 'The sign-in service').then(() => true, () => false);
  if (!(await safe(issuer))) throw new SsoError('SSO_PROVIDER_MISCONFIGURED');
  const res = await providerCall(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (!res || res.status !== 200) throw new SsoError('SSO_PROVIDER_UNREACHABLE');
  const doc = json(res.body) as Discovery;
  if (doc.issuer !== issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) throw new SsoError('SSO_PROVIDER_MISCONFIGURED');
  if (!(await safe(doc.token_endpoint)) || !(await safe(doc.jwks_uri))) throw new SsoError('SSO_PROVIDER_MISCONFIGURED');
  discoveries.set(issuer, { at: Date.now(), doc });
  return doc;
}

async function oidcStart(c: SsoConnection, sub: string, loginHint?: string, nx?: string) {
  const doc = await discover(c.oidcIssuer!);
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const url = new URL(doc.authorization_endpoint);
  const q = url.searchParams;
  q.set('client_id', c.oidcClientId!);
  q.set('response_type', 'code');
  q.set('redirect_uri', spUrls(sub).redirectUri);
  q.set('scope', 'openid email profile');
  q.set('response_mode', 'query');
  q.set('state', state);
  q.set('nonce', nonce);
  q.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()));
  q.set('code_challenge_method', 'S256');
  if (loginHint) q.set('login_hint', loginHint);
  return { url: url.toString(), cookie: await signState({ tid: c.tenantId, p: 'OIDC', state, nonce, verifier, nx }) };
}

async function oidcFinish(c: SsoConnection, sub: string, st: State, query: Record<string, unknown>) {
  if (typeof query.error === 'string') throw new SsoError('SSO_PROVIDER_REFUSED');
  if (typeof query.code !== 'string' || query.state !== st.state) throw new SsoError('SSO_STATE_INVALID');
  const doc = await discover(c.oidcIssuer!);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: query.code,
    redirect_uri: spUrls(sub).redirectUri,
    client_id: c.oidcClientId!,
    code_verifier: st.verifier!,
    ...(c.oidcSecret ? { client_secret: await openClientSecret(c.tenantId, c.oidcSecret as unknown as Sealed) } : {}),
  });
  const res = await providerCall(doc.token_endpoint, { method: 'POST', body: body.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
  if (!res || res.status < 200 || res.status >= 300) throw new SsoError('SSO_TOKEN_REFUSED');
  const { id_token } = json(res.body) as { id_token?: unknown };
  if (typeof id_token !== 'string') throw new SsoError('SSO_TOKEN_REFUSED');
  const verify = async (force: boolean) => (await jwtVerify(id_token, await keySet(doc.jwks_uri, force), { issuer: c.oidcIssuer!, audience: c.oidcClientId!, clockTolerance: 60 })).payload;
  let claims: Record<string, unknown>;
  try {
    claims = await verify(false).catch(async (e: unknown) => {
      // A key we don't have yet: the provider may have rotated its keys.
      if ((e as { code?: unknown })?.code === 'ERR_JWKS_NO_MATCHING_KEY') return verify(true);
      throw e;
    });
  } catch (e) {
    if (e instanceof SsoError) throw e;
    throw new SsoError('SSO_TOKEN_INVALID');
  }
  if (claims.nonce !== st.nonce) throw new SsoError('SSO_TOKEN_INVALID');
  // An address the provider itself says isn't verified never links to an account here (someone
  // could have typed a colleague's address into their own profile at the provider).
  if (claims.email_verified === false || claims.email_verified === 'false') throw new SsoError('SSO_EMAIL_UNVERIFIED');
  // Entra puts the address in email, preferred_username or upn depending on the directory.
  const email = [claims.email, claims.preferred_username, claims.upn].find((x): x is string => typeof x === 'string' && x.includes('@'));
  const amr = Array.isArray(claims.amr) ? (claims.amr as unknown[]) : [];
  return { email, subject: `${c.oidcIssuer}|${String(claims.sub)}`, mfa: amr.includes('mfa') };
}

/* ---------------- SAML 2.0 ---------------- */

/** The request id lives in the browser's signed cookie, not in this server's memory. */
function cookieCache(rid?: string, at?: number): CacheProvider & { saved?: string; savedAt?: string } {
  const cache: CacheProvider & { saved?: string; savedAt?: string } = {
    async saveAsync(key, value) {
      cache.saved = key;
      cache.savedAt = value;
      return { value, createdAt: Date.now() };
    },
    async getAsync(key) {
      return key && key === rid && at ? new Date(at).toISOString() : null;
    },
    async removeAsync(key) {
      return key;
    },
    async consumeAsync(key) {
      return key && key === rid && at ? new Date(at).toISOString() : null;
    },
  };
  return cache;
}

function samlFor(c: SsoConnection, sub: string, cache: CacheProvider) {
  const u = spUrls(sub);
  return new SAML({
    entryPoint: c.samlEntryPoint!,
    issuer: u.entityId,
    callbackUrl: u.acsUrl,
    idpIssuer: c.samlIdpIssuer ?? undefined,
    idpCert: c.samlCert!,
    audience: u.entityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: STATE_TTL_S * 1000,
    cacheProvider: cache,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    acceptedClockSkewMs: 60_000,
    disableRequestedAuthnContext: true,
  });
}

export function samlMetadata(sub: string) {
  const u = spUrls(sub);
  return new SAML({ issuer: u.entityId, callbackUrl: u.acsUrl, idpCert: 'unused', wantAssertionsSigned: true, identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress' }).generateServiceProviderMetadata(null);
}

async function samlStart(c: SsoConnection, sub: string, nx?: string) {
  const cache = cookieCache();
  const url = await samlFor(c, sub, cache).getAuthorizeUrlAsync('', undefined, {});
  if (!cache.saved) throw new SsoError('SSO_PROVIDER_MISCONFIGURED');
  return { url, cookie: await signState({ tid: c.tenantId, p: 'SAML', rid: cache.saved, rat: cache.savedAt ? new Date(cache.savedAt).getTime() || Date.now() : Date.now(), nx }) };
}

const SAML_EMAIL = ['email', 'mail', 'urn:oid:0.9.2342.19200300.100.1.3', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn'];
const MFA_CLAIM = 'http://schemas.microsoft.com/claims/authnmethodsreferences';

async function samlFinish(c: SsoConnection, sub: string, st: State, body: Record<string, string>) {
  let profile: Profile | null;
  try {
    ({ profile } = await samlFor(c, sub, cookieCache(st.rid, st.rat)).validatePostResponseAsync(body));
  } catch {
    throw new SsoError('SSO_TOKEN_INVALID');
  }
  if (!profile) throw new SsoError('SSO_TOKEN_INVALID');
  const email = [...SAML_EMAIL.map((k) => profile![k]), profile.nameID].find((x): x is string => typeof x === 'string' && x.includes('@'));
  const methods = ([] as unknown[]).concat(profile[MFA_CLAIM] ?? []);
  return { email, subject: `${profile.issuer}|${profile.nameID}`, mfa: methods.some((m) => typeof m === 'string' && /multipleauthn|mfa/i.test(m)) };
}

/* ---------------- Shared ---------------- */

export async function connectionFor(tx: Tx): Promise<SsoConnection | null> {
  return tx.ssoConnection.findFirst();
}

export function ready(c: SsoConnection | null): c is SsoConnection {
  if (!c?.enabled) return false;
  return c.protocol === 'OIDC' ? !!(c.oidcIssuer && c.oidcClientId) : !!(c.samlEntryPoint && c.samlCert);
}

export { safeNext };

export async function startSso(tenantId: string, sub: string, loginHint?: string, next?: string) {
  const c = await withTenant(tenantId, connectionFor);
  if (!ready(c)) throw new SsoError('SSO_OFF');
  const nx = safeNext(next);
  return { protocol: c.protocol, ...(c.protocol === 'OIDC' ? await oidcStart(c, sub, loginHint, nx) : await samlStart(c, sub, nx)) };
}

/** Checks the provider's answer and returns the one-time code for /sso. */
export async function finishSso(tenantId: string, sub: string, p: State['p'], rawState: string | undefined, input: Record<string, unknown>): Promise<{ code: string; next?: string }> {
  const st = await readState(rawState, tenantId, p);
  const c = await withTenant(tenantId, connectionFor);
  if (!ready(c) || c.protocol !== p) throw new SsoError('SSO_OFF');
  const who = p === 'OIDC' ? await oidcFinish(c, sub, st, input) : await samlFinish(c, sub, st, input as Record<string, string>);
  if (!who.email) throw new SsoError('SSO_NO_EMAIL');
  const email = who.email.toLowerCase();
  if (c.domains.length && !c.domains.includes(email.split('@')[1]!)) throw new SsoError('SSO_DOMAIN');
  const out: { code: string } | { refused: string; userId: string | null } = await withTenant(tenantId, async (tx) => {
    const user = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
    if (!user || user.status !== 'ACTIVE' || user.processingRestrictedAt) return { refused: 'SSO_NO_ACCOUNT', userId: user?.id ?? null };
    if (user.ssoSubject && user.ssoSubject !== who.subject) return { refused: 'SSO_SUBJECT_CHANGED', userId: user.id };
    if (!user.ssoSubject) await tx.user.update({ where: { id: user.id }, data: { ssoSubject: who.subject } });
    await tx.ssoConnection.update({ where: { id: c.id }, data: { lastUsedAt: new Date() } });
    const mfa = who.mfa || c.idpMfa;
    await audit(tx, { tenantId, actorId: user.id, action: 'auth.sso', entity: 'SsoConnection', entityId: c.id, after: { protocol: p, mfa } });
    return { code: await issueAuthToken(tx, tenantId, user.id, mfa ? 'SSO_MFA' : 'SSO') };
  });
  if ('code' in out) return { code: out.code, next: safeNext(st.nx) };
  await withTenant(tenantId, (tx) => audit(tx, { tenantId, actorId: out.userId, action: 'auth.sso.refused', entity: 'SsoConnection', entityId: c.id, after: { code: out.refused, protocol: p } }));
  throw new SsoError(out.refused);
}

/** What the sign-in page needs to show the button (nothing secret). */
export async function publicSso(tenantId: string) {
  const c = await withTenant(tenantId, connectionFor);
  return ready(c) ? { protocol: c.protocol, label: c.label, enforced: c.enforced } : null;
}
