import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'contacts';
type Role = 'EMPLOYEE' | 'AQUATIC_SUPERVISOR' | 'HR_ADMIN';
let t: Awaited<ReturnType<typeof seedTenant>>;
let worker: string;
let other: string;
const tok: Record<string, string> = {};

const as = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  put: (p: string, b: unknown) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b as object),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const mk = async (roles: Role[], name: string) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@contacts.test` } });
    tok[name] = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: Math.floor(Date.now() / 1000) });
    return u.id;
  };
  worker = await mk(['EMPLOYEE'], 'worker');
  other = await mk(['EMPLOYEE'], 'other');
  await mk(['AQUATIC_SUPERVISOR'], 'sup');
  await mk(['HR_ADMIN'], 'hr');
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const SAM = { name: 'Sam Rivera', relationship: 'Partner', phone: '250-555-0101' };
const ALEX = { name: 'Alex Rivera', relationship: 'Parent', phone: '(250) 555-0102', altPhone: '+1 778 555 0103' };

describe('emergency contacts', () => {
  it('people keep their own, in calling order, up to three', async () => {
    const r = await as(tok.worker!).put('/api/me/emergency-contacts', [ALEX, SAM]);
    expect(r.status).toBe(200);
    expect(r.body.map((c: { name: string; priority: number }) => [c.priority, c.name])).toEqual([[1, 'Alex Rivera'], [2, 'Sam Rivera']]);
    expect((await as(tok.worker!).get('/api/me/emergency-contacts')).body).toHaveLength(2);
    expect((await as(tok.worker!).put('/api/me/emergency-contacts', [SAM, SAM, SAM, SAM])).status).toBe(400);
    expect((await as(tok.worker!).put('/api/me/emergency-contacts', [{ ...SAM, phone: '555-0101' }])).status).toBe(400);
  });

  it('only HR sees someone else’s, and each look is audited', async () => {
    expect((await as(tok.other!).get(`/api/users/${worker}/emergency-contacts`)).status).toBe(403);
    expect((await as(tok.sup!).get(`/api/users/${worker}/emergency-contacts`)).status).toBe(403);
    const r = await as(tok.hr!).get(`/api/users/${worker}/emergency-contacts`);
    expect(r.status).toBe(200);
    expect(r.body[0].name).toBe('Alex Rivera');
    expect(await owner.auditLog.count({ where: { action: 'emergency_contacts.read', entityId: worker } })).toBe(1);
    expect((await as(tok.hr!).put(`/api/users/${other}/emergency-contacts`, [SAM])).status).toBe(200);
    expect((await as(tok.hr!).get('/api/users/00000000-0000-4000-8000-000000000000/emergency-contacts')).status).toBe(404);
  });

  it('a working-alone monitor sees them only once a session escalates or asks for help', async () => {
    const s = await as(tok.worker!).post('/api/me/lone-work', { location: 'Pump station 4', intervalMinutes: 30 });
    expect(s.status).toBe(201);
    const path = `/api/lone-work/${s.body.id}/emergency-contacts`;
    expect((await as(tok.sup!).get(path)).body.code).toBe('NOT_ESCALATED');
    expect((await as(tok.other!).get(path)).status).toBe(403);
    await owner.loneWorkSession.update({ where: { id: s.body.id }, data: { status: 'ESCALATED', escalatedAt: new Date() } });
    const r = await as(tok.sup!).get(path);
    expect(r.status).toBe(200);
    expect(r.body.map((c: { phone: string }) => c.phone)).toEqual(['(250) 555-0102', '250-555-0101']);
  });

  it('are part of the person’s records export, and go when erasure is requested', async () => {
    const ex = await as(tok.hr!).get(`/api/users/${worker}/records-export`);
    expect(ex.status).toBe(200);
    expect(ex.body.emergencyContacts).toHaveLength(2);
    const { requestErasure } = await import('../../src/services/privacy/erasure.js');
    const { withTenant } = await import('../../src/lib/db.js');
    await withTenant(t.tenant.id, (tx) => requestErasure(tx, t.tenant.id, worker, worker));
    expect(await owner.emergencyContact.count({ where: { userId: worker } })).toBe(0);
  });
});
