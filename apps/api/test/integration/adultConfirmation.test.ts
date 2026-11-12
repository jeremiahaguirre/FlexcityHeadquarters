/** HR's confirmation that someone with no birth date is of the age of majority: HR only, audited, a birth date wins, never shown to staff. */
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetDepartments } from '../../src/services/people/departments.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'adultok';
const OTHER = 'adultok-other';
const tok: Record<string, string> = {};
const id: Record<string, string> = {};
const subOf: Record<string, string> = {};
const as = (who: string) => {
  const s = subOf[who] ?? SUB;
  const r = (m: 'get' | 'post' | 'put' | 'delete', p: string) => request(server)[m](p).set('x-tenant-subdomain', s).auth(tok[who]!, { type: 'bearer' });
  return { get: (p: string) => r('get', p), post: (p: string, b: object = {}) => r('post', p).send(b), put: (p: string, b: object = {}) => r('put', p).send(b), del: (p: string) => r('delete', p) };
};
const yearsAgo = (y: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - y, d.getUTCMonth(), d.getUTCDate()));
};
const direct = (from: string, to: string) => as(from).post('/api/messages/direct', { userId: id[to] });
const confirm = (who: string, target: string, note = 'ID checked at hire') => as(who).put(`/api/users/${id[target]}/adult-confirmation`, { note });

beforeAll(async () => {
  const t = await seedTenant(SUB, 0);
  const o = await seedTenant(OTHER, 0);
  const now = Math.floor(Date.now() / 1000);
  const dept = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } });
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: dept.id } });
  const mk = async (name: string, roles: string[], dob: Date | null, positionId: string | null, tenant = t) => {
    const u = await owner.user.create({ data: { tenantId: tenant.tenant.id, roles: roles as never, employmentStatus: 'PART_TIME', firstName: name, lastName: 'Test', email: `${name}@${SUB}.test`, dateOfBirth: dob } });
    if (positionId) await owner.userPosition.create({ data: { tenantId: tenant.tenant.id, userId: u.id, positionId } });
    id[name] = u.id;
    tok[name] = await signAccessToken({ sub: u.id, tid: tenant.tenant.id, roles: roles as never, aat: now });
  };
  await mk('g0', ['STAFF'], yearsAgo(30), t.position.id);
  await mk('u1', ['STAFF'], null, t.position.id);
  await mk('m1', ['STAFF'], yearsAgo(16), t.position.id);
  await mk('sup', ['AQUATIC_SUPERVISOR'], yearsAgo(45), null);
  await mk('hr', ['HR_ADMIN'], yearsAgo(50), null);
  await owner.departmentManager.create({ data: { tenantId: t.tenant.id, departmentId: dept.id, userId: id.sup! } });
  forgetDepartments(t.tenant.id);
  await mk('hrx', ['HR_ADMIN'], yearsAgo(50), null, o);
  subOf.hrx = OTHER;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('HR confirms an adult with no birth date on file', () => {
  it('without a birth date or a confirmation, an adult can’t message them one to one', async () => {
    expect((await direct('g0', 'u1')).body.code).toBe('MINOR_RULE');
  });

  it('only HR can confirm: not a supervisor, not staff, not another organization’s HR; a note is required', async () => {
    expect((await confirm('sup', 'u1')).status).toBe(403);
    expect((await confirm('g0', 'u1')).status).toBe(403);
    expect((await confirm('u1', 'u1')).status).toBe(403);
    expect((await confirm('hrx', 'u1')).status).toBe(404);
    expect((await confirm('hr', 'u1', '')).status).toBe(400);
    expect(await owner.user.count({ where: { id: id.u1!, adultConfirmedAt: { not: null } } })).toBe(0);
  });

  it('HR confirms with how; it is audited; the person is then treated as an adult', async () => {
    const r = await confirm('hr', 'u1');
    expect(r.status).toBe(200);
    expect(r.body.note).toBe('ID checked at hire');
    const log = await owner.auditLog.findFirst({ where: { action: 'user.adult_confirmed', entityId: id.u1! } });
    expect(log).toMatchObject({ actorId: id.hr, after: { note: 'ID checked at hire' } });
    const c = await direct('g0', 'u1');
    expect(c.status).toBe(201);
    id.conv = c.body.id;
    expect((await as('g0').post(`/api/messages/conversations/${id.conv}/messages`, { text: 'Welcome aboard' })).status).toBe(201);
  });

  it('HR sees who confirmed it, when and how, next to the birth date', async () => {
    const p = (await as('hr').get(`/api/users/${id.u1}`)).body;
    expect(p.dateOfBirth).toBeNull();
    expect(p.adultConfirmation).toMatchObject({ by: 'hr Test', note: 'ID checked at hire' });
    expect(Date.parse(p.adultConfirmation.at)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('never shown to other staff: not the supervisor, not the person, not the messaging directory', async () => {
    const sup = (await as('sup').get(`/api/users/${id.u1}`)).body;
    expect(sup.id).toBe(id.u1);
    expect(JSON.stringify(sup)).not.toMatch(/adultConfirm|ID checked/);
    expect(JSON.stringify((await as('u1').get('/api/me')).body)).not.toMatch(/adultConfirm|ID checked/);
    expect(JSON.stringify((await as('g0').get('/api/messages/people')).body)).not.toMatch(/adultConfirm|ID checked/);
    expect(JSON.stringify((await as('sup').get('/api/users')).body)).not.toMatch(/adultConfirm|ID checked/);
  });

  it('a birth date always wins: HR can’t confirm someone the birth date says is a minor, and a stored confirmation doesn’t change it', async () => {
    const r = await confirm('hr', 'm1');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BIRTH_DATE_MINOR');
    await owner.user.update({ where: { id: id.m1! }, data: { adultConfirmedAt: new Date(), adultConfirmedById: id.hr!, adultConfirmedNote: 'mistake' } });
    expect((await direct('g0', 'm1')).body.code).toBe('MINOR_RULE');
    // A birth date added later that says minor makes the confirmed person's conversations with adults read-only.
    await owner.user.update({ where: { id: id.u1! }, data: { dateOfBirth: yearsAgo(17) } });
    expect((await as('g0').post(`/api/messages/conversations/${id.conv}/messages`, { text: 'still there?' })).body.code).toBe('READ_ONLY');
    await owner.user.update({ where: { id: id.u1! }, data: { dateOfBirth: null } });
  });

  it('the person’s records export includes it', async () => {
    const r = await as('hr').get(`/api/users/${id.u1}/records-export`);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text);
    expect(body.person.adultConfirmedNote).toBe('ID checked at hire');
    expect(body.person.adultConfirmedAt).toBeTruthy();
  });

  it('HR removes it (audited); the person is possibly a minor again', async () => {
    expect((await as('sup').del(`/api/users/${id.u1}/adult-confirmation`)).status).toBe(403);
    expect((await as('hr').del(`/api/users/${id.u1}/adult-confirmation`)).status).toBe(200);
    expect(await owner.auditLog.count({ where: { action: 'user.adult_confirmation_removed', entityId: id.u1! } })).toBe(1);
    expect((await as('hr').get(`/api/users/${id.u1}`)).body.adultConfirmation).toBeNull();
    expect((await as('g0').post(`/api/messages/conversations/${id.conv}/messages`, { text: 'hello?' })).body.code).toBe('READ_ONLY');
  });
});
