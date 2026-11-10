import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'payees';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr = '';
let sup = '';
const as = (tok: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok, { type: 'bearer' }).send(b),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(tok, { type: 'bearer' }).send(b),
});
const ADDR = { line1: '1435 Water St', city: 'Kelowna', province: 'BC', postalCode: 'V1Y 1J4' };

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  const now = Math.floor(Date.now() / 1000);
  const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hr', lastName: 'X', email: `hr@${SUB}.test` } });
  hr = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sup', lastName: 'X', email: `sup@${SUB}.test` } });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('T4A for contractors and honoraria', () => {
  let instructor = '';
  it('HR adds payees: a person (SIN sealed) or a business', async () => {
    expect((await as(sup).get('/api/payees')).status).toBe(403);
    expect((await as(hr).post('/api/payees', { kind: 'PERSON', firstName: 'Jo', lastName: 'Park', sin: '123 456 789' })).body.code).toBe('INVALID_SIN');
    const p = await as(hr).post('/api/payees', { kind: 'PERSON', firstName: 'Jo', lastName: 'Park', sin: '130 692 544', address: ADDR });
    expect(p.status).toBe(201);
    expect(p.body.sin).toBe('•••-•••-544');
    instructor = p.body.id;
    const stored = await owner.payee.findUniqueOrThrow({ where: { id: instructor } });
    expect(Buffer.from(stored.sinCiphertext!).toString()).not.toContain('130692544');
    const b = await as(hr).post('/api/payees', { kind: 'BUSINESS', businessName: 'Splash Safety Co.', businessNumber: '123456789', address: ADDR });
    expect(b.status).toBe(201);
    await as(hr).post(`/api/payees/${b.body.id}/payments`, { paidOn: '2026-06-01', box: '048', amount: 300, description: 'Rescue mannequin repair' });
  });

  it('slips only for payees over $500 (or with tax withheld), by box', async () => {
    await as(hr).post(`/api/payees/${instructor}/payments`, { paidOn: '2026-03-15', box: '048', amount: 450, description: 'Instructor course, March' });
    await as(hr).post(`/api/payees/${instructor}/payments`, { paidOn: '2026-07-15', box: '048', amount: 450, description: 'Instructor course, July' });
    await as(hr).post(`/api/payees/${instructor}/payments`, { paidOn: '2026-09-01', box: '028', amount: 200, description: 'Committee honorarium' });
    const r = (await as(hr).get('/api/payroll/t4a?year=2026')).body;
    expect(r.under).toBe(1);
    expect(r.slips).toEqual([expect.objectContaining({ payeeId: instructor, name: 'Jo Park', total: 1100, boxes: { '048': 900, '028': 200 } })]);
  });

  it('the XML needs the employer details first, then has the SIN and both boxes', async () => {
    expect((await as(hr).get('/api/payroll/t4a.xml?year=2026')).body.code).toBe('FILING_INCOMPLETE');
    expect((await as(hr).put('/api/payroll/settings', { businessNumber: '123456789RP0001', employerMailing: ADDR, filingContact: { name: 'Pat Lee', phone: '250-555-0100' } })).status).toBe(200);
    const x = await as(hr).get('/api/payroll/t4a.xml?year=2026');
    expect(x.status).toBe(200);
    expect(x.text).toContain('<sin>130692544</sin>');
    expect(x.text).toContain('<fee_or_oth_srvc_amt>900.00</fee_or_oth_srvc_amt>');
    expect(x.text).toContain('<oth_incamt>200.00</oth_incamt>');
    expect(x.text).toContain('<slp_cnt>1</slp_cnt>');
    expect(await owner.auditLog.count({ where: { action: 'payroll.t4a.xml' } })).toBe(1);
  });
});
