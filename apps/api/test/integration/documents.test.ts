import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'doccity';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { hr: '', sup: '', emp: '', other: '' };
const ids = { other: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  del: (p: string, b: object = {}) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
// A tiny real PDF, and a "PDF" that is really a script.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n' + 'x'.repeat(200));
const dataUrl = (b: Buffer, type = 'application/pdf') => `data:${type};base64,${b.toString('base64')}`;

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  const now = Math.floor(Date.now() / 1000);
  const mk = async (roles: Array<'HR_ADMIN' | 'AQUATIC_SUPERVISOR' | 'EMPLOYEE'>, name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } })).id;
  tok.hr = await signAccessToken({ sub: await mk(['HR_ADMIN'], 'hr'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  const sup = await mk(['AQUATIC_SUPERVISOR'], 'sup');
  tok.sup = await signAccessToken({ sub: sup, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
  tok.emp = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  ids.other = await mk(['EMPLOYEE'], 'roads');
  tok.other = await signAccessToken({ sub: ids.other, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now });
  const roads = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Roads' } });
  await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: ids.other, positionId: roads.id } });
  await call(tok.hr).post('/api/departments', { name: 'Aquatics', aquatic: true, positionIds: [t.position.id], managerIds: [sup] });
  await call(tok.hr).post('/api/departments', { name: 'Roads', positionIds: [roads.id] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('employee documents', () => {
  let note = '';
  let cert = '';
  it('an employee uploads a doctor’s note: encrypted, HR-only, and checked by content', async () => {
    expect((await call(tok.emp).post('/api/me/documents', { kind: 'OTHER', title: 'Not a PDF', fileName: 'x.pdf', data: dataUrl(Buffer.from('<script>alert(1)</script>')) })).body.code).toBe('UNSUPPORTED_TYPE');
    const r = await call(tok.emp).post('/api/me/documents', { kind: 'MEDICAL_NOTE', title: 'Doctor’s note', fileName: 'note.pdf', data: dataUrl(PDF), shareWithDepartment: true });
    expect(r.status).toBe(201);
    expect(r.body.visibility).toBe('HR'); // medical stays with HR whatever was asked
    note = r.body.id;
    const stored = await owner.employeeDocument.findUniqueOrThrow({ where: { id: note } });
    expect(Buffer.from(stored.ciphertext).includes(Buffer.from('%PDF'))).toBe(false);
    expect(stored.contentType).toBe('application/pdf');
  });

  it('accepts files over the usual request size, up to 10 MB', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024, 0x20)]);
    expect((await call(tok.emp).post('/api/me/documents', { kind: 'OTHER', title: 'Big', fileName: 'big.pdf', data: dataUrl(big) })).status).toBe(201);
  });

  it('supervisors add department files but never see or add medical notes', async () => {
    expect((await call(tok.sup).post(`/api/users/${t.users[0]!.id}/documents`, { kind: 'MEDICAL_NOTE', title: 'Note from the clinic', fileName: 'x.pdf', data: dataUrl(PDF) })).status).toBe(403);
    const c = await call(tok.sup).post(`/api/users/${t.users[0]!.id}/documents`, { kind: 'CERTIFICATE', title: 'NLS card', fileName: 'nls card.html', data: dataUrl(PDF) });
    expect(c.body.visibility).toBe('DEPARTMENT');
    cert = c.body.id;
    const listed = (await call(tok.sup).get(`/api/users/${t.users[0]!.id}/documents`)).body as Array<{ id: string; fileName: string }>;
    // Renamed to its real type: a PDF can't come back as a web page.
    expect(listed.find((d) => d.id === cert)?.fileName).toBe('nls card.pdf');
    const list = listed.map((d) => d.id);
    expect(list).toContain(cert);
    expect(list).not.toContain(note);
    expect((await call(tok.sup).get(`/api/documents/${note}/file`)).status).toBe(404);
    expect((await call(tok.sup).get(`/api/users/${ids.other}/documents`)).status).toBe(404); // not their department
  });

  it('HR and the employee open the file, and every opening is logged', async () => {
    const f = await call(tok.hr).get(`/api/documents/${note}/file`).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    });
    expect(f.status).toBe(200);
    expect(Buffer.compare(f.body as Buffer, PDF)).toBe(0);
    expect(f.headers['x-content-type-options']).toBe('nosniff');
    expect(f.headers['content-type']).toBe('application/pdf');
    expect(f.headers['content-disposition']).toBe('attachment; filename="note.pdf"');
    expect(f.headers['content-security-policy']).toBe("default-src 'none'; sandbox; frame-ancestors 'none'");
    expect((await call(tok.emp).get(`/api/documents/${note}/file`)).status).toBe(200);
    expect((await call(tok.other).get(`/api/documents/${note}/file`)).status).toBe(404);
    expect(await owner.auditLog.count({ where: { action: 'document.view', entityId: note } })).toBe(2);
    expect((await call(tok.emp).get('/api/me/documents')).body.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining([note, cert]));
  });

  it('only HR removes a file; the contents are wiped and the reason kept', async () => {
    expect((await call(tok.sup).del(`/api/documents/${cert}`, { reason: 'Wrong person' })).status).toBe(403);
    expect((await call(tok.hr).del(`/api/documents/${cert}`, { reason: 'Uploaded to the wrong person' })).status).toBe(200);
    const gone = await owner.employeeDocument.findUniqueOrThrow({ where: { id: cert } });
    expect(gone.ciphertext.length).toBe(0);
    expect(gone.deletedReason).toBe('Uploaded to the wrong person');
    expect((await call(tok.emp).get(`/api/documents/${cert}/file`)).status).toBe(404);
  });
});
