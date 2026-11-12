/**
 * Regression tests from the security review of team messaging (H1, M1, M2, L1–L5, L7).
 * Each one failed before its fix.
 */
import { randomBytes } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetTenantLookup } from '../../src/routes/context.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { forgetDepartments } from '../../src/services/people/departments.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'msgsec';
const tok: Record<string, string> = {};
const id: Record<string, string> = {};
const as = (who: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
});
const yearsAgo = (y: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - y, d.getUTCMonth(), d.getUTCDate()));
};
const binary = (r: request.Request) =>
  r.buffer(true).parse((res, cb) => {
    const parts: Buffer[] = [];
    res.on('data', (c: Buffer) => parts.push(c));
    res.on('end', () => cb(null, Buffer.concat(parts)));
  });
const send = (who: string, conv: string, text: string, extra: object = {}) => as(who).post(`/api/messages/conversations/${conv}/messages`, { text, ...extra });
const settings = { staffDirect: true, minorDirect: true, pushPreview: false, shiftArchiveHours: 12 };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const inTenant = <T>(fn: (tx: never) => Promise<T>) =>
  owner.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${t.tenant.id}', true)`);
    return fn(tx as never);
  });
let t: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  const now = Math.floor(Date.now() / 1000);
  const dept = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } });
  id.dept = dept.id;
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: dept.id } });
  const mk = async (name: string, roles: string[], dob: Date | null, pos: boolean) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: roles as never, employmentStatus: 'PART_TIME', firstName: name, lastName: 'Test', email: `${name}@${SUB}.test`, dateOfBirth: dob } });
    if (pos) await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id } });
    id[name] = u.id;
    tok[name] = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: roles as never, aat: now, mfa: true });
  };
  await mk('a1', ['STAFF'], yearsAgo(30), true);
  await mk('a2', ['STAFF'], yearsAgo(31), true);
  await mk('a3', ['STAFF'], yearsAgo(32), true);
  await mk('kid', ['STAFF'], yearsAgo(16), true);
  await mk('sup', ['AQUATIC_SUPERVISOR'], yearsAgo(45), false);
  await mk('hr', ['HR_ADMIN'], yearsAgo(50), false);
  await owner.departmentManager.create({ data: { tenantId: t.tenant.id, departmentId: dept.id, userId: id.sup! } });
  forgetDepartments(t.tenant.id);
  resetLimits();
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('M1: joining conversations', () => {
  it('HR who isn’t in a department can’t join its conversation; they open it for an investigation instead', async () => {
    const c = await as('a1').post('/api/messages/department', { departmentId: id.dept });
    expect(c.status).toBe(201);
    id.dc = c.body.id;
    expect((await send('a1', id.dc!, 'private dept talk before HR')).status).toBe(201);
    expect((await as('hr').post('/api/messages/department', { departmentId: id.dept })).status).toBe(403);
    expect((await as('hr').get(`/api/messages/conversations/${id.dc}`)).status).toBe(404);
  });

  it('HR can’t join a shift conversation they’re not on', async () => {
    const start = new Date(Date.now() + 3_600_000);
    const end = new Date(start.getTime() + 4 * 3_600_000);
    const s = await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: id.a1, startsAt: start, endsAt: end, status: 'PUBLISHED' } });
    await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: id.a2, startsAt: start, endsAt: end, status: 'PUBLISHED' } });
    id.shift = s.id;
    const c = await as('a1').post('/api/messages/shift', { shiftId: s.id });
    expect(c.status).toBe(201);
    id.sc = c.body.id;
    expect((await send('a1', id.sc!, 'before the lead joined')).status).toBe(201);
    expect((await as('hr').post('/api/messages/shift', { shiftId: s.id })).status).toBe(403);
  });

  it('a lead in scope may join a shift conversation, but sees only what was sent after joining; the join is audited', async () => {
    const before = await owner.message.findFirstOrThrow({ where: { conversationId: id.sc } });
    await owner.messageAttachment.create({ data: { tenantId: t.tenant.id, messageId: before.id, contentType: 'image/png', size: 1, ciphertext: Buffer.from('x'), iv: Buffer.alloc(12), authTag: Buffer.alloc(16) } });
    await new Promise((r) => setTimeout(r, 20));
    const j = await as('sup').post('/api/messages/shift', { shiftId: id.shift });
    expect(j.status).toBe(201);
    expect((await send('a2', id.sc!, 'after the lead joined')).status).toBe(201);
    const r = await as('sup').get(`/api/messages/conversations/${id.sc}`);
    expect(r.status).toBe(200);
    expect(r.body.messages.map((m: { text: string }) => m.text)).toEqual(['after the lead joined']);
    expect((await as('sup').get(`/api/messages/${before.id}/file`)).status).toBe(404);
    // Unread counts only what they can see.
    const list = (await as('sup').get('/api/messages/conversations')).body;
    expect(list.find((c: { id: string }) => c.id === id.sc).unread).toBe(1);
    const audits = await owner.auditLog.findMany({ where: { tenantId: t.tenant.id, entityId: id.sc, action: 'messages.join' } });
    expect(audits.map((x) => x.actorId)).toEqual([id.sup]);
    // People there from the start still see everything.
    expect((await as('a2').get(`/api/messages/conversations/${id.sc}`)).body.messages).toHaveLength(2);
  });

  it('someone added to a group later sees only what was sent after they were added', async () => {
    const g = await as('sup').post('/api/messages/groups', { title: 'Crew', memberIds: [id.a1, id.a2] });
    id.grp = g.body.id;
    expect((await send('a1', id.grp!, 'old group talk')).status).toBe(201);
    await new Promise((r) => setTimeout(r, 20));
    expect((await as('sup').post(`/api/messages/conversations/${id.grp}/members`, { userIds: [id.a3] })).status).toBe(200);
    expect((await send('a1', id.grp!, 'welcome a3')).status).toBe(201);
    expect((await as('a3').get(`/api/messages/conversations/${id.grp}`)).body.messages.map((m: { text: string }) => m.text)).toEqual(['welcome a3']);
  });
});

