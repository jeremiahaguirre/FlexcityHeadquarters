/**
 * Single sign-on routes. The sign-in ones run before anyone is signed in
 * (mounted with resolveTenant); the settings ones need tenant.configure.
 */
import express, { Router } from 'express';
import { z } from 'zod';
import { appUrl, consumeAuthToken } from '../auth/authTokens.js';
import { authOf, requirePermission, requireRecentAuth, requireModule } from '../auth/middleware.js';
import { allow } from '../auth/rateLimit.js';
import { epochSeconds, issueRefreshToken, signAccessToken } from '../auth/tokens.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { checkIssuerHost, checkIssuerUrl, connectionFor, finishSso, samlMetadata, sealClientSecret, spUrls, SsoError, startSso, STATE_COOKIE, stateCookieOpts } from '../services/auth/sso.js';
import { COOKIE, cookieOpts } from './auth.js';
import { h, subdomainOf } from './context.js';

export const ssoAuthRouter = Router();

ssoAuthRouter.get(
  '/auth/sso/start',
  h(async (req, res) => {
    const sub = subdomainOf(req)!;
    if (!(await allow(`sso:${req.ip}:${req.tenantId}`, 30, 10 * 60_000))) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Wait a few minutes and try again.');
    const hint = typeof req.query.hint === 'string' && req.query.hint.length < 200 ? req.query.hint : undefined;
    try {
      const s = await startSso(req.tenantId!, sub, hint, typeof req.query.next === 'string' ? req.query.next : undefined);
      res.cookie(STATE_COOKIE, s.cookie, stateCookieOpts(s.protocol));
      res.redirect(302, s.url);
    } catch (e) {
      if (!(e instanceof SsoError)) throw e;
      res.redirect(302, appUrl(sub, `/login?sso=${e.code}`));
    }
  }),
);

/** Where the provider sends people back. Errors go to the sign-in page, never a JSON page. */
async function finish(req: express.Request, res: express.Response, p: 'OIDC' | 'SAML', input: Record<string, unknown>) {
  const sub = subdomainOf(req)!;
  res.clearCookie(STATE_COOKIE, { path: '/api/auth/sso' });
  try {
    const { code, next } = await finishSso(req.tenantId!, sub, p, req.cookies?.[STATE_COOKIE] as string | undefined, input);
    res.redirect(303, appUrl(sub, `/sso?code=${code}${next ? `&next=${encodeURIComponent(next)}` : ''}`));
  } catch (e) {
    if (!(e instanceof SsoError)) throw e;
    res.redirect(303, appUrl(sub, `/login?sso=${e.code}`));
  }
}

ssoAuthRouter.get('/auth/sso/oidc/callback', h((req, res) => finish(req, res, 'OIDC', req.query as Record<string, unknown>)));
ssoAuthRouter.post('/auth/sso/saml/acs', express.urlencoded({ extended: false, limit: '512kb' }), h((req, res) => finish(req, res, 'SAML', { SAMLResponse: String(req.body?.SAMLResponse ?? ''), RelayState: String(req.body?.RelayState ?? '') })));

ssoAuthRouter.get(
  '/auth/sso/saml/metadata',
  h(async (req, res) => {
    res.type('application/samlmetadata+xml').send(samlMetadata(subdomainOf(req)!));
  }),
);

/** The one-time code from the callback, traded for a session on the organization's own site. */
ssoAuthRouter.post(
  '/auth/sso/exchange',
  h(async (req, res) => {
    const tenantId = req.tenantId!;
    const { code } = z.object({ code: z.string().min(20).max(100) }).parse(req.body);
    if (!(await allow(`sso-x:${req.ip}:${tenantId}`, 30, 10 * 60_000))) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes.');
    const out = await withTenant(tenantId, async (tx) => {
      const t = await consumeAuthToken(tx, code, ['SSO', 'SSO_MFA']);
      if (!t) return null;
      const user = await tx.user.findUniqueOrThrow({ where: { id: t.userId } });
      if (user.status !== 'ACTIVE' || user.processingRestrictedAt) return null;
      const mfa = t.purpose === 'SSO_MFA';
      const now = new Date();
      const refresh = await issueRefreshToken(tx, tenantId, user.id, undefined, now, mfa ? now : null);
      return { user, refresh, mfa };
    });
    if (!out) throw new HttpError(400, 'LINK_EXPIRED', 'This sign-in has expired. Try again.');
    const accessToken = await signAccessToken({ sub: out.user.id, tid: tenantId, roles: out.user.roles, aat: epochSeconds(), mfa: out.mfa });
    res.cookie(COOKIE, out.refresh, cookieOpts());
    res.json({ accessToken, user: { id: out.user.id, firstName: out.user.firstName, lastName: out.user.lastName, roles: out.user.roles, locale: out.user.locale } });
  }),
);

/* ---------------- Settings ---------------- */

export const ssoRouter = Router();

const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Enter a domain like kelowna.ca');
const body = z.object({
  protocol: z.enum(['OIDC', 'SAML']),
  enabled: z.boolean(),
  enforced: z.boolean(),
  idpMfa: z.boolean(),
  label: z.string().trim().max(40).nullable().optional(),
  domains: z.array(domain).max(10).default([]),
  oidcIssuer: z.string().trim().max(300).nullable().optional(),
  oidcClientId: z.string().trim().max(200).nullable().optional(),
  /** Only when changing it; left out keeps the stored one. */
  oidcSecret: z.string().max(500).optional(),
  samlEntryPoint: z.string().trim().url().max(500).nullable().optional(),
  samlIdpIssuer: z.string().trim().max(300).nullable().optional(),
  samlCert: z.string().trim().max(10_000).nullable().optional(),
});

