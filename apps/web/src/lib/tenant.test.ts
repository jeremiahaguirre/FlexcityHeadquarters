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
  it('round-trips through subdomainFromHost', async () => {
    const { tenantApiHeaders, subdomainFromHost } = await load('flexcity.ca');
    expect(subdomainFromHost(tenantApiHeaders('maple')['x-forwarded-host']!)).toBe('maple');
  });
});
