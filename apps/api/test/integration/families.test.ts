/** Front desk keeps a family's file current after it is made, and takes payment for spots that have none. */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { listSessions } from '../../src/services/lessons/lessons.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'families';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { head: '', desk: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const monday = (() => {
  const d = new Date(Date.now() + 30 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
})();
const plus = (iso: string, days: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
let householdId: string;
let setId: string;
let campaign: string;

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  const mk = async (roles: ('HEAD_LIFEGUARD' | 'FRONT_DESK')[], email: string) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: email, lastName: 'X', email: `${email}@families.test` } });
    return signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: Math.floor(Date.now() / 1000) });
  };
  tok.head = await mk(['HEAD_LIFEGUARD'], 'head');
  tok.desk = await mk(['FRONT_DESK'], 'desk');
  const c = (await call(tok.head).post('/api/campaigns', { name: 'Fall lessons', kind: 'LESSONS', startsOn: monday, endsOn: plus(monday, 30) })).body.id;
  campaign = c;
  setId = (await call(tok.head).post(`/api/campaigns/${c}/sets`, { facilityId: t.facility.id, positionId: t.position.id, daysOfWeek: [1], startMinute: 1020, endMinute: 1050, startsOn: monday, endsOn: plus(monday, 28), capacity: 1, priceCents: 9500 })).body.id;
  await call(tok.head).post(`/api/campaigns/${c}/publish`);
  householdId = (await call(tok.desk).post('/api/households', { name: 'Okafor', members: [{ role: 'GUARDIAN', firstName: 'Ada', lastName: 'Okafor', phone: '250-555-0101' }, { role: 'CHILD', firstName: 'Chidi', lastName: 'Okafor', dateOfBirth: '2019-03-01' }] })).body.id;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('a family’s file after it is made', () => {
  it('a new address and emergency contact are saved, on record; only member services may', async () => {
    expect((await call(tok.head).patch(`/api/households/${householdId}`, { address: 'X' })).status).toBe(403);
    expect((await call(tok.desk).patch(`/api/households/${householdId}`, { address: '12 Lakeview Rd', emergencyName: 'Uncle Obi', emergencyPhone: '250-555-0177' })).status).toBe(200);
    expect((await call(tok.desk).get(`/api/households/${householdId}`)).body).toMatchObject({ address: '12 Lakeview Rd', emergencyName: 'Uncle Obi', emergencyPhone: '250-555-0177' });
    const log = await owner.auditLog.findFirstOrThrow({ where: { tenantId: t.tenant.id, action: 'household.update', entityId: householdId } });
    expect(log.before).toMatchObject({ address: null, emergencyName: null });
  });

  it('a new child is added, and a new allergy reaches the instructor’s class list', async () => {
    const baby = await call(tok.desk).post(`/api/households/${householdId}/members`, { role: 'CHILD', firstName: 'Ngozi', lastName: 'Okafor', dateOfBirth: '2021-06-01' });
    expect(baby.status).toBe(201);
    const fam = (await call(tok.desk).get(`/api/households/${householdId}`)).body;
    expect(fam.members.map((m: { firstName: string }) => m.firstName).sort()).toEqual(['Ada', 'Chidi', 'Ngozi']);
    const chidi = fam.members.find((m: { firstName: string }) => m.firstName === 'Chidi').id;
    await call(tok.desk).post('/api/registrations', { setId, memberId: chidi, paymentMethod: 'DEBIT' });
    expect((await call(tok.desk).patch(`/api/households/${householdId}/members/${chidi}`, { safetyNote: 'Peanut allergy: EpiPen in bag' })).status).toBe(200);
    const roster = (await withTenant(t.tenant.id, (tx) => listSessions(tx, monday, monday))).find((s) => s.classId === setId)!.roster;
    expect(roster).toEqual([expect.objectContaining({ swimmerName: 'Chidi Okafor', safetyNote: 'Peanut allergy: EpiPen in bag' })]);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: { in: ['member.create', 'member.update'] } } })).toBe(2);
  });

  it('the log names only what changed, though the form sends every field', async () => {
    const ada = (await call(tok.desk).get(`/api/households/${householdId}`)).body.members.find((m: { firstName: string }) => m.firstName === 'Ada');
    const form = { role: 'GUARDIAN', firstName: 'Ada', lastName: 'Okafor', dateOfBirth: ada.dateOfBirth, phone: '250-555-0199', email: ada.email, safetyNote: ada.safetyNote, photoConsent: ada.photoConsent };
    expect((await call(tok.desk).patch(`/api/households/${householdId}/members/${ada.id}`, form)).status).toBe(200);
    const last = await owner.auditLog.findFirstOrThrow({ where: { tenantId: t.tenant.id, action: 'member.update', entityId: ada.id }, orderBy: { at: 'desc' } });
    expect(last.after).toEqual({ fields: ['phone'] });
  });

  it('a family keeps a parent, guardian or adult', async () => {
    const ada = (await call(tok.desk).get(`/api/households/${householdId}`)).body.members.find((m: { firstName: string }) => m.firstName === 'Ada');
    expect((await call(tok.desk).patch(`/api/households/${householdId}/members/${ada.id}`, { role: 'CHILD' })).body.code).toBe('NEEDS_GUARDIAN');
  });
});

