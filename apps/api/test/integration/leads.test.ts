import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword } from '../../src/auth/tokens.js';
import { owner } from './fixtures.js';

const server = createApp();
const ORIGIN = 'http://localhost:3100';
const lead = (over: object = {}) => ({ kind: 'DEMO', name: 'Robin Hale', email: 'Robin@Example.ca', organization: 'Town of Riverbend', province: 'BC', facilities: 2, message: 'We run two pools and want a walkthrough.', locale: 'en-CA', marketingConsent: true, ...over });
afterAll(() => owner.$disconnect());

describe('marketing enquiries', () => {
  it('accepts an enquiry from the marketing site, recording consent wording', async () => {
    resetLimits();
    const pre = await request(server).options('/api/marketing/leads').set('origin', ORIGIN);
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(ORIGIN);
    const r = await request(server).post('/api/marketing/leads').set('origin', ORIGIN).send(lead());
    expect(r.status).toBe(201);
    const saved = await owner.lead.findFirstOrThrow({ where: { email: 'robin@example.ca' } });
    expect(saved).toMatchObject({ kind: 'DEMO', status: 'NEW', marketingConsent: true });
    expect(saved.consentText).toMatch(/unsubscribe/);
  });

  it('refuses other origins, ignores bots quietly, and rate-limits', async () => {
    resetLimits();
    expect((await request(server).post('/api/marketing/leads').set('origin', 'https://evil.example').send(lead())).status).toBe(403);
    const before = await owner.lead.count();
    expect((await request(server).post('/api/marketing/leads').set('origin', ORIGIN).send(lead({ website: 'http://spam' }))).status).toBe(201);
    expect(await owner.lead.count()).toBe(before);
    for (let i = 0; i < 4; i++) await request(server).post('/api/marketing/leads').set('origin', ORIGIN).send(lead({ email: `p${i}@x.ca` }));
    expect((await request(server).post('/api/marketing/leads').set('origin', ORIGIN).send(lead())).status).toBe(429);
  });

  it('FH staff see and follow up leads in the Dev console', async () => {
    const email = `lead-${randomBytes(3).toString('hex')}@flexcity.dev`;
    await owner.platformAdmin.create({ data: { email, name: 'L', passwordHash: await hashPassword('right password!') } });
    resetLimits();
    const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const list = await request(server).get('/api/platform/leads?status=NEW').set('x-fh-platform', '1').set('Cookie', cookie);
    expect(list.body.length).toBeGreaterThan(0);
    const r = await request(server).patch(`/api/platform/leads/${list.body[0].id}`).set('x-fh-platform', '1').set('Cookie', cookie).send({ status: 'CONTACTED', notes: 'Called Tuesday' });
    expect(r.status).toBe(200);
    expect((await request(server).get('/api/platform/leads')).status).toBe(403);
    expect((await request(server).get('/api/platform/leads').set('x-fh-platform', '1')).status).toBe(401);
  });
});

describe('enquiry alerts to FH', () => {
  type Sent = { to: string; subject: string; text: string };
  const mailer = (box: Sent[], fail = false) => ({ send: async (m: Sent) => { if (fail) throw new Error('smtp down'); box.push(m); } });
  const alerts = async () => (await import('../../src/services/marketing/leadAlerts.js')).sendLeadAlerts;
  const make = (createdAt = new Date()) => owner.lead.create({ data: { kind: 'SALES', name: 'Avery Quill', email: `avery-${randomBytes(3).toString('hex')}@example.ca`, organization: 'Town of Riverbend', message: 'Private details about our budget.', createdAt } });

  it('sends nothing and marks nothing while no inbox is set', async () => {
    const l = await make();
    const box: Sent[] = [];
    expect(await (await alerts())(owner, mailer(box) as never, { to: '' })).toBe(0);
    expect(box).toHaveLength(0);
    expect((await owner.lead.findUniqueOrThrow({ where: { id: l.id } })).alertedAt).toBeNull();
  });

  it('emails the inbox once per enquiry, with no enquirer details, and never twice', async () => {
    const l = await make();
    const box: Sent[] = [];
    const send = await alerts();
    expect(await send(owner, mailer(box) as never, { to: 'inbox@fh.example' })).toBeGreaterThanOrEqual(1);
    const mine = box.filter((m) => m.to === 'inbox@fh.example');
    expect(mine.length).toBeGreaterThanOrEqual(1);
    for (const m of mine) {
      expect(m.subject).toMatch(/New website enquiry/);
      expect(m.text).toMatch(/\/platform\/enquiries/);
      for (const secret of ['Avery', 'Quill', 'example.ca', 'Riverbend', 'budget']) expect(`${m.subject}${m.text}`).not.toContain(secret);
    }
    expect((await owner.lead.findUniqueOrThrow({ where: { id: l.id } })).alertedAt).not.toBeNull();
    const again: Sent[] = [];
    expect(await send(owner, mailer(again) as never, { to: 'inbox@fh.example' })).toBe(0);
  });

  it('keeps an enquiry for the next round when the email fails, and skips week-old ones', async () => {
    const send = await alerts();
    await send(owner, mailer([]) as never, { to: 'inbox@fh.example' }); // clear anything waiting
    const fresh = await make();
    expect(await send(owner, mailer([], true) as never, { to: 'inbox@fh.example' })).toBe(0);
    expect((await owner.lead.findUniqueOrThrow({ where: { id: fresh.id } })).alertedAt).toBeNull();
    const old = await make(new Date(Date.now() - 8 * 86_400_000));
    const box: Sent[] = [];
    await send(owner, mailer(box) as never, { to: 'inbox@fh.example' });
    expect((await owner.lead.findUniqueOrThrow({ where: { id: old.id } })).alertedAt).not.toBeNull();
    expect(box).toHaveLength(1); // only the fresh one
  });
});