function view(c: Awaited<ReturnType<typeof connectionFor>>, sub: string) {
  return {
    sp: spUrls(sub),
    connection: c
      ? { protocol: c.protocol, enabled: c.enabled, enforced: c.enforced, idpMfa: c.idpMfa, label: c.label, domains: c.domains, oidcIssuer: c.oidcIssuer, oidcClientId: c.oidcClientId, hasSecret: !!c.oidcSecret, samlEntryPoint: c.samlEntryPoint, samlIdpIssuer: c.samlIdpIssuer, samlCert: c.samlCert, lastUsedAt: c.lastUsedAt, updatedAt: c.updatedAt }
      : null,
  };
}

ssoRouter.get(
  '/sso',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(view(await withTenant(a.tenantId, connectionFor), subdomainOf(req)!));
  }),
);

const PEM = /^(-----BEGIN CERTIFICATE-----)?[\sA-Za-z0-9+/=]+(-----END CERTIFICATE-----)?$/;

/** Who signs everyone in is the most sensitive setting there is: recent sign-in with a second factor, never a support visit. */
function assertStrongAdmin(a: ReturnType<typeof authOf>) {
  if (a.support) throw new HttpError(403, 'SUPPORT_READ_ONLY', 'FH support can look, not change anything.');
  if (!a.mfa) throw new HttpError(403, 'PASSKEY_REQUIRED', 'Sign in with your passkey to change single sign-on.');
}

ssoRouter.put(
  '/sso',
  requirePermission('tenant.configure'),
  requireModule('sso'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    assertStrongAdmin(a);
    const b = body.parse(req.body);
    if (b.protocol === 'OIDC') {
      if (b.oidcIssuer) {
        checkIssuerUrl(b.oidcIssuer);
        await checkIssuerHost(b.oidcIssuer);
      }
      if (b.enabled && !(b.oidcIssuer && b.oidcClientId)) throw new HttpError(400, 'SSO_INCOMPLETE', 'Enter the issuer and application (client) ID before turning single sign-on on.');
    } else {
      if (b.samlCert && !PEM.test(b.samlCert)) throw new HttpError(400, 'BAD_CERT', 'Paste the signing certificate (Base64), including the BEGIN and END lines.');
      if (b.enabled && !(b.samlEntryPoint && b.samlCert)) throw new HttpError(400, 'SSO_INCOMPLETE', 'Enter the sign-in URL and signing certificate before turning single sign-on on.');
    }
    if (b.enforced && !b.enabled) throw new HttpError(400, 'SSO_INCOMPLETE', 'Turn single sign-on on before making it the only way to sign in.');
    const secret = b.oidcSecret ? await sealClientSecret(a.tenantId, b.oidcSecret) : undefined;
    const c = await withTenant(a.tenantId, async (tx) => {
      const before = await connectionFor(tx);
      const data = {
        protocol: b.protocol,
        enabled: b.enabled,
        enforced: b.enforced,
        idpMfa: b.idpMfa,
        label: b.label ?? null,
        domains: b.domains,
        oidcIssuer: b.oidcIssuer ?? null,
        oidcClientId: b.oidcClientId ?? null,
        ...(secret ? { oidcSecret: secret } : {}),
        samlEntryPoint: b.samlEntryPoint ?? null,
        samlIdpIssuer: b.samlIdpIssuer ?? null,
        samlCert: b.samlCert ?? null,
      };
      const c = before ? await tx.ssoConnection.update({ where: { id: before.id }, data }) : await tx.ssoConnection.create({ data: { tenantId: a.tenantId, ...data } });
      // A different identity provider: no account stays bound to the old one, and every HR administrator is told.
      const providerChanged = !before || before.protocol !== data.protocol || before.oidcIssuer !== data.oidcIssuer || before.oidcClientId !== data.oidcClientId || before.samlEntryPoint !== data.samlEntryPoint || before.samlCert !== data.samlCert || before.samlIdpIssuer !== data.samlIdpIssuer;
      if (providerChanged || (data.enabled && !before?.enabled)) {
        if (providerChanged) await tx.user.updateMany({ where: { ssoSubject: { not: null } }, data: { ssoSubject: null } });
        const admins = await tx.user.findMany({ where: { status: 'ACTIVE', roles: { has: 'HR_ADMIN' } }, select: { email: true, locale: true } });
        for (const ad of admins) await tx.emailOutbox.create({ data: { tenantId: a.tenantId, toEmail: ad.email, template: 'sso_changed', locale: ad.locale, params: { protocol: data.protocol, enabled: String(data.enabled) } } });
      }
      const { oidcSecret: _s, ...after } = data as typeof data & { oidcSecret?: unknown };
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'sso.configure', entity: 'SsoConnection', entityId: c.id, after: { ...after, secretChanged: !!secret } });
      return c;
    });
    res.json(view(c, subdomainOf(req)!));
  }),
);

ssoRouter.delete(
  '/sso',
  requirePermission('tenant.configure'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    assertStrongAdmin(a);
    await withTenant(a.tenantId, async (tx) => {
      const c = await connectionFor(tx);
      if (!c) return;
      await tx.ssoConnection.delete({ where: { id: c.id } });
      // Accounts can be bound to a new provider afterwards.
      await tx.user.updateMany({ where: { ssoSubject: { not: null } }, data: { ssoSubject: null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'sso.remove', entity: 'SsoConnection', entityId: c.id });
    });
    res.status(204).end();
  }),
);
