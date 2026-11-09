import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { detectNoShows, flagForReview } from '../../src/services/jobs/daily.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'peoplerev';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let hrStale: string;
let sup: string;
let supId: string;
let guard: string;
let guardId: string;
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

const call = (token: string) => {
  const w = (r: request.Test) => r.auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
  return { get: (p: string) => w(request(server).get(p)), post: (p: string, b: object = {}) => w(request(server).post(p)).send(b) };
};
const run = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(t.tenant.id, fn, { prisma: appDb });

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 2);
  guardId = t.users[0]!.id;
  await owner.user.update({ where: { id: guardId }, data: { unionMember: true } });
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'Ross', email: 'hr@peoplerev.test' } });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sol', lastName: 'Park', email: 'sup@peoplerev.test' } });
  supId = s.id;
  const now = Math.floor(Date.now() / 1000);
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now });
  hrStale = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now - 3600 });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
  guard = await signAccessToken({ sub: guardId, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('missed shifts in the background', () => {
  it('records a no-show for a published shift with no punch and no time off, once', async () => {
    const base = { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, status: 'PUBLISHED' as const };
    await owner.shift.create({ data: { ...base, userId: guardId, startsAt: hours(-6), endsAt: hours(-2) } });
    // Worked (punched) and on approved sick leave: neither counts.
    const worked = await owner.shift.create({ data: { ...base, userId: t.users[1]!.id, startsAt: hours(-6), endsAt: hours(-2) } });
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: t.users[1]!.id, facilityId: t.facility.id, positionId: t.position.id, shiftId: worked.id, clockIn: hours(-6), clockOut: hours(-2) } });
    await owner.shift.create({ data: { ...base, userId: guardId, startsAt: hours(-30), endsAt: hours(-26) } });
    await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: guardId, type: 'SICK', status: 'APPROVED', startsAt: hours(-31), endsAt: hours(-25) } });

    expect(await run((tx) => detectNoShows(tx))).toBe(1);
    expect(await run((tx) => detectNoShows(tx))).toBe(0);
    expect(await owner.reliabilityEvent.count({ where: { userId: guardId, type: 'NO_SHOW' } })).toBe(1);
  });
});

describe('case file and review', () => {
  it('a supervisor records a second missed shift; the employee is told and sees the same facts', async () => {
    const r = await call(sup).post(`/api/users/${guardId}/reliability/events`, { type: 'NO_SHOW', occurredAt: hours(-50).toISOString(), note: 'Did not come in for the 6 a.m. opener; no call.' });
    expect(r.status).toBe(201);
    expect(await owner.notification.count({ where: { userId: guardId, type: 'attendance_recorded' } })).toBe(1);
    const mine = await call(guard).get('/api/me/case-file');
    expect(mine.body.events.filter((e: { type: string; counted: boolean }) => e.type === 'NO_SHOW' && e.counted)).toHaveLength(2);
    expect(mine.body.events.find((e: { source: string }) => e.source === 'SUPERVISOR').note).toMatch(/opener/);
  });

  it('nobody records events or notes about themselves, and staff cannot record at all', async () => {
    expect((await call(sup).post(`/api/users/${supId}/reliability/events`, { type: 'NO_SHOW', occurredAt: hours(-5).toISOString(), note: 'test note' })).status).toBe(403);
    expect((await call(guard).post(`/api/users/${t.users[1]!.id}/conduct-notes`, { category: 'CONDUCT', summary: 'not allowed at all here', occurredAt: hours(-5).toISOString() })).status).toBe(403);
  });

  it('flags repeated no-shows for review and tells HR and supervisors once', async () => {
    const list = await call(hr).get('/api/people/review');
    const row = list.body.find((x: { id: string }) => x.id === guardId);
    expect(row.review.flags.map((f: { code: string }) => f.code)).toContain('REPEATED_NO_SHOWS');
    expect(row.review.suggestedLevel).toBe('COACHING');
    expect(list.body[0].id).toBe(guardId);

    expect(await run((tx) => flagForReview(tx))).toBe(1);
    expect(await run((tx) => flagForReview(tx))).toBe(0);
    expect(await owner.notification.count({ where: { tenantId: t.tenant.id, type: 'review_needed' } })).toBe(2);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'people.review.view' } })).toBe(1);
  });

  it('excusing an event takes it out of the score but keeps it on file', async () => {
    const file = await call(hr).get(`/api/users/${guardId}/case-file`);
    const ev = file.body.events.find((e: { source: string }) => e.source === 'SUPERVISOR');
    expect((await call(sup).post(`/api/reliability-events/${ev.id}/excuse`, { reason: 'Doctor’s note received' })).status).toBe(200);
    const after = await call(hr).get(`/api/users/${guardId}/case-file`);
    const same = after.body.events.find((e: { id: string }) => e.id === ev.id);
    expect(same.counted).toBe(false);
    expect(same.excludedReason).toBe('Doctor’s note received');
    expect(after.body.review.flags.map((f: { code: string }) => f.code)).not.toContain('REPEATED_NO_SHOWS');
    expect(await owner.auditLog.count({ where: { action: 'casefile.view', entityId: guardId } })).toBe(2);
    // The nightly review clears the flag once things improve.
    await run((tx) => flagForReview(tx));
    expect((await owner.user.findUniqueOrThrow({ where: { id: guardId } })).reviewFlaggedAt).toBeNull();
  });

  it('conduct notes link to incidents, can be retracted with a reason, and commendations are kept apart', async () => {
    const incident = await owner.incidentReport.create({
      data: { tenantId: t.tenant.id, facilityId: t.facility.id, reportedById: supId, occurredAt: hours(-24), category: 'RESCUE', ciphertext: Buffer.from('x'), iv: Buffer.from('x'), authTag: Buffer.from('x'), wrappedDataKey: Buffer.from('x'), kekId: 'k' },
    });
    const note = await call(sup).post(`/api/users/${guardId}/conduct-notes`, { category: 'SAFETY_PROCEDURE', summary: 'Left the chair without a relief guard during the rescue debrief.', occurredAt: hours(-24).toISOString(), incidentId: incident.id });
    expect(note.status).toBe(201);
    await call(sup).post(`/api/users/${guardId}/conduct-notes`, { category: 'COMMENDATION', summary: 'Calm, textbook spinal rescue in the deep end.', occurredAt: hours(-24).toISOString(), incidentId: incident.id });
    let file = (await call(hr).get(`/api/users/${guardId}/case-file`)).body;
    expect(file.review.flags.map((f: { code: string }) => f.code)).toContain('SAFETY_CONCERN');
    expect(file.review.commendations90).toBe(1);
    expect((await call(sup).post(`/api/conduct-notes/${note.body.id}/retract`, { reason: 'Relief was in place; logged wrong guard' })).status).toBe(200);
    file = (await call(hr).get(`/api/users/${guardId}/case-file`)).body;
    expect(file.review.flags.map((f: { code: string }) => f.code)).not.toContain('SAFETY_CONCERN');
    expect(file.notes.find((n: { id: string }) => n.id === note.body.id).retractedReason).toMatch(/Relief/);
  });
});

