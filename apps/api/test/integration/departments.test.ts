import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'deptsplit';
let t: Awaited<ReturnType<typeof seedTenant>>;
const pos = { guard: '', water: '' };
const ids = { hr: '', sup: '', head: '', guard: '', casual: '', water: '' };
const tok = { hr: '', sup: '', head: '' };
const dept = { aquatics: '', water: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  delete: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
});
type Role = 'HR_ADMIN' | 'AQUATIC_SUPERVISOR' | 'HEAD_LIFEGUARD' | 'STAFF' | 'EMPLOYEE';
const mk = async (roles: Role[], name: string, position?: string) => {
  const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@deptsplit.test` } });
  if (position) await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: position } });
  return u.id;
};
const sign = (sub: string, roles: Role[]) => signAccessToken({ sub, tid: t.tenant.id, roles, aat: Math.floor(Date.now() / 1000) });
const names = (body: Array<{ id: string }>) => body.map((u) => u.id);
const shift = (positionId: string) => {
  const start = new Date(Date.now() + 6 * 86_400_000);
  return { facilityId: t.facility.id, positionId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 6 * 3_600_000).toISOString() };
};

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  pos.guard = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Pool Lifeguard' } })).id;
  pos.water = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Water Operator' } })).id;
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.sup = await mk(['AQUATIC_SUPERVISOR'], 'sup');
  ids.head = await mk(['HEAD_LIFEGUARD', 'STAFF'], 'head', pos.guard);
  ids.guard = await mk(['STAFF'], 'guard', pos.guard);
  ids.casual = await mk(['STAFF'], 'casual'); // pool staff without a position yet
  ids.water = await mk(['EMPLOYEE'], 'wally', pos.water);
  tok.hr = await sign(ids.hr, ['HR_ADMIN']);
  tok.sup = await sign(ids.sup, ['AQUATIC_SUPERVISOR']);
  tok.head = await sign(ids.head, ['HEAD_LIFEGUARD', 'STAFF']);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('departments', () => {
  it('before a city sets up departments, the aquatic supervisor still sees everyone', async () => {
    expect(names((await call(tok.sup).get('/api/users')).body)).toContain(ids.water);
  });

  it('only HR sets up departments', async () => {
    expect((await call(tok.sup).post('/api/departments', { name: 'Aquatics', aquatic: true, positionIds: [pos.guard] })).status).toBe(403);
    const a = await call(tok.hr).post('/api/departments', { name: 'Aquatics', aquatic: true, positionIds: [pos.guard], managerIds: [ids.sup, ids.head] });
    const w = await call(tok.hr).post('/api/departments', { name: 'Water Works', positionIds: [pos.water] });
    expect([a.status, w.status]).toEqual([201, 201]);
    dept.aquatics = a.body.id;
    dept.water = w.body.id;
    expect((await call(tok.hr).post('/api/departments', { name: 'water works' })).status).toBe(409);
  });

  it('an aquatic supervisor can’t see or manage water works employees', async () => {
    const people = names((await call(tok.sup).get('/api/users')).body);
    expect(people).toEqual(expect.arrayContaining([ids.guard, ids.casual, ids.head]));
    expect(people).not.toContain(ids.water);
    for (const path of ['', '/availability', '/discipline', '/reliability', '/case-file']) {
      expect((await call(tok.sup).get(`/api/users/${ids.water}${path}`)).status, path || 'profile').toBe(404);
    }
    expect((await call(tok.sup).post('/api/shifts', shift(pos.water))).status).toBe(403);
    expect((await call(tok.sup).post('/api/shifts', shift(pos.guard))).status).toBe(201);
    // Their department list shows aquatics only.
    const d = (await call(tok.sup).get('/api/departments')).body;
    expect(d.departments.map((x: { name: string }) => x.name)).toEqual(['Aquatics']);
  });

  it('a supervisor HR hasn’t chosen to run a department sees no one', async () => {
    const other = await mk(['AQUATIC_SUPERVISOR'], 'sup2');
    const o = await sign(other, ['AQUATIC_SUPERVISOR']);
    const people = names((await call(o).get('/api/users')).body);
    expect(people).not.toContain(ids.guard);
    expect(people).not.toContain(ids.water);
    expect((await call(o).post('/api/shifts', shift(pos.guard))).status).toBe(403);
  });

  it('a head lifeguard can’t schedule water works either', async () => {
    expect((await call(tok.head).post('/api/shifts', shift(pos.water))).status).toBe(403);
    expect((await call(tok.head).post('/api/shifts', shift(pos.guard))).status).toBe(201);
  });

  it('a Water Works manager sees only water works, including positions added later', async () => {
    const role = await call(tok.hr).post('/api/roles', { name: 'Water Works Manager', permissions: ['schedule.read', 'users.read', 'schedule.write', 'discipline.read'], scopeDepartmentIds: [dept.water] });
    expect(role.status).toBe(201);
    const mgr = await mk(['EMPLOYEE'], 'mgr');
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: mgr, customRoleId: role.body.id } });
    const m = await sign(mgr, ['EMPLOYEE']);
    let people = names((await call(m).get('/api/users')).body);
    expect(people).toContain(ids.water);
    expect(people).not.toContain(ids.guard);
    expect(people).not.toContain(ids.casual);
    expect((await call(m).get(`/api/users/${ids.guard}/discipline`)).status).toBe(404);
    // HR adds a new position to Water Works: the manager reaches it without changing the role.
    const meter = await call(tok.hr).post('/api/positions', { name: 'Meter Reader', requiredCertificationIds: [], departmentId: dept.water });
    expect(meter.status).toBe(201);
    const reader = await mk(['EMPLOYEE'], 'reader', meter.body.id);
    people = names((await call(m).get('/api/users')).body);
    expect(people).toContain(reader);
  });

  it('a custom manager role with no department reaches no one: only HR sees every department', async () => {
    const role = await call(tok.hr).post('/api/roles', { name: 'Floating Manager', permissions: ['schedule.read', 'users.read', 'discipline.read'] });
    const who = await mk(['EMPLOYEE'], 'floater');
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: who, customRoleId: role.body.id } });
    const people = names((await call(await sign(who, ['EMPLOYEE'])).get('/api/users')).body);
    expect(people).not.toContain(ids.guard);
    expect(people).not.toContain(ids.water);
  });

  it('HR sees every department and can pick one at a time', async () => {
    const all = names((await call(tok.hr).get('/api/users')).body);
    expect(all).toEqual(expect.arrayContaining([ids.guard, ids.water, ids.casual]));
    const aquatics = names((await call(tok.hr).get(`/api/users?department=${dept.aquatics}`)).body);
    expect(aquatics).toEqual(expect.arrayContaining([ids.guard, ids.head]));
    expect(aquatics).not.toContain(ids.water);
    const water = names((await call(tok.hr).get(`/api/users?department=${dept.water}`)).body);
    expect(water).toContain(ids.water);
    expect(water).not.toContain(ids.guard);
    expect(names((await call(tok.hr).get('/api/users?department=none')).body)).toContain(ids.casual);
    const d = (await call(tok.hr).get('/api/departments')).body;
    expect(d.departments.map((x: { name: string }) => x.name)).toEqual(['Aquatics', 'Water Works']);
    expect((await call(tok.hr).get('/api/users?department=nope')).status).toBe(400);
  });
});

describe('department managers', () => {
  it('HR chooses several supervisors and managers to run a department, from everyone who can', async () => {
    const catalog = (await call(tok.hr).get('/api/roles')).body.catalog as Record<string, string[]>;
    // Any type of role, including one with every capability.
    const everything = await call(tok.hr).post('/api/roles', { name: 'City Manager', permissions: Object.values(catalog).flat() });
    expect(everything.status).toBe(201);
    const parksRole = await call(tok.hr).post('/api/roles', { name: 'Parks Supervisor', permissions: ['schedule.read', 'users.read', 'schedule.write'] });
    const pat = await mk(['EMPLOYEE'], 'pat');
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: pat, customRoleId: parksRole.body.id } });
    const options = (await call(tok.hr).get('/api/departments')).body.managerOptions.map((o: { id: string }) => o.id);
    expect(options).toEqual(expect.arrayContaining([ids.sup, ids.head, pat]));
    expect(options).not.toContain(ids.guard);
    expect(options).not.toContain(ids.hr);
    // Any number of positions, and several managers.
    const positions: string[] = [];
    for (let i = 0; i < 12; i++) positions.push((await owner.position.create({ data: { tenantId: t.tenant.id, name: `Parks Worker ${i}` } })).id);
    const d = await call(tok.hr).post('/api/departments', { name: 'Parks', positionIds: positions, managerIds: [pat, ids.sup] });
    expect(d.status).toBe(201);
    const parks = (await call(tok.hr).get('/api/departments')).body.departments.find((x: { name: string }) => x.name === 'Parks');
    expect(parks.positions).toHaveLength(12);
    expect(parks.managerIds.sort()).toEqual([pat, ids.sup].sort());
    // Pat now reaches Parks workers; the aquatic supervisor runs both of their departments.
    const worker = await mk(['EMPLOYEE'], 'parky', positions[0]);
    expect(names((await call(await sign(pat, ['EMPLOYEE'])).get('/api/users')).body)).toContain(worker);
    const supSees = names((await call(tok.sup).get('/api/users')).body);
    expect(supSees).toEqual(expect.arrayContaining([worker, ids.guard]));
    // Someone who doesn't supervise can't be chosen.
    expect((await call(tok.hr).put(`/api/departments/${d.body.id}`, { name: 'Parks', positionIds: positions, managerIds: [ids.guard] })).status).toBe(400);
    // Taking the supervisor off Parks takes Parks away from them.
    expect((await call(tok.hr).put(`/api/departments/${d.body.id}`, { name: 'Parks', positionIds: positions, managerIds: [pat] })).status).toBe(200);
    expect(names((await call(tok.sup).get('/api/users')).body)).not.toContain(worker);
  });
});

describe('HR records', () => {
  it('a supervisor sees only the records they were involved in; HR sees them all', async () => {
    const at = new Date(Date.now() - 86_400_000).toISOString();
    const note = (summary: string) => ({ category: 'CONDUCT', summary, occurredAt: at });
    expect((await call(tok.hr).post(`/api/users/${ids.guard}/conduct-notes`, note('HR wrote this about a late return from break.'))).status).toBe(201);
    expect((await call(tok.sup).post(`/api/users/${ids.guard}/conduct-notes`, note('Supervisor saw this on deck: phone use on the chair.'))).status).toBe(201);
    const issued = await call(tok.hr).post(`/api/users/${ids.guard}/discipline`, { summary: 'Written warning issued by HR for repeated lateness.', level: null });
    expect(issued.status).toBe(201);
    const supFile = (await call(tok.sup).get(`/api/users/${ids.guard}/case-file`)).body;
    expect(supFile.onlyMine).toBe(true);
    expect(supFile.notes.map((n: { summary: string }) => n.summary)).toEqual(['Supervisor saw this on deck: phone use on the chair.']);
    expect(supFile.records).toEqual([]);
    expect((await call(tok.sup).get(`/api/users/${ids.guard}/discipline`)).body).toEqual([]);
    const hrFile = (await call(tok.hr).get(`/api/users/${ids.guard}/case-file`)).body;
    expect(hrFile.onlyMine).toBe(false);
    expect(hrFile.notes).toHaveLength(2);
    expect(hrFile.records).toHaveLength(1);
    // People review: the supervisor sees the people they wrote about, nobody else.
    expect((await call(tok.sup).get('/api/people/review')).body.map((r: { id: string }) => r.id)).toEqual([ids.guard]);
  });
});
