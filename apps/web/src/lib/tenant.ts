import { headers } from 'next/headers';
import type { ThemeColors } from './theme';

export interface PublicTenant {
  id: string;
  name: string;
  logoUrl: string | null;
  themeColors: ThemeColors;
  defaultLocale: string;
}

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'localhost';

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
      headers: { 'x-tenant-subdomain': sub },
      next: { revalidate: 60 },
    });
    return res.ok ? ((await res.json()) as PublicTenant) : null;
  } catch {
    return null;
  }
}
