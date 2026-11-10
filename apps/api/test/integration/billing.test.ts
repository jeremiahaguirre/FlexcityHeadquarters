import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
let t: Awaited<ReturnType<typeof seedTenant>>;
let cookie: string;
const dev = (m: 'get' | 'post' | 'put' | 'patch', p: string, b?: object) => request(server)[m](`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(b);
const MONTH = '2026-10';

const account = (over: object = {}) => ({
  plan: 'MUNICIPAL',
  legalName: 'City of Chi',
  contactName: 'Accounts Payable',
  email: 'ap@chi.test',
  addressLine1: '1435 Water St',
  addressLine2: null,
  city: 'Chi',
  province: 'ON',
  postalCode: 'K1A 0A1',
  poNumber: 'PO-77',
  paymentTermsDays: 30,
  taxExempt: false,
  taxExemptNote: null,
  level: 'MULTI_COMPLEX',
  quotedRateCents: 300_000,
  items: {},
  clubUserRateCents: 500,
  notes: null,
  facilities: [{ id: t.facility.id, tier: 2, customCents: null }],
  ...over,
});

beforeAll(async () => {
  t = await seedTenant('chi', 1);
  const email = `bill-${randomBytes(3).toString('hex')}@flexcity.dev`;
  await owner.platformAdmin.create({ data: { email, name: 'B', passwordHash: await hashPassword('right password!') } });
  const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
  cookie = String(r.headers['set-cookie']).split(';')[0]!;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('billing', () => {
  let id: string;

  it('a billing account sets the plan, its quoted rate and facility sizes; the estimate follows', async () => {
    // Business at the list price: $2,800 for a standard facility.
    expect((await dev('put', `/billing/accounts/${t.tenant.id}`, account({ level: 'BUSINESS', quotedRateCents: 999 }))).body.estimate.subtotalCents).toBe(280_000);
    const got = await dev('get', `/billing/accounts/${t.tenant.id}`);
    expect(got.body.account).toMatchObject({ level: 'BUSINESS', quotedRateCents: null });
    expect(got.body.catalog.public.ENTERPRISE).toMatchObject({ quoted: true, staffPerFacility: null });
    // Multi-complex quoted at $3,000 a facility; Ontario HST 13% = $390.
    const r = await dev('put', `/billing/accounts/${t.tenant.id}`, account());
    expect(r.status).toBe(200);
    expect(r.body.estimate).toMatchObject({ subtotalCents: 300_000, totalCents: 339_000, taxLines: [{ name: 'HST', rate: '13', amountCents: 39_000 }] });
    expect((await dev('put', `/billing/accounts/${t.tenant.id}`, account({ province: 'XX' }))).status).toBe(400);
  });

  it('drafts a month once, lets Dev adjust it, then sends it with the next number', async () => {
    expect((await dev('post', '/billing/invoices/generate', { month: MONTH, tenantIds: [t.tenant.id] })).body).toMatchObject({ created: 1 });
    expect((await dev('post', '/billing/invoices/generate', { month: MONTH, tenantIds: [t.tenant.id] })).body).toMatchObject({ exists: 1 });
    const list = await dev('get', `/billing/invoices?tenantId=${t.tenant.id}`);
    id = list.body[0].id;
    expect(list.body[0]).toMatchObject({ status: 'DRAFT', number: null, periodStart: '2026-10-01', periodEnd: '2026-10-31', totalCents: 339_000 });

    const edited = await dev('patch', `/billing/invoices/${id}`, {
      lines: [...list.body[0].lines.map((l: { description: string; quantity: number; unitCents: number }) => ({ description: l.description, quantity: l.quantity, unitCents: l.unitCents })), { description: 'Implementation (1 of 2)', quantity: 1, unitCents: 250_000 }],
      notes: 'Thank you!',
    });
    expect(edited.body).toMatchObject({ subtotalCents: 550_000, totalCents: 621_500 });

    const sent = await dev('post', `/billing/invoices/${id}/send`);
    expect(sent.body.number).toMatch(/^FH-\d{4}-\d{4}$/);
    expect((await dev('patch', `/billing/invoices/${id}`, { notes: 'late change' })).body.code).toBe('NOT_DRAFT');
    const mail = await owner.emailOutbox.findFirst({ where: { tenantId: t.tenant.id, template: 'invoice' } });
    expect(mail).toMatchObject({ toEmail: 'ap@chi.test' });
  });

  it('records part and full payments; refuses overpayment; paid invoices can’t be voided', async () => {
    expect((await dev('post', `/billing/invoices/${id}/payments`, { amountCents: 700_000, receivedOn: '2026-11-05', method: 'EFT' })).body.code).toBe('OVERPAYMENT');
    expect((await dev('post', `/billing/invoices/${id}/payments`, { amountCents: 21_500, receivedOn: '2026-11-05', method: 'CHEQUE', reference: '#1042' })).body).toMatchObject({ status: 'SENT', paidCents: 21_500 });
    expect((await dev('get', `/billing/invoices/${id}`)).body.status).toBe('PARTIAL');
    expect((await dev('post', `/billing/invoices/${id}/payments`, { amountCents: 600_000, receivedOn: '2026-11-06', method: 'EFT' })).body.status).toBe('PAID');
    expect((await dev('post', `/billing/invoices/${id}/void`, { reason: 'test' })).body.code).toBe('NOT_VOIDABLE');
  });

  it('overdue and void; drafts are simply discarded', async () => {
    await dev('post', '/billing/invoices/generate', { month: '2026-09', tenantIds: [t.tenant.id] });
    const sept = (await dev('get', `/billing/invoices?tenantId=${t.tenant.id}&status=DRAFT`)).body[0];
    await dev('post', `/billing/invoices/${sept.id}/send`);
    await owner.invoice.update({ where: { id: sept.id }, data: { dueDate: new Date('2026-10-01') } });
    expect((await dev('get', '/billing/invoices?status=OVERDUE')).body.map((i: { id: string }) => i.id)).toContain(sept.id);
    const summary = await dev('get', '/billing/summary');
    expect(summary.body.totals.overdueCount).toBeGreaterThan(0);
    expect(summary.body.cities.find((c: { tenantId: string }) => c.tenantId === t.tenant.id)).toMatchObject({ hasAccount: true, monthlySubtotalCents: 300_000 });
    expect((await dev('post', `/billing/invoices/${sept.id}/void`, { reason: 'Issued in error' })).body.outcome).toBe('voided');
    await dev('post', '/billing/invoices/generate', { month: '2026-08', tenantIds: [t.tenant.id] });
    const aug = (await dev('get', `/billing/invoices?tenantId=${t.tenant.id}&status=DRAFT`)).body[0];
    expect((await dev('post', `/billing/invoices/${aug.id}/void`, { reason: 'not needed' })).body.outcome).toBe('deleted');
  });

  it('club plan bills active users beyond 20', async () => {
    await dev('put', `/billing/accounts/${t.tenant.id}`, account({ plan: 'CLUB', province: 'AB', clubUserRateCents: 600 }));
    const est = (await dev('get', `/billing/accounts/${t.tenant.id}`)).body.estimate;
    expect(est.lines[0]).toMatchObject({ kind: 'club_base', amountCents: 9_900 });
    expect(est.taxLines).toEqual([{ name: 'GST', rate: '5', amountCents: 495 }]);
  });

  it('private sector: options switched on in the Dev console change the organization’s access at once', async () => {
    const hr = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: `hr-${randomBytes(3).toString('hex')}@chi.test` } });
    const tok = await signAccessToken({ sub: hr.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
    const me = async () => (await request(server).get('/api/me').set('x-tenant-subdomain', 'chi').auth(tok, { type: 'bearer' })).body;
    await dev('put', `/billing/accounts/${t.tenant.id}`, account({ plan: 'CLUB', province: 'AB', items: {} }));
    expect((await me()).features).toMatchObject({ registration: false, incidents: false });
    const r = await dev('put', `/billing/accounts/${t.tenant.id}`, account({ plan: 'CLUB', province: 'AB', items: { registration: { on: true, cents: null }, incidents: { on: true, cents: 2_500 } } }));
    expect(r.body.estimate.lines.map((l: { kind: string }) => l.kind)).toEqual(['club_base', 'item_incidents', 'item_registration']);
    expect(r.body.estimate.lines[1].amountCents).toBe(2_500);
    // Stored: only what differs from the plan's standard.
    expect((await owner.billingAccount.findUniqueOrThrow({ where: { tenantId: t.tenant.id } })).items).toEqual({ registration: { on: true }, incidents: { on: true, cents: 2_500 } });
    expect((await me()).features).toMatchObject({ registration: true, incidents: true, discipline: false });
    await dev('put', `/billing/accounts/${t.tenant.id}`, account({ plan: 'CLUB', province: 'AB', items: { registration: { on: true, cents: null } } }));
    expect((await me()).features).toMatchObject({ registration: true, incidents: false });
    // Unknown options are refused.
    expect((await dev('put', `/billing/accounts/${t.tenant.id}`, account({ plan: 'CLUB', items: { everything: { on: true, cents: null } } }))).status).toBe(400);
    // The Dev console sees every option's state.
    const got = (await dev('get', `/billing/accounts/${t.tenant.id}`)).body.items;
    expect(got.find((i: { key: string }) => i.key === 'registration')).toMatchObject({ on: true, standard: false, cents: 9_900 });
  });

  it('organizations can’t reach billing', async () => {
    expect((await request(server).get('/api/platform/billing/summary').set('x-fh-platform', '1')).status).toBe(401);
  });
});
