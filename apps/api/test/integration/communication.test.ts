import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
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
    // It opens the Announcements page, which every role can open (Today hides read notices).
    expect((await owner.notification.findFirst({ where: { type: 'announcement', userId: id.guard } }))?.link).toBe('/announcements');
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

describe('a poster limited to a department', () => {
  it('writes only to their department’s positions, and sees and ends only their department’s announcements', async () => {
    const now = Math.floor(Date.now() / 1000);
    const hrUser = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hr', lastName: 'X', email: `hr@${SUB}.test` } });
    tok.hr = await signAccessToken({ sub: hrUser.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
    const water = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Water Operator' } })).id;
    const aquatics = (await as('hr').post('/api/departments', { name: 'Aquatics', positionIds: [t.position.id] })).body.id as string;
    expect((await as('hr').post('/api/departments', { name: 'Water Works', positionIds: [water] })).status).toBe(201);
    const role = await as('hr').post('/api/roles', { name: 'Aquatics notices', permissions: ['announcements.post'], scopeDepartmentIds: [aquatics] });
    expect(role.status).toBe(201);
    const poster = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Poster', lastName: 'X', email: `poster@${SUB}.test` } });
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: poster.id, customRoleId: role.body.id } });
    forgetCustomPermissions(t.tenant.id);
    tok.poster = await signAccessToken({ sub: poster.id, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now });
    const theirs = (await as('hr').post('/api/announcements', { title: 'Plant closed Friday', body: 'Water Works only: the plant closes Friday.', positionIds: [water], pinned: true })).body.id as string;
    const before = await owner.announcement.count({ where: { tenantId: t.tenant.id } });
    // Everyone (no positions) and another department's positions are refused; their own are fine.
    expect((await as('poster').post('/api/announcements', { title: 'To everyone', body: 'Addressed to the whole organization.' })).status).toBe(403);
    expect((await as('poster').post('/api/announcements', { title: 'To Water Works', body: 'Addressed to another department.', positionIds: [water] })).status).toBe(403);
    expect(await owner.announcement.count({ where: { tenantId: t.tenant.id } })).toBe(before);
    const own = await as('poster').post('/api/announcements', { title: 'Pool notice', body: 'Addressed to the pool only.', positionIds: [t.position.id] });
    expect(own.status).toBe(201);
    // The list shows their department's announcements, not Water Works', and they can't end Water Works'.
    const list = (await as('poster').get('/api/announcements')).body as Array<{ id: string }>;
    expect(list.map((x) => x.id)).toContain(own.body.id);
    expect(list.map((x) => x.id)).not.toContain(theirs);
    expect((await as('poster').post(`/api/announcements/${theirs}/end`)).status).toBe(404);
    const still = await owner.announcement.findUniqueOrThrow({ where: { id: theirs } });
    expect([still.pinned, still.expiresAt]).toEqual([true, null]);
    expect((await as('poster').post(`/api/announcements/${own.body.id}/end`)).status).toBe(200);
  });
});
