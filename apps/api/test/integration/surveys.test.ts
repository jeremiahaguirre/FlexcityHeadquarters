import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetDepartments } from '../../src/services/people/departments.js';
import { anonymizeUser } from '../../src/services/privacy/erasure.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'surv';
const OTHER = 'surv-other';
let t: Awaited<ReturnType<typeof seedTenant>>;
let o: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
const id: Record<string, string> = {};
const subOf: Record<string, string> = {};
const as = (who: string) => {
  const s = subOf[who] ?? SUB;
  const r = (m: 'get' | 'post' | 'put' | 'delete', p: string) => request(server)[m](p).set('x-tenant-subdomain', s).auth(tok[who]!, { type: 'bearer' });
  return { get: (p: string) => r('get', p), post: (p: string, b: object = {}) => r('post', p).send(b), put: (p: string, b: object = {}) => r('put', p).send(b) };
};
const week = () => new Date(Date.now() + 7 * 86_400_000).toISOString();
const QUESTIONS = [
  { id: 'mood', type: 'RATING', text: 'How was your week?' },
  { id: 'load', type: 'CHOICE', text: 'Your workload', options: ['Too light', 'About right', 'Too heavy'] },
  { id: 'help', type: 'MULTI', text: 'What would help?', options: ['More staff', 'Training', 'Breaks'], required: false },
  { id: 'note', type: 'TEXT', text: 'Anything else?', required: false },
];
const answer = (who: string, survey: string, mood: number, note?: string) => as(who).post(`/api/me/surveys/${survey}/answers`, { answers: { mood, load: 'About right', help: ['Training'], ...(note ? { note } : {}) } });
const lifeguards = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'];

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  o = await seedTenant(OTHER, 0);
  const now = Math.floor(Date.now() / 1000);
  const aq = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } });
  const parks = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Parks' } });
  id.aq = aq.id;
  id.parks = parks.id;
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: aq.id } });
  const parksPos = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Parks worker', departmentId: parks.id } });
  const mk = async (name: string, roles: string[], positionId: string | null, tenant = t) => {
    const u = await owner.user.create({ data: { tenantId: tenant.tenant.id, roles: roles as never, employmentStatus: 'PART_TIME', firstName: name, lastName: 'Test', email: `${name}@${SUB}.test` } });
    if (positionId) await owner.userPosition.create({ data: { tenantId: tenant.tenant.id, userId: u.id, positionId } });
    id[name] = u.id;
    tok[name] = await signAccessToken({ sub: u.id, tid: tenant.tenant.id, roles: roles as never, aat: now });
  };
  for (const g of lifeguards) await mk(g, ['STAFF'], t.position.id);
  await mk('p0', ['EMPLOYEE'], parksPos.id);
  await mk('p1', ['EMPLOYEE'], parksPos.id);
  await mk('hr', ['HR_ADMIN'], null);
  await mk('sup', ['AQUATIC_SUPERVISOR'], null);
  await owner.departmentManager.create({ data: { tenantId: t.tenant.id, departmentId: aq.id, userId: id.sup! } });
  await mk('x', ['HR_ADMIN'], null, o);
  subOf.x = OTHER;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const create = async (who: string, body: object) => as(who).post('/api/surveys', { kind: 'PULSE', title: 'Weekly check-in', questions: QUESTIONS, closesAt: week(), ...body });

describe('who can run surveys', () => {
  it('HR always; staff never; managers only when the organization allows, for their departments, and never exit surveys', async () => {
    expect((await create('g0', {})).status).toBe(403);
    expect((await create('sup', {})).status).toBe(403);
    expect((await as('hr').put('/api/surveys-admin/settings', { minGroup: 2, managersCreate: true })).status).toBe(400); // never below 3
    expect((await as('hr').put('/api/surveys-admin/settings', { minGroup: 5, managersCreate: true })).status).toBe(200);
    expect((await create('sup', { audience: { departmentIds: [id.parks], positionIds: [] } })).status).toBe(403);
    const r = await create('sup', { audience: { departmentIds: [id.aq], positionIds: [] } });
    expect(r.status).toBe(201);
    id.supSurvey = r.body.id;
    expect((await create('sup', { kind: 'EXIT' })).status).toBe(403);
    // HR sees it; the manager sees their own only.
    expect((await as('hr').get('/api/surveys')).body.some((s: { id: string }) => s.id === id.supSurvey)).toBe(true);
  });

  it('an anonymous survey can’t go to fewer people than the minimum group', async () => {
    const r = await create('hr', { audience: { departmentIds: [id.parks], positionIds: [] } });
    const p = await as('hr').post(`/api/surveys/${r.body.id}/publish`);
    expect(p.status).toBe(422);
    expect(p.body.code).toBe('AUDIENCE_TOO_SMALL');
  });

  it('choice questions need options; answers are checked', async () => {
    expect((await create('hr', { questions: [{ type: 'CHOICE', text: 'Pick one', options: ['Only'] }] })).status).toBe(400);
  });
});

