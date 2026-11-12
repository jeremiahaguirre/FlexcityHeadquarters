import { describe, expect, it } from 'vitest';
import { nearest } from './demoApi';
import { loadFixtures, lookupKey, shiftDate, shiftDates, within } from './demoFixtures';

describe('demo fixtures', () => {
  it('ignores date range bounds when looking up a response', () => {
    expect(lookupKey('/api/me/shifts?from=2026-11-09T00%3A00%3A00.000Z&to=2026-11-10T00%3A00%3A00.000Z')).toBe('/api/me/shifts');
    expect(lookupKey('/api/users?status=ACTIVE&q=jo')).toBe('/api/users?q=jo&status=ACTIVE');
    // Recorded in November 2026, still found in December and the next year.
    expect(lookupKey('/api/payroll/remittance?month=2026-12')).toBe(lookupKey('/api/payroll/remittance?month=2026-11'));
    expect(lookupKey('/api/payroll/t4?year=2027')).toBe('/api/payroll/t4');
  });

  it('moves dates by whole days and keeps the time and offset', () => {
    expect(shiftDate('2026-11-09T06:00:00-08:00', 3)).toBe('2026-11-12T06:00:00-08:00');
    expect(shiftDate('2026-12-30', 3)).toBe('2027-01-02');
    expect(shiftDate('Main Tank', 3)).toBe('Main Tank');
    expect(shiftDates({ '2026-11-09': [[360, 840]], name: 'x' }, 1)).toEqual({ '2026-11-10': [[360, 840]], name: 'x' });
  });

  it('filters lists to the requested range', () => {
    const items = [{ startsAt: '2026-11-09T16:00:00Z' }, { startsAt: '2026-11-12T16:00:00Z' }];
    expect(within(items, new URLSearchParams('from=2026-11-09T00:00:00Z&to=2026-11-10T00:00:00Z'))).toEqual([items[0]]);
  });

  it('serves every role a profile, with dates moved to today', async () => {
    for (const role of ['guard', 'supervisor', 'hr', 'frontdesk', 'steward', 'waterworks'] as const) {
      const f = await loadFixtures(role, '2030-01-15');
      expect(f.get('/api/me')).toMatchObject({ permissions: expect.any(Array) });
      expect(JSON.stringify(f.get('/api/me'))).not.toMatch(/kelowna/i);
    }
  });

  it('serves the Dev console with the embedded demo logo instead of an API address', async () => {
    const f = await loadFixtures('platform', '2030-01-15');
    const cities = f.get('/tenants') as Array<{ name: string; logoUrl: string | null }>;
    expect(cities.length).toBeGreaterThan(1);
    expect(cities.some((c) => c.logoUrl?.startsWith('data:image/png;base64,'))).toBe(true);
    expect(JSON.stringify(cities)).not.toMatch(/api\/public\/logo|kelowna/i);
  });
});

describe('Dev console in the demo', () => {
  it('has a recording for every Dev console screen', async () => {
    const f = await loadFixtures('platform', '2030-01-15');
    const cities = f.get('/tenants') as Array<{ id: string }>;
    const invoices = f.get('/billing/invoices') as Array<{ id: string }>;
    const tests = f.get('/trust/tests') as Array<{ key: string }>;
    const screens = [
      '/me', '/passkeys', '/billing/summary', '/billing/pad-originator', '/billing/pad-debits?date=2030-01-15', '/books', '/books/journal?from=2030-01-01&to=2030-01-15',
      '/books/trial-balance?asOf=2030-01-15', '/books/income-statement?from=2030-01-01&to=2030-01-15', '/books/aging?asOf=2030-01-15', '/books/sales-tax?from=2030-01-01&to=2030-01-15',
      '/books/revenue?year=2030', '/leads', '/payroll-tax?year=2030', '/trust/overview?days=30', '/trust/frameworks', '/trust/controls', '/trust/tests', '/trust/evidence',
      '/trust/policies', '/trust/risks', '/trust/vendors', '/trust/commitments', '/trust/answers', '/trust/people',
      ...cities.flatMap((c) => [`/tenants/${c.id}`, `/tenants/${c.id}/access`, `/tenants/${c.id}/integrations`, `/tenants/${c.id}/payroll`, `/tenants/${c.id}/lifecycle`, `/tenants/${c.id}/consents`, `/billing/accounts/${c.id}`, `/billing/pad/${c.id}`, `/billing/invoices?tenantId=${c.id}`]),
      ...invoices.map((i) => `/billing/invoices/${i.id}`),
      ...tests.map((x) => `/trust/tests/${x.key}/history?days=90`),
    ];
    expect(screens.filter((s) => f.get(s) === undefined)).toEqual([]);
    expect((f.get('/leads') as unknown[]).length).toBeGreaterThan(0);
  });

  it('answers options nobody recorded with the closest recording of the same address', async () => {
    const f = await loadFixtures('platform', '2030-01-15');
    expect(nearest(f, '/trust/overview?days=30&frameworks=soc2,pipeda')).toEqual(f.get('/trust/overview?days=30'));
    expect(nearest(f, '/trust/overview?days=45')).toBeDefined();
    expect(nearest(f, '/nothing/here')).toBeUndefined();
  });
});

describe('demo answers in either language', () => {
  it('answers a French request with the English recording when only that was recorded', async () => {
    const f = await loadFixtures('hr');
    expect(f.get('/api/billing?lang=en-CA')).toBeDefined();
    expect(f.get('/api/billing?lang=fr-CA')).toEqual(f.get('/api/billing?lang=en-CA'));
  });
});
