import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'pi';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
const posting = {
  title: 'Seasonal Lifeguard',
  titleFr: 'Sauveteur saisonnier',
  description: 'Guard our outdoor pools from May to September. NLS and Standard First Aid required.',
  descriptionFr: null,
  facilityId: null as string | null,
  employmentStatus: 'CASUAL',
  payMin: '21.50',
  payMax: '24.00',
  closesOn: '2027-03-31',
  applyUrl: 'https://careers.example.ca/lifeguard',
  published: true,
};

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  posting.facilityId = t.facility.id;
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@pi.test' } });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('job board', () => {
  it('validates postings', async () => {
    const r = await request(server).post('/api/jobs').set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send({ ...posting, applyUrl: 'javascript:alert(1)' });
    expect(r.status).toBe(400);
    const pay = await request(server).post('/api/jobs').set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send({ ...posting, payMin: '30', payMax: '20' });
    expect(pay.status).toBe(400);
  });

  it('publishes to the public board without sign-in; drafts and closed postings stay hidden', async () => {
    await request(server).post('/api/jobs').set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send(posting);
    await request(server).post('/api/jobs').set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send({ ...posting, title: 'Draft posting', published: false });
    await request(server).post('/api/jobs').set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send({ ...posting, title: 'Closed posting', closesOn: '2026-01-01' });
    const pub = await request(server).get('/api/public/jobs').set('x-tenant-subdomain', SUB);
    expect(pub.status).toBe(200);
    expect(pub.body.map((j: { title: string }) => j.title)).toEqual(['Seasonal Lifeguard']);
    expect(pub.body[0]).toMatchObject({ facility: 'Rec Centre', payMin: '21.5', titleFr: 'Sauveteur saisonnier' });
    expect(pub.body[0].published).toBeUndefined();
    // Where and when it was posted, for search engines.
    expect(pub.body[0]).toMatchObject({ province: 'BC', postedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('serves each open posting on its own, and nothing that isn’t public', async () => {
    const all = (await request(server).get('/api/jobs').set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' })).body as Array<{ id: string; title: string }>;
    const open = all.find((j) => j.title === 'Seasonal Lifeguard')!;
    const one = await request(server).get(`/api/public/jobs/${open.id}`).set('x-tenant-subdomain', SUB);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: open.id, title: 'Seasonal Lifeguard', facility: 'Rec Centre' });
    expect(one.body.published).toBeUndefined();
    for (const title of ['Draft posting', 'Closed posting']) {
      expect((await request(server).get(`/api/public/jobs/${all.find((j) => j.title === title)!.id}`).set('x-tenant-subdomain', SUB)).status).toBe(404);
    }
    expect((await request(server).get('/api/public/jobs/not-a-uuid').set('x-tenant-subdomain', SUB)).status).toBe(404);
  });

  it('keeps management to HR and supervisors', async () => {
    const staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
    expect((await request(server).get('/api/jobs').set('x-tenant-subdomain', SUB).auth(staff, { type: 'bearer' })).status).toBe(403);
  });
});
