/**
 * Single sign-on counts as the second factor for the passkey-mandatory roles (HR, payroll, managers,
 * city admins: anyone holding a manager- or admin-level permission) only with the identity
 * provider's proof of a phishing-resistant method (ASVS 6.8.4; owner decision 1, 2026-11-17).
 * Otherwise the session must confirm with an FH passkey before anything else, whatever the city's
 * own second-factor settings, and a code by email or text doesn't do. Other staff keep today's rule:
 * any `mfa` amr, or the city's "our provider always requires MFA" switch.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword, signAccessToken, verifyAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'ssostrength';
const CLIENT = 'fh-strength-client';
let t: Awaited<ReturnType<typeof seedTenant>>;
let idp: Server;
let issuer = '';
let nextClaims: Record<string, unknown> = {};
let signingKey: CryptoKey;
let setup = '';
const people = { guard: '', hr: '', sup: '', mgr: '' };
const now = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  resetLimits();
  const kp = await generateKeyPair('RS256');
  signingKey = kp.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/.well-known/openid-configuration') return res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }));
    if (url.pathname === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
    if (url.pathname === '/token') {
      for await (const _ of req) void _;
      const id_token = await new SignJWT({ ...nextClaims }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience(CLIENT).setSubject(String(nextClaims.sub)).setIssuedAt().setExpirationTime('5m').sign(signingKey);
      return res.end(JSON.stringify({ id_token, access_token: 'x', token_type: 'Bearer' }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;

  t = await seedTenant(SUB, 1);
  people.guard = t.users[0]!.id;
  const pw = await hashPassword('a long password 12');
  people.hr = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'R', email: `hr@${SUB}.test`, passwordHash: pw } })).id;
  people.sup = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sam', lastName: 'S', email: `sup@${SUB}.test` } })).id;
  // A manager through a custom role: manager-level permissions, none of them admin-level.
  people.mgr = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'FULL_TIME', firstName: 'Max', lastName: 'M', email: `mgr@${SUB}.test` } })).id;
  const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Case manager', permissions: ['discipline.read', 'reliability.read', 'incidents.read'] } });
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: people.mgr, customRoleId: role.id } });
  setup = await signAccessToken({ sub: people.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  const r = await request(server).put('/api/sso').set('x-tenant-subdomain', SUB).auth(setup, { type: 'bearer' }).send({ protocol: 'OIDC', enabled: true, enforced: false, idpMfa: false, label: 'Entra', domains: [`${SUB}.test`], oidcIssuer: issuer, oidcClientId: CLIENT, oidcSecret: 'secret' });
  expect(r.status).toBe(200);
});
afterAll(async () => {
  idp?.close();
  await appDb.$disconnect();
  await owner.$disconnect();
});

const emailOf = { guard: `guard0@${SUB}.test`, hr: `hr@${SUB}.test`, sup: `sup@${SUB}.test`, mgr: `mgr@${SUB}.test` };
type Who = keyof typeof people;
const anon = (p: string, cookie = '') => request(server).get(p).set('x-tenant-subdomain', SUB).set('Cookie', cookie);
const as = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

/** Signs `who` in through the provider with these extra ID-token claims; returns the session. */
async function signIn(who: Who, claims: Record<string, unknown>) {
  const start = await anon('/api/auth/sso/start');
  const to = new URL(start.headers.location!);
  nextClaims = { nonce: to.searchParams.get('nonce'), sub: `oid-${who}`, email: emailOf[who], ...claims };
  const cookie = String(([] as string[]).concat(start.headers['set-cookie'] ?? []).find((c) => c.startsWith('fc_sso='))).split(';')[0]!;
  const back = await anon(`/api/auth/sso/oidc/callback?code=c&state=${to.searchParams.get('state')}`, cookie);
  const code = new URL(back.headers.location!).searchParams.get('code');
  expect(code, String(back.headers.location)).toBeTruthy();
  const x = await request(server).post('/api/auth/sso/exchange').set('x-tenant-subdomain', SUB).send({ code });
  expect(x.status).toBe(200);
  const refresh = String(([] as string[]).concat(x.headers['set-cookie'] ?? []).find((c) => c.startsWith('fc_refresh='))).split(';')[0]!;
  return { token: x.body.accessToken as string, claims: await verifyAccessToken(x.body.accessToken), refresh };
}
const setIdpMfa = (idpMfa: boolean) => request(server).put('/api/sso').set('x-tenant-subdomain', SUB).auth(setup, { type: 'bearer' }).send({ protocol: 'OIDC', enabled: true, enforced: false, idpMfa, label: 'Entra', domains: [`${SUB}.test`], oidcIssuer: issuer, oidcClientId: CLIENT });
/** Answers 403 MFA_REQUIRED: the session has to confirm before anything else. */
const blocked = async (token: string) => (await as(token).get('/api/departments')).body.code === 'MFA_REQUIRED';

describe('other staff keep today’s rule', () => {
  it('a lifeguard whose provider says mfa gets a second-factor session; without it, a normal one', async () => {
    const strong = await signIn('guard', { amr: ['pwd', 'mfa'] });
    expect(strong.claims.mfa).toBe(true);
    expect(strong.claims.pkr).toBeUndefined();
    const plain = await signIn('guard', { amr: ['pwd'] });
    expect(plain.claims.mfa).toBe(false);
    expect(plain.claims.pkr).toBeUndefined();
    expect((await as(plain.token).get('/api/me')).status).toBe(200);
  });

  it('a lifeguard counts the city’s "always requires MFA" switch', async () => {
    expect((await setIdpMfa(true)).status).toBe(200);
    try {
      expect((await signIn('guard', { amr: ['pwd'] })).claims.mfa).toBe(true);
    } finally {
      await setIdpMfa(false);
    }
  });
});

