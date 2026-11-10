import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const EMAIL = `dev-${randomBytes(4).toString('hex')}@flexcity.dev`;
let cookie: string;
let existing: Awaited<ReturnType<typeof seedTenant>>;

const dev = () => ({
  get: (p: string) => request(server).get(p).set('x-fh-platform', '1').set('Cookie', cookie),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
  put: (p: string, b: object) => request(server).put(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
  patch: (p: string, b: object) => request(server).patch(p).set('x-fh-platform', '1').set('Cookie', cookie).send(b),
  delete: (p: string) => request(server).delete(p).set('x-fh-platform', '1').set('Cookie', cookie),
});
const facility = { name: 'Riverside Pool', province: 'ON', timezone: 'America/Toronto', latitude: null, longitude: null, geoRadiusM: 150, costCenter: 'AQ-1' };
const PNG = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex').toString('base64')}`;

beforeAll(async () => {
  existing = await seedTenant('sigma', 1);
  await owner.platformAdmin.create({ data: { email: EMAIL, name: 'Test Dev', passwordHash: await hashPassword('correct horse battery') } });
  const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email: EMAIL, password: 'correct horse battery' });
  expect(r.status).toBe(200);
  cookie = String(r.headers['set-cookie']).split(';')[0]!;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('Dev console sign-in', () => {
  it('needs the session cookie and the console header; organization tokens get nowhere', async () => {
    expect((await request(server).get('/api/platform/tenants').set('x-fh-platform', '1')).status).toBe(401);
    expect((await request(server).get('/api/platform/tenants').set('Cookie', cookie)).status).toBe(403);
    const hr = await signAccessToken({ sub: existing.users[0]!.id, tid: existing.tenant.id, roles: ['HR_ADMIN'] });
    expect((await request(server).get('/api/platform/tenants').set('x-fh-platform', '1').auth(hr, { type: 'bearer' })).status).toBe(401);
    expect((await dev().get('/api/platform/me')).body.email).toBe(EMAIL);
  });

  it('a Dev session is not an organization session', async () => {
    expect((await request(server).get('/api/me').set('x-tenant-subdomain', 'sigma').set('Cookie', cookie)).status).toBe(401);
  });

  it('locks the account after five wrong passwords', async () => {
    const email = `lock-${randomBytes(3).toString('hex')}@flexcity.dev`;
    await owner.platformAdmin.create({ data: { email, name: 'L', passwordHash: await hashPassword('right password!') } });
    const attempt = (password: string) => request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password });
    for (let i = 0; i < 5; i++) expect((await attempt('wrong')).status).toBe(401);
    expect((await attempt('right password!')).status).toBe(423);
  });

  it('offers Dev console passkeys on the console’s own address, only soon after signing in', async () => {
    const opts = await dev().post('/api/platform/passkeys/options');
    expect(opts.body.options.rp.id).toBe('localhost');
    expect((await request(server).post('/api/platform/auth/passkey/options').set('x-fh-platform', '1').send({})).body.options.rpId).toBe('localhost');
    await owner.platformSession.updateMany({ where: { admin: { email: EMAIL } }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    expect((await dev().post('/api/platform/passkeys/options')).body.code).toBe('STEP_UP_REQUIRED');
    expect((await dev().get('/api/platform/passkeys')).body).toEqual([]);
  });

  it('signing out ends the session', async () => {
    const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email: EMAIL, password: 'correct horse battery' });
    const c = String(r.headers['set-cookie']).split(';')[0]!;
    await request(server).post('/api/platform/auth/logout').set('x-fh-platform', '1').set('Cookie', c);
    expect((await request(server).get('/api/platform/me').set('x-fh-platform', '1').set('Cookie', c)).status).toBe(401);
  });
});

