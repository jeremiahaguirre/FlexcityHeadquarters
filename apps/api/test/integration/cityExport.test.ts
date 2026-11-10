import { randomBytes } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { forgetTenantLookup } from '../../src/routes/context.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'exportcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hrId = '';
const tok = { hr: '', staff: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const binary = (r: request.Request) =>
  r.buffer(true).parse((res, cb) => {
    const parts: Buffer[] = [];
    res.on('data', (c: Buffer) => parts.push(c));
    res.on('end', () => cb(null, Buffer.concat(parts)));
  });
const PDF = Buffer.from('%PDF-1.4\n% medical note for the test\n%%EOF\n');

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  const now = Math.floor(Date.now() / 1000);
  const hr = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'Admin', email: `hr@${SUB}.test`, passwordHash: await hashPassword('hr password 12') } });
  hrId = hr.id;
  await owner.user.update({ where: { id: t.users[0]!.id }, data: { passwordHash: await hashPassword('staff password 1') } });
  tok.hr = await signAccessToken({ sub: hr.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  // Sealed things the export has to open: a SIN, a bank account, a document.
  expect((await call(tok.hr).put(`/api/users/${t.users[0]!.id}/pay-profile`, { sin: '130 692 544' })).status).toBeLessThan(300);
  expect((await call(tok.hr).post(`/api/users/${t.users[0]!.id}/documents`, { kind: 'MEDICAL_NOTE', title: 'Doctor’s note', fileName: 'note.pdf', data: `data:application/pdf;base64,${PDF.toString('base64')}` })).status).toBe(201);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('the organization’s full data export', () => {
  it('is for administrators only', async () => {
    expect((await call(tok.staff).get('/api/data-export')).status).toBe(403);
    const s = await call(tok.hr).get('/api/data-export');
    expect(s.status).toBe(200);
    expect(s.body.tables.find((x: { table: string }) => x.table === 'User').rows).toBe(3);
    expect(s.body.files).toBe(1);
  });

  it('contains every record, opened and readable, without sign-in secrets or the union hub', async () => {
    const r = await binary(call(tok.hr).get('/api/data-export/download'));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(r.headers['cache-control']).toBe('no-store');
    const zip = unzipSync(new Uint8Array(r.body as Buffer));
    const names = Object.keys(zip);
    const text = (n: string) => strFromU8(zip[`flexcity-export/${n}`]!);
    const readme = JSON.parse(text('README.json'));
    expect(readme.organization).toBe(`City of ${SUB}`);
    expect(readme.requestedBy).toBe('Hana Admin');
    expect(readme.problems).toEqual([]);
    // Staff records, as spreadsheets and JSON.
    const users = text('csv/User.csv');
    // A byte-order mark, so Excel reads accents correctly (the text decoder strips it).
    expect([...zip['flexcity-export/csv/User.csv']!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(users).toContain(`guard0@${SUB}.test`);
    expect(users).not.toContain('passwordHash');
    expect(users).not.toContain('scrypt$');
    // Sealed values opened: the full SIN and the original document, byte for byte.
    const profile = text('json/PayProfile.jsonl').trim().split('\n').map((l) => JSON.parse(l))[0];
    expect(profile.sin).toBe('130692544');
    expect(profile.sinCiphertext).toBeUndefined();
    const doc = text('json/EmployeeDocument.jsonl').trim().split('\n').map((l) => JSON.parse(l))[0];
    expect(doc.ciphertext).toBeUndefined();
    expect(Buffer.from(zip[`flexcity-export/${doc.file}`]!).equals(PDF)).toBe(true);
    // Never included.
    for (const secret of ['RefreshToken', 'AuthToken', 'Passkey', 'PlatformAudit', 'SupportSession']) expect(names.some((n) => n.includes(`/${secret}.`))).toBe(false);
    expect(names.some((n) => /union/i.test(n))).toBe(false);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'data.export', actorId: hrId } })).toBe(1);
  });

  it('a stale sign-in is asked to confirm first', async () => {
    const old = await signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) - 3 * 3600, mfa: true });
    expect((await call(old).get('/api/data-export/download')).body.code).toBe('STEP_UP_REQUIRED');
  });
});

describe('after offboarding', () => {
  const closeWith = async (exportUntil: Date | null) => {
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { disabledAt: new Date(), disabledReason: 'Contract ended', offboardedAt: new Date(), deleteAfter: new Date(Date.now() + 30 * 86_400_000), exportUntil } });
    forgetTenantLookup();
    forgetFeatures(t.tenant.id);
  };
  const login = (email: string, password: string) => request(server).post('/api/auth/login').set('x-tenant-subdomain', SUB).send({ email, password });

  it('administrators can sign in only to download the data; everyone else is shut out', async () => {
    await closeWith(new Date(Date.now() + 30 * 86_400_000));
    const pub = await request(server).get('/api/public/tenant').set('x-tenant-subdomain', SUB);
    expect(pub.body.closed.exportUntil).toBeTruthy();
    expect((await login(`guard0@${SUB}.test`, 'staff password 1')).body.code).toBe('ORG_DISABLED');
    const hr = await login(`hr@${SUB}.test`, 'hr password 12');
    expect(hr.status).toBe(200);
    const token = hr.body.accessToken as string;
    const me = await call(token).get('/api/me');
    expect(me.body.closed.exportUntil).toBeTruthy();
    expect((await call(token).get('/api/data-export')).status).toBe(200);
    expect((await call(token).get('/api/shifts?from=2026-01-01&to=2026-01-08')).body.code).toBe('ORG_DISABLED');
    expect((await call(token).get('/api/users')).body.code).toBe('ORG_DISABLED');
    // A staff session from before the closing stops at once.
    expect((await call(tok.staff).get('/api/me')).body.code).toBe('ORG_DISABLED');
  });

  it('once the export window ends, nothing opens', async () => {
    await closeWith(new Date(Date.now() - 1000));
    expect((await login(`hr@${SUB}.test`, 'hr password 12')).body.code).toBe('ORG_DISABLED');
    expect((await call(tok.hr).get('/api/data-export')).body.code).toBe('ORG_DISABLED');
  });
});
