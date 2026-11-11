/**
 * Who is asking and what they may do: requireAuth builds the AuthContext (roles, permissions after
 * feature switches and overrides, department scope), and the require* guards check it per route.
 */
import type { AccessRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { HttpError, forbidden } from '../lib/errors.js';
import type { Permission } from './permissions.js';
import { verifyAccessToken } from './tokens.js';
import { type Scope, customAccess, scopeOf, stillActive } from '../services/people/customRoles.js';
import { managedScope } from '../services/people/departments.js';
import { type FeatureKey, tenantFeatures, tenantSettings, withoutDisabled } from '../services/platform/features.js';
import { permissionsWithOverrides } from '../services/platform/roleOverrides.js';
import { type Module, allowedWhileSuspended, hasModule } from '../services/billing/entitlements.js';
import { SETUP_PERMISSIONS, supportStillAllowed } from '../services/platform/support.js';
import { audit, withTenant } from '../lib/db.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  roles: AccessRole[];
  permissions: Set<Permission>;
  /** Last time the person proved who they are (password or passkey), if known. */
  authenticatedAt: Date | null;
  /** This session proved a second factor (a passkey, or a code by email or text). */
  mfa: boolean;
  /** The city requires a second factor for one of this person's access levels, and this session hasn't given one. */
  mfaPending: boolean;
  /** Where supervisory capabilities reach: null = the whole organization, else a department. */
  scope: Scope;
  /** An FH support visit (read-only, with the organization's consent). */
  support?: { sessionId: string; level: 'SETUP' | 'FULL'; endsAt: Date; adminId: string };
}

/** What someone who still owes a second factor may reach: enough to give it (a passkey or a code), or set up a passkey. */
const MFA_EXEMPT = [/^\/api\/me$/, /^\/api\/me\/passkeys(\/|$)/, /^\/api\/auth\/step-up(\/|$)/, /^\/api\/auth\/mfa\/(options|code|code\/verify)$/];
/** Powers that need the same second factor as HR. */
const ADMIN_LEVEL = new Set<string>(['users.write', 'tenant.configure', 'payroll.approve', 'payroll.export', 'roles.manage', 'documents.manage', 'billing.manage', 'audit.read']);

/** Never open to an FH support visit, whatever the organization allowed. */
const SUPPORT_BLOCKED = [
  /^\/api\/me\/.+/, // the granting person's own pay, documents, discipline…
  /^\/api\/incidents\/[^/]+$/,
  /^\/api\/(documents|accommodations|injury-claims|grievances|reviews|households|registrations|online-registrations|care\/checkins|people\/review|discipline)(\/|$)/,
  /^\/api\/users\/[^/]+\/(documents|accommodations|case-file|discipline|records-export|records-export\.pdf|sin|reliability|conduct|pay-profile|bank-accounts)(\/|$)/,
  /^\/api\/payroll\/(?!settings$|export-settings$).+/,
  /^\/api\/data-export(\/|$)/,
];

