import { headers } from 'next/headers';
import type { ThemeColors } from './theme';

export interface PublicTenant {
  id: string;
  name: string;
  logoUrl: string | null;
  themeColors: ThemeColors;
  defaultLocale: string;
}

/**
 * Where this server reaches the API for server-rendered pages, read at run time: in production the
 * API's internal address (ops/terraform/compute.tf passes API_URL to the web task), never through
 * the public load balancer.
 */
export const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'localhost';

/**
 * Headers for this server's own calls to the API about one organization. In production the API
 * finds the organization from the host name only (x-tenant-subdomain is a development shortcut it
 * ignores there), and these calls go to the API directly, so the organization's host travels as
 * X-Forwarded-Host, which the API reads as the host (Express `trust proxy`, one hop).
 */
export function tenantApiHeaders(sub: string): Record<string, string> {
  // Server-side only (INTERNAL_API_TOKEN is not a NEXT_PUBLIC_ variable): marks the web app's own
  // calls, so the API gives them their own budget, not every visitor's anonymous one (SEC-48).
  const internal = process.env.INTERNAL_API_TOKEN;
  return { 'x-tenant-subdomain': sub, 'x-forwarded-host': `${sub}.${ROOT_DOMAIN}`, ...(internal ? { 'x-fh-internal': internal } : {}) };
}

/** "kelowna.flexcity.ca" → "kelowna"; "kelowna.localhost:3000" → "kelowna". */
export function subdomainFromHost(host: string | null): string | null {
  if (!host) return null;
  const h = host.split(':')[0]!.toLowerCase();
  if (!h.endsWith(`.${ROOT_DOMAIN}`)) return null;
  const sub = h.slice(0, -(ROOT_DOMAIN.length + 1));
  return sub && !sub.includes('.') ? sub : null;
}

/**
 * Subdomains the API said have no organization, remembered for a minute in this process (at most
 * UNKNOWN_MAX), so a visitor reloading or repeating made-up subdomains doesn't cost an API call each
 * time: Next caches only good answers. Made-up subdomains that are all different are still bounded
 * by the firewall's per-address limit and the API's internal budget (review of #77).
 */
export const UNKNOWN_TTL_MS = 60_000;
export const UNKNOWN_MAX = 10_000;
const unknown = new Map<string, number>();
export function rememberUnknown(sub: string, now = Date.now()) {
  unknown.delete(sub);
  unknown.set(sub, now + UNKNOWN_TTL_MS);
  if (unknown.size > UNKNOWN_MAX) unknown.delete(unknown.keys().next().value!);
}
export function knownUnknown(sub: string, now = Date.now()): boolean {
  const until = unknown.get(sub);
  if (until === undefined) return false;
  if (until > now) return true;
  unknown.delete(sub);
  return false;
}

/** Server-side: branding for the current request's subdomain. */
export async function currentTenant(): Promise<PublicTenant | null> {
  const sub = subdomainFromHost((await headers()).get('host'));
  if (!sub || knownUnknown(sub)) return null;
  try {
    const res = await fetch(`${API_URL}/api/public/tenant`, {
      headers: tenantApiHeaders(sub),
      next: { revalidate: 60 },
    });
    if (res.status === 404) rememberUnknown(sub);
    return res.ok ? ((await res.json()) as PublicTenant) : null;
  } catch {
    return null;
  }
}
