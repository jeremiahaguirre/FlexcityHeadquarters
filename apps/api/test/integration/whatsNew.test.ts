import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { announceDueNotes } from '../../src/services/platform/releaseNotes.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const sfx = randomBytes(3).toString('hex');
let cookie: string;
let plainCookie: string;
let a: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;
let hrA: string;

const dev = (c = () => cookie) => ({
  get: (p: string) => request(server).get(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', c()),
  post: (p: string, body: object = {}) => request(server).post(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', c()).send(body),
  put: (p: string, body: object) => request(server).put(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', c()).send(body),
});
async function signIn(email: string, permissions?: string[]) {
  await owner.platformAdmin.create({ data: { email, name: 'Dev', passwordHash: await hashPassword('correct horse battery'), ...(permissions ? { permissions } : {}) } });
  const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'correct horse battery' });
  return String(r.headers['set-cookie']).split(';')[0]!;
}
const as = async (t: typeof a, userId: string, roles: string[] = ['STAFF']) => {
  const token = await signAccessToken({ sub: userId, tid: t.tenant.id, roles: roles as never });
  return {
    get: (p: string) => request(server).get(p).set('x-tenant-subdomain', t.tenant.subdomain).auth(token, { type: 'bearer' }),
    post: (p: string, body: object) => request(server).post(p).set('x-tenant-subdomain', t.tenant.subdomain).auth(token, { type: 'bearer' }).send(body),
  };
};
const note = (over: object = {}) => ({ titleEn: 'Faster schedules', titleFr: 'Horaires plus rapides', bodyEn: 'The week view opens faster.\n- Swipe between weeks\n- Tap a shift to open it', bodyFr: 'La vue de la semaine s’ouvre plus vite.\n- Glissez d’une semaine à l’autre', publishAt: new Date(Date.now() - 60_000).toISOString(), ...over });

beforeAll(async () => {
  a = await seedTenant(`wna${sfx}`, 2);
  b = await seedTenant(`wnb${sfx}`, 1);
  // Staff who joined a while ago (new people aren't shown older notes).
  await owner.user.updateMany({ where: { tenantId: { in: [a.tenant.id, b.tenant.id] } }, data: { createdAt: new Date(Date.now() - 90 * 86_400_000) } });
  const hr = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'HR', email: `hr@wna${sfx}.test`, dateOfBirth: new Date('1985-01-01'), createdAt: new Date(Date.now() - 90 * 86_400_000) } });
  hrA = hr.id;
  cookie = await signIn(`notes-${sfx}@flexcity.dev`);
  plainCookie = await signIn(`plain-${sfx}@flexcity.dev`, ['trust.read']);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('What’s new notes', () => {
  it('only console admins with releases.manage reach them', async () => {
    expect((await dev(() => plainCookie).get('/notes')).status).toBe(403);
    expect((await dev(() => plainCookie).post('/notes', note())).status).toBe(403);
    expect((await dev().get('/notes')).status).toBe(200);
  });

  it('a draft is seen by nobody; once published, by the organization and roles it targets, once', async () => {
    const created = await dev().post('/notes', note({ tenantIds: [a.tenant.id], roles: ['STAFF'] }));
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    const id = created.body.id as string;
    const guard = await as(a, a.users[0]!.id);
    expect((await guard.get('/api/me/whats-new')).body.notes.map((n: { id: string }) => n.id)).not.toContain(id);

    const pub = await dev().post(`/notes/${id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');
    expect(pub.body.announcedAt).toBeTruthy();
    expect(await owner.platformAudit.count({ where: { action: 'note.publish', detail: { path: ['id'], equals: id } } })).toBe(1);

    const mine = (await guard.get('/api/me/whats-new')).body;
    const n = mine.notes.find((x: { id: string }) => x.id === id);
    expect(n.title).toEqual({ en: 'Faster schedules', fr: 'Horaires plus rapides' });
    expect(mine.unseen).toContain(id);
    // HR in the same organization: not in the audience (staff only). Another organization: never.
    expect((await (await as(a, hrA, ['HR_ADMIN'])).get('/api/me/whats-new')).body.notes.map((x: { id: string }) => x.id)).not.toContain(id);
    expect((await (await as(b, b.users[0]!.id)).get('/api/me/whats-new')).body.notes.map((x: { id: string }) => x.id)).not.toContain(id);

    // Dismissing = read, for this person only.
    expect((await guard.post('/api/me/whats-new/read', { ids: [id] })).body.marked).toBe(1);
    expect((await guard.post('/api/me/whats-new/read', { ids: [id] })).body.marked).toBe(0);
    const after = (await guard.get('/api/me/whats-new')).body;
    expect(after.unseen).not.toContain(id);
    expect(after.notes.find((x: { id: string }) => x.id === id).readAt).toBeTruthy();
    expect((await (await as(a, a.users[1]!.id)).get('/api/me/whats-new')).body.unseen).toContain(id);
    // A note someone may not see can't be marked read by them.
    expect((await (await as(b, b.users[0]!.id)).post('/api/me/whats-new/read', { ids: [id] })).body.marked).toBe(0);
  });

  it('inside an organization’s session Postgres shows only the notes for it or for everyone, and the app can’t write them', async () => {
    const forA = await owner.releaseNote.create({ data: { ...note(), tenantIds: [a.tenant.id], roles: [], ringIds: [], publishAt: new Date(), publishedAt: new Date(), createdById: a.users[0]!.id } });
    const forAll = await owner.releaseNote.create({ data: { ...note(), tenantIds: [], roles: [], ringIds: [], publishAt: new Date(), publishedAt: new Date(), createdById: a.users[0]!.id } });
    const seen = await withTenant(b.tenant.id, (tx) => tx.releaseNote.findMany({ where: { id: { in: [forA.id, forAll.id] } } }), { prisma: appDb });
    expect(seen.map((n) => n.id)).toEqual([forAll.id]);
    await expect(withTenant(a.tenant.id, (tx) => tx.releaseNote.create({ data: { ...note(), tenantIds: [], roles: [], ringIds: [], publishAt: new Date(), createdById: a.users[0]!.id } }), { prisma: appDb })).rejects.toThrow();
    const changed = await withTenant(a.tenant.id, (tx) => tx.releaseNote.updateMany({ where: { id: forA.id }, data: { titleEn: 'Hacked' } }), { prisma: appDb });
    expect(changed.count).toBe(0);
    // Read marks are each organization's own.
    await withTenant(a.tenant.id, (tx) => tx.releaseNoteRead.create({ data: { tenantId: a.tenant.id, userId: a.users[0]!.id, noteId: forAll.id } }), { prisma: appDb });
    expect(await withTenant(b.tenant.id, (tx) => tx.releaseNoteRead.count({ where: { noteId: forAll.id } }), { prisma: appDb })).toBe(0);
  });

  it('a note for later shows from its date; the worker sends its live signal then', async () => {
    const later = await dev().post('/notes', note({ tenantIds: [b.tenant.id], publishAt: new Date(Date.now() + 3_600_000).toISOString() }));
    const pub = await dev().post(`/notes/${later.body.id}/publish`);
    expect(pub.body.status).toBe('scheduled');
    expect(pub.body.announcedAt).toBeNull();
    const guard = await as(b, b.users[0]!.id);
    expect((await guard.get('/api/me/whats-new')).body.notes.map((x: { id: string }) => x.id)).not.toContain(later.body.id);
    await owner.releaseNote.update({ where: { id: later.body.id }, data: { publishAt: new Date(Date.now() - 1000) } });
    expect(await announceDueNotes(appDb)).toBeGreaterThanOrEqual(1);
    expect((await owner.releaseNote.findUniqueOrThrow({ where: { id: later.body.id } })).announcedAt).toBeTruthy();
    expect((await guard.get('/api/me/whats-new')).body.unseen).toContain(later.body.id);
  });

  it('withdrawn notes disappear; people who joined after a note never get it as new', async () => {
    const n = await dev().post('/notes', note({ tenantIds: [a.tenant.id] }));
    await dev().post(`/notes/${n.body.id}/publish`);
    const fresh = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['STAFF'], employmentStatus: 'CASUAL', firstName: 'New', lastName: 'Hire', email: `new@wna${sfx}.test`, dateOfBirth: new Date('2001-01-01') } });
    const newbie = (await (await as(a, fresh.id)).get('/api/me/whats-new')).body;
    expect(newbie.notes.map((x: { id: string }) => x.id)).toContain(n.body.id);
    expect(newbie.unseen).not.toContain(n.body.id);
    expect((await dev().post(`/notes/${n.body.id}/withdraw`)).body.status).toBe('withdrawn');
    expect((await (await as(a, a.users[0]!.id)).get('/api/me/whats-new')).body.notes.map((x: { id: string }) => x.id)).not.toContain(n.body.id);
    expect((await dev().put(`/notes/${n.body.id}`, note())).status).toBe(409);
  });

  it('text stays text: no control characters, no hidden direction marks, limits on length', async () => {
    const r = await dev().post('/notes', note({ titleEn: 'Hi‮ there', bodyEn: '<script>alert(1)</script>\r\n- one\u0007\n\n\n\nend' }));
    expect(r.status).toBe(201);
    expect(r.body.titleEn).toBe('Hi there');
    // Stored as typed (it is shown as text, never as HTML), line ends folded.
    expect(r.body.bodyEn).toBe('<script>alert(1)</script>\n- one\n\nend');
    expect((await dev().post('/notes', note({ titleEn: 'x'.repeat(121) }))).status).toBe(400);
    expect((await dev().post('/notes', note({ titleFr: 'two\nlines' }))).status).toBe(400);
    expect((await dev().post('/notes', note({ roles: ['KING'] }))).status).toBe(400);
  });
});