describe('discipline with a fair process', () => {
  let evidenceId: string;

  it('freezes the facts relied on into the record', async () => {
    const file = (await call(hr).get(`/api/users/${guardId}/case-file`)).body;
    evidenceId = file.events.find((e: { counted: boolean; type: string }) => e.counted && e.type === 'NO_SHOW').id;
    const r = await call(sup).post(`/api/users/${guardId}/discipline`, { summary: 'Coaching conversation about a missed shift.', level: 'COACHING', evidence: { events: [evidenceId] } });
    expect(r.status).toBe(201);
    expect(r.body.level).toBe('COACHING');
    expect(r.body.evidence[0]).toMatchObject({ kind: 'EVENT', id: evidenceId, type: 'NO_SHOW', points: -15 });
  });

  it('refuses excused events and retracted notes as evidence', async () => {
    const file = (await call(hr).get(`/api/users/${guardId}/case-file`)).body;
    const excused = file.events.find((e: { excludedReason: string | null }) => e.excludedReason).id;
    const r = await call(sup).post(`/api/users/${guardId}/discipline`, { summary: 'Should not be allowed to rely on this.', level: 'VERBAL_WARNING', evidence: { events: [excused] } });
    expect(r.status).toBe(400);
  });

  it('a suspension needs HR, a fresh sign-in, attached facts and every fair-process confirmation', async () => {
    const body = { summary: 'One-day suspension for repeated missed shifts.', level: 'SUSPENSION', evidence: { events: [evidenceId] } };
    expect((await call(sup).post(`/api/users/${guardId}/discipline`, body)).status).toBe(403);
    expect((await call(hrStale).post(`/api/users/${guardId}/discipline`, body)).body.code).toBe('STEP_UP_REQUIRED');
    const missing = await call(hr).post(`/api/users/${guardId}/discipline`, { ...body, fairProcess: { factsReviewed: true } });
    expect(missing.status).toBe(400);
    // Union member: the steward confirmation is required; a suspension doesn't need counsel review.
    expect(missing.body.details.missing).toEqual(['protectedGrounds', 'employeeHeard', 'agreementChecked', 'stewardOffered']);
    const noFacts = await call(hr).post(`/api/users/${guardId}/discipline`, { ...body, evidence: {}, fairProcess: { factsReviewed: true, protectedGrounds: true, employeeHeard: true, agreementChecked: true, stewardOffered: true } });
    expect(noFacts.status).toBe(400);
    const ok = await call(hr).post(`/api/users/${guardId}/discipline`, { ...body, stewardPresent: true, fairProcess: { factsReviewed: true, protectedGrounds: true, employeeHeard: true, agreementChecked: true, stewardOffered: true } });
    expect(ok.status).toBe(201);
    const stored = await owner.disciplinaryRecord.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(Object.keys(stored.fairProcess as object).sort()).toEqual(['agreementChecked', 'employeeHeard', 'factsReviewed', 'protectedGrounds', 'stewardOffered']);
  });

  it('a termination also needs counsel or HR-lead review of notice and severance', async () => {
    const r = await call(hr).post(`/api/users/${guardId}/discipline`, {
      summary: 'Termination review.',
      level: 'TERMINATION',
      evidence: { events: [evidenceId] },
      fairProcess: { factsReviewed: true, protectedGrounds: true, employeeHeard: true, agreementChecked: true, stewardOffered: true },
    });
    expect(r.body.details.missing).toEqual(['counselReviewed']);
  });

  it('the employee adds their own response once, and the issuer is told', async () => {
    const rec = (await call(guard).get('/api/me/discipline')).body.find((r: { level: string }) => r.level === 'COACHING');
    expect((await call(guard).post(`/api/me/discipline/${rec.id}/response`, { response: 'My car broke down; I texted the head guard at 5:40.' })).status).toBe(200);
    expect((await call(guard).post(`/api/me/discipline/${rec.id}/response`, { response: 'Again' })).status).toBe(409);
    expect(await owner.notification.count({ where: { userId: supId, type: 'discipline_response' } })).toBe(1);
    const file = (await call(hr).get(`/api/users/${guardId}/case-file`)).body;
    expect(file.records.find((r: { id: string }) => r.id === rec.id).employeeResponse).toMatch(/car broke down/);
    // Active suspension on file: the next suggested step is a termination review.
    expect(file.review.activeLevel).toBe('SUSPENSION');
  });
});
