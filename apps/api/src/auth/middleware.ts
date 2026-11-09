import type { AccessRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { HttpError, forbidden } from '../lib/errors.js';
import type { Permission } from './permissions.js';
import { verifyAccessToken } from './tokens.js';
import { customPermissions, stillActive } from '../services/people/customRoles.js';
import { type FeatureKey, tenantFeatures, tenantSettings, withoutDisabled } from '../services/platform/features.js';
import { permissionsWithOverrides } from '../services/platform/roleOverrides.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  roles: AccessRole[];
  permissions: Set<Permission>;
  /** Last time the person proved who they are (password or passkey), if known. */
  authenticatedAt: Date | null;
  /** This session proved a second factor (a passkey). */
  mfa: boolean;
  /** The city requires a second factor for one of this person's access levels, and this session hasn't given one. */
  mfaPending: boolean;
}

/** What someone who still owes a second factor may reach: enough to give it, or set up a passkey. */
const MFA_EXEMPT = [/^\/api\/me$/, /^\/api\/me\/passkeys(\/|$)/, /^\/api\/auth\/step-up(\/|$)/];
const mfaExempt = (url: string) => MFA_EXEMPT.some((r) => r.test(url.split('?')[0]!));

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Tenant resolved from the Host subdomain (set by resolveTenant). */
      tenantId?: string;
    }
  }
}

/** Verifies the Bearer access token and that it belongs to the subdomain's tenant. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing access token');
    const claims = await verifyAccessToken(header.slice(7)).catch(() => {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired access token');
    });
    if (req.tenantId && req.tenantId !== claims.tid) throw forbidden('Token does not belong to this organization');
    const [{ features, overrides, mfaRoles }, custom, ok] = await Promise.all([tenantSettings(claims.tid), customPermissions(claims.tid, claims.sub), stillActive(claims.tid, claims.sub)]);
    // Terminated, deactivated or restricted people lose access at once, not when their token expires.
    if (!ok) throw new HttpError(401, 'ACCOUNT_INACTIVE', 'This account is no longer active.');
    // Each role's permissions after the city's Dev console overrides, plus custom roles.
    const granted = new Set([...permissionsWithOverrides(claims.roles, overrides), ...custom]);
    const mfa = claims.mfa === true;
    const mfaPending = !mfa && claims.roles.some((r) => mfaRoles.includes(r));
    req.auth = {
      userId: claims.sub,
      tenantId: claims.tid,
      roles: claims.roles,
      permissions: withoutDisabled(granted, features),
      authenticatedAt: claims.aat ? new Date(claims.aat * 1000) : null,
      mfa,
      mfaPending,
    };
    if (mfaPending && !mfaExempt(req.originalUrl)) throw new HttpError(403, 'MFA_REQUIRED', 'Your organization requires a passkey for this account. Confirm with your passkey to continue.');
    next();
  } catch (e) {
    next(e);
  }
}

export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) return next(new HttpError(401, 'UNAUTHENTICATED', 'Not signed in'));
    if (!perms.every((p) => auth.permissions.has(p))) return next(forbidden());
    next();
  };
}

export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Not signed in');
  return req.auth;
}

/** Refuses a route while the organization has the feature switched off. */
export function requireFeature(feature: FeatureKey) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const tenantId = req.auth?.tenantId ?? req.tenantId;
      if (!tenantId) throw new HttpError(401, 'UNAUTHENTICATED', 'Not signed in');
      if (!(await tenantFeatures(tenantId))[feature]) throw new HttpError(404, 'FEATURE_OFF', 'This feature is switched off for your organization.');
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const RECENT_AUTH_MS = 10 * 60_000;

/**
 * Sensitive actions need the person to have proved who they are in the last
 * 10 minutes. Otherwise the app asks for their passkey (Face ID, fingerprint,
 * Windows Hello) or password, then retries.
 */
export function requireRecentAuth(req: Request, _res: Response, next: NextFunction) {
  const at = req.auth?.authenticatedAt;
  if (!at || Date.now() - at.getTime() > RECENT_AUTH_MS) {
    return next(new HttpError(401, 'STEP_UP_REQUIRED', 'Confirm it’s you to continue.'));
  }
  next();
}
