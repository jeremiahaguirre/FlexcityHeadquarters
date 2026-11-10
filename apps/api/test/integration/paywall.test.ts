import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { stateFrom } from '../../src/services/billing/entitlements.js';
import { signForTest } from '../../src/services/billing/stripe.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'paywall';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let guard: string;
const tok = { hr: '', guard: '' };
const as = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),

  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
const account = (data: object = {}) =>
  owner.billingAccount.upsert({
    where: { tenantId: t.tenant.id },
    create: { tenantId: t.tenant.id, legalName: 'City of Paywall', email: 'ap@paywall.test', province: 'ON', ...data },
    update: data,
  });
async function invoice(dueOffsetDays: number, totalCents = 113_000) {
  const n = Math.floor(Math.random() * 1e9);
  return owner.invoice.create({
    data: { tenantId: t.tenant.id, number: `T-${n}`, status: 'SENT', periodStart: day(-60), periodEnd: day(-31), issueDate: day(dueOffsetDays - 30), dueDate: day(dueOffsetDays), subtotalCents: 100_000, totalCents, billTo: {}, createdById: hr },
  });
}

// A stand-in for Stripe's API.
const stripeCalls: Array<Record<string, string>> = [];
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    stripeCalls.push(Object.fromEntries(new URLSearchParams(body)));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: `cs_test_${stripeCalls.length}`, url: `https://checkout.stripe.test/${stripeCalls.length}` }));
  });
});

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  guard = t.users[0]!.id;
  hr = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@paywall.test' } })).id;
  tok.hr = await signAccessToken({ sub: hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
  tok.guard = await signAccessToken({ sub: guard, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
  await new Promise<void>((r) => fake.listen(0, r));
  process.env.STRIPE_API_BASE = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await owner.invoicePayment.deleteMany({ where: { invoice: { tenantId: t.tenant.id } } });
  await owner.invoice.deleteMany({ where: { tenantId: t.tenant.id } });
  await owner.billingAccount.deleteMany({ where: { tenantId: t.tenant.id } });
  forgetFeatures(t.tenant.id);
});
afterAll(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_API_BASE;
  fake.close();
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('plans unlock features', () => {
  it('without a billing account, everything is on', async () => {
    expect((await as(tok.hr).get('/api/me')).body.features).toMatchObject({ discipline: true, incidents: true });
  });

  it('what the plan doesn’t include is locked, and HR sees which module would unlock it', async () => {
    await account({ plan: 'MUNICIPAL', level: 'BUSINESS', modules: [] });
    forgetFeatures(t.tenant.id);
    const me = (await as(tok.hr).get('/api/me')).body;
    expect(me.features).toMatchObject({ discipline: false, reliability: false, onboarding: false, incidents: true });
    expect(me.permissions).not.toContain('reliability.read');
    expect(me.lockedMenu).toEqual(expect.arrayContaining([expect.objectContaining({ href: '/manage/people', addOn: 'hrCompliance' }), expect.objectContaining({ href: '/manage/onboarding', addOn: 'hrCompliance' })]));
    // Settings that need a higher plan are refused with a reason.
    const sso = await as(tok.hr).put('/api/sso', {});
    expect(sso.body).toMatchObject({ code: 'PLAN_REQUIRED' });
    expect((await as(tok.hr).get('/api/people/review')).status).toBe(403);
    // Staff don't see upsells.
    expect((await as(tok.guard).get('/api/me')).body.lockedMenu).toEqual([]);
  });

  it('Small has the core; Enterprise has everything; the private sector gets only the modules chosen', async () => {
    await account({ plan: 'MUNICIPAL', level: 'SMALL', modules: [] });
    forgetFeatures(t.tenant.id);
    expect((await as(tok.hr).get('/api/me')).body.features).toMatchObject({ incidents: false, registration: false, discipline: false, loneWork: true, injuryClaims: true, timeclock: true, payroll: true });
    await account({ plan: 'MUNICIPAL', level: 'ENTERPRISE', modules: [] });
    forgetFeatures(t.tenant.id);
    expect((await as(tok.hr).get('/api/me')).body.lockedMenu).toEqual([]);
    await account({ plan: 'CLUB', level: 'BUSINESS', modules: ['programs'] });
    forgetFeatures(t.tenant.id);
    expect((await as(tok.hr).get('/api/me')).body.features).toMatchObject({ registration: true, incidents: false, discipline: false });
  });

  it('a trial has everything until it ends', async () => {
    await account({ trialEndsAt: day(10) });
    forgetFeatures(t.tenant.id);
    const me = (await as(tok.hr).get('/api/me')).body;
    expect(me.features.discipline).toBe(true);
    expect(me.billing.stage).toBe('trial');
  });
});

describe('unpaid invoices', () => {
  it('stages: ok → overdue (warning) → suspended after the grace period, unless held', () => {
    const acct = { plan: 'MUNICIPAL', level: 'ENTERPRISE', modules: [], graceDays: 30, trialEndsAt: null, suspensionHoldUntil: null } as never;
    expect(stateFrom(acct, [{ dueDate: day(5), totalCents: 100, paidCents: 0 }]).stage).toBe('ok');
    expect(stateFrom(acct, [{ dueDate: day(-3), totalCents: 100, paidCents: 0 }]).stage).toBe('overdue');
    expect(stateFrom(acct, [{ dueDate: day(-31), totalCents: 100, paidCents: 0 }])).toMatchObject({ stage: 'suspended', overdueCents: 100 });
    expect(stateFrom({ ...(acct as object), suspensionHoldUntil: day(3) } as never, [{ dueDate: day(-31), totalCents: 100, paidCents: 0 }]).stage).toBe('overdue');
    expect(stateFrom(acct, [{ dueDate: day(-31), totalCents: 100, paidCents: 100 }]).stage).toBe('ok');
  });

  it('suspended is read-only, except safety work, clocking in and paying', async () => {
    await account({ plan: 'MUNICIPAL', level: 'MULTI_COMPLEX', modules: [] });
    await invoice(-40);
    forgetFeatures(t.tenant.id);
    expect((await as(tok.hr).get('/api/me')).body.billing).toMatchObject({ stage: 'suspended', canPay: true });
    expect((await as(tok.hr).get('/api/users')).status).toBe(200);
    const blocked = await as(tok.hr).post('/api/time-off', { startsOn: '2026-12-01', endsOn: '2026-12-02', reason: 'x' });
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe('ACCOUNT_SUSPENDED');
    // Safety and clocking still go through (whatever their own validation says).
    expect((await as(tok.guard).post('/api/incidents', {})).status).not.toBe(402);
    expect((await as(tok.guard).post('/api/timeclock/in', {})).status).not.toBe(402);
    expect((await as(tok.guard).post('/api/me/lone-work', {})).status).not.toBe(402);
  });

  it('the city sees its invoices and balance, but not drafts', async () => {
    await account();
    await invoice(10);
    await owner.invoice.create({ data: { tenantId: t.tenant.id, status: 'DRAFT', periodStart: day(-30), periodEnd: day(-1), totalCents: 5, billTo: {}, createdById: hr } });
    const r = await as(tok.hr).get('/api/billing');
    expect(r.body.invoices).toHaveLength(1);
    expect(r.body.invoices[0]).toMatchObject({ status: 'SENT', balanceCents: 113_000 });
    expect(r.body.payment.online).toBe(false);
    expect((await as(tok.guard).get('/api/billing')).status).toBe(403);
  });
});

describe('paying online', () => {
  it('opens a card or pre-authorized debit checkout for the balance', async () => {
    await account();
    const inv = await invoice(10);
    expect((await as(tok.hr).post(`/api/billing/invoices/${inv.id}/checkout`, { method: 'card' })).body.code).toBe('ONLINE_PAYMENTS_OFF');
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const r = await as(tok.hr).post(`/api/billing/invoices/${inv.id}/checkout`, { method: 'pad' });
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const sent = stripeCalls.at(-1)!;
    expect(sent).toMatchObject({ mode: 'payment', 'payment_method_types[0]': 'acss_debit', 'line_items[0][price_data][unit_amount]': '113000', 'line_items[0][price_data][currency]': 'cad', 'metadata[invoiceId]': inv.id });
  });

  it('a signed webhook records the payment once and lifts a suspension', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    await account();
    const inv = await invoice(-40);
    forgetFeatures(t.tenant.id);
    expect((await as(tok.hr).get('/api/me')).body.billing.stage).toBe('suspended');
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 113_000, payment_intent: 'pi_1', payment_method_types: ['card'], metadata: { invoiceId: inv.id } } } });
    const hook = (sig: string) => request(server).post('/api/billing/stripe/webhook').set('content-type', 'application/json').set('stripe-signature', sig).send(payload);
    expect((await hook('t=1,v1=00')).status).toBe(400);
    expect((await hook(signForTest(payload, 'whsec_test'))).status).toBe(200);
    expect((await hook(signForTest(payload, 'whsec_test'))).status).toBe(200); // Stripe retries: no double count
    const paid = await owner.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { payments: true } });
    expect(paid).toMatchObject({ status: 'PAID', paidCents: 113_000 });
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]).toMatchObject({ method: 'CARD', reference: 'pi_1' });
    expect((await as(tok.hr).get('/api/me')).body.billing.stage).toBe('ok');
  });

  it('pre-authorized debit is only recorded once the money has arrived', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    await account();
    const inv = await invoice(5);
    const send = (type: string, status: string) => {
      const payload = JSON.stringify({ id: `evt_${type}`, type, data: { object: { id: 'cs_pad', payment_status: status, amount_total: 113_000, payment_intent: 'pi_pad', payment_method_types: ['acss_debit'], metadata: { invoiceId: inv.id } } } });
      return request(server).post('/api/billing/stripe/webhook').set('content-type', 'application/json').set('stripe-signature', signForTest(payload, 'whsec_test')).send(payload);
    };
    await send('checkout.session.completed', 'unpaid');
    expect((await owner.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paidCents).toBe(0);
    await send('checkout.session.async_payment_succeeded', 'paid');
    const after = await owner.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { payments: true } });
    expect(after.status).toBe('PAID');
    expect(after.payments[0]!.method).toBe('PAD');
  });
});