describe('spots with no payment on file', () => {
  it('a desk registration moved off the waitlist shows as owing, on the family and in the list, and is paid once', async () => {
    const fam = (await call(tok.desk).get(`/api/households/${householdId}`)).body;
    const ngozi = fam.members.find((m: { firstName: string }) => m.firstName === 'Ngozi').id;
    const chidiSpot = fam.enrollments.find((e: { swimmerName: string }) => e.swimmerName === 'Chidi Okafor');
    expect(chidiSpot.paid).toBe(true);
    const waiting = await call(tok.desk).post('/api/registrations', { setId, memberId: ngozi, paymentMethod: 'DEBIT', ageOverride: 'Strong swimmer, supervisor approved' });
    expect(waiting.body.status).toBe('WAITLISTED');
    await call(tok.desk).post(`/api/registrations/${chidiSpot.id}/cancel`, { refund: true });
    const after = (await call(tok.desk).get(`/api/households/${householdId}`)).body.enrollments.find((e: { id: string }) => e.id === waiting.body.id);
    expect(after).toMatchObject({ status: 'ENROLLED', paid: false });
    const owing = (await call(tok.desk).get('/api/online-registrations')).body.find((r: { id: string }) => r.id === waiting.body.id);
    expect(owing).toMatchObject({ paid: false, status: 'ENROLLED', source: 'STAFF' });
    expect((await call(tok.desk).post(`/api/online-registrations/${waiting.body.id}/pay`, { paymentMethod: 'CASH' })).status).toBe(200);
    expect((await call(tok.desk).get(`/api/households/${householdId}`)).body.enrollments.find((e: { id: string }) => e.id === waiting.body.id).paid).toBe(true);
    // Paid desk registrations leave the list; it stays about what is owed.
    expect((await call(tok.desk).get('/api/online-registrations')).body.map((r: { id: string }) => r.id)).not.toContain(waiting.body.id);
    expect((await call(tok.desk).post(`/api/online-registrations/${waiting.body.id}/pay`, { paymentMethod: 'CASH' })).body.code).toBe('ALREADY_PAID');
    // Its sale reads as a desk payment, not an online one.
    expect((await owner.sale.findFirstOrThrow({ where: { enrollmentId: waiting.body.id } })).description).toBe('L: Fall lessons');
  });

  it('two desks paying the same spot at once charge it once', async () => {
    const fam = (await call(tok.desk).post('/api/households', { name: 'Haddad', members: [{ role: 'GUARDIAN', firstName: 'Rami', lastName: 'Haddad' }, { role: 'CHILD', firstName: 'Lina', lastName: 'Haddad', dateOfBirth: '2018-01-01' }] })).body.id;
    const lina = (await call(tok.desk).get(`/api/households/${fam}`)).body.members.find((m: { firstName: string }) => m.firstName === 'Lina').id;
    const other = (await call(tok.head).post(`/api/campaigns/${campaign}/sets`, { facilityId: t.facility.id, positionId: t.position.id, daysOfWeek: [3], startMinute: 1020, endMinute: 1050, startsOn: plus(monday, 2), endsOn: plus(monday, 23), capacity: 1, priceCents: 9000 })).body.id;
    // Moved off the waitlist: registered at the desk without payment.
    const e = await owner.lessonEnrollment.create({ data: { tenantId: t.tenant.id, classId: other, memberId: lina, householdId: fam, swimmerName: 'Lina Haddad', status: 'ENROLLED', active: true, priceCents: 9000 } });
    const both = await Promise.all([1, 2].map(() => call(tok.desk).post(`/api/online-registrations/${e.id}/pay`, { paymentMethod: 'DEBIT' })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await owner.sale.count({ where: { enrollmentId: e.id } })).toBe(1);
  });

  it('an old unpaid spot stays listed behind hundreds of paid ones', async () => {
    const fam = (await call(tok.desk).post('/api/households', { name: 'Martin', members: [{ role: 'GUARDIAN', firstName: 'Paul', lastName: 'Martin' }, { role: 'CHILD', firstName: 'Lou', lastName: 'Martin', dateOfBirth: '2018-01-01' }] })).body.id;
    const lou = (await call(tok.desk).get(`/api/households/${fam}`)).body.members.find((m: { firstName: string }) => m.firstName === 'Lou').id;
    const old = await owner.lessonEnrollment.create({ data: { tenantId: t.tenant.id, classId: setId, memberId: lou, householdId: fam, swimmerName: 'Lou Martin', status: 'ENROLLED', active: true, priceCents: 9500, createdAt: new Date('2026-01-01') } });
    const many = Array.from({ length: 520 }, (_, i) => ({ id: crypto.randomUUID(), tenantId: t.tenant.id, classId: setId, memberId: lou, householdId: fam, swimmerName: `Paid ${i}`, status: 'ENROLLED' as const, active: true, priceCents: 9500 }));
    await owner.lessonEnrollment.createMany({ data: many });
    const desk = await owner.user.findFirstOrThrow({ where: { tenantId: t.tenant.id, email: 'desk@families.test' } });
    await owner.sale.createMany({ data: many.map((e) => ({ tenantId: t.tenant.id, householdId: fam, memberId: lou, enrollmentId: e.id, facilityId: t.facility.id, description: 'L: x', priceCents: 9500, paymentMethod: 'CASH', soldById: desk.id })) });
    expect((await call(tok.desk).get('/api/online-registrations')).body.map((r: { id: string }) => r.id)).toContain(old.id);
  });

  it('an instructor’s class-list entry (no family, no price) is never owed and can’t be charged', async () => {
    const entry = await owner.lessonEnrollment.create({ data: { tenantId: t.tenant.id, classId: setId, swimmerName: 'Walk-in Kid', status: 'ENROLLED', active: true } });
    expect((await call(tok.desk).get('/api/online-registrations')).body.map((r: { id: string }) => r.id)).not.toContain(entry.id);
    expect((await call(tok.desk).post(`/api/online-registrations/${entry.id}/pay`, { paymentMethod: 'CASH' })).body.code).toBe('NOT_PAYABLE');
    expect(await owner.sale.count({ where: { enrollmentId: entry.id } })).toBe(0);
  });
});
