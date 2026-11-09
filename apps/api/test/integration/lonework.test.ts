import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { loneWorkChecks } from '../../src/services/safety/loneWork.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'alone';
let t: Awaited<ReturnType<typeof seedTenant>>;
let worker: string;
let sup: string;
let hr: string;
let tok: { worker: string; sup: string };

const as = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const sign = (sub: string, roles: ('EMPLOYEE' | 'AQUATIC_SUPERVISOR' | 'HR_ADMIN')[]) => signAccessToken({ sub, tid: t.tenant.id, roles, aat: Math.floor(Date.now() / 1000) });
const notes = (userId: string, type: string) => owner.notification.count({ where: { userId, type } });

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const mk = (roles: ('EMPLOYEE' | 'AQUATIC_SUPERVISOR' | 'HR_ADMIN')[], email: string) =>
    owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: email, lastName: 'X', email: `${email}@alone.test` } });
  worker = (await mk(['EMPLOYEE'], 'pat')).id;
  sup = (await mk(['AQUATIC_SUPERVISOR'], 'sup')).id;
  hr = (await mk(['HR_ADMIN'], 'hr')).id;
  tok = { worker: await sign(worker, ['EMPLOYEE']), sup: await sign(sup, ['AQUATIC_SUPERVISOR']) };
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('working alone', () => {
  it('starts one session at a time, on a listed interval', async () => {
    expect((await as(tok.worker).post('/api/me/lone-work', { location: 'Pump station 4', intervalMinutes: 7 })).status).toBe(400);
    const r = await as(tok.worker).post('/api/me/lone-work', { location: 'Pump station 4', task: 'Valve inspection', intervalMinutes: 30, latitude: 49.9, longitude: -119.4 });
    expect(r.status).toBe(201);
    expect(new Date(r.body.nextDueAt).getTime() - new Date(r.body.startedAt).getTime()).toBe(30 * 60_000);
    expect((await as(tok.worker).post('/api/me/lone-work', { location: 'Elsewhere', intervalMinutes: 30 })).body.code).toBe('ALREADY_ALONE');
    expect((await as(tok.sup).get('/api/lone-work')).body).toEqual([expect.objectContaining({ person: 'pat X', location: 'Pump station 4', status: 'ACTIVE' })]);
  });

  it('a missed check-in alerts the worker and monitors, then escalates to HR', async () => {
    await owner.loneWorkSession.updateMany({ where: { userId: worker }, data: { nextDueAt: new Date(Date.now() - 60_000) } });
    expect(await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx))).toBe(1);
    expect(await notes(worker, 'lonework_check_in_now')).toBe(1);
    expect(await notes(sup, 'lonework_overdue')).toBe(1);
    expect(await notes(hr, 'lonework_escalated')).toBe(0);
    // Running again inside the grace period does nothing new.
    expect(await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx))).toBe(0);
    // After the grace period: escalate, with an email.
    expect(await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx, new Date(Date.now() + 16 * 60_000)))).toBe(1);
    expect(await notes(hr, 'lonework_escalated')).toBe(1);
    expect(await notes(sup, 'lonework_escalated')).toBe(1);
    expect(await owner.emailOutbox.count({ where: { template: 'lonework_escalated', tenantId: t.tenant.id } })).toBe(2);
  });

  it('checking in clears it, tells monitors, and resets the timer', async () => {
    const r = await as(tok.worker).post('/api/me/lone-work/check-in', {});
    expect(r.body.status).toBe('ACTIVE');
    expect(await notes(sup, 'lonework_ok')).toBe(1);
  });

  it('"I need help" reaches everyone at once; a monitor responds and the worker is told', async () => {
    const r = await as(tok.worker).post('/api/me/lone-work/help', { note: 'Slipped, ankle hurt' });
    expect(r.body.status).toBe('HELP');
    expect(await notes(sup, 'lonework_help')).toBe(1);
    expect(await notes(hr, 'lonework_help')).toBe(1);
    // A later check-in doesn't hide a help request.
    expect((await as(tok.worker).post('/api/me/lone-work/check-in', {})).body.status).toBe('HELP');
    const list = await as(tok.sup).get('/api/lone-work');
    expect((await as(tok.sup).post(`/api/lone-work/${list.body[0].id}/respond`)).status).toBe(200);
    expect(await notes(worker, 'lonework_responding')).toBe(1);
    expect((await as(tok.sup).get('/api/lone-work')).body[0]).toMatchObject({ status: 'HELP', responder: 'sup X' });
  });

  it('ends; workers can’t see the board and monitors can close a forgotten session', async () => {
    expect((await as(tok.worker).get('/api/lone-work')).status).toBe(403);
    expect((await as(tok.worker).post('/api/me/lone-work/end')).status).toBe(200);
    expect((await as(tok.worker).get('/api/me/lone-work')).body).toBeNull();
    await as(tok.worker).post('/api/me/lone-work', { location: 'Arena', intervalMinutes: 60 });
    const id = (await as(tok.sup).get('/api/lone-work')).body.find((s: { status: string }) => s.status === 'ACTIVE').id;
    expect((await as(tok.sup).post(`/api/lone-work/${id}/close`, { note: 'Called, home safe' })).status).toBe(200);
    expect((await as(tok.worker).get('/api/me/lone-work')).body).toBeNull();
  });
});
