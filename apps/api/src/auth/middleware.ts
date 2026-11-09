import type { AccessRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { HttpError, forbidden } from '../lib/errors.js';
import { type Permission, permissionsFor } from './permissions.js';
import { verifyAccessToken } from './tokens.js';

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
    req.auth = { userId: claims.sub, tenantId: claims.tid, roles: claims.roles, permissions: permissionsFor(claims.roles) };
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