describe('anonymity', () => {
  it('who answered is kept apart from the answers: no person, no time; one answer each', async () => {
    const r = await create('hr', {});
    id.s1 = r.body.id;
    const p = await as('hr').post(`/api/surveys/${id.s1}/publish`);
    expect(p.body.invited).toBe(10); // 6 lifeguards, 2 parks, HR, the supervisor
    expect(await owner.notification.count({ where: { userId: id.g0, type: 'survey_open' } })).toBe(1);
    const mine = (await as('g0').get('/api/me/surveys')).body;
    expect(mine[0]).toMatchObject({ id: id.s1, from: 'hr', anonymous: true, minGroup: 5, responded: false });
    expect((await as('g0').post(`/api/me/surveys/${id.s1}/answers`, { answers: { mood: 7, load: 'About right' } })).status).toBe(400);
    expect((await answer('g0', id.s1!, 4, 'More lane ropes please')).status).toBe(201);
    expect((await answer('g0', id.s1!, 5)).body.code).toBe('ALREADY_ANSWERED');
    const rows = await owner.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "SurveyResponse" WHERE "surveyId" = $1::uuid`, id.s1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBeNull();
    expect(Object.keys(rows[0]!).sort()).toEqual(['answers', 'departmentId', 'id', 'positionId', 'surveyId', 'tenantId', 'userId']);
    const inviteCols = await owner.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'SurveyInvite'`);
    expect(inviteCols.map((c) => c.column_name).sort()).toEqual(['id', 'responded', 'surveyId', 'tenantId', 'userId']);
    // The app can't change an answer once given.
    await expect(appDb.$executeRawUnsafe(`UPDATE "SurveyResponse" SET answers = '{}'`)).rejects.toThrow();
  });

  it('HR sees how many answered, never who; nothing while it’s open', async () => {
    const list = (await as('hr').get('/api/surveys')).body.find((s: { id: string }) => s.id === id.s1);
    expect(list).toMatchObject({ invited: 10, answered: 1, status: 'OPEN' });
    expect(JSON.stringify(list)).not.toContain(id.g0);
    const r = (await as('hr').get(`/api/surveys/${id.s1}/results`)).body;
    expect(r).toMatchObject({ shown: false, reason: 'open', total: 1 });
    expect(r.questions).toBeUndefined();
  });

  it('closed with fewer than the minimum group: no results, and the CSV says so', async () => {
    for (const g of ['g1', 'g2', 'g3']) await answer(g, id.s1!, 3);
    await as('hr').post(`/api/surveys/${id.s1}/close`);
    expect((await answer('g4', id.s1!, 3)).body.code).toBe('SURVEY_CLOSED');
    const r = (await as('hr').get(`/api/surveys/${id.s1}/results`)).body;
    expect(r).toMatchObject({ shown: false, reason: 'tooFew', total: 4, minGroup: 5 });
    const csv = await as('hr').get(`/api/surveys/${id.s1}/results.csv`);
    expect(csv.text).toContain('hidden: fewer than 5 responses');
    expect(csv.text).not.toContain('lane ropes');
  });

  it('enough answers: results, written answers alphabetically; a small group stays hidden, and so does the group that would give it away', async () => {
    const r = await create('hr', {});
    id.s2 = r.body.id;
    await as('hr').post(`/api/surveys/${id.s2}/publish`);
    const notes = ['Zones are clear', 'Breaks too short', 'Good week', 'More training', 'All good', 'Need radios'];
    for (const [i, g] of lifeguards.entries()) await answer(g, id.s2!, (i % 5) + 1, notes[i]);
    await answer('p0', id.s2!, 1, 'Parks feel forgotten');
    await as('hr').post(`/api/surveys/${id.s2}/close`);
    const res = (await as('hr').get(`/api/surveys/${id.s2}/results`)).body;
    expect(res).toMatchObject({ shown: true, total: 7 });
    const note = res.questions.find((q: { id: string }) => q.id === 'note');
    expect(note.texts).toEqual([...notes, 'Parks feel forgotten'].sort((a, b) => a.localeCompare(b)));
    // Parks (2 people asked) is under 5: its answer kept no department. Aquatics alone would then
    // reveal Parks by subtraction, so it's hidden too.
    const stored = await owner.surveyResponse.findMany({ where: { surveyId: id.s2 } });
    expect(stored.filter((s) => s.departmentId === id.parks)).toHaveLength(0);
    expect(res.breakdown).toMatchObject({ by: 'DEPARTMENT', groups: [], hidden: 7 });
    // Breakdowns never carry written answers.
    expect(JSON.stringify(res.breakdown)).not.toContain('Parks feel forgotten');
    // Only the survey's one dimension is kept on the answers.
    expect(stored.every((x) => x.positionId === null)).toBe(true);
    const csv = await as('hr').get(`/api/surveys/${id.s2}/results.csv`);
    expect(csv.text).toContain('writing style can identify people');
    expect(csv.text).not.toMatch(new RegExp(Object.values(id).filter((v) => v.length === 36).join('|')));
  });

  it('a department big enough on its own is shown', async () => {
    const r = await create('hr', { audience: { departmentIds: [id.aq], positionIds: [] }, repeatOf: id.s2 });
    id.s3 = r.body.id;
    await as('hr').post(`/api/surveys/${id.s3}/publish`);
    for (const g of lifeguards) await answer(g, id.s3!, 4);
    await as('hr').post(`/api/surveys/${id.s3}/close`);
    const res = (await as('hr').get(`/api/surveys/${id.s3}/results`)).body;
    expect(res.breakdown.groups).toEqual([expect.objectContaining({ id: id.aq, responses: 6 })]);
    const series = (await as('hr').get('/api/surveys')).body.find((s: { id: string }) => s.id === id.s3).seriesId;
    const trend = (await as('hr').get(`/api/surveys/series/${series}/trend`)).body;
    expect(trend.map((x: { id: string }) => x.id)).toEqual([id.s2, id.s3]);
    expect(trend[1].points[0]).toMatchObject({ text: 'How was your week?', average: 4 });
  });
});