/** All a closed organization's administrators can reach: who they are, their passkeys or a sign-in code, and the export. */
const CLOSED_EXPORT = /^\/api\/(me|me\/passkeys(\/.*)?|auth\/step-up(\/options)?|auth\/mfa\/(options|code|code\/verify)|data-export(\/.*)?)$/;
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
    const [{ features, overrides, mfaRoles, billing, disabledAt, exportUntil }, custom, ok, managed] = await Promise.all([tenantSettings(claims.tid), customAccess(claims.tid, claims.sub), stillActive(claims.tid, claims.sub), managedScope(claims.tid, claims.sub)]);
    // Terminated, deactivated or restricted people lose access at once, not when their token expires.
    if (!ok) throw new HttpError(401, 'ACCOUNT_INACTIVE', 'This account is no longer active.');
    // Each role's permissions after the city's Dev console overrides, plus custom roles.
    const builtIn = permissionsWithOverrides(claims.roles, overrides);
    const granted = new Set([...builtIn, ...custom.perms]);
    // Closed by FH: a session still in hand stops working at once. After offboarding, the
    // organization's administrators keep only what they need to download their data.
    if (disabledAt) {
      const exportOnly = exportUntil && exportUntil > new Date() && granted.has('tenant.configure') && !claims.sup && CLOSED_EXPORT.test(req.originalUrl.split('?')[0]!);
      if (!exportOnly) throw new HttpError(403, 'ORG_DISABLED', 'This organization’s account is closed. Contact FlexcityHeadquarters.');
    }
    const mfa = claims.mfa === true;
    // A second factor follows the access, not just the role's name: when the city requires it for HR,
    // anyone holding HR-level powers through a custom role needs it too.
    const adminLike = mfaRoles.includes('HR_ADMIN') && [...granted].some((p) => ADMIN_LEVEL.has(p));
    const mfaPending = !mfa && (claims.roles.some((r) => mfaRoles.includes(r)) || adminLike);
    req.auth = {
      userId: claims.sub,
      tenantId: claims.tid,
      roles: claims.roles,
      permissions: withoutDisabled(granted, features),
      authenticatedAt: claims.aat ? new Date(claims.aat * 1000) : null,
      mfa,
      mfaPending,
      scope: scopeOf(builtIn, custom, { roles: claims.roles, managed }),
    };
    // FH support, with the organization's consent: read-only, what the grant allows, every page logged.
    if (claims.sup) {
      const allowed = await supportStillAllowed(claims.tid, claims.sup);
      if (!allowed) throw new HttpError(401, 'SUPPORT_ENDED', 'This support visit has ended or the organization withdrew its permission.');
      req.auth.support = { sessionId: claims.sup, level: allowed.level, endsAt: allowed.endsAt, adminId: allowed.adminId };
      req.auth.mfaPending = false;
      if (allowed.level === 'SETUP') req.auth.permissions = new Set([...req.auth.permissions].filter((p) => SETUP_PERMISSIONS.includes(p)));
      // Logged first, so attempts that are refused are on record too.
      await withTenant(claims.tid, (tx) => audit(tx, { tenantId: claims.tid, actorId: null, action: 'support.view', entity: 'SupportSession', entityId: claims.sup!, after: { method: req.method, path: req.originalUrl.split('?')[0] } }));
      if (req.method !== 'GET' && !req.originalUrl.startsWith('/api/auth/logout')) throw new HttpError(403, 'SUPPORT_READ_ONLY', 'FH support can look, not change anything.');
      // The union local's hub is never open to FH, whoever allowed the visit.
      if (req.originalUrl.startsWith('/api/union')) throw new HttpError(403, 'FORBIDDEN', 'The union hub isn’t part of support access.');
      // Nor are individual sensitive records, at any level: support helps with setup and schedules,
      // it doesn't read narratives, health or HR files, children's details, SINs or anyone's own pages.
      if (SUPPORT_BLOCKED.some((r) => r.test(req.originalUrl.split('?')[0]!))) throw new HttpError(403, 'SUPPORT_NOT_RECORDS', 'Individual records aren’t part of support access.');
      req.auth.permissions.delete('union.hub');
    }
    // Unpaid past the grace period: read-only, except safety work, clocking and paying.
    if (billing.stage === 'suspended' && !allowedWhileSuspended(req.method, req.originalUrl)) {
      throw new HttpError(402, 'ACCOUNT_SUSPENDED', 'Your organization’s account is read-only until the overdue balance is paid.');
    }
    if (mfaPending && !mfaExempt(req.originalUrl)) throw new HttpError(403, 'MFA_REQUIRED', 'Your organization requires a second factor for this account. Confirm with your passkey or a sign-in code to continue.');
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
/** A setting the plan must include (single sign-on, the bank connection): 403 PLAN_REQUIRED otherwise. */
export function requireModule(module: Module) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const tenantId = req.auth?.tenantId ?? req.tenantId;
      if (!tenantId) throw new HttpError(401, 'UNAUTHENTICATED', 'Not signed in');
      if (!hasModule((await tenantSettings(tenantId)).billing, module)) throw new HttpError(403, 'PLAN_REQUIRED', 'Your plan doesn’t include this. See Billing to add it.', { module });
      next();
    } catch (e) {
      next(e);
    }
  };
}

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

/**
 * A person's access as a request would see it (permissions after overrides, custom roles,
 * switched-off features, department scope), for work done on their behalf without a request:
 * scheduled reports. Null when they're no longer active.
 */
export async function accessOf(tenantId: string, userId: string, roles: AccessRole[]): Promise<AuthContext | null> {
  const [{ features, overrides }, custom, ok, managed] = await Promise.all([tenantSettings(tenantId), customAccess(tenantId, userId), stillActive(tenantId, userId), managedScope(tenantId, userId)]);
  if (!ok) return null;
  const builtIn = permissionsWithOverrides(roles, overrides);
  return { userId, tenantId, roles, permissions: withoutDisabled(new Set([...builtIn, ...custom.perms]), features), authenticatedAt: null, mfa: false, mfaPending: false, scope: scopeOf(builtIn, custom, { roles, managed }) };
}