describe('M2: previews never stored in notifications', () => {
  it('stores only the conversation and message ids; the preview is made at push time from the sealed message', async () => {
    expect((await as('hr').put('/api/messages-admin/settings', { ...settings, pushPreview: true })).status).toBe(200);
    const d = await as('a1').post('/api/messages/direct', { userId: id.a2 });
    id.dm = d.body.id;
    const s = await send('a1', id.dm!, 'SECRET-PREVIEW my medical thing');
    expect(s.status).toBe(201);
    const n = await owner.notification.findFirstOrThrow({ where: { userId: id.a2, type: 'message_new', params: { path: ['conversationId'], equals: id.dm } } });
    expect(JSON.stringify(n.params)).not.toContain('SECRET-PREVIEW');
    expect(n.params).toMatchObject({ conversationId: id.dm, messageId: s.body.id });
    const { messagePreviews } = await import('../../src/services/messaging/conversations.js');
    const p = await inTenant((tx) => messagePreviews(tx, [n]));
    expect(p.get(n.id)).toBe('SECRET-PREVIEW my medical thing');
    // Removed: the notification goes, and no preview can be made.
    expect((await as('a1').del(`/api/messages/${s.body.id}`)).status).toBe(200);
    expect(await owner.notification.count({ where: { id: n.id } })).toBe(0);
    expect((await inTenant((tx) => messagePreviews(tx, [n]))).get(n.id)).toBeUndefined();
    await as('hr').put('/api/messages-admin/settings', settings);
  });

  it('erasure removes the notifications pointing at the person’s messages', async () => {
    const s = await send('a3', id.grp!, 'from a3');
    expect(s.status).toBe(201);
    expect(await owner.notification.count({ where: { type: 'message_new', params: { path: ['messageId'], equals: s.body.id } } })).toBeGreaterThan(0);
    const { forgetMessages } = await import('../../src/services/messaging/records.js');
    await inTenant((tx) => forgetMessages(tx, id.a3!));
    expect(await owner.notification.count({ where: { type: 'message_new', params: { path: ['messageId'], equals: s.body.id } } })).toBe(0);
  });
});

