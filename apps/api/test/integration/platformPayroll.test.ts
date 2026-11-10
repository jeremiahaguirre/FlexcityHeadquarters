import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
let t: Awaited<ReturnType<typeof seedTenant>>;
let cookie = '';
const p = (method: 'get' | 'put' | 'post' | 'delete', path: string, body?: object) => {
  const r = request(server)[method](`/api/platform${path}`).set('x-fh-platform', '1').set('Cookie', cookie);
  return body ? r.send(body) : r;
};

beforeAll(async () => {
  t = await seedTenant('paysetup', 1);
  const email = `pay-${randomBytes(3).toString('hex')}@flexcity.dev`;
  await owner.platformAdmin.create({ data: { email, name: 'P', passwordHash: await hashPassword('right password!') } });
  resetLimits();
  const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('Dev console: a city’s in-app payroll, paid from its own bank', () => {
  it('shows what’s missing before pay can go from the city’s bank to its staff', async () => {
    const r = await p('get', `/tenants/${t.tenant.id}/payroll`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'in_app', bank: { configured: false }, readiness: { ready: false, bankConnected: false } });
    expect(r.body.readiness.missing).toEqual(expect.arrayContaining(['originatorId', 'returnsAccount']));
  });

  it('saves the deposit details (the returns account sealed) and turns in-app payroll on', async () => {
    expect((await p('put', `/tenants/${t.tenant.id}/payroll`, { originatorId: '12345 67' })).status).toBe(400);
    const r = await p('put', `/tenants/${t.tenant.id}/payroll`, { inApp: true, businessNumber: '123456789RP0001', originatorId: '1234567890', originatorShortName: 'PAYSETUP', originatorLongName: 'CITY OF PAYSETUP', destinationDataCentre: '00120', returnsInstitution: '001', returnsTransit: '00011', returnsAccount: '1234567' });
    expect(r.status).toBe(200);
    expect(r.body.readiness).toMatchObject({ ready: true, missing: [] });
    expect(r.body.deposit.returnsAccount).toBe('••••4567');
    const stored = JSON.stringify((await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).payrollSettings);
    expect(stored).not.toContain('1234567"');
  });

  it('sets up the bank connection with a sealed credential, and logs every change', async () => {
    const r = await p('put', `/tenants/${t.tenant.id}/payroll/bank`, { host: 'sftp.bank.example', username: 'paysetup', remoteDir: '/in', hostKeySha256: `SHA256:${'A'.repeat(43)}`, password: 'bank-pass-123', autoSend: true });
    expect(r.status).toBe(200);
    expect(r.body.bank).toMatchObject({ host: 'sftp.bank.example', autoSend: true });
    expect(r.body.readiness).toMatchObject({ bankConnected: true, autoSend: true });
    expect(JSON.stringify((await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).payrollSettings)).not.toContain('bank-pass-123');
    expect((await p('delete', `/tenants/${t.tenant.id}/payroll/bank`)).body.bank).toEqual({ configured: false });
    const actions = (await owner.platformAudit.findMany({ where: { tenantId: t.tenant.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['payroll.setup', 'payroll.bank_connection', 'payroll.bank_connection.remove']));
  });
});
