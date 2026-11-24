/**
 * How the separate Union Hub service (unionServer.ts) checks a request's sign-in without any way
 * into the main app's data (review of #75; SECURITY-AUDIT SEC-61).
 *
 * The hub holds only the union database role. For each request it asks the main API, at its
 * private address, the same question every API route answers: is this access token genuine and
 * current, is the person still active, is the organization open, is the consent signed, is the
 * union feature on? It sends the request's own method, path, token and organization host, with
 * the x-fh-union-check header, and no body. The API runs its usual chain (resolveTenant,
 * requireAuth, requireConsent, then requireFeature('union'): routes/features.ts) and answers either
 * with the facts the hub needs (who, which organization) or with the refusal itself, which the hub
 * passes on unchanged. So the hub needs neither the app database role nor the token-signing secret.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthContext } from '../auth/middleware.js';
import type { Permission } from '../auth/permissions.js';
import type { AccessRole } from '../generated/prisma/client.js';

export const UNION_CHECK_HEADER = 'x-fh-union-check';
/** The web app's and the hub's internal token header (INTERNAL_API_TOKEN, lib/ipRateLimit.ts once SEC-48 lands). */
const INTERNAL_HEADER = 'x-fh-internal';
/** Set by requireAuth on a genuine but expired token, so the hub's limiter treats it as the API does. */
export const CREDENTIAL_EXPIRED_HEADER = 'x-fh-credential-expired';

/** What the API tells the hub about a request it accepted. */
export interface UnionAccess {
  userId: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  authenticatedAt: string | null;
  mfa: boolean;
}

export const unionAccessOf = (a: AuthContext): UnionAccess => ({
  userId: a.userId,
  tenantId: a.tenantId,
  roles: a.roles,
  permissions: [...a.permissions],
  authenticatedAt: a.authenticatedAt ? a.authenticatedAt.toISOString() : null,
  mfa: a.mfa,
});

/** Headers passed on from the browser's request: the token, the organization's host, the app version. */
const PASSED = ['authorization', 'x-tenant-subdomain', 'x-fh-client'] as const;

export interface UnionAccessOptions {
  /** The main API's private address, e.g. http://api.fh-production.internal:4000 (API_URL). */
  apiUrl: string;
  /** INTERNAL_API_TOKEN, when set: the API then counts these checks on their own budget. */
  internalToken?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

/** The hub's stand-in for resolveTenant + requireAuth + requireConsent + requireFeature('union'). */
export function unionAccessViaApi(opts: UnionAccessOptions): RequestHandler {
  const fetcher = opts.fetcher ?? fetch;
  const base = opts.apiUrl.replace(/\/+$/, '');
  return (req: Request, res: Response, next: NextFunction) => {
    const headers: Record<string, string> = { [UNION_CHECK_HEADER]: '1' };
    for (const h of PASSED) {
      const v = req.header(h);
      if (v) headers[h] = v;
    }
    // The organization is found from the host it was asked on; the visitor's address (already
    // resolved by this service's own trust-proxy setting) keeps the API's per-address limits per visitor.
    headers['x-forwarded-host'] = req.header('x-forwarded-host') ?? req.header('host') ?? '';
    if (req.ip) headers['x-forwarded-for'] = req.ip;
    if (opts.internalToken) headers[INTERNAL_HEADER] = opts.internalToken;
    fetcher(`${base}${req.originalUrl}`, { method: req.method, headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (UnionAccess & { code?: string }) | null;
        if (r.ok && body?.userId && body.tenantId) {
          const auth: AuthContext = {
            userId: body.userId,
            tenantId: body.tenantId,
            roles: body.roles as AccessRole[],
            permissions: new Set(body.permissions as Permission[]),
            authenticatedAt: body.authenticatedAt ? new Date(body.authenticatedAt) : null,
            mfa: body.mfa,
            mfaPending: false,
            scope: null,
          };
          req.auth = auth;
          req.tenantId = body.tenantId;
          return next();
        }
        if (r.status === 401 && r.headers.get(CREDENTIAL_EXPIRED_HEADER)) res.locals.credentialExpired = true;
        const retry = r.headers.get('retry-after');
        if (retry) res.setHeader('Retry-After', retry);
        if (r.ok) return void res.status(502).json({ code: 'BUSY', message: 'The Union Hub couldn’t check your sign-in. Try again shortly.', requestId: req.id });
        res.status(r.status).json(body ?? { code: 'BUSY', message: 'The Union Hub couldn’t check your sign-in. Try again shortly.', requestId: req.id });
      })
      .catch(() => {
        res.setHeader('Retry-After', '5');
        res.status(503).json({ code: 'BUSY', message: 'The Union Hub couldn’t check your sign-in. Try again shortly.', requestId: req.id });
      });
  };
}