describe('L1: who is a minor stays private', () => {
  it('the directory leaves out people you can’t message one to one, with no flag', async () => {
    const d = (await as('a1').get('/api/messages/people')).body;
    expect(JSON.stringify(d)).not.toContain('safeguarding');
    expect(d.people.some((p: { id: string }) => p.id === id.kid)).toBe(false);
    // Directly: the same generic refusal.
    expect((await as('a1').post('/api/messages/direct', { userId: id.kid })).body.code).toBe('MINOR_RULE');
  });

  it('a read-only group gives non-HR one generic reason; HR keeps the specific one', async () => {
    const g = await as('hr').post('/api/messages/groups', { title: 'Juniors', memberIds: [id.kid, id.sup] });
    expect(g.status).toBe(201);
    expect((await as('sup').del(`/api/messages/conversations/${g.body.id}/members/me`)).status).toBe(200);
    // HR + kid: one adult beside a minor, read-only.
    expect((await as('hr').get(`/api/messages/conversations/${g.body.id}`)).body.readOnly).toBe('safeguarding');
    const kid = await as('kid').get(`/api/messages/conversations/${g.body.id}`);
    expect(kid.body.readOnly).toBe('readOnly');
    const sent = await send('kid', g.body.id, 'hi');
    expect(sent.status).toBe(409);
    expect(JSON.stringify(sent.body)).not.toMatch(/safeguard|MINOR/i);
    const list = (await as('kid').get('/api/messages/conversations')).body;
    expect(list.find((c: { id: string }) => c.id === g.body.id).readOnly).toBe('readOnly');
  });
});

