import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken, verifyAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

// The OIDC client secret is sealed with the city's key.
process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'ssocity';
const ORIGIN = `http://${SUB}.localhost:3000`;
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr = '';
let staffEmail = '';

/* ---------- A tiny OpenID provider ---------- */
let idp: Server;
let issuer = '';
let lastVerifier = '';
let lastChallenge = '';
let nextClaims: Record<string, unknown> = {};
let signingKey: CryptoKey;
let otherKey: CryptoKey;
let useOtherKey = false;
const CLIENT = 'fh-client-id';

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  signingKey = kp.privateKey as CryptoKey;
  otherKey = (await generateKeyPair('RS256')).privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }));
    }
    if (url.pathname === '/jwks') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    if (url.pathname === '/token') {
      let body = '';
      for await (const c of req) body += c;
      const p = new URLSearchParams(body);
      lastVerifier = p.get('code_verifier') ?? '';
      if (p.get('client_secret') !== 'shh-secret' || p.get('code') !== 'good-code') {
        res.statusCode = 400;
        return res.end('{}');
      }
      const id_token = await new SignJWT({ ...nextClaims }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(String(nextClaims.iss ?? issuer)).setAudience(String(nextClaims.aud ?? CLIENT)).setSubject(String(nextClaims.sub ?? 'oid-1')).setIssuedAt().setExpirationTime('5m').sign(useOtherKey ? otherKey : signingKey);
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ id_token, access_token: 'x', token_type: 'Bearer' }));
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;

  t = await seedTenant(SUB, 1);
  staffEmail = t.users[0]!.email;
  await owner.user.update({ where: { id: t.users[0]!.id }, data: { passwordHash: await hashPassword('staff password 1') } });
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'R', email: `hr@${SUB}.test`, passwordHash: await hashPassword('hr password 12') } });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000), mfa: true });
});
afterAll(async () => {
  idp?.close();
  await appDb.$disconnect();
  await owner.$disconnect();
});

const api = () => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send(b),
});
const anon = {
  get: (p: string, cookie?: string) => request(server).get(p).set('x-tenant-subdomain', SUB).set('Cookie', cookie ?? ''),
  post: (p: string, b: object) => request(server).post(p).set('x-tenant-subdomain', SUB).send(b),
};
const stateCookie = (r: request.Response) => String(([] as string[]).concat(r.headers['set-cookie'] ?? []).find((c) => c.startsWith('fc_sso=')) ?? '').split(';')[0]!;

/** Starts a sign-in and comes back from the provider with `claims` in the ID token. */
async function oidcRound(claims: Record<string, unknown>, opts: { state?: string; code?: string; cookie?: string | null } = {}) {
  const start = await anon.get('/api/auth/sso/start');
  expect(start.status).toBe(302);
  const to = new URL(start.headers.location!);
  lastChallenge = to.searchParams.get('code_challenge')!;
  nextClaims = { nonce: to.searchParams.get('nonce'), ...claims };
  const cookie = opts.cookie === null ? '' : opts.cookie ?? stateCookie(start);
  const back = await anon.get(`/api/auth/sso/oidc/callback?code=${opts.code ?? 'good-code'}&state=${opts.state ?? to.searchParams.get('state')}`, cookie);
  expect(back.status).toBe(303);
  return { to, location: new URL(back.headers.location!) };
}

const oidcConfig = { protocol: 'OIDC', enabled: true, enforced: false, idpMfa: false, label: 'Microsoft', domains: [`${SUB}.test`], oidcClientId: CLIENT, oidcSecret: 'shh-secret' };

