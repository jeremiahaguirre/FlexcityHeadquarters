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
  return { 'x-tenant-subdomain': sub, 'x-forwarded-host': `${sub}.${ROOT_DOMAIN}` };
}

/** "kelowna.flexcity.ca" → "kelowna"; "kelowna.localhost:3000" → "kelowna". */
export function subdomainFromHost(host: string | null): string | null {
  if (!host) return null;
  const h = host.split(':')[0]!.toLowerCase();
  if (!h.endsWith(`.${ROOT_DOMAIN}`)) return null;
  const sub = h.slice(0, -(ROOT_DOMAIN.length + 1));
  return sub && !sub.includes('.') ? sub : null;
}

/** Server-side: branding for the current request's subdomain. */
export async function currentTenant(): Promise<PublicTenant | null> {
  const sub = subdomainFromHost((await headers()).get('host'));
  if (!sub) return null;
  try {
    const res = await fetch(`${API_URL}/api/public/tenant`, {
      headers: tenantApiHeaders(sub),
      next: { revalidate: 60 },
    });
    return res.ok ? ((await res.json()) as PublicTenant) : null;
  } catch {
    return null;
  }
}
