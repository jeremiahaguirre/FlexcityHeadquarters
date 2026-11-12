import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { forgetDepartments } from '../../src/services/people/departments.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'msgs';
const OTHER = 'msgs-other';
let t: Awaited<ReturnType<typeof seedTenant>>;
let o: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
const id: Record<string, string> = {};
const subOf: Record<string, string> = {};
const as = (who: string) => {
  const s = subOf[who] ?? SUB;
  return {
    get: (p: string) => request(server).get(p).set('x-tenant-subdomain', s).auth(tok[who]!, { type: 'bearer' }),
    post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', s).auth(tok[who]!, { type: 'bearer' }).send(b),
    put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', s).auth(tok[who]!, { type: 'bearer' }).send(b),
    patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', s).auth(tok[who]!, { type: 'bearer' }).send(b),
    del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', s).auth(tok[who]!, { type: 'bearer' }),
  };
};
const yearsAgo = (y: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - y, d.getUTCMonth(), d.getUTCDate()));
};
const settings = { staffDirect: true, minorDirect: true, pushPreview: false, shiftArchiveHours: 12 };
const setSettings = (s: Partial<typeof settings>) => as('hr').put('/api/messages-admin/settings', { ...settings, ...s });
const direct = async (from: string, to: string) => as(from).post('/api/messages/direct', { userId: id[to] });
const send = (who: string, conv: string, text: string, extra: object = {}) => as(who).post(`/api/messages/conversations/${conv}/messages`, { text, ...extra });

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  o = await seedTenant(OTHER, 0);
  const now = Math.floor(Date.now() / 1000);
  const aquatics = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } });
  const parks = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Parks' } });
  id.aquatics = aquatics.id;
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: aquatics.id } });
  const parksPos = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Parks worker', departmentId: parks.id } });
  const mk = async (name: string, roles: string[], dob: Date | null, positionId: string | null, tenant = t) => {
    const u = await owner.user.create({ data: { tenantId: tenant.tenant.id, roles: roles as never, employmentStatus: 'PART_TIME', firstName: name, lastName: 'Test', email: `${name}@${SUB}.test`, dateOfBirth: dob } });
    if (positionId) await owner.userPosition.create({ data: { tenantId: tenant.tenant.id, userId: u.id, positionId } });
    id[name] = u.id;
    tok[name] = await signAccessToken({ sub: u.id, tid: tenant.tenant.id, roles: roles as never, aat: now });
  };
  await mk('g0', ['STAFF'], yearsAgo(30), t.position.id);
  await mk('g1', ['STAFF'], yearsAgo(25), t.position.id);
  await mk('m1', ['STAFF'], yearsAgo(16), t.position.id);
  await mk('m2', ['STAFF'], yearsAgo(15), t.position.id);
  await mk('u1', ['STAFF'], null, t.position.id);
  await mk('p1', ['EMPLOYEE'], yearsAgo(40), parksPos.id);
  await mk('sup', ['AQUATIC_SUPERVISOR'], yearsAgo(45), null);
  await mk('hr', ['HR_ADMIN'], yearsAgo(50), null);
  await mk('steward', ['UNION_STEWARD'], yearsAgo(50), null);
  await owner.departmentManager.create({ data: { tenantId: t.tenant.id, departmentId: aquatics.id, userId: id.sup! } });
  forgetDepartments(t.tenant.id);
  await mk('x', ['STAFF'], yearsAgo(30), o.position.id, o);
  subOf.x = OTHER;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('who can message whom', () => {
  it('colleagues in a department talk one to one; the text is sealed at rest', async () => {
    const r = await direct('g0', 'g1');
    expect(r.status).toBe(201);
    id.c01 = r.body.id;
    expect((await direct('g1', 'g0')).body.id).toBe(id.c01); // one conversation per pair
    expect((await send('g0', id.c01!, 'Can you cover the 6 a.m. lane swim?')).status).toBe(201);
    const read = (await as('g1').get(`/api/messages/conversations/${id.c01}`)).body;
    expect(read.messages[0]).toMatchObject({ text: 'Can you cover the 6 a.m. lane swim?', author: 'g0 Test', mine: false });
    const raw = await owner.message.findFirstOrThrow({ where: { conversationId: id.c01 } });
    expect(Buffer.from(raw.ciphertext!).toString('utf8')).not.toContain('lane swim');
  });

  it('staff can’t message another department’s staff, but can always reach HR; never another organization', async () => {
    expect((await direct('g0', 'p1')).status).toBe(403);
    expect((await direct('p1', 'hr')).status).toBe(201);
    expect((await direct('g0', 'x')).status).toBe(404);
    expect((await as('x').get(`/api/messages/conversations/${id.c01}`)).status).toBe(404);
  });

  it('with staff-to-staff direct messages off, staff still reach their supervisor', async () => {
    await setSettings({ staffDirect: false });
    expect((await direct('g1', 'm2')).status).toBe(403);
    expect((await direct('g1', 'sup')).status).toBe(201);
    // An existing staff conversation stops taking messages, but keeps its history.
    expect((await send('g0', id.c01!, 'still there?')).status).toBe(409);
    await setSettings({});
  });

  it('only people with messaging can use it, and switching the feature off closes it', async () => {
    expect((await as('steward').get('/api/messages/conversations')).status).toBe(403);
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { messaging: false } } });
    forgetFeatures(t.tenant.id);
    expect((await as('g0').get('/api/messages/conversations')).status).toBe(404);
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: {} } });
    forgetFeatures(t.tenant.id);
  });
});

