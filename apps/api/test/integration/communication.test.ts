import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'notices';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
const id: Record<string, string> = {};
const as = (who: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const now = Math.floor(Date.now() / 1000);
  id.guard = t.users[0]!.id;
  tok.guard = await signAccessToken({ sub: id.guard, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  const mk = async (name: string, roles: ('EMPLOYEE' | 'AQUATIC_SUPERVISOR' | 'UNION_STEWARD')[]) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } });
    id[name] = u.id;
    tok[name] = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: now });
  };
  await mk('works', ['EMPLOYEE']);
  await mk('sup', ['AQUATIC_SUPERVISOR']);
  await mk('steward', ['UNION_STEWARD']);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('facility logbook', () => {
  it('staff add handover notes; entries can’t be changed', async () => {
    const r = await as('guard').post('/api/logbook', { facilityId: t.facility.id, category: 'MAINTENANCE', body: 'Slide closed: crack in the third section. Maintenance called.' });
    expect(r.status).toBe(201);
    expect((await as('steward').post('/api/logbook', { facilityId: t.facility.id, category: 'OTHER', body: 'hello' })).status).toBe(403);
    const list = (await as('sup').get(`/api/logbook?facilityId=${t.facility.id}`)).body;
    expect(list[0]).toMatchObject({ category: 'MAINTENANCE', author: `Guard0 ${SUB}` });
    await expect(appDb.$executeRawUnsafe(`UPDATE "LogEntry" SET body = 'x'`)).rejects.toThrow();
  });
});

describe('announcements', () => {
  let annId = '';
  it('a supervisor posts to a position; only those people see it, and it counts who read it', async () => {
    expect((await as('guard').post('/api/announcements', { title: 'Hi', body: 'Hello there' })).status).toBe(403);
    const r = await as('sup').post('/api/announcements', { title: 'Pool closed Monday', body: 'Annual shutdown starts Monday at 6 a.m.', positionIds: [t.position.id], pinned: true });
    expect(r.status).toBe(201);
    annId = r.body.id;
    expect(await owner.notification.count({ where: { type: 'announcement', userId: id.guard } })).toBe(1);
    expect((await as('works').get('/api/me/announcements')).body).toEqual([]);
    const mine = (await as('guard').get('/api/me/announcements')).body;
    expect(mine).toEqual([expect.objectContaining({ id: annId, pinned: true, read: false })]);
    await as('guard').post(`/api/me/announcements/${annId}/read`);
    expect((await as('guard').get('/api/me/announcements')).body[0].read).toBe(true);
    expect((await as('sup').get('/api/announcements')).body[0]).toMatchObject({ read: 1, of: 1 });
  });

  it('ending one takes it off everyone’s screen', async () => {
    await as('sup').post(`/api/announcements/${annId}/end`);
    expect((await as('guard').get('/api/me/announcements')).body).toEqual([]);
  });
});
