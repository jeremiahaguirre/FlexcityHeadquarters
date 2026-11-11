/**
 * Shared route plumbing: which organization a request is for (from its subdomain), the encryption
 * key provider, and h(), which passes async errors to the error handler.
 */
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { db } from '../lib/db.js';
import { HttpError, notFound } from '../lib/errors.js';
import { LocalKeyProvider, AwsKmsKeyProvider, type KeyProvider } from '../services/crypto/envelope.js';
import { awsKms } from '../services/crypto/awsKms.js';
import { sharedForget } from '../lib/cacheBus.js';

export interface PublicTenant {
  disabledAt?: Date | null;
  exportUntil?: Date | null;
  id: string;
  name: string;
  logoUrl: string | null;
  themeColors: Record<string, string>;
  defaultLocale: string;
}

const cache = new Map<string, { at: number; tenant: PublicTenant | null }>();
const TTL_MS = 60_000;

export async function lookupTenant(subdomain: string): Promise<PublicTenant | null> {
  const hit = cache.get(subdomain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tenant;
  const rows = await db().$queryRaw<PublicTenant[]>`SELECT * FROM public_tenant_by_subdomain(${subdomain})`;
  const tenant = rows[0] ?? null;
  cache.set(subdomain, { at: Date.now(), tenant });
  return tenant;
}

/** Branding changed (e.g. from the Dev console): look it up again next time. */
export const forgetTenantLookup = sharedForget('tenantLookup', () => cache.clear());

/** Resolves the tenant from the Host subdomain (kelowna.flexcity.ca → "kelowna"). */
export function subdomainOf(req: Request): string | null {
  const devHeader = config().NODE_ENV !== 'production' ? req.header('x-tenant-subdomain') : undefined;
  if (devHeader) return devHeader;
  const host = (req.hostname || '').toLowerCase();
  const root = config().ROOT_DOMAIN.toLowerCase();
  if (!host.endsWith(`.${root}`)) return null;
  const sub = host.slice(0, -(root.length + 1));
  return sub.includes('.') ? null : sub;
}

/**
 * What a closed organization's administrators still need to reach their data export: sign-in, who
 * they are, their passkeys and the export. requireAuth then admits only administrators to the rest.
 */
const CLOSED_OK = /^\/(public\/tenant|auth\/(login|refresh|logout|forgot|reset|passkey(\/options)?|step-up(\/options)?|mfa\/(options|code|code\/verify)|sso\/.+)|me|me\/passkeys(\/.*)?|data-export(\/.*)?)$/;
export const exportWindowOpen = (until: Date | string | null | undefined) => !!until && new Date(until) > new Date();

export async function resolveTenant(req: Request, _res: Response, next: NextFunction) {
  try {
    const sub = subdomainOf(req);
    if (!sub) throw notFound('Organization');
    const tenant = await lookupTenant(sub);
    if (!tenant) throw notFound('Organization');
    // Closed by FH (unpaid for good, or offboarded): nothing opens, not even sign-in, except that
    // after offboarding its administrators may sign in to download their data until the export window ends.
    if (tenant.disabledAt && !(exportWindowOpen(tenant.exportUntil) && CLOSED_OK.test(req.path))) {
      throw new HttpError(403, 'ORG_DISABLED', 'This organization’s account is closed. Contact FlexcityHeadquarters.');
    }
    req.tenantId = tenant.id;
    next();
  } catch (e) {
    next(e);
  }
}

let keyProvider: KeyProvider | undefined;
export function keys(): KeyProvider {
  if (!keyProvider) {
    const c = config();
    if (c.KMS_KEY_ARN) keyProvider = new AwsKmsKeyProvider(awsKms(c.AWS_REGION), c.KMS_REPLICA_REGION);
    else if (c.LOCAL_KEK_BASE64) keyProvider = new LocalKeyProvider(Buffer.from(c.LOCAL_KEK_BASE64, 'base64'));
    else throw new Error('No key provider configured (KMS_KEY_ARN or LOCAL_KEK_BASE64)');
  }
  return keyProvider;
}

/** KEK used for a tenant's records. Production: one KMS key (alias) per tenant. */
export function tenantKekId(tenantId: string): string {
  const c = config();
  return c.KMS_KEY_ARN ? `alias/flexcity-tenant-${tenantId}` : `local:${tenantId}`;
}

/** Wrap an async handler so rejections reach the error middleware. */
export const h =
  <R extends Request>(fn: (req: R, res: Response) => Promise<unknown>) =>
  (req: R, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
