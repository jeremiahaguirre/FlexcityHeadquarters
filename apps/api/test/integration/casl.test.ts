import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { ConsoleMailer } from '../../src/services/notifications/mailer.js';
import { buildCommercialEmail, consentFor, consentFrom, purgeOldEnquiries, sendCommercialEmail, unsubscribeToken, verifyUnsubscribeToken } from '../../src/services/marketing/casl.js';
import { owner } from './fixtures.js';

const server = createApp();
const ORIGIN = 'http://localhost:3100';
const addr = () => `casl-${randomBytes(4).toString('hex')}@example.ca`;
const enquire = (email: string, marketingConsent: boolean) =>
  request(server).post('/api/marketing/leads').set('origin', ORIGIN).send({ kind: 'DEMO', name: 'Robin Hale', email, organization: 'Town of Riverbend', message: 'A walkthrough, please.', locale: 'en-CA', marketingConsent });
afterAll(() => owner.$disconnect());

describe('CASL: commercial email', () => {
  it('unsubscribe tokens are signed and name one address', () => {
    const t = unsubscribeToken('Robin@Example.ca');
    expect(verifyUnsubscribeToken(t)).toBe('robin@example.ca');
    expect(verifyUnsubscribeToken(`${t}x`)).toBeNull();
    const [p] = t.split('.');
    expect(verifyUnsubscribeToken(`${Buffer.from('someone@else.ca').toString('base64url')}.${t.split('.')[1]}`)).toBeNull();
    expect(verifyUnsubscribeToken(p!)).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
  });

  it('consent: express (with wording and date), implied for six months after an enquiry, withdrawn by an unsubscribe', () => {
    const d = (s: string) => new Date(s);
    const now = d('2026-11-11T00:00:00Z');
    expect(consentFrom([], now).state).toBe('NONE');
    expect(consentFrom([{ kind: 'DEMO', marketingConsent: false, consentText: null, createdAt: d('2026-09-01') }], now)).toMatchObject({ state: 'IMPLIED', expires: d('2027-03-01') });
    expect(consentFrom([{ kind: 'DEMO', marketingConsent: false, consentText: null, createdAt: d('2026-04-01') }], now).state).toBe('NONE');
    expect(consentFrom([{ kind: 'DEMO', marketingConsent: true, consentText: 'Yes…', createdAt: d('2025-01-01') }], now)).toMatchObject({ state: 'EXPRESS', text: 'Yes…' });
    const unsub = { kind: 'UNSUBSCRIBE', marketingConsent: false, consentText: null, createdAt: d('2026-10-01') };
    expect(consentFrom([{ kind: 'DEMO', marketingConsent: true, consentText: 'Yes', createdAt: d('2026-09-01') }, unsub], now).state).toBe('WITHDRAWN');
    // A later enquiry alone doesn't undo an unsubscribe; ticking the box again does.
    expect(consentFrom([unsub, { kind: 'SALES', marketingConsent: false, consentText: null, createdAt: d('2026-10-15') }], now).state).toBe('WITHDRAWN');
    expect(consentFrom([unsub, { kind: 'SALES', marketingConsent: true, consentText: 'Yes', createdAt: d('2026-10-15') }], now).state).toBe('EXPRESS');
  });

  it('every commercial message identifies the sender and carries the unsubscribe link and headers', () => {
    for (const locale of ['en-CA', 'fr-CA']) {
      const m = buildCommercialEmail({ to: 'robin@example.ca', locale, subject: 'News', text: 'Hello' });
      expect(m.headers['List-Unsubscribe']).toMatch(/^<http.*\/api\/email\/unsubscribe\?token=.+>$/);
      expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(m.text).toMatch(/\/unsubscribe\?token=/);
      expect(m.text).toContain('[Company mailing address — set COMPANY_MAILING_ADDRESS]');
      expect(m.text).toMatch(locale === 'fr-CA' ? /désabonner/ : /Unsubscribe/);
    }
  });

  it('sends only with consent, never after an unsubscribe (link or one-click), which takes effect at once', async () => {
    resetLimits();
    const mailer = new ConsoleMailer(true);
    const stranger = addr();
    expect(await sendCommercialEmail(mailer, { to: stranger, locale: 'en-CA', subject: 'News', text: 'Hi' })).toEqual({ sent: false, reason: 'NO_CONSENT' });
    const a = addr();
    expect((await enquire(a, true)).status).toBe(201);
    expect(await sendCommercialEmail(mailer, { to: a, locale: 'en-CA', subject: 'News', text: 'Hi' })).toEqual({ sent: true });
    expect(mailer.sent.at(-1)?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // The landing page: no sign-in, the address masked.
    const token = unsubscribeToken(a);
    const page = await request(server).get(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(page.body).toMatchObject({ unsubscribed: false });
    expect(page.body.email).not.toBe(a);
    expect((await request(server).get('/api/email/unsubscribe?token=nope')).body.code).toBe('BAD_TOKEN');
    expect((await request(server).post(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`).send({})).body).toMatchObject({ unsubscribed: true });
    expect((await consentFor(a)).state).toBe('WITHDRAWN');
    expect(await sendCommercialEmail(mailer, { to: a, locale: 'en-CA', subject: 'News', text: 'Hi' })).toEqual({ sent: false, reason: 'WITHDRAWN' });
    // Twice is fine, and stores one record.
    await request(server).post(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`).send({});
    expect(await owner.lead.count({ where: { email: a, kind: 'UNSUBSCRIBE' } })).toBe(1);
    // RFC 8058 one-click: a mail app POSTs a form body, no origin.
    const b = addr();
    await enquire(b, false);
    expect((await consentFor(b)).state).toBe('IMPLIED');
    const oc = await request(server).post(`/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(b))}`).type('form').send('List-Unsubscribe=One-Click');
    expect(oc.status).toBe(200);
    expect((await consentFor(b)).state).toBe('WITHDRAWN');
    expect((await owner.lead.findFirstOrThrow({ where: { email: b, kind: 'UNSUBSCRIBE' } })).message).toMatch(/one-click/);
  });

  it('valid links always work from a shared address (mail apps’ one-click servers); only bad tokens are rate-limited', async () => {
    resetLimits();
    const ip = '203.0.113.77';
    for (let i = 0; i < 35; i++) {
      const r = await request(server).post(`/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(addr()))}`).set('x-forwarded-for', ip).type('form').send('List-Unsubscribe=One-Click');
      expect(r.status).toBe(200);
    }
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await request(server).post('/api/email/unsubscribe?token=nope').set('x-forwarded-for', ip).send({})).status);
    expect(codes.slice(0, 30).every((c) => c === 400)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    resetLimits();
  });

  it('refuses to send in production until the legal name and mailing address are configured', async () => {
    const c = config();
    const before = { env: c.NODE_ENV, name: c.COMPANY_LEGAL_NAME, address: c.COMPANY_MAILING_ADDRESS };
    try {
      c.NODE_ENV = 'production';
      await expect(sendCommercialEmail(new ConsoleMailer(true), { to: addr(), locale: 'en-CA', subject: 'x', text: 'y' })).rejects.toThrow(/COMPANY_MAILING_ADDRESS/);
      c.COMPANY_LEGAL_NAME = 'Example Legal Name Inc.';
      c.COMPANY_MAILING_ADDRESS = '1 Test Street, Testville';
      expect(await sendCommercialEmail(new ConsoleMailer(true), { to: addr(), locale: 'en-CA', subject: 'x', text: 'y' })).toEqual({ sent: false, reason: 'NO_CONSENT' });
    } finally {
      c.NODE_ENV = before.env;
      c.COMPANY_LEGAL_NAME = before.name;
      c.COMPANY_MAILING_ADDRESS = before.address;
    }
  });

  it('enquiries lose their personal details two years after the last exchange; customers and unsubscribes are kept', async () => {
    const e = addr();
    const old = new Date(Date.now() - 800 * 86_400_000);
    const base = { name: 'Old', email: e, message: 'Old enquiry', locale: 'en-CA' };
    const gone = await owner.lead.create({ data: { ...base, kind: 'SALES', createdAt: old } });
    const won = await owner.lead.create({ data: { ...base, kind: 'DEMO', status: 'WON', createdAt: old } });
    const unsub = await owner.lead.create({ data: { ...base, kind: 'UNSUBSCRIBE', status: 'CLOSED', createdAt: old } });
    await owner.$executeRaw`UPDATE "Lead" SET "updatedAt" = ${old} WHERE email = ${e}`;
    expect(await purgeOldEnquiries()).toBeGreaterThanOrEqual(1);
    expect(await owner.lead.findUnique({ where: { id: gone.id } })).toMatchObject({ name: '(removed)', email: '', message: '(removed)', organization: null });
    expect(await purgeOldEnquiries()).toBe(0);
    expect(await owner.lead.findUnique({ where: { id: won.id } })).not.toBeNull();
    expect(await owner.lead.findUnique({ where: { id: unsub.id } })).not.toBeNull();
  });
});