describe('OpenID Connect (Microsoft Entra ID)', () => {
  it('HR sets it up; the secret is never shown back; shared Entra endpoints are refused', async () => {
    expect((await api().put('/api/sso', { ...oidcConfig, oidcIssuer: 'https://login.microsoftonline.com/common/v2.0' })).body.code).toBe('BAD_ISSUER');
    const r = await api().put('/api/sso', { ...oidcConfig, oidcIssuer: issuer });
    expect(r.status).toBe(200);
    expect(r.body.connection.hasSecret).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('shh-secret');
    expect(r.body.sp.redirectUri).toBe(`${ORIGIN}/api/auth/sso/oidc/callback`);
    const pub = await anon.get('/api/public/tenant');
    expect(pub.body.sso).toEqual({ protocol: 'OIDC', label: 'Microsoft', enforced: false });
  });

  it('signs an existing person in with PKCE, state and nonce, through a one-time code', async () => {
    const { to, location } = await oidcRound({ email: staffEmail.toUpperCase() });
    expect(to.origin).toBe(issuer);
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(createHash('sha256').update(lastVerifier).digest('base64url')).toBe(lastChallenge);
    expect(location.pathname).toBe('/sso');
    const code = location.searchParams.get('code')!;
    const x = await anon.post('/api/auth/sso/exchange', { code });
    expect(x.status).toBe(200);
    expect(String(x.headers['set-cookie'])).toContain('fc_refresh=');
    const claims = await verifyAccessToken(x.body.accessToken);
    expect(claims.sub).toBe(t.users[0]!.id);
    expect(claims.mfa).toBe(false);
    // The code works once.
    expect((await anon.post('/api/auth/sso/exchange', { code })).body.code).toBe('LINK_EXPIRED');
    // And it can't be used to set a password.
    const { location: l2 } = await oidcRound({ email: staffEmail });
    expect((await anon.post('/api/auth/reset', { token: l2.searchParams.get('code'), password: 'new password 123' })).body.code).toBe('LINK_EXPIRED');
  });

  it('returns people to the page they were going to, never to another site', async () => {
    const go = async (next: string) => {
      const start = await anon.get(`/api/auth/sso/start?next=${encodeURIComponent(next)}`);
      const to = new URL(start.headers.location!);
      nextClaims = { nonce: to.searchParams.get('nonce'), email: staffEmail };
      const back = await anon.get(`/api/auth/sso/oidc/callback?code=good-code&state=${to.searchParams.get('state')}`, stateCookie(start));
      return new URL(back.headers.location!).searchParams.get('next');
    };
    expect(await go('/manage/payroll')).toBe('/manage/payroll');
    expect(await go('//evil.example')).toBeNull();
    expect(await go('https://evil.example')).toBeNull();
    expect(await go('/\\evil.example')).toBeNull();
    expect(await go('/\t/evil.example')).toBeNull();
  });

  it('talks to the provider only over the checked, pinned connection (never the global fetch)', async () => {
    const fake = vi.fn(async () => {
      throw new Error('global fetch used');
    });
    vi.stubGlobal('fetch', fake);
    try {
      const { location } = await oidcRound({ email: staffEmail });
      expect(location.searchParams.get('code')).toBeTruthy();
      expect(fake).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the provider’s MFA counts when it says so', async () => {
    const { location } = await oidcRound({ email: staffEmail, amr: ['pwd', 'mfa'] });
    const x = await anon.post('/api/auth/sso/exchange', { code: location.searchParams.get('code') });
    expect((await verifyAccessToken(x.body.accessToken)).mfa).toBe(true);
  });

  it('refuses answers that were not asked for by this browser, or are not genuine', async () => {
    const reason = (l: URL) => (l.pathname === '/login' ? l.searchParams.get('sso') : 'signed-in');
    expect(reason((await oidcRound({ email: staffEmail }, { cookie: null })).location)).toBe('SSO_STATE_MISSING');
    expect(reason((await oidcRound({ email: staffEmail }, { state: 'forged' })).location)).toBe('SSO_STATE_INVALID');
    expect(reason((await oidcRound({ email: staffEmail }, { code: 'bad-code' })).location)).toBe('SSO_TOKEN_REFUSED');
    expect(reason((await oidcRound({ email: staffEmail, nonce: 'replayed' })).location)).toBe('SSO_TOKEN_INVALID');
    expect(reason((await oidcRound({ email: staffEmail, aud: 'someone-else' })).location)).toBe('SSO_TOKEN_INVALID');
    useOtherKey = true;
    try {
      expect(reason((await oidcRound({ email: staffEmail })).location)).toBe('SSO_TOKEN_INVALID');
    } finally {
      useOtherKey = false;
    }
  });

  it('refuses ID tokens from another issuer, and browser state that is unsigned, for another purpose or signed with another key', async () => {
    const reason = (l: URL) => (l.pathname === '/login' ? l.searchParams.get('sso') : 'signed-in');
    expect(reason((await oidcRound({ email: staffEmail, iss: 'https://login.example.com/other-directory' })).location)).toBe('SSO_TOKEN_INVALID');
    const start = await anon.get('/api/auth/sso/start');
    const state = new URL(start.headers.location!).searchParams.get('state');
    const genuine = stateCookie(start).slice('fc_sso='.length);
    const payload = JSON.parse(Buffer.from(genuine.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const back = async (cookie: string) => reason(new URL((await anon.get(`/api/auth/sso/oidc/callback?code=bad-code&state=${state}`, `fc_sso=${cookie}`)).headers.location!));
    // The control: the genuine state gets past the state check (and then the provider refuses the bad code).
    expect(await back(genuine)).toBe('SSO_TOKEN_REFUSED');
    expect(await back(`${b64({ alg: 'none' })}.${genuine.split('.')[1]}.`)).toBe('SSO_STATE_INVALID');
    expect(await back(await new SignJWT({ ...payload, aud: 'something-else' }).setProtectedHeader({ alg: 'HS256' }).sign(secret))).toBe('SSO_STATE_INVALID');
    expect(await back(await new SignJWT({ ...payload }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('another-secret-another-secret-000000')))).toBe('SSO_STATE_INVALID');
    expect(await back(await new SignJWT({ ...payload, exp: Math.floor(Date.now() / 1000) - 1 }).setProtectedHeader({ alg: 'HS256' }).sign(secret))).toBe('SSO_STATE_INVALID');
  });

  it('never creates accounts, keeps to the city’s domains, and stays bound to the first directory account', async () => {
    const reason = async (claims: Record<string, unknown>) => (await oidcRound(claims)).location.searchParams.get('sso');
    expect(await reason({ email: `nobody@${SUB}.test` })).toBe('SSO_NO_ACCOUNT');
    expect(await reason({ email: 'guard0@elsewhere.ca' })).toBe('SSO_DOMAIN');
    // An address the provider says isn't verified never links an account.
    expect(await reason({ email: staffEmail, email_verified: false })).toBe('SSO_EMAIL_UNVERIFIED');
    expect(await reason({ email: staffEmail, sub: 'a-different-person' })).toBe('SSO_SUBJECT_CHANGED');
    const refused = await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'auth.sso.refused' } });
    expect(refused).toBeGreaterThanOrEqual(2);
  });

  it('when enforced, passwords only work for the people who can turn it off', async () => {
    await api().put('/api/sso', { ...oidcConfig, oidcIssuer: issuer, enforced: true });
    expect((await anon.post('/api/auth/login', { email: staffEmail, password: 'staff password 1' })).body.code).toBe('SSO_REQUIRED');
    expect((await anon.post('/api/auth/login', { email: `hr@${SUB}.test`, password: 'hr password 12' })).status).toBe(200);
    // The answer doesn't depend on the password, so it can't be used to confirm one.
    expect((await anon.post('/api/auth/login', { email: staffEmail, password: 'wrong' })).body.code).toBe('SSO_REQUIRED');
    expect((await anon.post('/api/auth/login', { email: `nobody@${SUB}.test`, password: 'wrong' })).body.code).toBe('SSO_REQUIRED');
    await api().put('/api/sso', { ...oidcConfig, oidcIssuer: issuer, enforced: false });
  });

  it('only HR can see or change it', async () => {
    const staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
    expect((await request(server).get('/api/sso').set('x-tenant-subdomain', SUB).auth(staff, { type: 'bearer' })).status).toBe(403);
  });
});

