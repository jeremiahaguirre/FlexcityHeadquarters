import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'padcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
let cookie: string;
let hr: string;
const dev = (m: 'get' | 'post' | 'put' | 'patch' | 'delete', p: string, b?: object) => request(server)[m](`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(b);
const city = (m: 'get' | 'post', p: string, b?: object) => request(server)[m](`/api/${p}`).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send(b);
const plus = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const ACCOUNT = '0012345678';

let invoiceId = '';
let issue = '';
let due = '';

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const email = `books-${randomBytes(3).toString('hex')}@flexcity.dev`;
  await owner.platformAdmin.create({ data: { email, name: 'B', passwordHash: await hashPassword('right password!') } });
  const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
  cookie = String(r.headers['set-cookie']).split(';')[0]!;
  const hrUser = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hr', lastName: 'X', email: `hr@${SUB}.test` } });
  hr = await signAccessToken({ sub: hrUser.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000), mfa: true });
  expect((await dev('put', `/billing/accounts/${t.tenant.id}`, { plan: 'MUNICIPAL', legalName: 'City of Pad', contactName: 'AP', email: 'ap@pad.test', addressLine1: null, addressLine2: null, city: null, province: 'ON', postalCode: null, poNumber: null, paymentTermsDays: 30, taxExempt: false, taxExemptNote: null, level: 'MULTI_COMPLEX', quotedRateCents: 300_000, modules: [], clubUserRateCents: 500, notes: null, facilities: [{ id: t.facility.id, tier: 2, customCents: null }] })).status).toBe(200);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('pre-authorized debit for plan charges', () => {
  it('the city authorizes it in the app; the full account number never comes back', async () => {
    const bad = await city('post', 'billing/pad', { payorName: 'City of Pad', signerName: 'Dana Treasurer', signerTitle: 'Treasurer', institution: '004', transit: '12345', account: ACCOUNT, agree: false });
    expect(bad.status).toBe(400);
    const r = await city('post', 'billing/pad', { payorName: 'City of Pad', signerName: 'Dana Treasurer', signerTitle: 'Treasurer', institution: '004', transit: '12345', account: ACCOUNT, agree: true });
    expect(r.status).toBe(201);
    expect(r.body.account).toBe('•••5678');
    expect(JSON.stringify(r.body)).not.toContain(ACCOUNT);
    const stored = await owner.padAgreement.findFirstOrThrow({ where: { tenantId: t.tenant.id } });
    expect(JSON.stringify(stored.accountSealed)).not.toContain(ACCOUNT);
    expect((await city('get', 'billing')).body.pad.agreement).toMatchObject({ status: 'ACTIVE', signerName: 'Dana Treasurer' });
    // The written confirmation the rules call for.
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, template: 'pad_confirmation', toEmail: 'ap@pad.test' } })).toBe(1);
    expect((await dev('get', `/billing/pad/${t.tenant.id}`)).body.active).toMatchObject({ channel: 'ORGANIZATION', account: '•••5678' });
  });

  it('the invoice tells the city when it will be debited', async () => {
    const month = new Date().toISOString().slice(0, 7);
    expect((await dev('post', '/billing/invoices/generate', { month, tenantIds: [t.tenant.id] })).body).toMatchObject({ created: 1 });
    invoiceId = (await dev('get', `/billing/invoices?tenantId=${t.tenant.id}`)).body[0].id;
    expect((await dev('post', `/billing/invoices/${invoiceId}/send`)).status).toBe(200);
    const inv = (await dev('get', `/billing/invoices/${invoiceId}`)).body;
    issue = inv.issueDate;
    due = inv.dueDate;
    expect(inv.totalCents).toBe(339_000);
    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { tenantId: t.tenant.id, template: 'invoice' } });
    expect((mail.params as { padAccount?: string }).padAccount).toBe('004-12345 •••5678');
  });

  it('builds a CPA-005 debit file once notice has been given, then settles and handles a return', async () => {
    expect((await dev('post', '/billing/pad-batches', { debitDate: due })).body.code).toBe('NO_ORIGINATOR');
    expect((await dev('put', '/billing/pad-originator', { originatorId: 'FHQ0000001', dataCentre: '00330', shortName: 'FLEXCITY HQ', longName: 'FLEXCITYHEADQUARTERS INC', returns: { institution: '003', transit: '00011', account: '7654321' } })).status).toBe(200);
    // Too soon after the invoice: the 10-day notice isn't up.
    const early = (await dev('get', `/billing/pad-debits?date=${plus(issue, 3)}`)).body.invoices.filter((i: { tenantId: string }) => i.tenantId === t.tenant.id);
    expect(early).toHaveLength(0); // not due yet either
    const ready = (await dev('get', `/billing/pad-debits?date=${due}`)).body.invoices.find((i: { invoiceId: string }) => i.invoiceId === invoiceId);
    expect(ready).toMatchObject({ amountCents: 339_000, ready: true });

    const batch = await dev('post', '/billing/pad-batches', { debitDate: due, invoiceIds: [invoiceId] });
    expect(batch.status).toBe(201);
    expect(batch.body).toMatchObject({ count: 1, totalCents: 339_000 });
    // Already in a batch: not offered again.
    expect((await dev('get', `/billing/pad-debits?date=${due}`)).body.invoices.find((i: { invoiceId: string }) => i.invoiceId === invoiceId)).toBeUndefined();

    const file = await dev('get', `/billing/pad-batches/${batch.body.id}/file`);
    const records = file.text.split('\r\n').filter(Boolean);
    expect(records.every((r) => r.length === 1464)).toBe(true);
    expect(records[1]![0]).toBe('D');
    expect(records[1]).toContain('0000339000');
    expect(records[1]).toContain(ACCOUNT);
    expect(records.at(-1)!.slice(24, 38)).toBe('00000000339000'); // trailer: debit total first

    expect((await dev('post', `/billing/pad-batches/${batch.body.id}/settle`, { settledOn: due })).body.code).toBe('BATCH_STEP');
    expect((await dev('post', `/billing/pad-batches/${batch.body.id}/sent`)).status).toBe(200);
    expect((await dev('post', `/billing/pad-batches/${batch.body.id}/settle`, { settledOn: due })).status).toBe(200);
    expect((await dev('get', `/billing/invoices/${invoiceId}`)).body.status).toBe('PAID');

    // NSF: the payment comes back off and the balance is owing again.
    const debit = (await dev('get', `/billing/pad-debits?date=${due}`)).body.batches.find((b: { id: string }) => b.id === batch.body.id).debits[0];
    expect((await dev('post', `/billing/pad-debits/${debit.id}/return`, { reason: 'NSF', returnedOn: plus(due, 3) })).status).toBe(200);
    const after = (await dev('get', `/billing/invoices/${invoiceId}`)).body;
    expect(after).toMatchObject({ paidCents: 0, balanceCents: 339_000 });
  });

  it('a credit note and a write-off close the invoice', async () => {
    const d = plus(due, 5);
    expect((await dev('post', `/billing/invoices/${invoiceId}/credit`, { amountCents: 500_000, reason: 'Too much', date: d })).body.code).toBe('OVER_BALANCE');
    expect((await dev('post', `/billing/invoices/${invoiceId}/credit`, { amountCents: 113_000, reason: 'Pilot discount', date: d })).status).toBe(200);
    const w = await dev('post', `/billing/invoices/${invoiceId}/write-off`, { reason: 'Uncollectable', date: d });
    expect(w.body).toMatchObject({ status: 'PAID', paidCents: 339_000 });
  });
});

describe('FH books', () => {
  it('posts every step as balanced entries to the right accounts', async () => {
    const j = (await dev('get', `/books/journal?from=${issue}&to=${plus(due, 10)}`)).body.entries.filter((e: { tenantId: string }) => e.tenantId === t.tenant.id);
    const kinds = j.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(['INVOICE', 'PAYMENT', 'PAD_RETURN', 'CREDIT', 'WRITE_OFF']);
    for (const e of j) {
      const dr = e.lines.reduce((s: number, l: { debitCents: number }) => s + l.debitCents, 0);
      const cr = e.lines.reduce((s: number, l: { creditCents: number }) => s + l.creditCents, 0);
      expect(dr, e.kind).toBe(cr);
    }
    const inv = j[0];
    expect(inv.lines).toEqual(expect.arrayContaining([
      { account: '1200', debitCents: 339_000, creditCents: 0 },
      { account: '4000', debitCents: 0, creditCents: 300_000 },
      { account: '2300', debitCents: 0, creditCents: 39_000 },
    ]));
    // $1,130 credit including 13% HST: $1,000 to credits, $130 back off HST.
    expect(j[3].lines).toEqual(expect.arrayContaining([{ account: '4900', debitCents: 100_000, creditCents: 0 }, { account: '2300', debitCents: 13_000, creditCents: 0 }]));
    const csv = await dev('get', `/books/journal.csv?from=${issue}&to=${plus(due, 10)}`);
    expect(csv.text.split('\r\n')[0]).toBe('"Date","Reference","Type","Account","Account name","Debit","Credit","Organization","Memo"');
  });

  it('balances, ages receivables and reports tax and revenue', async () => {
    const tb = (await dev('get', `/books/trial-balance?asOf=${plus(due, 10)}`)).body;
    expect(tb.balanced).toBe(true);
    const aging = (await dev('get', `/books/aging?asOf=${plus(due, 4)}`)).body;
    expect(aging.rows.find((r: { tenantId: string }) => r.tenantId === t.tenant.id)).toMatchObject({ d1_30: 339_000 });
    expect((await dev('get', `/books/aging?asOf=${plus(due, 10)}`)).body.rows.find((r: { tenantId: string }) => r.tenantId === t.tenant.id)).toBeUndefined();
    const tax = (await dev('get', `/books/sales-tax?from=${issue}&to=${issue}`)).body;
    expect(tax.taxes.find((x: { key: string }) => x.key === 'gstHst').chargedCents).toBeGreaterThanOrEqual(39_000);
    expect(tax.byProvince.find((p: { province: string }) => p.province === 'ON').taxes.HST).toBeGreaterThanOrEqual(39_000);
    // $3,000 invoiced, less the $1,000 pre-tax credit note (if it fell in the same year).
    const rev = (await dev('get', `/books/revenue?year=${issue.slice(0, 4)}`)).body;
    const net = issue.slice(0, 4) === plus(due, 5).slice(0, 4) ? 200_000 : 300_000;
    expect(rev.organizations.find((o: { tenantId: string }) => o.tenantId === t.tenant.id).totalCents).toBe(net);
  });

  it('takes balanced manual entries in the chart, reverses them, and respects closed periods', async () => {
    expect((await dev('post', '/books/entries', { date: due, memo: 'Bank fee', lines: [{ account: '6100', debitCents: 1500, creditCents: 0 }, { account: '1000', debitCents: 0, creditCents: 1000 }] })).body.code).toBe('UNBALANCED');
    expect((await dev('post', '/books/entries', { date: due, memo: 'Bank fee', lines: [{ account: '9999', debitCents: 1500, creditCents: 0 }, { account: '1000', debitCents: 0, creditCents: 1500 }] })).status).toBe(400);
    const e = await dev('post', '/books/entries', { date: due, memo: 'Bank fee', lines: [{ account: '6100', debitCents: 1500, creditCents: 0 }, { account: '1000', debitCents: 0, creditCents: 1500 }] });
    expect(e.status).toBe(201);
    expect((await dev('post', `/books/entries/${e.body.id}/reverse`, { date: due })).status).toBe(201);
    const is = (await dev('get', `/books/income-statement?from=${due}&to=${due}`)).body;
    expect(is.expenses.find((x: { code: string }) => x.code === '6100')).toBeUndefined(); // fee and reversal cancel out

    expect((await dev('put', '/books/settings', { fiscalYearStart: 1, closedThrough: '2020-12-31' })).status).toBe(200);
    expect((await dev('post', '/books/entries', { date: '2020-06-30', memo: 'Late', lines: [{ account: '6100', debitCents: 100, creditCents: 0 }, { account: '1000', debitCents: 0, creditCents: 100 }] })).body.code).toBe('PERIOD_CLOSED');
    await dev('put', '/books/settings', { fiscalYearStart: 1, closedThrough: null });
  });
});
