import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'kiosk';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
let device = '';
let cookie = '';
const as = (who: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
});
const tablet = (token = device) => ({
  get: () => request(server).get('/api/kiosk').set('x-kiosk-token', token),
  punch: (employeeNumber: string, pin: string) => request(server).post('/api/kiosk/punch').set('x-kiosk-token', token).send({ employeeNumber, pin }),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  resetLimits();
  const now = Math.floor(Date.now() / 1000);
  await owner.user.update({ where: { id: t.users[0]!.id }, data: { employeeNumber: 'E100' } });
  tok.g0 = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  tok.g1 = await signAccessToken({ sub: t.users[1]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  const sup = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sup', lastName: 'X', email: `sup@${SUB}.test` } });
  tok.sup = await signAccessToken({ sub: sup.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('facility kiosk', () => {
  it('a supervisor registers a tablet; the secret is in the set-up link only', async () => {
    expect((await as('g0').post('/api/kiosks', { facilityId: t.facility.id, name: 'Front desk tablet' })).status).toBe(403);
    const r = await as('sup').post('/api/kiosks', { facilityId: t.facility.id, name: 'Front desk tablet' });
    expect(r.status).toBe(201);
    device = r.body.setupUrl.split('#')[1];
    expect(device.startsWith(`${t.tenant.id}.`)).toBe(true);
    expect((await tablet().get()).body).toMatchObject({ facility: 'Rec Centre', organization: `City of ${SUB}` });
    expect((await tablet(`${t.tenant.id}.nottherightsecretnottherightsecret`).get()).status).toBe(401);
  });

  it('people set a PIN that’s hard to guess; it needs an employee number', async () => {
    expect((await as('g0').put('/api/me/kiosk-pin', { pin: '1234' })).status).toBe(400);
    expect((await as('g1').put('/api/me/kiosk-pin', { pin: '4826' })).body.code).toBe('NO_EMPLOYEE_NUMBER');
    expect((await as('g0').put('/api/me/kiosk-pin', { pin: '4826' })).status).toBe(200);
    expect((await as('g0').get('/api/me/kiosk-pin')).body).toEqual({ set: true, employeeNumber: 'E100' });
  });

  it('punches in at this facility (on site), then out', async () => {
    const shift = await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: t.users[0]!.id, startsAt: new Date(Date.now() + 10 * 60_000), endsAt: new Date(Date.now() + 4 * 3_600_000), status: 'PUBLISHED' } });
    const i = await tablet().punch('E100', '4826');
    expect(i.body).toMatchObject({ action: 'IN', name: 'Guard0', scheduled: true });
    const p = await owner.timePunch.findFirstOrThrow({ where: { userId: t.users[0]!.id } });
    expect(p).toMatchObject({ shiftId: shift.id, facilityId: t.facility.id, locationStatus: 'VERIFIED' });
    expect(p.kioskId).not.toBeNull();
    expect((await tablet().punch('E100', '4826')).body.action).toBe('OUT');
  });

  it('a wrong PIN or number doesn’t say which; five wrong tries lock the number', async () => {
    expect((await tablet().punch('E100', '9999')).body.code).toBe('KIOSK_WRONG');
    expect((await tablet().punch('NOPE', '4826')).body.code).toBe('KIOSK_WRONG');
    // Correct punches don't count toward the lock.
    for (let i = 0; i < 4; i++) expect((await tablet().punch('E100', '4826')).body.action).toBeDefined();
    for (let i = 0; i < 4; i++) await tablet().punch('E100', '9999');
    expect((await tablet().punch('E100', '4826')).body.code).toBe('KIOSK_LOCKED');
  });

  it('pairing keeps the secret in an HttpOnly cookie that only counts with the tablet’s own header', async () => {
    const pair = await request(server).post('/api/kiosk/pair').send({ token: device });
    expect(pair.status).toBe(200);
    const set = String(pair.headers['set-cookie']);
    expect(set).toMatch(/^fh_kiosk=/);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    expect(set).toMatch(/Path=\/api\/kiosk/i);
    expect(pair.body).toEqual({ ok: true }); // the page is never handed the secret back
    cookie = set.split(';')[0]!;
    expect((await request(server).get('/api/kiosk').set('cookie', cookie).set('x-fh-kiosk', '1')).status).toBe(200);
    // The cookie alone (as a request forged from another site would carry it) is not enough.
    expect((await request(server).get('/api/kiosk').set('cookie', cookie)).status).toBe(401);
    expect((await request(server).post('/api/kiosk/pair').send({ token: `${t.tenant.id}.not-the-real-secret-at-all-0000` })).status).toBe(401);
  });

  it('a revoked tablet stops working, whether it pairs by cookie or the old header', async () => {
    const list = (await as('sup').get('/api/kiosks')).body as Array<{ id: string }>;
    expect((await as('sup').del(`/api/kiosks/${list[0]!.id}`)).status).toBe(204);
    expect((await tablet().get()).status).toBe(401);
    expect((await request(server).get('/api/kiosk').set('cookie', cookie).set('x-fh-kiosk', '1')).status).toBe(401);
  });
});
