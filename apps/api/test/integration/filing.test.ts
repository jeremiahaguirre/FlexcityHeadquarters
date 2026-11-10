import { randomBytes } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import sax from 'sax';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'filecity';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { hr: '', hr2: '', noPasskey: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
// Passes the SIN check digit.
const SIN = '130 692 544';

/** Strict well-formedness check (xmldom alone forgives broken XML). */
function wellFormed(xml: string): string | null {
  const p = sax.parser(true);
  let error: string | null = null;
  p.onerror = (e) => {
    error ??= e.message.split('\n')[0]!;
    p.resume();
  };
  p.write(xml).close();
  return error;
}

function parse(xml: string) {
  expect(wellFormed(xml)).toBeNull();
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: { error: (m: string) => void errors.push(m), fatalError: (m: string) => void errors.push(m) } }).parseFromString(xml, 'application/xml');
  expect(errors).toEqual([]);
  const all = (name: string) => Array.from(doc.getElementsByTagName(name));
  const text = (name: string, within?: Element) => (within ?? doc).getElementsByTagName(name)[0]?.textContent ?? null;
  return { doc, all, text };
}

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { name: 'Town of Smith & Sons', payWeekStartDay: 1 } });
  const now = Math.floor(Date.now() / 1000);
  const mk = async (name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } })).id;
  const hr = await mk('hr');
  tok.hr = await signAccessToken({ sub: hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.hr2 = await signAccessToken({ sub: await mk('hr2'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.noPasskey = await signAccessToken({ sub: hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now });
  for (const u of t.users) {
    await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-05-01'), employeeNumber: `E-${u.firstName}` } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
    for (const d of [2, 3, 4, 5, 9, 10, 11, 12]) {
      const start = new Date(Date.UTC(2026, 2, d, 16));
      await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 7 * 3_600_000), status: 'APPROVED' } });
    }
  }
  await ensureTaxTables(owner, 2026);
  await owner.payrollTaxTable.updateMany({ where: { year: 2026, verifiedAt: null }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
  const run = await call(tok.hr).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-03-02', weeks: 2, payDate: '2026-03-20' });
  expect((await call(tok.hr2).post(`/api/payroll/runs/${run.body.id}/approve`)).status).toBe(200);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('T4 XML for CRA', () => {
  it('the well-formedness check itself catches broken XML', () => {
    expect(wellFormed('<a><b>x & y</b></a>')).not.toBeNull();
    expect(wellFormed('<a><b>x</a>')).not.toBeNull();
  });

  it('lists what’s missing instead of making a file CRA would reject', async () => {
    const r = await call(tok.hr).get('/api/payroll/t4.xml?year=2026');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FILING_INCOMPLETE');
    const problems = r.body.details.problems as Array<{ code: string; name?: string }>;
    expect(problems.map((p) => p.code)).toEqual(expect.arrayContaining(['NO_BN', 'NO_EMPLOYER_ADDRESS', 'NO_CONTACT', 'NO_SIN', 'NO_ADDRESS']));
    expect(problems).toContainEqual({ code: 'NO_SIN', name: 'filecity, Guard0' });
  });

  it('builds a well-formed return matching the T4 slips, with full SINs, only with a passkey', async () => {
    expect((await call(tok.hr).put('/api/payroll/settings', { businessNumber: '123456789RP0001', filingContact: { name: 'Pat Payroll', phone: '(250) 555-0100', email: 'pay@filecity.test' }, employerMailing: { line1: '1 Civic Plaza', city: 'Kelowna', province: 'BC', postalCode: 'v1y1a1' } })).status).toBe(200);
    for (const u of t.users) {
      expect((await call(tok.hr).put(`/api/users/${u.id}/pay-profile`, { sin: SIN, mailingAddress: { line1: `${u.firstName} Street`, city: 'Kelowna', province: 'BC', postalCode: 'V1Y 2B2' } })).status).toBeLessThan(300);
    }
    expect((await call(tok.noPasskey).get('/api/payroll/t4.xml?year=2026')).body.code).toBe('PASSKEY_REQUIRED');

    const r = await call(tok.hr).get('/api/payroll/t4.xml?year=2026').buffer(true).parse((res, cb) => {
      let s = '';
      res.on('data', (c: Buffer) => (s += c.toString()));
      res.on('end', () => cb(null, s));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/xml/);
    expect(r.headers['cache-control']).toBe('no-store');
    const xml = r.body as string;
    const { all, text } = parse(xml);
    const t4 = (await call(tok.hr).get('/api/payroll/t4?year=2026')).body;
    const slips = all('T4Slip');
    expect(slips).toHaveLength(2);
    expect(text('sin', slips[0])).toBe('130692544');
    expect(text('bn', slips[0])).toBe('123456789RP0001');
    expect(text('empt_prov_cd', slips[0])).toBe('BC');
    expect(text('pstl_cd', slips[0])).toBe('V1Y2B2');
    const first = t4.slips.find((s: { name: string }) => s.name.startsWith(text('snm', slips[0])!));
    expect(Number(text('empt_incamt', slips[0]))).toBeCloseTo(first.box14EmploymentIncome, 2);
    expect(Number(text('cpp_cntrb_amt', slips[0]))).toBeCloseTo(first.box16Cpp, 2);
    expect(Number(text('itx_ddct_amt', slips[0]))).toBeCloseTo(first.box22IncomeTax, 2);
    expect(Number(text('tot_empt_incamt'))).toBeCloseTo(t4.summary.box14, 2);
    expect(Number(text('tot_empr_cpp_amt'))).toBeCloseTo(t4.summary.box27EmployerCpp, 2);
    expect(text('slp_cnt')).toBe('2');
    expect(text('tx_yr')).toBe('2026');
    // The ampersand in the city's name is escaped, not left to break the file.
    expect(xml).toContain('Town of Smith &amp; Sons');
    expect(text('l1_nm')).toBe('Town of Smith & Sons');
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'payroll.t4.xml' } })).toBe(1);
  });
});