describe('cities', () => {
  let id: string;

  it('creates a city with its first facility and invites its HR administrator', async () => {
    const sub = `oak${randomBytes(3).toString('hex')}`;
    const r = await dev().post('/api/platform/tenants', { name: 'Town of Oakridge', subdomain: sub, facility, admin: { firstName: 'Pat', lastName: 'Lee', email: `pat@${sub}.ca` } });
    expect(r.status).toBe(201);
    id = r.body.id;
    expect((await dev().post('/api/platform/tenants', { name: 'Copy', subdomain: sub, facility })).body.code).toBe('SUBDOMAIN_TAKEN');
    expect((await dev().post('/api/platform/tenants', { name: 'Bad', subdomain: 'admin', facility })).status).toBe(400);
    const city = await dev().get(`/api/platform/tenants/${id}`);
    expect(city.body.organization).toMatchObject({ name: 'Town of Oakridge', subdomain: sub });
    expect(city.body.facilities).toHaveLength(1);
    expect(city.body.admins).toEqual([expect.objectContaining({ email: `pat@${sub}.ca`, invited: true })]);
    expect(await owner.emailOutbox.count({ where: { tenantId: id, template: 'invite' } })).toBe(1);
    const list = await dev().get('/api/platform/tenants');
    expect(list.body.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([id, existing.tenant.id]));
  });

  it('switches features and records who did it in the city’s audit trail', async () => {
    expect((await dev().patch(`/api/platform/tenants/${id}`, { features: { union: true, payroll: false } })).status).toBe(200);
    expect((await dev().patch(`/api/platform/tenants/${id}`, { features: { teleport: true } })).status).toBe(400);
    const city = await dev().get(`/api/platform/tenants/${id}`);
    expect(city.body.features).toMatchObject({ union: true, payroll: false, shiftBoard: true });
    expect(await owner.auditLog.count({ where: { tenantId: id, action: 'platform.tenant.features' } })).toBe(1);
  });

  it('adds and edits positions with their required certifications', async () => {
    const certs = (await dev().get(`/api/platform/tenants/${id}`)).body.certifications as Array<{ id: string }>;
    const r = await dev().post(`/api/platform/tenants/${id}/positions`, { name: 'Lifeguard', nameFr: 'Sauveteur', minimumAge: 16, requiredCertificationIds: certs.slice(0, 1).map((c) => c.id) });
    expect(r.status).toBe(201);
    expect((await dev().post(`/api/platform/tenants/${id}/positions`, { name: 'lifeguard', requiredCertificationIds: [] })).body.code).toBe('POSITION_EXISTS');
    expect((await dev().put(`/api/platform/tenants/${id}/positions/${r.body.id}`, { name: 'Lifeguard I', minimumAge: 15, requiredCertificationIds: [] })).status).toBe(200);
    const positions = (await dev().get(`/api/platform/tenants/${id}`)).body.positions;
    expect(positions).toEqual([expect.objectContaining({ name: 'Lifeguard I', minimumAge: 15, requiredCertificationIds: [] })]);
  });

  it('uploads a logo that the city’s own pages can load, and refuses anything else', async () => {
    expect((await dev().put(`/api/platform/tenants/${id}/logo`, { dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })).status).toBe(400);
    const up = await dev().put(`/api/platform/tenants/${id}/logo`, { dataUrl: PNG });
    expect(up.body.logoUrl).toMatch(new RegExp(`^/api/public/logo/${id}\\?v=`));
    const sub = (await dev().get(`/api/platform/tenants/${id}`)).body.organization.subdomain;
    const pub = await request(server).get(up.body.logoUrl);
    expect(pub.status).toBe(200);
    expect(pub.headers['content-type']).toBe('image/png');
    expect((await request(server).get('/api/public/tenant').set('x-tenant-subdomain', sub)).body.logoUrl).toBe(up.body.logoUrl);
    await dev().delete(`/api/platform/tenants/${id}/logo`);
    expect((await request(server).get(up.body.logoUrl)).status).toBe(404);
    expect((await request(server).get('/api/public/logo/not-a-uuid')).status).toBe(404);
  });

  it('imports staff: preview first, then creates only the rows that passed', async () => {
    const csv = ['first_name,last_name,email,employment,positions,hire_date,employee_number,union', 'Ana,Diaz,ana@oak.ca,part-time,Lifeguard I,2026-04-01,E1,yes', 'Bo,Chen,bad-email,casual,,,,', 'Cy,Ng,cy@oak.ca,casual,Diving Coach,,,'].join('\n');
    const pv = await dev().post(`/api/platform/tenants/${id}/import/preview`, { csv });
    expect(pv.body.summary).toEqual({ create: 1, exists: 0, error: 2 });
    expect(await owner.user.count({ where: { tenantId: id, email: 'ana@oak.ca' } })).toBe(0);
    const done = await dev().post(`/api/platform/tenants/${id}/import`, { csv, sendInvites: true });
    expect(done.body).toEqual({ created: 1, exists: 0, errors: 2, invited: 1 });
    const ana = await owner.user.findFirstOrThrow({ where: { tenantId: id, email: 'ana@oak.ca' }, include: { positions: true } });
    expect(ana).toMatchObject({ employmentStatus: 'PART_TIME', employeeNumber: 'E1', unionMember: true, roles: ['STAFF'] });
    expect(ana.positions).toHaveLength(1);
    // Importing the same file again creates nobody twice.
    expect((await dev().post(`/api/platform/tenants/${id}/import`, { csv })).body).toMatchObject({ created: 0, exists: 1 });
  });
});

describe('the Dev console sees no one’s personal information', () => {
  it('shows a city’s setup and counts, never employees’ records', async () => {
    const tid = existing.tenant.id;
    const staff = existing.users[0]!;
    // A city full of sensitive records.
    await owner.user.update({ where: { id: staff.id }, data: { phone: '250-555-0199', dateOfBirth: new Date('2008-03-14'), employeeNumber: 'EMP-7781' } });
    await owner.payRate.create({ data: { tenantId: tid, userId: staff.id, positionId: existing.position.id, hourlyRate: 31.37, effectiveFrom: new Date('2026-01-01') } });
    await owner.grievance.create({ data: { tenantId: tid, number: 1, userId: staff.id, title: 'Harassment complaint about the night lead', filedOn: new Date('2026-10-01'), history: [], createdById: staff.id } });
    await owner.emailOutbox.create({ data: { tenantId: tid, toEmail: staff.email, template: 'invite', params: { url: 'https://x/reset?token=never-show-this' } } });

    const bodies: string[] = [];
    for (const path of ['/tenants', `/tenants/${tid}`, `/tenants/${tid}/access`, `/billing/accounts/${tid}`, `/billing/invoices?tenantId=${tid}`, '/billing/summary', '/leads', '/payroll-tax', '/me']) {
      const r = await dev().get(`/api/platform${path}`);
      expect(r.status, path).toBeLessThan(500);
      bodies.push(JSON.stringify(r.body));
    }
    const all = bodies.join('\n');
    for (const secret of ['250-555-0199', '2008-03-14', 'EMP-7781', '31.37', 'Harassment', 'never-show-this', staff.email]) expect(all, secret).not.toContain(secret);
    for (const key of ['"dateOfBirth"', '"phone"', '"hourlyRate"', '"sin"', '"passwordHash"', '"employeeNumber"']) expect(all, key).not.toContain(key);
  });
});
