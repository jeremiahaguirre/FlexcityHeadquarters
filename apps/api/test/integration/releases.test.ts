import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { applyChange, releaseTick } from '../../src/services/platform/releases.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const sfx = randomBytes(3).toString('hex');
let cookie: string;
let a: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;
const hr: Record<string, string> = {};
let pilot: string;
let early: string;

const dev = {
  get: (p: string) => request(server).get(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie),
  post: (p: string, body: object = {}) => request(server).post(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(body),
  put: (p: string, body: object) => request(server).put(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(body),
  patch: (p: string, body: object) => request(server).patch(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(body),
};
const features = async (id: string) => (await owner.tenant.findUniqueOrThrow({ where: { id } })).features as Record<string, boolean>;
const asHr = async (t: typeof a) => {
  const token = await signAccessToken({ sub: hr[t.tenant.id]!, tid: t.tenant.id, roles: ['HR_ADMIN'] });
  return (p: string) => request(server).get(p).set('x-tenant-subdomain', t.tenant.subdomain).auth(token, { type: 'bearer' });
};
const release = (over: object = {}) => ({ name: `Bidding ${randomBytes(2).toString('hex')}`, summaryEn: 'Shift bidding by seniority, and the Union Hub.', summaryFr: 'Les choix de quarts par ancienneté et le carrefour syndical.', features: { shiftBidding: true, union: true }, ...over });
const day = 86_400_000;

beforeAll(async () => {
  a = await seedTenant(`rla${sfx}`, 1);
  b = await seedTenant(`rlb${sfx}`, 1);
  for (const t of [a, b]) hr[t.tenant.id] = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'HR', email: `hr@${t.tenant.subdomain}.test`, dateOfBirth: new Date('1985-01-01') } })).id;
  const email = `rel-${sfx}@flexcity.dev`;
  await owner.platformAdmin.create({ data: { email, name: 'Dev', passwordHash: await hashPassword('correct horse battery') } });
  const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'correct horse battery' });
  cookie = String(r.headers['set-cookie']).split(';')[0]!;
  // This suite owns the rings in its database.
  await owner.releaseRing.deleteMany({});
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('release rings', () => {
  it('rings in order; an organization is in one ring at a time', async () => {
    pilot = (await dev.post('/rings', { name: 'Pilot' })).body.id;
    early = (await dev.post('/rings', { name: 'Early' })).body.id;
    expect((await dev.post('/rings', { name: 'Pilot' })).status).toBe(409);
    await dev.put(`/rings/${pilot}/members`, { tenantIds: [a.tenant.id, b.tenant.id] });
    const rings = (await dev.put(`/rings/${early}/members`, { tenantIds: [b.tenant.id] })).body as Array<{ id: string; tenantIds: string[] }>;
    expect(rings.find((r) => r.id === pilot)!.tenantIds).toEqual([a.tenant.id]);
    expect(rings.find((r) => r.id === early)!.tenantIds).toEqual([b.tenant.id]);
    // FH's own records: nothing of them inside an organization's session.
    expect(await withTenant(a.tenant.id, (tx) => tx.releaseRing.count(), { prisma: appDb })).toBe(0);
    expect(await withTenant(a.tenant.id, (tx) => tx.releaseRingMember.count(), { prisma: appDb })).toBe(0);
  });

  it('the preview shows where an organization’s own choice wins, and rings go in order', async () => {
    // The Dev console turned the Union Hub off for B on purpose.
    await dev.patch(`/tenants/${b.tenant.id}`, { features: { union: false } });
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: b.tenant.id } })).featureChoices).toEqual(['union']);
    const rel = (await dev.post('/releases', release())).body;
    const pv = (await dev.get(`/releases/${rel.id}/preview/${early}`)).body;
    expect(pv).toEqual([{ tenantId: b.tenant.id, name: b.tenant.name, changes: [{ key: 'shiftBidding', from: false, to: true }], conflicts: [{ key: 'union', value: false }], unchanged: [] }]);
    const order = await dev.post(`/releases/${rel.id}/stages`, { ringId: early, scheduledAt: new Date(Date.now() + day).toISOString() });
    expect(order.status).toBe(409);
    expect(order.body.code).toBe('RING_ORDER');
  });

  it('HR admins hear in advance (once, in-app and by email); due stages apply ring by ring; the explicit choice stays', async () => {
    const rel = (await dev.post('/releases', release())).body;
    const inThree = new Date(Date.now() + 3 * day);
    expect((await dev.post(`/releases/${rel.id}/stages`, { ringId: pilot, scheduledAt: inThree.toISOString(), noticeDays: 7 })).status).toBe(201);
    // Not before the earlier ring's date.
    expect((await dev.post(`/releases/${rel.id}/stages`, { ringId: early, scheduledAt: new Date(Date.now() + day).toISOString() })).body.code).toBe('RING_ORDER');
    const earlyStage = (await dev.post(`/releases/${rel.id}/stages`, { ringId: early, scheduledAt: new Date(Date.now() + 20 * day).toISOString(), noticeDays: 2 })).body;

    await releaseTick(appDb);
    await releaseTick(appDb);
    const notes = await owner.notification.findMany({ where: { userId: hr[a.tenant.id]!, type: 'release_scheduled' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.params).toMatchObject({ titleEn: rel.name, summaryFr: release().summaryFr });
    expect(await owner.emailOutbox.count({ where: { tenantId: a.tenant.id, template: 'release_scheduled' } })).toBe(1);
    // Early is 20 days out with 2 days' notice: not yet.
    expect(await owner.notification.count({ where: { userId: hr[b.tenant.id]!, type: 'release_scheduled' } })).toBe(0);
    expect((await features(a.tenant.id)).shiftBidding).toBeUndefined();

    // A's HR admin sees what's coming; B's doesn't see A's.
    const coming = (await (await asHr(a))('/api/updates/changes')).body;
    expect(coming).toHaveLength(1);
    expect(coming[0]).toMatchObject({ status: 'PLANNED', features: { shiftBidding: true, union: true }, keptOwnChoice: [] });
    expect((await (await asHr(b))('/api/updates/changes')).body[0].keptOwnChoice).toEqual(['union']);
    // Staff can't.
    const staff = await signAccessToken({ sub: a.users[0]!.id, tid: a.tenant.id, roles: ['STAFF'] });
    expect((await request(server).get('/api/updates/changes').set('x-tenant-subdomain', a.tenant.subdomain).auth(staff, { type: 'bearer' })).status).toBe(403);

    // Time comes for Pilot, then Early.
    await owner.releaseChange.updateMany({ where: { releaseId: rel.id, tenantId: a.tenant.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await owner.releaseStage.updateMany({ where: { releaseId: rel.id, ringId: pilot }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect((await releaseTick(appDb)).applied).toBe(1);
    expect(await features(a.tenant.id)).toMatchObject({ shiftBidding: true, union: true });
    await owner.releaseStage.update({ where: { id: earlyStage.id }, data: { scheduledAt: new Date(Date.now() - 500) } });
    expect((await releaseTick(appDb)).applied).toBe(1);
    expect(await features(b.tenant.id)).toMatchObject({ shiftBidding: true, union: false });
    const bChange = await owner.releaseChange.findFirstOrThrow({ where: { releaseId: rel.id, tenantId: b.tenant.id } });
    expect(bChange.skipped).toEqual(['union']);
    // What B had stored before (the console saved its full set when it chose the Union Hub).
    expect(bChange.previous).toEqual({ shiftBidding: false });
    // Applying again does nothing.
    expect(await applyChange(appDb, bChange.id, b.tenant.id, rel.createdById)).toBe(false);
    expect(await owner.auditLog.count({ where: { tenantId: b.tenant.id, action: 'platform.release.apply' } })).toBe(1);

    // Undo Early: B is back on its default; a switch changed since is left alone (and reported).
    const back = (await dev.post(`/stages/${earlyStage.id}/rollback`)).body;
    expect(back.restored).toBe(1);
    expect((await features(b.tenant.id)).shiftBidding).toBe(false);
    await dev.patch(`/tenants/${a.tenant.id}`, { features: { union: false } });
    const all = (await dev.post(`/releases/${rel.id}/rollback`)).body;
    expect(all.kept).toEqual([{ tenantId: a.tenant.id, keys: ['union'] }]);
    expect(await features(a.tenant.id)).toMatchObject({ union: false });
    expect((await features(a.tenant.id)).shiftBidding).not.toBe(true);
    expect(await owner.platformAudit.count({ where: { action: 'release.rollback', tenantId: null } })).toBe(2);
    expect((await dev.post(`/releases/${rel.id}/rollback`)).status).toBe(409);
  });

  it('scheduled for now applies at once; an organization reads only its own part', async () => {
    const rel = (await dev.post('/releases', release({ features: { expenses: false } }))).body;
    expect((await dev.post(`/releases/${rel.id}/stages`, { ringId: pilot, scheduledAt: new Date().toISOString(), noticeDays: 0 })).body.status).toBe('APPLIED');
    expect((await features(a.tenant.id)).expenses).toBe(false);
    const theirs = await withTenant(b.tenant.id, (tx) => tx.releaseChange.count({ where: { releaseId: rel.id } }), { prisma: appDb });
    expect(theirs).toBe(0);
    // A release whose rings are live can't be edited until undone.
    expect((await dev.put(`/releases/${rel.id}`, release())).status).toBe(409);
  });
});
