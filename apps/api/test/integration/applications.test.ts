import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { applyRetention } from '../../src/services/privacy/retention.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'hiring';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr = '';
let postingId = '';
const as = () => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send(b),
  patch: (p: string, b: object) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send(b),
});
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% résumé\n').toString('base64')}`;
const apply = (b: object) => request(server).post(`/api/public/jobs/${postingId}/apply`).set('x-tenant-subdomain', SUB).send({ startedAt: Date.now() - 10_000, consent: true, age: 'ADULT', ...b });

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  resetLimits();
  const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hr', lastName: 'X', email: `hr@${SUB}.test` } });
  hr = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('job applications in the app', () => {
  it('a posting either takes applications in the app or links elsewhere', async () => {
    const base = { title: 'Lifeguard (summer)', titleFr: null, description: 'Guard the outdoor pool this summer. NLS required.', descriptionFr: null, facilityId: t.facility.id, employmentStatus: 'CASUAL', payMin: '19.50', payMax: '22.00', closesOn: '2099-05-01', published: true };
    expect((await as().post('/api/jobs', base)).status).toBe(400);
    const r = await as().post('/api/jobs', { ...base, applyInApp: true });
    expect(r.status).toBe(201);
    postingId = r.body.id;
    expect((await request(server).get(`/api/public/jobs/${postingId}`).set('x-tenant-subdomain', SUB)).body.applyInApp).toBe(true);
  });

  it('someone applies with a PDF résumé; HR is told; only a PDF is taken; once per posting', async () => {
    expect((await apply({ firstName: 'Riley', lastName: 'Chen', email: 'riley@example.ca', consent: false })).status).toBe(400);
    expect((await apply({ firstName: 'Riley', lastName: 'Chen', email: 'riley@example.ca', resume: { fileName: 'cv.png', data: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]).toString('base64')}` } })).status).toBe(415);
    const r = await apply({ firstName: 'Riley', lastName: 'Chen', email: 'Riley@example.ca', phone: '250-555-0110', certifications: 'NLS, SFA', resume: { fileName: 'Riley CV.pdf', data: PDF } });
    expect(r.status).toBe(201);
    expect((await apply({ firstName: 'Riley', lastName: 'Chen', email: 'riley@example.ca' })).body.code).toBe('ALREADY_APPLIED');
    expect(await owner.notification.count({ where: { type: 'application_received' } })).toBe(1);
    const stored = await owner.jobApplication.findFirstOrThrow({ where: { postingId } });
    expect(stored.notes).toBe('Applicant confirmed they are 16 or older.');
    expect(Buffer.from(stored.ciphertext!).toString('latin1')).not.toContain('%PDF');
  });

  it('age gate: an age is confirmed (no birth date), and under 16 needs a parent or guardian', async () => {
    const job = (await request(server).get(`/api/public/jobs/${postingId}`).set('x-tenant-subdomain', SUB)).body;
    expect(job.workAge).toMatchObject({ adultAge: 16, minAge: 14 });
    expect((await apply({ firstName: 'Kai', lastName: 'Ng', email: 'kai@example.ca', age: undefined })).status).toBe(400);
    expect((await apply({ firstName: 'Kai', lastName: 'Ng', email: 'kai@example.ca', age: 'YOUNG' })).body.code).toBe('GUARDIAN_CONSENT');
    expect((await apply({ firstName: 'Kai', lastName: 'Ng', email: 'kai@example.ca', age: 'YOUNG', guardianConsent: true })).body.code).toBe('GUARDIAN_CONSENT');
    expect(await owner.jobApplication.count({ where: { postingId, email: 'kai@example.ca' } })).toBe(0);
    expect((await apply({ firstName: 'Kai', lastName: 'Ng', email: 'kai@example.ca', age: 'YOUNG', guardianConsent: true, guardianName: 'Lin Ng' })).status).toBe(201);
    const a = await owner.jobApplication.findFirstOrThrow({ where: { postingId, email: 'kai@example.ca' } });
    expect(a.notes).toMatch(/^Applicant is 14–15: parent or guardian Lin Ng consented on \d{4}-\d{2}-\d{2}/);
    const log = await owner.auditLog.findFirst({ where: { tenantId: t.tenant.id, action: 'application.received', entityId: a.id } });
    expect(log?.after).toMatchObject({ age: 'YOUNG', guardianConsent: true });
    await owner.jobApplication.delete({ where: { id: a.id } });
  });

  it('HR reads it, moves it along, and hires: an account and an invitation', async () => {
    const list = (await as().get(`/api/jobs/${postingId}/applications`)).body;
    expect(list[0]).toMatchObject({ name: 'Riley Chen', status: 'NEW', resume: { name: 'Riley CV.pdf' } });
    const resume = await as().get(`/api/applications/${list[0].id}/resume`);
    expect(resume.status).toBe(200);
    expect(Buffer.from(resume.body).toString('latin1')).toContain('%PDF-1.4');
    expect((await as().patch(`/api/applications/${list[0].id}`, { status: 'INTERVIEW', notes: 'Strong swimmer' })).body.status).toBe('INTERVIEW');
    const h = await as().post(`/api/applications/${list[0].id}/hire`, { role: 'STAFF', employmentStatus: 'CASUAL', positionIds: [t.position.id], hireDate: '2026-05-01' });
    expect(h.status).toBe(201);
    const u = await owner.user.findUniqueOrThrow({ where: { id: h.body.userId }, include: { positions: true } });
    expect(u).toMatchObject({ email: 'riley@example.ca', roles: ['STAFF'] });
    expect(u.positions).toHaveLength(1);
    expect(await owner.emailOutbox.count({ where: { toEmail: 'riley@example.ca', template: 'invite' } })).toBe(1);
  });

  it('applications that didn’t end in a hire go after a year', async () => {
    await apply({ firstName: 'Sam', lastName: 'Doe', email: 'sam@example.ca' });
    await owner.jobApplication.updateMany({ where: { postingId }, data: { updatedAt: new Date('2024-01-01') } });
    await withTenant(t.tenant.id, (tx) => applyRetention(tx));
    const left = await owner.jobApplication.findMany({ where: { postingId } });
    expect(left.map((x) => x.status)).toEqual(['HIRED']);
    expect(left[0]!.ciphertext).toBeNull();
  });
});