/* ---------- SAML ---------- */

function selfSigned() {
  const dir = mkdtempSync(join(tmpdir(), 'saml-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=idp.test'], { stdio: 'ignore' });
  return { key: readFileSync(join(dir, 'k.pem'), 'utf8'), cert: readFileSync(join(dir, 'c.pem'), 'utf8') };
}

function samlResponse(o: { key: string; cert: string; inResponseTo: string | null; email: string; audience: string; acs: string; nameId?: string }) {
  const now = new Date();
  const later = new Date(now.getTime() + 5 * 60_000).toISOString();
  const aid = `_${randomUUID()}`;
  const irt = o.inResponseTo ? ` InResponseTo="${o.inResponseTo}"` : '';
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${aid}" Version="2.0" IssueInstant="${now.toISOString()}"><saml:Issuer>https://idp.test</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${o.nameId ?? o.email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${later}" Recipient="${o.acs}"${irt}/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${new Date(now.getTime() - 60_000).toISOString()}" NotOnOrAfter="${later}"><saml:AudienceRestriction><saml:Audience>${o.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now.toISOString()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><saml:AttributeValue>${o.email}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  const sig = new SignedXml({ privateKey: o.key, publicCert: o.cert, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'], digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' });
  sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Issuer']", action: 'after' } });
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_${randomUUID()}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${o.acs}"${irt}><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://idp.test</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${sig.getSignedXml()}</samlp:Response>`;
  return Buffer.from(xml).toString('base64');
}

