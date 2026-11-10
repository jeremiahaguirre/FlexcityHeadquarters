import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { type HttpRequest, setTransport } from '../../src/services/payroll/providers.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'provcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { hr: '', noPasskey: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
});
// The provider's side, in memory.
const seen: HttpRequest[] = [];
let answer = (r: HttpRequest) => (r.url.includes('token') ? { status: 200, body: JSON.stringify({ access_token: 'tok-123', token_type: 'Bearer' }) } : { status: 202, body: JSON.stringify({ id: 'IMP-42' }) });

const CERT = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIEfake\n-----END PRIVATE KEY-----';

beforeAll(async () => {
  setTransport(async (r) => {
    seen.push(r);
    return answer(r);
  });
  t = await seedTenant(SUB, 2);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const now = Math.floor(Date.now() / 1000);
  const hr = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hr', lastName: 'X', email: `hr@${SUB}.test` } })).id;
  tok.hr = await signAccessToken({ sub: hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.noPasskey = await signAccessToken({ sub: hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now });
  for (const u of t.users) {
    await owner.user.update({ where: { id: u.id }, data: { employeeNumber: `E-${u.firstName}` } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
    for (const d of [2, 3, 4]) {
      const start = new Date(Date.UTC(2026, 2, d, 16));
      await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 7 * 3_600_000), status: 'APPROVED' } });
    }
  }
  for (const key of ['REGULAR', 'OVERTIME_1_5', 'OVERTIME_2_0', 'STAT_WORKED', 'STAT_HOLIDAY_PAY', 'SHIFT_PREMIUM', 'VACATION_PAY'] as const) {
    await owner.payCodeMapping.create({ data: { tenantId: t.tenant.id, key, code: key.slice(0, 3) } });
  }
});
afterAll(async () => {
  setTransport(null);
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('payroll provider connections', () => {
  it('starts in the app, and needs a provider connected before switching to it', async () => {
    const r = await call(tok.hr).get('/api/payroll/provider');
    expect(r.body).toMatchObject({ mode: 'in_app', adp: null, dayforce: null, wagepoint: null });
    expect((await call(tok.hr).put('/api/payroll/provider/mode', { mode: 'adp' })).body.code).toBe('PROVIDER_NOT_SET');
  });

  it('connects ADP with sealed secrets, refuses addresses outside adp.com, and needs a passkey', async () => {
    const body = { clientId: 'client-abc', clientSecret: 'super-secret-1', certificate: CERT, privateKey: KEY, companyCode: 'abc', batchId: '0320' };
    expect((await call(tok.noPasskey).put('/api/payroll/provider/adp', body)).body.code).toBe('PASSKEY_REQUIRED');
    expect((await call(tok.hr).put('/api/payroll/provider/adp', { ...body, importUrl: 'https://evil.example/import' })).body.code).toBe('PROVIDER_URL');
    expect((await call(tok.hr).put('/api/payroll/provider/adp', { ...body, importUrl: 'http://api.adp.com/x' })).body.code).toBe('PROVIDER_URL');
    const r = await call(tok.hr).put('/api/payroll/provider/adp', body);
    expect(r.status).toBe(200);
    expect(r.body.adp).toMatchObject({ clientId: 'client-abc', companyCode: 'ABC', hasSecret: true, hasCertificate: true });
    expect(JSON.stringify(r.body)).not.toContain('super-secret-1');
    const stored = JSON.stringify((await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).payrollSettings);
    expect(stored).not.toContain('super-secret-1');
    expect(stored).not.toContain('MIIEfake');
    // Saving again without the secrets keeps them.
    expect((await call(tok.hr).put('/api/payroll/provider/adp', { clientId: 'client-abc', companyCode: 'ABC' })).status).toBe(200);
  });

  it('tests the connection: signs in over mutual TLS with the certificate', async () => {
    seen.length = 0;
    const r = await call(tok.hr).post('/api/payroll/provider/adp/test');
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://accounts.adp.com/auth/oauth/v2/token');
    expect(seen[0]!.cert).toBe(CERT);
    expect(seen[0]!.key).toBe(KEY);
    expect(seen[0]!.headers.authorization).toBe(`Basic ${Buffer.from('client-abc:super-secret-1').toString('base64')}`);
    expect((await call(tok.hr).get('/api/payroll/provider')).body.tested.adp).toBeTruthy();
  });

  it('sends a period in ADP’s layout and keeps a record of it', async () => {
    expect((await call(tok.hr).put('/api/payroll/provider/mode', { mode: 'adp' })).status).toBe(200);
    seen.length = 0;
    const r = await call(tok.hr).post('/api/payroll/provider/adp/send', { periodStart: '2026-03-02', weeks: 1 });
    expect(r.status).toBe(201);
    const sent = seen.find((x) => x.url.includes('payroll-imports'))!;
    // One row per pay line (regular hours, vacation pay…), as in the downloaded file.
    expect(r.body).toMatchObject({ reference: 'IMP-42', rows: String(sent.body).trim().split('\r\n').length - 1 });
    expect(sent.headers.authorization).toBe('Bearer tok-123');
    expect(String(sent.body).split('\r\n')[0]).toMatch(/^Co Code,Batch ID,File #/);
    expect(String(sent.body).split('\r\n')[1]).toMatch(/^ABC,0320,E-Guard\d,/);
    const history = (await call(tok.hr).get('/api/payroll/provider')).body.history;
    expect(history[0]).toMatchObject({ provider: 'adp', status: 'SENT', reference: 'IMP-42', periodStart: '2026-03-02', periodEnd: '2026-03-08' });
  });

  it('records a refusal from the provider instead of losing it', async () => {
    // Sending the same period again needs saying so: it could pay people twice.
    const again = await call(tok.hr).post('/api/payroll/provider/adp/send', { periodStart: '2026-03-02', weeks: 1 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_SENT');
    answer = (r) => (r.url.includes('token') ? { status: 200, body: '{"access_token":"tok"}' } : { status: 400, body: JSON.stringify({ message: 'Unknown file number E-Guard1' }) });
    const r = await call(tok.hr).post('/api/payroll/provider/adp/send', { periodStart: '2026-03-02', weeks: 1, resend: true });
    expect(r.status).toBe(502);
    expect(r.body.message).toContain('Unknown file number E-Guard1');
    expect((await call(tok.hr).get('/api/payroll/provider')).body.history[0]).toMatchObject({ status: 'FAILED', httpStatus: 400 });
  });

  it('connects Dayforce and Wagepoint too, and disconnecting returns to the app', async () => {
    answer = (r) => (r.url.includes('token') ? { status: 200, body: '{"access_token":"df"}' } : { status: 200, body: '{}' });
    expect((await call(tok.hr).put('/api/payroll/provider/dayforce', { clientId: 'df-client', clientSecret: 'df-secret-123', clientNamespace: 'lakeview' })).status).toBe(200);
    expect((await call(tok.hr).put('/api/payroll/provider/wagepoint', { apiKey: 'wp-key-0123456789abcdef', companyId: 'C123' })).status).toBe(200);
    // Only the provider in use: the hours can't go to two places.
    expect((await call(tok.hr).post('/api/payroll/provider/dayforce/send', { periodStart: '2026-03-02', weeks: 1 })).body.code).toBe('PROVIDER_NOT_IN_USE');
    expect((await call(tok.hr).put('/api/payroll/provider/mode', { mode: 'dayforce' })).status).toBe(200);
    seen.length = 0;
    expect((await call(tok.hr).post('/api/payroll/provider/dayforce/send', { periodStart: '2026-03-02', weeks: 1 })).status).toBe(201);
    expect(seen.map((x) => x.url)).toEqual(['https://dfid.dayforcehcm.com/connect/token', 'https://www.dayforcehcm.com/api/lakeview/V1/Imports/PayrollImport']);
    expect(String(seen[1]!.body).split('\r\n')[0]).toMatch(/^EmployeeXRefCode/);
    expect((await call(tok.hr).put('/api/payroll/provider/mode', { mode: 'wagepoint' })).status).toBe(200);
    seen.length = 0;
    expect((await call(tok.hr).post('/api/payroll/provider/wagepoint/send', { periodStart: '2026-03-02', weeks: 1 })).status).toBe(201);
    expect(seen[0]!.url).toBe('https://api.wagepoint.com/v1/companies/C123/hours/import');
    expect(seen[0]!.headers['x-api-key']).toBe('wp-key-0123456789abcdef');
    expect((await call(tok.hr).put('/api/payroll/provider/mode', { mode: 'adp' })).status).toBe(200);
    const off = await call(tok.hr).del('/api/payroll/provider/adp');
    expect(off.body).toMatchObject({ mode: 'in_app', adp: null });
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'payroll.provider.send' } })).toBe(4);
  });
});
