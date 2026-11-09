import type { AccessRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { HttpError, forbidden } from '../lib/errors.js';
import { type Permission, permissionsFor } from './permissions.js';
import { verifyAccessToken } from './tokens.js';
import { type FeatureKey, tenantFeatures, withoutDisabled } from '../services/platform/features.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  roles: AccessRole[];
  permissions: Set<Permission>;
}

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
    const features = await tenantFeatures(claims.tid);
    req.auth = { userId: claims.sub, tenantId: claims.tid, roles: claims.roles, permissions: withoutDisabled(permissionsFor(claims.roles), features) };
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