describe('SAML 2.0', () => {
  const idpKeys = selfSigned();
  const stranger = selfSigned();
  const acs = `${ORIGIN}/api/auth/sso/saml/acs`;
  const audience = `${ORIGIN}/api/auth/sso/saml/metadata`;

  async function samlRound(o: { key?: string; withRequestId?: boolean; email?: string; nameId?: string; cookie?: string | null }) {
    const start = await anon.get('/api/auth/sso/start');
    expect(start.status).toBe(302);
    const req = inflateRawSync(Buffer.from(new URL(start.headers.location!).searchParams.get('SAMLRequest')!, 'base64')).toString();
    const id = /ID="([^"]+)"/.exec(req)![1]!;
    const SAMLResponse = samlResponse({ key: o.key ?? idpKeys.key, cert: idpKeys.cert, inResponseTo: o.withRequestId === false ? null : id, email: o.email ?? staffEmail, audience, acs, nameId: o.nameId });
    const r = await request(server).post('/api/auth/sso/saml/acs').set('x-tenant-subdomain', SUB).set('Cookie', o.cookie === null ? '' : o.cookie ?? stateCookie(start)).type('form').send({ SAMLResponse });
    expect(r.status).toBe(303);
    const l = new URL(r.headers.location!);
    return l.pathname === '/sso' ? 'signed-in' : l.searchParams.get('sso');
  }

  it('publishes metadata for the identity provider', async () => {
    const m = await anon.get('/api/auth/sso/saml/metadata');
    expect(m.text).toContain(`entityID="${audience}"`);
    expect(m.text).toContain(acs);
  });

  it('signs in with a signed assertion that answers this browser’s request', async () => {
    await owner.user.update({ where: { id: t.users[0]!.id }, data: { ssoSubject: null } });
    const r = await api().put('/api/sso', { protocol: 'SAML', enabled: true, enforced: false, idpMfa: true, domains: [], samlEntryPoint: 'https://idp.test/sso', samlIdpIssuer: 'https://idp.test', samlCert: idpKeys.cert });
    expect(r.status).toBe(200);
    expect(await samlRound({})).toBe('signed-in');
  });

  it('refuses forged, unsolicited and cross-browser responses', async () => {
    expect(await samlRound({ key: stranger.key })).toBe('SSO_TOKEN_INVALID');
    expect(await samlRound({ withRequestId: false })).toBe('SSO_TOKEN_INVALID');
    expect(await samlRound({ cookie: null })).toBe('SSO_STATE_MISSING');
    expect(await samlRound({ email: `nobody@${SUB}.test`, nameId: `nobody@${SUB}.test` })).toBe('SSO_NO_ACCOUNT');
  });

  it('refuses a certificate that is not one', async () => {
    expect((await api().put('/api/sso', { protocol: 'SAML', enabled: true, enforced: false, idpMfa: false, samlEntryPoint: 'https://idp.test/sso', samlCert: '<script>' })).body.code).toBe('BAD_CERT');
  });

  it('removing it unbinds accounts', async () => {
    expect((await request(server).delete('/api/sso').set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' })).status).toBe(204);
    expect((await owner.user.findUniqueOrThrow({ where: { id: t.users[0]!.id } })).ssoSubject).toBeNull();
    expect((await anon.get('/api/public/tenant')).body.sso).toBeNull();
    const start = await anon.get('/api/auth/sso/start');
    expect(new URL(start.headers.location!).searchParams.get('sso')).toBe('SSO_OFF');
  });
});