describe('rule of two (minors)', () => {
  it('a minor and an adult never get a one-to-one conversation, whoever starts it, whatever the adult’s role', async () => {
    for (const [a, b] of [['g0', 'm1'], ['m1', 'g0'], ['sup', 'm1'], ['m1', 'sup'], ['hr', 'm1'], ['m1', 'hr']] as const) {
      const r = await direct(a, b);
      expect(r.status, `${a}→${b}`).toBe(403);
      expect(r.body.code).toBe('MINOR_RULE');
      expect(`${r.body.code} ${r.body.message} ${JSON.stringify(r.body.details ?? null)}`).not.toMatch(/\d|birth|\bage\b/i);
    }
    const logged = await owner.auditLog.findMany({ where: { tenantId: t.tenant.id, action: 'messages.blocked' } });
    expect(logged.length).toBeGreaterThanOrEqual(6);
    expect(logged.every((l) => JSON.stringify(l.after) === JSON.stringify({ rule: 'minor rule', what: 'direct' }))).toBe(true);
  });

  it('someone with no birth date on file is treated as possibly a minor', async () => {
    expect((await direct('g0', 'u1')).body.code).toBe('MINOR_RULE');
    expect((await direct('u1', 'm1')).body.code).toBe('MINOR_RULE');
  });

  it('two minors may talk unless the organization turns it off; then sending stops too', async () => {
    const r = await direct('m1', 'm2');
    expect(r.status).toBe(201);
    id.mm = r.body.id;
    expect((await send('m1', id.mm!, 'hi')).status).toBe(201);
    await setSettings({ minorDirect: false });
    // Refused as read-only, without saying why (only HR is told it's safeguarding); still recorded.
    const blocked = await send('m2', id.mm!, 'hello');
    expect(blocked.body).toMatchObject({ code: 'READ_ONLY', details: { reason: 'readOnly' } });
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'messages.blocked', entityId: id.mm } })).toBe(1);
    expect((await as('m2').get(`/api/messages/conversations/${id.mm}`)).body.readOnly).toBe('readOnly');
    await setSettings({});
  });

  it('the directory leaves out who can’t get one-to-one messages, with no flag, and no ages', async () => {
    const d = (await as('g0').get('/api/messages/people')).body;
    expect(d.people.find((p: { id: string }) => p.id === id.m1)).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/dateOfBirth|"age"|safeguarding/);
  });

  it('turning of age lifts it; a birth-date correction that makes someone a minor makes the conversation read-only, kept', async () => {
    await owner.user.update({ where: { id: id.m1! }, data: { dateOfBirth: yearsAgo(20) } });
    const r = await direct('g0', 'm1');
    expect(r.status).toBe(201);
    id.gm = r.body.id;
    expect((await send('g0', id.gm!, 'Welcome to the team!')).status).toBe(201);
    await owner.user.update({ where: { id: id.m1! }, data: { dateOfBirth: yearsAgo(16) } });
    expect((await send('g0', id.gm!, 'one more')).body.code).toBe('READ_ONLY');
    const c = (await as('m1').get(`/api/messages/conversations/${id.gm}`)).body;
    expect(c.readOnly).toBe('readOnly');
    expect(c.messages).toHaveLength(1);
  });

  it('a group with a minor needs two adults; when one leaves it turns read-only', async () => {
    const bad = await as('sup').post('/api/messages/groups', { title: 'Junior guards', memberIds: [id.m1, id.m2] });
    expect(bad.body.code).toBe('MINOR_RULE');
    const ok = await as('sup').post('/api/messages/groups', { title: 'Saturday crew', memberIds: [id.m1, id.g0] });
    expect(ok.status).toBe(201);
    id.grp = ok.body.id;
    expect((await send('m1', id.grp!, 'Where do we meet?')).status).toBe(201);
    // Adding a second minor keeps two adults: fine.
    expect((await as('sup').post(`/api/messages/conversations/${id.grp}/members`, { userIds: [id.m2] })).status).toBe(200);
    expect((await as('g0').del(`/api/messages/conversations/${id.grp}/members/me`)).status).toBe(200);
    expect((await send('sup', id.grp!, 'See you at 9')).body.code).toBe('READ_ONLY');
    expect((await as('m1').get(`/api/messages/conversations/${id.grp}`)).body.readOnly).toBe('readOnly');
  });

  it('staff can’t make groups; a lead can only add people in their departments', async () => {
    expect((await as('g0').post('/api/messages/groups', { title: 'Mine', memberIds: [id.g1, id.sup] })).status).toBe(403);
    expect((await as('sup').post('/api/messages/groups', { title: 'Mixed', memberIds: [id.g0, id.p1] })).status).toBe(403);
  });
});

