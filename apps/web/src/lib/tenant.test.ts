import { afterEach, describe, expect, it, vi } from 'vitest';

// Server-rendered pages ask the API for the organization's branding and job postings. In
// production the API ignores x-tenant-subdomain, so the organization's host must travel as
// X-Forwarded-Host (found by the production rehearsal: every organization page said "not found").
const load = async (root: string) => {
  vi.resetModules();
  vi.stubEnv('ROOT_DOMAIN', root);
  return import('./tenant');
};
afterEach(() => vi.unstubAllEnvs());

describe('tenantApiHeaders', () => {
  it('sends the organization host the API resolves in production', async () => {
    const { tenantApiHeaders } = await load('flexcity.ca');
    expect(tenantApiHeaders('kelowna')).toEqual({ 'x-tenant-subdomain': 'kelowna', 'x-forwarded-host': 'kelowna.flexcity.ca' });
  });
  it('marks the web server’s own calls with the internal token when it has one (SEC-48)', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', 'x'.repeat(40));
    const { tenantApiHeaders } = await load('flexcity.ca');
    expect(tenantApiHeaders('kelowna')['x-fh-internal']).toBe('x'.repeat(40));
  });
  it('round-trips through subdomainFromHost', async () => {
    const { tenantApiHeaders, subdomainFromHost } = await load('flexcity.ca');
    expect(subdomainFromHost(tenantApiHeaders('maple')['x-forwarded-host']!)).toBe('maple');
  });
});

describe('currentTenant', () => {
  it('remembers an unknown subdomain for a minute instead of asking the API on every view (review of #77)', async () => {
    vi.doMock('next/headers', () => ({ headers: async () => new Headers({ host: 'nowhere.flexcity.ca' }) }));
    const fetcher = vi.fn(async () => new Response('{"code":"NOT_FOUND"}', { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const { currentTenant, rememberUnknown, knownUnknown, UNKNOWN_TTL_MS, UNKNOWN_MAX } = await load('flexcity.ca');
      expect(await currentTenant()).toBeNull();
      expect(await currentTenant()).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
      // Forgotten after a minute, and the list stays bounded.
      const now = Date.now();
      rememberUnknown('later', now);
      expect(knownUnknown('later', now + UNKNOWN_TTL_MS - 1)).toBe(true);
      expect(knownUnknown('later', now + UNKNOWN_TTL_MS + 1)).toBe(false);
      for (let i = 0; i <= UNKNOWN_MAX; i++) rememberUnknown(`s${i}`, now);
      expect(knownUnknown('s0', now)).toBe(false);
      expect(knownUnknown(`s${UNKNOWN_MAX}`, now)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock('next/headers');
    }
  });

  it('a real organization is asked for as before (Next caches the answer)', async () => {
    vi.doMock('next/headers', () => ({ headers: async () => new Headers({ host: 'kelowna.flexcity.ca' }) }));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 't', name: 'Kelowna', logoUrl: null, themeColors: {}, defaultLocale: 'en-CA' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const { currentTenant } = await load('flexcity.ca');
      expect((await currentTenant())?.name).toBe('Kelowna');
      expect((await currentTenant())?.name).toBe('Kelowna');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock('next/headers');
    }
  });
});