describe('one breakdown per survey (security review H2)', () => {
  it('a position breakdown keeps only the position on the answers, and shows only positions', async () => {
    const r = await create('hr', { breakdown: 'POSITION' });
    expect(r.status).toBe(201);
    await as('hr').post(`/api/surveys/${r.body.id}/publish`);
    for (const g of lifeguards) await answer(g, r.body.id, 3);
    await as('hr').post(`/api/surveys/${r.body.id}/close`);
    const stored = await owner.surveyResponse.findMany({ where: { surveyId: r.body.id } });
    expect(stored.every((x) => x.departmentId === null)).toBe(true);
    expect(stored.filter((x) => x.positionId === t.position.id)).toHaveLength(6);
    const res = (await as('hr').get(`/api/surveys/${r.body.id}/results`)).body;
    expect(res.breakdown).toMatchObject({ by: 'POSITION', groups: [expect.objectContaining({ id: t.position.id, responses: 6 })], hidden: 0 });
    expect(res.breakdowns).toBeUndefined();
    const csv = (await as('hr').get(`/api/surveys/${r.body.id}/results.csv`)).text;
    expect(csv).toContain('by position');
    expect(csv).toContain('Lifeguard');
    expect((await as('hr').get('/api/surveys')).body.find((x: { id: string }) => x.id === r.body.id).breakdown).toBe('POSITION');
  });

  it('no breakdown: no group is kept at all', async () => {
    const r = await create('hr', { breakdown: 'NONE' });
    await as('hr').post(`/api/surveys/${r.body.id}/publish`);
    for (const g of lifeguards.slice(0, 5)) await answer(g, r.body.id, 2);
    await as('hr').post(`/api/surveys/${r.body.id}/close`);
    const stored = await owner.surveyResponse.findMany({ where: { surveyId: r.body.id } });
    expect(stored.every((x) => x.departmentId === null && x.positionId === null)).toBe(true);
    expect((await as('hr').get(`/api/surveys/${r.body.id}/results`)).body.breakdown).toBeUndefined();
  });
});