describe('ROE Web XML', () => {
  it('builds a Record of Employment with insurable earnings by pay period', async () => {
    const u = t.users[0]!;
    expect((await call(tok.hr).post(`/api/payroll/roe/${u.id}/xml`, { reason: 'X', recall: 'N' })).status).toBe(400);
    expect((await call(tok.hr).post(`/api/payroll/roe/${u.id}/xml`, { reason: 'A', recall: 'Y' })).status).toBe(400); // needs the recall date
    const r = await call(tok.hr)
      .post(`/api/payroll/roe/${u.id}/xml`, { reason: 'A', recall: 'Y', recallDate: '2026-06-01', lastDay: '2026-03-13', comments: 'End of season <winter>' })
      .buffer(true)
      .parse((res, cb) => {
        let s = '';
        res.on('data', (c: Buffer) => (s += c.toString()));
        res.on('end', () => cb(null, s));
      });
    expect(r.status).toBe(200);
    const { all, text, doc } = parse(r.body as string);
    expect(doc.documentElement?.getAttribute('FileVersion')).toBe('W-2.0');
    const roe = (await call(tok.hr).get(`/api/payroll/roe/${u.id}`)).body;
    expect(text('B8')).toBe('130692544');
    expect(text('B5')).toBe('123456789RP0001');
    expect(text('B6')).toBe('B');
    expect(text('B10')).toBe('2024-05-01');
    expect(text('B11')).toBe('2026-03-13');
    expect(text('CD', all('B14')[0])).toBe('Y');
    expect(text('DT', all('B14')[0])).toBe('2026-06-01');
    expect(Number(text('B15A'))).toBe(Math.round(roe.totalInsurableHours));
    expect(all('PP')).toHaveLength(roe.periods.length);
    expect(Number(text('AMT', all('PP')[0]))).toBeCloseTo(roe.periods[0].insurableEarnings, 2);
    expect(text('CD', all('B16')[0])).toBe('A');
    expect(text('B18')).toBe('End of season <winter>');
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'payroll.roe.xml', entityId: u.id } })).toBe(1);
  });
});