describe('messages', () => {
  it('unread counts, read receipts and muting', async () => {
    const c = (await direct('g1', 'sup')).body.id;
    const unread = async () => (await as('sup').get('/api/messages/unread')).body.total as number;
    const before = await unread();
    const forC = { userId: id.sup, type: 'message_new', params: { path: ['conversationId'], equals: c } };
    await send('g1', c, 'Running 5 minutes late');
    expect(await unread()).toBe(before + 1);
    const n = await owner.notification.findFirstOrThrow({ where: forC });
    expect(n.params).toEqual({ conversationId: c, messageId: expect.any(String), from: 'g1 Test' }); // never text
    await send('g1', c, 'Sorry!');
    expect(await owner.notification.count({ where: forC })).toBe(1); // one per conversation until read
    await as('sup').post(`/api/messages/conversations/${c}/read`);
    expect(await unread()).toBe(before);
    const seen = (await as('g1').get(`/api/messages/conversations/${c}`)).body.members.find((m: { id: string }) => m.id === id.sup);
    expect(seen.lastReadAt).toBeTruthy();
    await as('sup').post(`/api/messages/conversations/${c}/mute`, { muted: true });
    await send('g1', c, 'One more thing');
    expect(await unread()).toBe(before);
    expect(await owner.notification.count({ where: { ...forC, readAt: null } })).toBe(0);
  });

  it('a short preview in the notification only when the organization turns it on', async () => {
    await setSettings({ pushPreview: true });
    const c = (await direct('hr', 'g1')).body.id;
    await send('hr', c, 'Your benefits enrolment form is ready to sign in the app today.');
    const n = await owner.notification.findFirstOrThrow({ where: { userId: id.g1, type: 'message_new', params: { path: ['conversationId'], equals: c } } });
    expect(JSON.stringify(n.params)).not.toContain('benefits');
    const { messagePreviews } = await import('../../src/services/messaging/conversations.js');
    const inT = <T>(fn: (tx: never) => Promise<T>) => owner.$transaction(async (tx) => { await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${t.tenant.id}', true)`); return fn(tx as never); });
    const preview = (await inT((tx) => messagePreviews(tx, [n]))).get(n.id)!;
    expect(preview.startsWith('Your benefits')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(60);
    await setSettings({});
  });

  it('edit within 15 minutes, remove shows "removed"; too long and too late are refused', async () => {
    const r = await send('g0', id.c01!, 'Pool opens at 6');
    // c01 was blocked while staff direct was off; it's open again now.
    expect(r.status).toBe(201);
    expect((await as('g1').patch(`/api/messages/${r.body.id}`, { text: 'hijack' })).status).toBe(404);
    expect((await as('g0').patch(`/api/messages/${r.body.id}`, { text: 'Pool opens at 6:30' })).status).toBe(200);
    expect((await send('g0', id.c01!, 'x'.repeat(2001))).status).toBe(400);
    const old = await send('g0', id.c01!, 'Old note');
    await owner.message.update({ where: { id: old.body.id }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await as('g0').patch(`/api/messages/${old.body.id}`, { text: 'changed' })).body.code).toBe('EDIT_WINDOW');
    expect((await as('g0').del(`/api/messages/${old.body.id}`)).status).toBe(200);
    const msgs = (await as('g1').get(`/api/messages/conversations/${id.c01}`)).body.messages;
    expect(msgs.find((m: { id: string }) => m.id === old.body.id)).toMatchObject({ removed: true, text: null });
    expect(msgs.find((m: { id: string }) => m.id === r.body.id)).toMatchObject({ text: 'Pool opens at 6:30' });
    id.edited = r.body.id;
    id.removed = old.body.id;
  });

  it('files go through the checked upload path: images and PDFs only, sealed, sent as downloads', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
    const r = await send('g0', id.c01!, 'Schedule photo', { attachment: { fileName: 'sched.html', data: `data:text/html;base64,${png.toString('base64')}` } });
    expect(r.status).toBe(201);
    const f = await as('g1').get(`/api/messages/${r.body.id}/file`).buffer(true);
    expect(f.status).toBe(200);
    expect(f.headers['content-type']).toBe('image/png');
    expect(f.headers['content-disposition']).toContain('sched.png');
    expect(Buffer.compare(f.body as Buffer, png)).toBe(0);
    expect((await as('p1').get(`/api/messages/${r.body.id}/file`)).status).toBe(404);
    const html = await send('g0', id.c01!, '', { attachment: { fileName: 'x.html', data: `data:text/html;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}` } });
    expect(html.status).toBe(415);
  });

  it('shift conversations: everyone on the shift; others can’t open it', async () => {
    const start = new Date(Date.now() + 3_600_000);
    const end = new Date(start.getTime() + 4 * 3_600_000);
    const s0 = await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: id.g0, startsAt: start, endsAt: end, status: 'PUBLISHED' } });
    await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: id.g1, startsAt: start, endsAt: end, status: 'PUBLISHED' } });
    expect((await as('p1').post('/api/messages/shift', { shiftId: s0.id })).status).toBe(403);
    const r = await as('g1').post('/api/messages/shift', { shiftId: s0.id });
    expect(r.status).toBe(201);
    const c = (await as('g0').get(`/api/messages/conversations/${r.body.id}`)).body;
    expect(c.kind).toBe('SHIFT');
    expect(c.members.map((m: { id: string }) => m.id).sort()).toEqual([id.g0, id.g1].sort());
    expect(new Date(c.closesAt).getTime()).toBe(end.getTime() + 12 * 3_600_000);
  });
});