describe('a manager’s access to their surveys (security review L6)', () => {
  it('only while managers may run surveys and they still manage its departments', async () => {
    expect((await as('sup').get(`/api/surveys/${id.supSurvey}/results`)).status).toBe(200);
    await as('hr').put('/api/surveys-admin/settings', { minGroup: 5, managersCreate: false });
    expect((await as('sup').get(`/api/surveys/${id.supSurvey}/results`)).status).toBe(404);
    expect((await as('hr').get(`/api/surveys/${id.supSurvey}/results`)).status).toBe(200);
    await as('hr').put('/api/surveys-admin/settings', { minGroup: 5, managersCreate: true });
    expect((await as('sup').get(`/api/surveys/${id.supSurvey}/results`)).status).toBe(200);
    await owner.departmentManager.deleteMany({ where: { userId: id.sup } });
    forgetDepartments(t.tenant.id);
    expect((await as('sup').get(`/api/surveys/${id.supSurvey}/results`)).status).toBe(404);
    expect((await as('sup').put(`/api/surveys/${id.supSurvey}`, { kind: 'PULSE', title: 'Changed', questions: QUESTIONS, closesAt: week() })).status).not.toBe(200);
    await owner.departmentManager.create({ data: { tenantId: t.tenant.id, departmentId: id.aq!, userId: id.sup! } });
    forgetDepartments(t.tenant.id);
  });
});

describe('reminders, exit surveys and isolation', () => {
  it('two reminders at most, only to those who haven’t answered, never after closing', async () => {
    const r = await create('hr', {});
    await as('hr').post(`/api/surveys/${r.body.id}/publish`);
    await answer('g0', r.body.id, 5);
    expect((await as('hr').post(`/api/surveys/${r.body.id}/remind`)).body.sent).toBe(9);
    expect(await owner.notification.count({ where: { userId: id.g0, type: 'survey_reminder' } })).toBe(0);
    expect((await as('hr').post(`/api/surveys/${r.body.id}/remind`)).status).toBe(200);
    expect((await as('hr').post(`/api/surveys/${r.body.id}/remind`)).body.code).toBe('REMINDERS_USED');
    await as('hr').post(`/api/surveys/${r.body.id}/close`);
    const d = await create('hr', {});
    await as('hr').post(`/api/surveys/${d.body.id}/publish`);
    await as('hr').post(`/api/surveys/${d.body.id}/close`);
    expect((await as('hr').post(`/api/surveys/${d.body.id}/remind`)).body.code).toBe('SURVEY_CLOSED');
  });

  it('an exit survey goes to the person leaving, named; only HR reads it', async () => {
    const off = await owner.offboarding.create({ data: { tenantId: t.tenant.id, userId: id.g5!, lastDay: new Date(Date.now() + 5 * 86_400_000), reason: 'RESIGNED', checklist: [], createdById: id.hr! } });
    const r = await create('hr', { kind: 'EXIT', title: 'Before you go', offboardingId: off.id });
    expect(r.status).toBe(201);
    expect((await as('hr').post(`/api/surveys/${r.body.id}/publish`)).body.invited).toBe(1);
    const mine = (await as('g5').get('/api/me/surveys')).body.find((s: { id: string }) => s.id === r.body.id);
    expect(mine).toMatchObject({ anonymous: false, kind: 'EXIT' });
    await answer('g5', r.body.id, 2, 'Schedules changed too often');
    const res = (await as('hr').get(`/api/surveys/${r.body.id}/results`)).body;
    expect(res.named).toEqual([{ name: 'g5 Test', answers: expect.objectContaining({ note: 'Schedules changed too often' }) }]);
    expect((await as('sup').get(`/api/surveys/${r.body.id}/results`)).status).toBe(404);
    id.exit = r.body.id;
  });

  it('another organization sees nothing', async () => {
    expect((await as('x').get(`/api/surveys/${id.s2}/results`)).status).toBe(404);
    expect((await as('x').get('/api/surveys')).body).toEqual([]);
    expect((await as('x').post(`/api/me/surveys/${id.s2}/answers`, { answers: { mood: 3, load: 'About right' } })).status).toBe(404);
  });

  it('anonymizing someone removes their invitations and named answers; anonymous answers stay unlinked', async () => {
    const before = await owner.surveyResponse.count({ where: { surveyId: id.s2 } });
    await owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${t.tenant.id}', true)`);
      await anonymizeUser(tx as never, t.tenant.id, id.hr!, id.g5!);
    });
    expect(await owner.surveyInvite.count({ where: { userId: id.g5 } })).toBe(0);
    expect(await owner.surveyResponse.count({ where: { surveyId: id.exit } })).toBe(0);
    expect(await owner.surveyResponse.count({ where: { surveyId: id.s2 } })).toBe(before);
  });
});
