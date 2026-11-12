import { afterEach, describe, expect, it, vi } from 'vitest';

// Trust alert emails link to the Dev console. In production that must be the deployed address
// (derived from PUBLIC_APP_URL), never the development default http://localhost:3000.
const load = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  return (await import('../../src/services/trust/reminders.js')).platformAppUrl();
};
const base = { APP_DATABASE_URL: 'postgresql://u:p@localhost/db', JWT_SECRET: 'x'.repeat(40) };

afterEach(() => vi.unstubAllEnvs());

describe('platformAppUrl', () => {
  it('drops the organization from PUBLIC_APP_URL', async () => {
    expect(await load({ ...base, PLATFORM_APP_URL: undefined, PUBLIC_APP_URL: 'https://{subdomain}.flexcity.ca' })).toBe('https://flexcity.ca');
  });
  it('uses PLATFORM_APP_URL when set, without a trailing slash', async () => {
    expect(await load({ ...base, PLATFORM_APP_URL: 'https://console.flexcity.ca/', PUBLIC_APP_URL: 'https://{subdomain}.flexcity.ca' })).toBe('https://console.flexcity.ca');
  });
});