describe('reports and investigations', () => {
  it('a member reports a message; HR is told, but can read the conversation only after opening it with a reason', async () => {
    const r = await as('g1').post(`/api/messages/${id.edited}/report`, { reason: 'Made a comment about my appearance earlier.' });
    expect(r.status).toBe(201);
    expect(await owner.notification.count({ where: { userId: id.hr, type: 'message_reported' } })).toBe(1);
    const reports = (await as('hr').get('/api/messages-admin/reports')).body;
    expect(reports[0]).toMatchObject({ status: 'OPEN', reporter: 'g1 Test', author: 'g0 Test', open: false });
    expect((await as('hr').get(`/api/messages/conversations/${id.c01}`)).status).toBe(404);
    expect((await as('sup').post(`/api/messages-admin/conversations/${id.c01}/investigate`, { reason: 'Looking into a report' })).status).toBe(403);
    expect((await as('hr').post(`/api/messages-admin/conversations/${id.c01}/investigate`, { reason: 'short' })).status).toBe(400);
    expect((await as('hr').post(`/api/messages-admin/conversations/${id.c01}/investigate`, { reason: 'Harassment report from g1, policy section 4', reportId: reports[0].id })).status).toBe(201);
    const c = (await as('hr').get(`/api/messages/conversations/${id.c01}`)).body;
    expect(c.investigation.reason).toContain('Harassment report');
    expect(c.messages.find((m: { id: string }) => m.id === id.removed)).toMatchObject({ removed: true, text: 'Old note' });
    expect(c.messages.find((m: { id: string }) => m.id === id.edited)).toMatchObject({ text: 'Pool opens at 6:30', original: 'Pool opens at 6' });
    // HR can read, not write, through an investigation.
    expect((await send('hr', id.c01!, 'hello')).status).toBe(404);
    const log = await owner.auditLog.findMany({ where: { tenantId: t.tenant.id, action: { in: ['messages.investigation_open', 'messages.investigation_read'] } } });
    expect(log.map((l) => l.action).sort()).toEqual(['messages.investigation_open', 'messages.investigation_read']);
    expect((await as('hr').post(`/api/messages-admin/reports/${reports[0].id}/close`, { note: 'Spoke with both; resolved.' })).status).toBe(200);
  });

  it('another organization’s HR sees nothing', async () => {
    expect((await as('x').get('/api/messages-admin/reports')).status).toBe(403);
    expect((await as('x').get('/api/messages/conversations')).body).toEqual([]);
  });
});

