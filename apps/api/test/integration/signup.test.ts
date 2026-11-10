import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'signup';
let t: Awaited<ReturnType<typeof seedTenant>>;
let setId: string;
let serviceId: string;
let desk: string;
const pub = {
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB),
  post: (p: string, b: object) => request(server).post(p).set('x-tenant-subdomain', SUB).send(b),
};
const staff = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const yearsAgo = (y: number) => new Date(Date.now() - y * 365.25 * 86_400_000).toISOString().slice(0, 10);
const form = (over: object = {}) => ({
  setId,
  startedAt: Date.now() - 60_000,
  guardian: { firstName: 'Marie', lastName: 'Tremblay', email: 'Marie@Example.ca', phone: '250-555-0199' },
  emergency: { name: 'Luc Tremblay', phone: '250-555-0123' },
  participant: { firstName: 'Léa', lastName: 'Tremblay', dateOfBirth: yearsAgo(4.5), safetyNote: 'Asthma: inhaler in bag' },
  consents: { terms: true, privacy: true, photo: false },
  ...over,
});

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['FRONT_DESK'], employmentStatus: 'PART_TIME', firstName: 'D', lastName: 'K', email: 'desk@signup.test' } });
  desk = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['FRONT_DESK'], aat: Math.floor(Date.now() / 1000) });
  const c = await owner.lessonCampaign.create({ data: { tenantId: t.tenant.id, name: 'Spring lessons', startsOn: new Date(inDays(20)), endsOn: new Date(inDays(80)), status: 'PUBLISHED', createdById: u.id } });
  setId = (await owner.lessonClass.create({ data: { tenantId: t.tenant.id, campaignId: c.id, facilityId: t.facility.id, positionId: t.position.id, name: 'Preschool 2', dayOfWeek: 6, daysOfWeek: [6], startMinute: 600, endMinute: 630, startsOn: new Date(inDays(20)), endsOn: new Date(inDays(62)), maxSwimmers: 1, minAgeMonths: 36, maxAgeMonths: 72, priceCents: 9500, published: true } })).id;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('public sign-up portal', () => {
  it('is closed until staff open it with their terms', async () => {
    expect((await pub.get('/api/public/signup')).body).toEqual({ enabled: false });
    expect((await staff(desk).put('/api/signup/settings', { enabled: true, terms: '', payment: '' })).body.code).toBe('NEEDS_TERMS');
    expect((await staff(desk).put('/api/signup/settings', { enabled: true, terms: 'Participants follow staff instructions. Refunds before the second lesson.', payment: 'Pay at the front desk within 3 days.' })).status).toBe(200);
    const s = (await pub.get('/api/public/signup')).body;
    expect(s.programs[0].sets[0]).toMatchObject({ name: 'Preschool 2', spotsLeft: 1, priceCents: 9500, sessions: expect.any(Number) });
    expect(JSON.stringify(s)).not.toContain('Tremblay');
  });

  it('turns away bots, missing consents and the wrong age', async () => {
    expect((await pub.post('/api/public/registrations', form({ website: 'spam.example' }))).body.code).toBe('REJECTED');
    expect((await pub.post('/api/public/registrations', form({ startedAt: Date.now() }))).body.code).toBe('TOO_FAST');
    expect((await pub.post('/api/public/registrations', form({ consents: { terms: false, privacy: true } }))).status).toBe(400);
    const baby = await pub.post('/api/public/registrations', form({ participant: { firstName: 'Noé', lastName: 'Tremblay', dateOfBirth: yearsAgo(1) } }));
    expect(baby.body.code).toBe('AGE_OUTSIDE_LEVEL');
  });

  it('a family signs up with no account; a second child joins the waitlist', async () => {
    const r = await pub.post('/api/public/registrations', form());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'ENROLLED', reference: expect.stringMatching(/^R-[A-Z2-9]{6}$/) });
    expect((await pub.post('/api/public/registrations', form())).body.code).toBe('ALREADY_REGISTERED');
    const w = await pub.post('/api/public/registrations', form({ participant: { firstName: 'Zoé', lastName: 'Tremblay', dateOfBirth: yearsAgo(5) } }));
    expect(w.body.status).toBe('WAITLISTED');
    const mail = await owner.emailOutbox.findFirst({ where: { tenantId: t.tenant.id, template: 'signup_confirmation' }, orderBy: { createdAt: 'asc' } });
    expect(mail).toMatchObject({ toEmail: 'marie@example.ca' });
    expect(mail!.params).toMatchObject({ reference: r.body.reference, payment: 'Pay at the front desk within 3 days.' });
    // Member services see it, with the family on file, and take payment.
    const list = (await staff(desk).get('/api/online-registrations')).body;
    const mine = list.find((x: { reference: string }) => x.reference === r.body.reference);
    expect(mine).toMatchObject({ swimmerName: 'Léa Tremblay', paid: false });
    expect((await staff(desk).post(`/api/online-registrations/${mine.id}/pay`, { paymentMethod: 'DEBIT' })).status).toBe(200);
    expect((await staff(desk).get('/api/online-registrations')).body.find((x: { id: string }) => x.id === mine.id).paid).toBe(true);
    const hh = (await staff(desk).get(`/api/households/${mine.householdId}`)).body;
    expect(hh.members.map((m: { role: string; firstName: string }) => `${m.role}:${m.firstName}`)).toEqual(['GUARDIAN:Marie', 'CHILD:Léa']);
    expect(hh.emergencyName).toBe('Luc Tremblay');
  });

  it('facility bookings: free times, a request, then staff confirm', async () => {
    const day = inDays(10);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const v = await staff(desk).post('/api/bookable-services', { facilityId: t.facility.id, name: 'Party room', durationMinutes: 120, priceCents: 15000, capacity: 1, maxPartySize: 20, daysOfWeek: [dow], openMinute: 600, closeMinute: 1080, leadDays: 3 });
    expect(v.status).toBe(201);
    serviceId = v.body.id;
    const slots = (await pub.get(`/api/public/services/${serviceId}/slots?date=${day}`)).body;
    expect(slots.map((s: { startMinute: number }) => s.startMinute)).toEqual([600, 720, 840, 960]);
    expect((await pub.get(`/api/public/services/${serviceId}/slots?date=${inDays(1)}`)).body).toEqual([]); // too soon
    const book = (start: number, size = 12) => pub.post('/api/public/bookings', { serviceId, date: day, startMinute: start, partySize: size, startedAt: Date.now() - 30_000, contact: { name: 'Sam Lee', email: 'sam@example.ca', phone: '250-555-0177' }, notes: 'Birthday, 7 years old', consents: { terms: true, privacy: true } });
    expect((await book(720, 40)).body.code).toBe('PARTY_TOO_BIG');
    const r = await book(720);
    expect(r.body.reference).toMatch(/^B-/);
    expect((await book(720)).body.code).toBe('SLOT_TAKEN');
    expect((await pub.get(`/api/public/services/${serviceId}/slots?date=${day}`)).body.map((s: { startMinute: number }) => s.startMinute)).toEqual([600, 840, 960]);
    const pending = (await staff(desk).get('/api/bookings')).body;
    expect(pending[0]).toMatchObject({ status: 'REQUESTED', service: 'Party room', name: 'Sam Lee' });
    expect((await staff(desk).post(`/api/bookings/${pending[0].id}/decide`, { decision: 'CONFIRMED', note: 'Please arrive 10 minutes early.' })).status).toBe(200);
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, template: 'booking_decided' } })).toBe(1);
  });
});