describe('passkey-mandatory roles need phishing-resistant proof', () => {
  it('an HR admin with amr hwk (hardware key) and a fresh auth_time gets a second-factor session', async () => {
    const s = await signIn('hr', { amr: ['hwk', 'mfa'], auth_time: now() - 60 });
    expect(s.claims.mfa).toBe(true);
    expect(await blocked(s.token)).toBe(false);
  });

  it('an HR admin with amr fido or acr phrh, fresh, also counts', async () => {
    expect((await signIn('hr', { amr: ['fido', 'mfa'], auth_time: now() })).claims.mfa).toBe(true);
    expect((await signIn('hr', { amr: ['pwd'], acr: 'phrh', auth_time: now() })).claims.mfa).toBe(true);
  });

  it('an HR admin whose provider says only mfa (an SMS or OTP factor) gets no second factor and must confirm with a passkey', async () => {
    const s = await signIn('hr', { amr: ['pwd', 'mfa'], auth_time: now() });
    expect(s.claims.mfa).toBe(false);
    expect(s.claims.pkr).toBe(true);
    // Blocked although the city requires no second factor for HR (Tenant.mfaRoles is empty).
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).mfaRoles).toEqual([]);
    expect(await blocked(s.token)).toBe(true);
    // The way out is a passkey: codes aren't offered and can't be sent or checked.
    expect((await as(s.token).get('/api/auth/mfa/options')).body).toEqual({ codes: false, channels: [] });
    expect((await as(s.token).post('/api/auth/mfa/code', { channel: 'email' })).body.code).toBe('PASSKEY_REQUIRED');
    expect((await as(s.token).post('/api/auth/mfa/code/verify', { code: '123456' })).body.code).toBe('PASSKEY_REQUIRED');
    expect((await as(s.token).get('/api/me')).status).toBe(200);
  });

  it('the city’s "always requires MFA" switch doesn’t count for HR', async () => {
    expect((await setIdpMfa(true)).status).toBe(200);
    try {
      const s = await signIn('hr', { amr: ['pwd'] });
      expect(s.claims.mfa).toBe(false);
      expect(await blocked(s.token)).toBe(true);
    } finally {
      await setIdpMfa(false);
    }
  });

  it('for admin-level powers the proof must be fresh: auth_time over 15 minutes old, or missing, doesn’t count', async () => {
    expect((await signIn('hr', { amr: ['hwk'], auth_time: now() - 30 * 60 })).claims.mfa).toBe(false);
    expect((await signIn('hr', { amr: ['hwk'] })).claims.mfa).toBe(false);
  });

  it('an aquatic supervisor (manager, with admin-level documents.manage) needs the proof, fresh', async () => {
    expect((await signIn('sup', { amr: ['swk'], auth_time: now() })).claims.mfa).toBe(true);
    expect((await signIn('sup', { amr: ['swk'], auth_time: now() - 30 * 60 })).claims.mfa).toBe(false);
    const weak = await signIn('sup', { amr: ['pwd', 'mfa'], auth_time: now() });
    expect(weak.claims.mfa).toBe(false);
    expect(await blocked(weak.token)).toBe(true);
  });

  it('a manager through a custom role, without admin-level powers, needs the proof but not the 15-minute freshness', async () => {
    expect((await signIn('mgr', { amr: ['hwk'] })).claims.mfa).toBe(true);
    const weak = await signIn('mgr', { amr: ['pwd', 'mfa'] });
    expect(weak.claims.mfa).toBe(false);
    expect(weak.claims.pkr).toBe(true);
    expect((await as(weak.token).get('/api/me')).status).toBe(200);
    expect((await as(weak.token).get('/api/auth/mfa/options')).body).toEqual({ codes: false, channels: [] });
  });

  it('the passkey requirement survives refreshing the session and a password step-up', async () => {
    const s = await signIn('hr', { amr: ['pwd', 'mfa'] });
    const r = await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', SUB).set('Cookie', s.refresh);
    expect(r.status).toBe(200);
    const refreshed = await verifyAccessToken(r.body.accessToken);
    expect(refreshed.pkr).toBe(true);
    expect(refreshed.mfa).toBe(false);
    expect(await blocked(r.body.accessToken)).toBe(true);
    const up = await as(r.body.accessToken).post('/api/auth/step-up', { password: 'a long password 12' }).set('Cookie', s.refresh);
    expect(up.status).toBe(200);
    expect((await verifyAccessToken(up.body.accessToken)).pkr).toBe(true);
    expect(await blocked(up.body.accessToken)).toBe(true);
  });

  it('the audit log records whether the provider’s proof was accepted', async () => {
    await signIn('hr', { amr: ['pwd', 'mfa'] });
    const row = await owner.auditLog.findFirstOrThrow({ where: { tenantId: t.tenant.id, action: 'auth.sso', actorId: people.hr }, orderBy: { at: 'desc' } });
    expect(row.after).toMatchObject({ mfa: false, passkeyRequired: true, phishingResistant: false });
  });
});
