import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { listSessions } from '../../src/services/lessons/lessons.js';
import { ageInMonths, fitsAge } from '../../src/services/programs/levels.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'swimco';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { head: '', desk: '', guard: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
});
// A Monday in the future, so campaign dates are stable.
const monday = (() => {
  const d = new Date(Date.now() + 30 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
})();
const plus = (iso: string, days: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const yearsBefore = (iso: string, y: number, m = 0) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - y);
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const mk = async (roles: ('HEAD_LIFEGUARD' | 'FRONT_DESK')[], email: string) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: email, lastName: 'X', email: `${email}@swim.test` } });
    return signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: Math.floor(Date.now() / 1000) });
  };
  tok.head = await mk(['HEAD_LIFEGUARD'], 'head');
  tok.desk = await mk(['FRONT_DESK'], 'desk');
  tok.guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('ages', () => {
  it('counts whole months and treats the upper age as exclusive', () => {
    expect(ageInMonths('2021-05-15', '2026-05-14')).toBe(59);
    expect(ageInMonths('2021-05-15', '2026-05-15')).toBe(60);
    expect(fitsAge(11, 4, 12)).toBe(true);
    expect(fitsAge(12, 4, 12)).toBe(false);
  });
});

describe('planning and registration', () => {
  let campaignId: string;
  let weekly: string; // Preschool 2, Mondays for 8 weeks
  let block: string; // Swim Kids 3, Monday to Friday for 2 weeks
  let householdId: string;
  let kid: string;
  let toddler: string;

  it('Lifesaving Society: Parent & Tot to Swim Patrol, then the Bronze awards and National Lifeguard if asked', async () => {
    expect((await call(tok.head).post('/api/swim-levels/presets', { preset: 'LIFESAVING' })).body.added).toBe(18);
    expect((await call(tok.head).post('/api/swim-levels/presets', { preset: 'LIFESAVING', advanced: true })).body.added).toBe(4);
    const nl = (await call(tok.head).get('/api/swim-levels')).body.find((l: { name: string }) => l.name === 'National Lifeguard');
    expect(nl).toMatchObject({ minAgeMonths: 192 });
    const presets = (await call(tok.head).get('/api/swim-levels/presets')).body;
    expect(presets.map((p: { key: string }) => p.key)).toEqual(['LIFESAVING', 'YMCA', 'CANSKATE']);
    expect((await call(tok.head).post('/api/swim-levels/presets', { preset: 'YMCA' })).body.added).toBe(13);
  });

  it('arenas load Skate Canada CanSkate levels too', async () => {
    expect((await call(tok.head).post('/api/swim-levels/presets', { preset: 'CANSKATE' })).body.added).toBe(8);
  });

  it('levels come with their ages; staff without planning rights can’t load them', async () => {
    const levels = (await call(tok.head).get('/api/swim-levels')).body;
    expect(levels.find((l: { name: string; program: string }) => l.name === 'Parent & Tot 1' && l.program.startsWith('Lifesaving'))).toMatchObject({ minAgeMonths: 4, maxAgeMonths: 12, parentInWater: true });
    expect(levels.find((l: { name: string }) => l.name === 'Preschool 2')).toMatchObject({ minAgeMonths: 36, maxAgeMonths: 72, ratio: 5 });
    expect((await call(tok.head).post('/api/swim-levels/presets', { preset: 'RED_CROSS' })).status).toBe(400);
    expect((await call(tok.guard).post('/api/swim-levels/presets', { preset: 'LIFESAVING' })).status).toBe(403);
  });

  it('plans a campaign with once-a-week and Monday-to-Friday sets, skipping a holiday', async () => {
    const levels = (await call(tok.head).get('/api/swim-levels')).body as Array<{ id: string; name: string }>;
    const id = (n: string) => levels.find((l) => l.name === n)!.id;
    const c = await call(tok.head).post('/api/campaigns', { name: 'Spring lessons', kind: 'LESSONS', startsOn: monday, endsOn: plus(monday, 60), skipDates: [plus(monday, 14)] });
    expect(c.status).toBe(201);
    campaignId = c.body.id;
    const base = { facilityId: t.facility.id, positionId: t.position.id, startMinute: 17 * 60, endMinute: 17 * 60 + 30, priceCents: 9500, memberPriceCents: 8000 };
    weekly = (await call(tok.head).post(`/api/campaigns/${campaignId}/sets`, { ...base, levelId: id('Preschool 2'), daysOfWeek: [1], startsOn: monday, endsOn: plus(monday, 49) })).body.id;
    block = (await call(tok.head).post(`/api/campaigns/${campaignId}/sets`, { ...base, levelId: id('Swimmer 3'), daysOfWeek: [1, 2, 3, 4, 5], startsOn: monday, endsOn: plus(monday, 11), capacity: 1 })).body.id;
    const detail = (await call(tok.head).get(`/api/campaigns/${campaignId}`)).body;
    const w = detail.sets.find((s: { id: string }) => s.id === weekly);
    expect(w).toMatchObject({ daysOfWeek: [1], sessions: 7, capacity: 5, minAgeMonths: 36, maxAgeMonths: 72 }); // 8 Mondays minus the holiday
    expect(detail.sets.find((s: { id: string }) => s.id === block)).toMatchObject({ daysOfWeek: [1, 2, 3, 4, 5], sessions: 10 });
  });

  it('member services can’t see drafts; publishing opens registration and the instructors’ lists', async () => {
    expect((await call(tok.desk).get('/api/campaigns')).body).toHaveLength(0);
    expect(await withTenant(t.tenant.id, (tx) => listSessions(tx, monday, plus(monday, 6)))).toHaveLength(0);
    expect((await call(tok.head).post(`/api/campaigns/${campaignId}/publish`)).status).toBe(200);
    expect((await call(tok.desk).get('/api/campaigns')).body).toHaveLength(1);
    expect((await withTenant(t.tenant.id, (tx) => listSessions(tx, monday, plus(monday, 6)))).length).toBe(6); // 1 weekly + 5 block
  });

  it('member services put a family on file, with parents and children', async () => {
    expect((await call(tok.desk).post('/api/households', { name: 'Tremblay', members: [{ role: 'CHILD', firstName: 'Léa', lastName: 'Tremblay' }] })).body.code).toBe('NEEDS_GUARDIAN');
    const r = await call(tok.desk).post('/api/households', {
      name: 'Tremblay',
      emergencyName: 'Grand-maman',
      emergencyPhone: '250-555-0100',
      members: [
        { role: 'GUARDIAN', firstName: 'Marie', lastName: 'Tremblay', phone: '250-555-0199', email: 'marie@example.ca' },
        { role: 'CHILD', firstName: 'Léa', lastName: 'Tremblay', dateOfBirth: yearsBefore(monday, 4), safetyNote: 'Ear tubes: no diving' },
        { role: 'CHILD', firstName: 'Noé', lastName: 'Tremblay', dateOfBirth: yearsBefore(monday, 1, 6) },
      ],
    });
    expect(r.status).toBe(201);
    householdId = r.body.id;
    const hh = (await call(tok.desk).get(`/api/households/${householdId}`)).body;
    kid = hh.members.find((m: { firstName: string }) => m.firstName === 'Léa').id;
    toddler = hh.members.find((m: { firstName: string }) => m.firstName === 'Noé').id;
    expect((await call(tok.desk).get('/api/households?q=555-0199')).body.map((x: { id: string }) => x.id)).toEqual([householdId]);
  });

  it('offers show whether the age fits; registering checks it', async () => {
    const offers = (await call(tok.desk).get(`/api/offerings?memberId=${toddler}`)).body[0].sets;
    expect(offers.find((s: { id: string }) => s.id === weekly).ageFits).toBe(false);
    const tooYoung = await call(tok.desk).post('/api/registrations', { setId: weekly, memberId: toddler, paymentMethod: 'DEBIT' });
    expect(tooYoung.status).toBe(409);
    expect(tooYoung.body.code).toBe('AGE_OUTSIDE_LEVEL');
    const ok = await call(tok.desk).post('/api/registrations', { setId: weekly, memberId: kid, paymentMethod: 'DEBIT' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ status: 'ENROLLED', priceCents: 9500 });
    // The instructor sees the child with the safety note.
    const roster = (await withTenant(t.tenant.id, (tx) => listSessions(tx, monday, monday))).find((s) => s.classId === weekly)!.roster;
    expect(roster).toEqual([expect.objectContaining({ swimmerName: 'Léa Tremblay', safetyNote: 'Ear tubes: no diving' })]);
  });

  it('a full set waitlists; a cancellation moves the first waiting swimmer in', async () => {
    const override = { ageOverride: 'Strong swimmer, approved by supervisor' };
    const first = await call(tok.desk).post('/api/registrations', { setId: block, memberId: kid, paymentMethod: 'CASH', ...override });
    expect(first.body.status).toBe('ENROLLED');
    const second = await call(tok.desk).post('/api/registrations', { setId: block, memberId: toddler, paymentMethod: 'CASH', ...override });
    expect(second.body.status).toBe('WAITLISTED');
    const out = await call(tok.desk).post(`/api/registrations/${first.body.id}/cancel`, { refund: true });
    expect(out.body.promoted).toMatchObject({ swimmerName: 'Noé Tremblay' });
    const list = (await call(tok.desk).get(`/api/registrations?setId=${block}`)).body;
    expect(list).toEqual([expect.objectContaining({ swimmerName: 'Noé Tremblay', status: 'ENROLLED' })]);
  });

  it('memberships by year or month, drop-ins, and member prices on programs', async () => {
    const fee = async (b: object) => (await call(tok.head).post('/api/fees', b)).status;
    // Head guards don't set prices; supervisors and HR do.
    expect(await fee({ kind: 'MEMBERSHIP', period: 'YEAR', ageGroup: 'FAMILY', name: 'Family year', priceCents: 52000 })).toBe(403);
    const sup = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: Math.floor(Date.now() / 1000) });
    const year = (await call(sup).post('/api/fees', { kind: 'MEMBERSHIP', period: 'YEAR', ageGroup: 'FAMILY', name: 'Family year', priceCents: 52000 })).body;
    const month = (await call(sup).post('/api/fees', { kind: 'MEMBERSHIP', period: 'MONTH', ageGroup: 'ADULT', name: 'Adult month', priceCents: 5500 })).body;
    const drop = (await call(sup).post('/api/fees', { kind: 'DROP_IN', period: 'VISIT', ageGroup: 'CHILD', name: 'Child drop-in', priceCents: 375 })).body;
    expect((await call(tok.desk).get('/api/fees')).body).toHaveLength(3);

    const sold = await call(tok.desk).post('/api/sales', { feeId: year.id, householdId, paymentMethod: 'CREDIT', startsOn: '2027-01-15' });
    expect(sold.body).toMatchObject({ validFrom: '2027-01-15', validTo: '2028-01-14', priceCents: 52000 });
    const m = await call(tok.desk).post('/api/sales', { feeId: month.id, householdId, paymentMethod: 'CREDIT', startsOn: '2027-01-31' });
    expect(m.body.validTo).toBe('2027-03-02');
    expect((await call(tok.desk).post('/api/sales', { feeId: drop.id, paymentMethod: 'CASH' })).status).toBe(201);

    // With a membership covering today, programs charge the member price.
    await call(tok.desk).post('/api/sales', { feeId: year.id, householdId, paymentMethod: 'CREDIT' });
    const hh = (await call(tok.desk).get(`/api/households/${householdId}`)).body;
    expect(hh.memberUntil).not.toBeNull();
    const r = await call(tok.desk).post('/api/registrations', { setId: weekly, memberId: toddler, paymentMethod: 'DEBIT', ageOverride: 'Sibling, supervisor approved' });
    expect(r.body.priceCents).toBe(8000);
    const day = (await call(tok.desk).get('/api/sales/summary')).body;
    expect(day.byMethod.CASH).toBeGreaterThan(0);
  });
});