describe('privacy', () => {
  const inTenant = <T>(fn: (tx: never) => Promise<T>) =>
    owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${t.tenant.id}', true)`);
      return fn(tx as never);
    });

  it('the person’s records export has the messages they wrote, opened', async () => {
    const { exportPersonRecords } = await import('../../src/services/privacy/recordsExport.js');
    const out = await inTenant((tx) => exportPersonRecords(tx, id.g0!));
    expect(out.messages.messagesWritten.map((m: { text: string | null }) => m.text)).toContain('Pool opens at 6:30');
    expect(out.excluded.join(' ')).toContain('anonymous surveys');
  });

  it('retention removes quiet conversations, but not one with an open report', async () => {
    const { applyMessageRetention } = await import('../../src/services/messaging/records.js');
    const old = new Date(Date.now() - 800 * 86_400_000);
    await owner.conversation.updateMany({ where: { tenantId: t.tenant.id }, data: { lastMessageAt: old, createdAt: old } });
    await owner.messageReport.create({ data: { tenantId: t.tenant.id, messageId: id.edited!, conversationId: id.c01!, reporterId: id.g1!, reason: 'Second report, still open' } });
    const removed = await inTenant((tx) => applyMessageRetention(tx, 730));
    expect(removed).toBeGreaterThan(0);
    expect(await owner.conversation.count({ where: { tenantId: t.tenant.id } })).toBe(1);
    expect(await owner.conversation.findUnique({ where: { id: id.c01 } })).not.toBeNull();
  });

  it('anonymizing someone wipes what they wrote (kept under an open report) and takes them out', async () => {
    const { anonymizeUser } = await import('../../src/services/privacy/erasure.js');
    await inTenant((tx) => anonymizeUser(tx, t.tenant.id, id.hr!, id.g0!));
    const left = await owner.message.findMany({ where: { authorId: id.g0 } });
    expect(left.filter((m) => m.ciphertext).map((m) => m.id)).toEqual([id.edited]);
    expect(await owner.conversationMember.count({ where: { userId: id.g0 } })).toBe(0);
  });
});