describe('L2: rate limits', () => {
  it('sending messages is limited per person', async () => {
    resetLimits();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await send('a2', id.dm!, `m${i}`)).status;
    expect(last).toBe(429);
    resetLimits();
  });

  it('one report per message per reporter, even once closed', async () => {
    const m = await send('a1', id.dm!, 'reportable');
    const r1 = await as('a2').post(`/api/messages/${m.body.id}/report`, { reason: 'Not appropriate at work.' });
    expect(r1.status).toBe(201);
    await owner.messageReport.update({ where: { id: r1.body.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    expect((await as('a2').post(`/api/messages/${m.body.id}/report`, { reason: 'Not appropriate at work.' })).status).toBe(409);
    resetLimits();
  });
});

describe('L3: file names sealed, no plain fingerprint', () => {
  it('stores the file name sealed and no sha256', async () => {
    const r = await send('a1', id.dm!, 'photo', { attachment: { fileName: 'jane-doctor-note.png', data: `data:image/png;base64,${PNG.toString('base64')}` } });
    expect(r.status).toBe(201);
    const row = await owner.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "MessageAttachment" WHERE "messageId" = $1::uuid`, r.body.id);
    expect(JSON.stringify(row[0], (_k, v) => (v && v.type === 'Buffer' ? Buffer.from(v.data).toString('latin1') : v))).not.toContain('jane-doctor-note');
    expect('sha256' in row[0]!).toBe(false);
    const f = await as('a2').get(`/api/messages/${r.body.id}/file`).buffer(true);
    expect(f.headers['content-disposition']).toContain('jane-doctor-note.png');
    const conv = (await as('a2').get(`/api/messages/conversations/${id.dm}`)).body;
    expect(conv.messages.find((m: { id: string }) => m.id === r.body.id).attachment.fileName).toBe('jane-doctor-note.png');
    id.fileMsg = r.body.id;
  });

  it('older rows with a plain name are sealed by the retention run and keep working', async () => {
    const { applyMessageRetention } = await import('../../src/services/messaging/records.js');
    await owner.$executeRawUnsafe(`UPDATE "MessageAttachment" SET "fileName" = 'legacy-name.png', "nameCiphertext" = NULL, "nameIv" = NULL, "nameAuthTag" = NULL WHERE "messageId" = $1::uuid`, id.fileMsg);
    expect((await as('a2').get(`/api/messages/${id.fileMsg}/file`).buffer(true)).headers['content-disposition']).toContain('legacy-name.png');
    await inTenant((tx) => applyMessageRetention(tx, 730));
    const a = await owner.messageAttachment.findUniqueOrThrow({ where: { messageId: id.fileMsg } });
    expect(a.fileName).toBeNull();
    expect(a.nameCiphertext).not.toBeNull();
    expect((await as('a2').get(`/api/messages/${id.fileMsg}/file`).buffer(true)).headers['content-disposition']).toContain('legacy-name.png');
  });
});

describe('L4 and L5: removed messages and edit originals', () => {
  it('the person’s records export has their own first versions of edited messages', async () => {
    const m = await send('a1', id.dm!, 'first version');
    expect((await as('a1').patch(`/api/messages/${m.body.id}`, { text: 'second version' })).status).toBe(200);
    const { exportPersonRecords } = await import('../../src/services/privacy/recordsExport.js');
    const out = await inTenant((tx) => exportPersonRecords(tx, id.a1!));
    const row = out.messages.messagesWritten.find((x: { text: string | null }) => x.text === 'second version');
    expect(row).toMatchObject({ originalText: 'first version' });
    id.editedMsg = m.body.id;
  });

  it('removed messages and edit originals go when their own period ends, in conversations still in use', async () => {
    const { applyMessageRetention } = await import('../../src/services/messaging/records.js');
    const gone = await send('a1', id.dm!, 'to be removed');
    await as('a1').del(`/api/messages/${gone.body.id}`);
    const old = new Date(Date.now() - 800 * 86_400_000);
    await owner.message.update({ where: { id: gone.body.id }, data: { deletedAt: old } });
    await owner.message.update({ where: { id: id.editedMsg }, data: { editedAt: old } });
    await inTenant((tx) => applyMessageRetention(tx, 730));
    const r = await owner.message.findUnique({ where: { id: gone.body.id } });
    expect(r === null || r.ciphertext === null).toBe(true);
    const e = await owner.message.findUniqueOrThrow({ where: { id: id.editedMsg } });
    expect(e.originalCiphertext).toBeNull();
    expect(e.ciphertext).not.toBeNull();
  });

  it('conversations held by open reports don’t starve deletion of the rest', async () => {
    const { applyMessageRetention } = await import('../../src/services/messaging/records.js');
    const old = new Date(Date.now() - 800 * 86_400_000);
    // 1,000 held conversations, older than the one that should go.
    const held: string[] = [];
    const conv = await owner.conversation.findUniqueOrThrow({ where: { id: id.dm } });
    const msg = await owner.message.findFirstOrThrow({ where: { conversationId: id.dm } });
    for (let i = 0; i < 1000; i++) held.push(randomUUID());
    // Made first, then 1,000 held ones after it, older: a batch taken before filtering is all held.
    const stale = await owner.conversation.create({ data: { tenantId: t.tenant.id, kind: 'GROUP', title: 'stale', createdById: id.a1!, wrappedKey: conv.wrappedKey, kekId: conv.kekId, createdAt: old, lastMessageAt: old } });
    await owner.conversation.createMany({ data: held.map((x) => ({ id: x, tenantId: t.tenant.id, kind: 'GROUP' as const, title: 'held', createdById: id.a1!, wrappedKey: conv.wrappedKey, kekId: conv.kekId, createdAt: new Date(old.getTime() - 86_400_000), lastMessageAt: new Date(old.getTime() - 86_400_000) })) });
    await owner.messageReport.createMany({ data: held.map((x) => ({ tenantId: t.tenant.id, messageId: msg.id, conversationId: x, reporterId: id.a2!, reason: 'held open' })) });
    await inTenant((tx) => applyMessageRetention(tx, 730));
    expect(await owner.conversation.findUnique({ where: { id: stale.id } })).toBeNull();
    await owner.messageReport.deleteMany({ where: { conversationId: { in: held } } });
    await owner.conversation.deleteMany({ where: { id: { in: held } } });
  });
});

describe('L7: HR’s lookup of someone’s conversations', () => {
  it('needs a recorded reason, kept in the audit log', async () => {
    expect((await as('hr').get(`/api/messages-admin/people/${id.a1}/conversations`)).status).toBe(404);
    expect((await as('hr').post(`/api/messages-admin/people/${id.a1}/conversations`, {})).status).toBe(400);
    const r = await as('hr').post(`/api/messages-admin/people/${id.a1}/conversations`, { reason: 'Harassment complaint 2026-14 from a2' });
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    const log = await owner.auditLog.findFirstOrThrow({ where: { tenantId: t.tenant.id, action: 'messages.investigation_lookup', entityId: id.a1 } });
    expect(log.after).toMatchObject({ reason: 'Harassment complaint 2026-14 from a2' });
  });
});

describe('H1: the organization export and messages', () => {
  const zipOf = async () => {
    const r = await binary(as('hr').get('/api/data-export/download'));
    expect(r.status).toBe(200);
    const zip = unzipSync(new Uint8Array(r.body as Buffer));
    return { zip, text: (n: string) => (zip[`flexcity-export/${n}`] ? strFromU8(zip[`flexcity-export/${n}`]!) : '') };
  };

  it('while the organization is active: conversation metadata only, no message text, originals or files', async () => {
    const m = await send('a1', id.dm!, 'EXPORT-SECRET first');
    await as('a1').patch(`/api/messages/${m.body.id}`, { text: 'EXPORT-SECRET second' });
    const gone = await send('a1', id.dm!, 'EXPORT-SECRET removed');
    await as('a1').del(`/api/messages/${gone.body.id}`);
    const { zip, text } = await zipOf();
    const all = Object.entries(zip).map(([, v]) => strFromU8(v, true)).join('\n');
    expect(all).not.toContain('EXPORT-SECRET');
    expect(all).not.toContain('legacy-name');
    expect(Object.keys(zip).some((n) => n.includes('files/messages/'))).toBe(false);
    expect(Object.keys(zip).some((n) => /\/(Message|MessageAttachment)\.(csv|jsonl)$/.test(n))).toBe(false);
    const convs = text('json/Conversation.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    const dm = convs.find((c: { id: string }) => c.id === id.dm);
    expect(dm).toMatchObject({ kind: 'DIRECT' });
    expect(dm.memberIds.sort()).toEqual([id.a1, id.a2].sort());
    expect(dm.messages).toBeGreaterThan(0);
    expect(JSON.parse(text('README.json')).messages).toMatch(/not included/i);
  });

  it('in the offboarding export the organization receives when it leaves: messages and files, with an audit row saying so', async () => {
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { disabledAt: new Date(), disabledReason: 'Contract ended', offboardedAt: new Date(), deleteAfter: new Date(Date.now() + 30 * 86_400_000), exportUntil: new Date(Date.now() + 30 * 86_400_000) } });
    forgetTenantLookup();
    forgetFeatures(t.tenant.id);
    const { zip, text } = await zipOf();
    expect(text('csv/Message.csv')).toContain('EXPORT-SECRET second');
    expect(text('csv/Message.csv')).toContain('EXPORT-SECRET first');
    expect(Object.keys(zip).some((n) => n.includes('files/messages/') && n.includes('legacy-name'))).toBe(true);
    const log = await owner.auditLog.findMany({ where: { tenantId: t.tenant.id, action: 'data.export_messages' } });
    expect(log).toHaveLength(1);
    expect(log[0]!.after).toMatchObject({ messagesIncluded: true });
  });
});

function randomUUID() {
  return globalThis.crypto.randomUUID();
}