describe('correcting plans after they are made', () => {
  it('a city adds its own level, corrects its ages and ratio, and retires it; the range stays sensible', async () => {
    const l = await call(tok.head).post('/api/swim-levels', { program: 'Adult learn to swim', name: 'Adult 1', nameFr: 'Adulte 1', minAgeMonths: 216, ratio: 6, durationMinutes: 45 });
    expect(l.status).toBe(201);
    expect((await call(tok.desk).patch(`/api/swim-levels/${l.body.id}`, { ratio: 8 })).status).toBe(403);
    expect((await call(tok.head).patch(`/api/swim-levels/${l.body.id}`, { maxAgeMonths: 120 })).body.code).toBe('AGE_RANGE');
    expect((await call(tok.head).patch(`/api/swim-levels/${l.body.id}`, { minAgeMonths: 192, ratio: 8, active: false })).status).toBe(200);
    const row = (await call(tok.head).get('/api/swim-levels')).body.find((x: { id: string }) => x.id === l.body.id);
    expect(row).toMatchObject({ minAgeMonths: 192, ratio: 8, active: false, nameFr: 'Adulte 1' });
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, entityId: l.body.id, action: { in: ['level.create', 'level.update'] } } })).toBe(2);
  });

  it('a campaign gets a French name and new dates, never ending before it starts', async () => {
    const c = (await call(tok.head).post('/api/campaigns', { name: 'Winter lessons', kind: 'LESSONS', startsOn: monday, endsOn: plus(monday, 55) })).body.id;
    expect((await call(tok.head).patch(`/api/campaigns/${c}`, { endsOn: plus(monday, -1) })).body.code).toBe('ENDS_BEFORE_START');
    expect((await call(tok.head).patch(`/api/campaigns/${c}`, { nameFr: 'Cours d’hiver', endsOn: plus(monday, 62) })).status).toBe(200);
    expect((await call(tok.head).get(`/api/campaigns/${c}`)).body).toMatchObject({ nameFr: 'Cours d’hiver', endsOn: plus(monday, 62) });
  });

  it('a set is corrected (time, level, price); its times stay in order; an empty one is removed, on record', async () => {
    const c = (await call(tok.head).post('/api/campaigns', { name: 'Spring lessons', kind: 'LESSONS', startsOn: monday, endsOn: plus(monday, 55) })).body.id;
    const level = (await call(tok.head).get('/api/swim-levels')).body.find((x: { active: boolean }) => x.active);
    const set = (await call(tok.head).post(`/api/campaigns/${c}/sets`, { facilityId: t.facility.id, positionId: t.position.id, daysOfWeek: [1], startMinute: 1020, endMinute: 1050, startsOn: monday, endsOn: plus(monday, 49), priceCents: 9500 })).body.id;
    expect((await call(tok.head).patch(`/api/campaigns/${c}/sets/${set}`, { startMinute: 1080 })).body.code).toBe('ENDS_BEFORE_START');
    expect((await call(tok.head).patch(`/api/campaigns/${c}/sets/${set}`, { startMinute: 1080, endMinute: 1110, levelId: level.id, priceCents: 10500 })).status).toBe(200);
    const view = (await call(tok.head).get(`/api/campaigns/${c}`)).body.sets[0];
    expect(view).toMatchObject({ startMinute: 1080, endMinute: 1110, levelId: level.id, level: level.name, priceCents: 10500 });
    expect((await call(tok.head).del(`/api/campaigns/${c}/sets/${set}`)).status).toBe(204);
    expect((await call(tok.head).get(`/api/campaigns/${c}`)).body.sets).toEqual([]);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'set.delete', entityId: set } })).toBe(1);
  });

  it('a draft made by mistake is deleted with its sets; a published campaign can’t be', async () => {
    const c = (await call(tok.head).post('/api/campaigns', { name: 'Oops', kind: 'CAMP', startsOn: monday, endsOn: plus(monday, 4) })).body.id;
    await call(tok.head).post(`/api/campaigns/${c}/sets`, { facilityId: t.facility.id, positionId: t.position.id, daysOfWeek: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 960, startsOn: monday, endsOn: plus(monday, 4), priceCents: 20000 });
    expect((await call(tok.desk).del(`/api/campaigns/${c}`)).status).toBe(403);
    expect((await call(tok.head).del(`/api/campaigns/${c}`)).status).toBe(204);
    expect((await call(tok.head).get(`/api/campaigns/${c}`)).status).toBe(404);
    const live = (await call(tok.head).post('/api/campaigns', { name: 'Live', kind: 'CAMP', startsOn: monday, endsOn: plus(monday, 4) })).body.id;
    await call(tok.head).post(`/api/campaigns/${live}/sets`, { facilityId: t.facility.id, positionId: t.position.id, daysOfWeek: [1], startMinute: 540, endMinute: 600, startsOn: monday, endsOn: monday, priceCents: 1000 });
    await call(tok.head).post(`/api/campaigns/${live}/publish`);
    expect((await call(tok.head).del(`/api/campaigns/${live}`)).body.code).toBe('CAMPAIGN_NOT_DRAFT');
  });
});
