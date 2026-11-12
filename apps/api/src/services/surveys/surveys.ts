/**
 * Short staff surveys: pulse check-ins (always anonymous) and exit surveys (one person who is
 * leaving, named, and the person is told so before answering).
 *
 * Anonymity, done properly:
 *  - Who was asked and whether they answered (SurveyInvite: person, survey, a yes/no) is kept apart
 *    from the answers (SurveyResponse), which carry no person, no time and no sequence: their id is
 *    random, and every list and export orders them by that id or alphabetically, never by when.
 *  - A response keeps the department and position only when that group, among the people asked, is
 *    at least the survey's minimum group; otherwise it keeps neither.
 *  - An anonymous survey can't be sent to fewer people than the minimum group (it could never show
 *    results, and it would single people out).
 *  - Results open when the survey closes (watching numbers change while it's open would reveal each
 *    answer as it arrives) and only for at least the minimum group (./results.ts).
 *  - HR and managers see how many answered, never who.
 *  - Questions and the minimum group are fixed once a survey is sent.
 * What remains: someone with direct database access could match the two tables by the database's
 * own transaction ids; the application, its screens and its exports never expose those.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, Survey } from '@prisma/client';
import type { AuthContext } from '../../auth/middleware.js';
import { announceChange, announceChangeTo } from '../../lib/changes.js';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { notify } from '../notifications/notifier.js';
import { type Answers, MIN_GROUP_CEILING, MIN_GROUP_DEFAULT, MIN_GROUP_FLOOR, type Question, type Results, anonymousResults, validateAnswers } from './results.js';

export interface SurveySettings { minGroup: number; managersCreate: boolean }
export const SURVEY_DEFAULTS: SurveySettings = { minGroup: MIN_GROUP_DEFAULT, managersCreate: false };
export const MAX_REMINDERS = 2;

export function readSurveySettings(raw: unknown): SurveySettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const n = Number(r.minGroup);
  return { minGroup: Number.isInteger(n) && n >= MIN_GROUP_FLOOR && n <= MIN_GROUP_CEILING ? n : MIN_GROUP_DEFAULT, managersCreate: typeof r.managersCreate === 'boolean' ? r.managersCreate : false };
}

export async function surveySettings(tx: Tx): Promise<SurveySettings> {
  return readSurveySettings((await tx.tenant.findFirst({ select: { surveySettings: true } }))?.surveySettings);
}

export interface Audience { departmentIds: string[]; positionIds: string[] }
export const isClosed = (s: Pick<Survey, 'closedAt' | 'closesAt'>, now = new Date()) => !!s.closedAt || s.closesAt <= now;
const questionsOf = (s: Pick<Survey, 'questions'>) => s.questions as unknown as Question[];
const audienceOf = (s: Pick<Survey, 'audience'>) => ({ departmentIds: [], positionIds: [], ...(s.audience as object) }) as Audience;

/** Departments a manager may survey: those they manage, and those of the positions their role covers. */
export async function managedDepartments(tx: Tx, a: AuthContext): Promise<string[]> {
  const [managed, positions] = await Promise.all([
    tx.departmentManager.findMany({ where: { userId: a.userId }, select: { departmentId: true } }),
    a.scope?.positionIds.length ? tx.position.findMany({ where: { id: { in: a.scope.positionIds } }, select: { departmentId: true } }) : Promise.resolve([]),
  ]);
  return [...new Set([...managed.map((m) => m.departmentId), ...positions.map((p) => p.departmentId).filter((d): d is string => !!d)])];
}

/** HR, or a manager when the organization lets managers run surveys. Managers only reach their departments. */
export async function authorScope(tx: Tx, a: AuthContext): Promise<{ hr: boolean; departments: string[] }> {
  if (a.permissions.has('surveys.manage')) return { hr: true, departments: [] };
  if (!a.permissions.has('surveys.department') || !(await surveySettings(tx)).managersCreate) throw forbidden('Your organization hasn’t turned on surveys by managers.');
  const departments = await managedDepartments(tx, a);
  if (!departments.length) throw forbidden('You don’t manage a department.');
  return { hr: false, departments };
}

/** May this person see or change this survey? HR: all; a manager: their own. */
export async function ownSurvey(tx: Tx, a: AuthContext, id: string) {
  const s = await tx.survey.findUnique({ where: { id } });
  if (!s) throw notFound('Survey');
  if (a.permissions.has('surveys.manage')) return s;
  if (s.createdById === a.userId && a.permissions.has('surveys.department')) return s;
  throw notFound('Survey');
}

/** The people an audience reaches today: active, in the departments or positions chosen (empty = everyone in reach). */
async function audiencePeople(tx: Tx, aud: Audience, limitDepartments: string[]): Promise<Array<{ id: string; departmentId: string | null; positionId: string | null }>> {
  const deps = limitDepartments.length ? (aud.departmentIds.length ? aud.departmentIds.filter((d) => limitDepartments.includes(d)) : limitDepartments) : aud.departmentIds;
  const posWhere: Prisma.UserPositionWhereInput = { ...(aud.positionIds.length ? { positionId: { in: aud.positionIds } } : {}), ...(deps.length ? { position: { departmentId: { in: deps } } } : {}) };
  const filtered = aud.positionIds.length || deps.length;
  const users = await tx.user.findMany({
    where: { status: 'ACTIVE', anonymizedAt: null, processingRestrictedAt: null, roles: { hasSome: ['HR_ADMIN', 'AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD', 'STAFF', 'FRONT_DESK', 'EMPLOYEE'] }, ...(filtered ? { positions: { some: posWhere } } : {}) },
    select: { id: true, positions: { where: filtered ? posWhere : {}, orderBy: { approvedAt: 'asc' }, select: { positionId: true, position: { select: { departmentId: true } } } } },
  });
  return users.map((u) => ({ id: u.id, positionId: u.positions[0]?.positionId ?? null, departmentId: u.positions[0]?.position.departmentId ?? null }));
}

export interface Draft {
  kind: 'PULSE' | 'EXIT';
  title: string;
  intro?: string | null;
  questions: Question[];
  audience: Audience;
  closesAt: Date;
  offboardingId?: string | null;
  /** Repeat of an earlier survey: same series, for the trend. */
  repeatOf?: string | null;
}

export async function saveDraft(tx: Tx, a: AuthContext, d: Draft, id?: string) {
  const scope = await authorScope(tx, a);
  if (d.kind === 'EXIT' && !scope.hr) throw forbidden('Exit surveys are for HR.');
  if (!scope.hr && d.audience.departmentIds.some((x) => !scope.departments.includes(x))) throw forbidden('Choose departments you manage.');
  let subjectUserId: string | null = null;
  if (d.kind === 'EXIT') {
    if (!d.offboardingId) throw badRequest('Choose the person leaving.');
    const o = await tx.offboarding.findUnique({ where: { id: d.offboardingId } });
    if (!o || o.completedAt) throw notFound('Offboarding');
    subjectUserId = o.userId;
  }
  let seriesId: string = randomUUID();
  if (d.repeatOf) {
    const prev = await ownSurvey(tx, a, d.repeatOf);
    if (prev.kind !== 'PULSE' || d.kind !== 'PULSE') throw badRequest('Only pulse surveys repeat.');
    seriesId = prev.seriesId;
  }
  const data = {
    kind: d.kind,
    title: d.title,
    intro: d.intro ?? null,
    // Pulses are always anonymous; exit surveys are always named (and say so before anyone answers).
    anonymous: d.kind === 'PULSE',
    questions: d.questions as unknown as Prisma.InputJsonValue,
    audience: (d.kind === 'EXIT' ? { userId: subjectUserId } : d.audience) as unknown as Prisma.InputJsonValue,
    departmentIds: scope.hr ? [] : scope.departments,
    offboardingId: d.kind === 'EXIT' ? d.offboardingId! : null,
    subjectUserId,
    closesAt: d.closesAt,
  };
  if (id) {
    const s = await ownSurvey(tx, a, id);
    if (s.publishedAt) throw conflict('SURVEY_SENT', 'A survey can’t be changed once it’s sent.');
    return tx.survey.update({ where: { id }, data });
  }
  const s = await tx.survey.create({ data: { ...data, tenantId: a.tenantId, seriesId, opensAt: new Date(), createdById: a.userId } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'survey.create', entity: 'Survey', entityId: s.id, after: { kind: d.kind, questions: d.questions.length } });
  return s;
}

/** Sends a draft: the people asked are fixed now, and told. */
export async function publish(tx: Tx, a: AuthContext, id: string, now = new Date()) {
  const s = await ownSurvey(tx, a, id);
  if (s.publishedAt) throw conflict('SURVEY_SENT', 'This survey was already sent.');
  if (s.closesAt <= new Date(now.getTime() + 3_600_000)) throw badRequest('Choose a closing date at least an hour from now.');
  const settings = await surveySettings(tx);
  let people: Array<{ id: string; departmentId: string | null; positionId: string | null }>;
  if (s.kind === 'EXIT') {
    const u = await tx.user.findUnique({ where: { id: s.subjectUserId! }, select: { id: true, status: true } });
    if (!u) throw notFound('Person');
    people = [{ id: u.id, departmentId: null, positionId: null }];
  } else {
    people = await audiencePeople(tx, audienceOf(s), s.departmentIds);
    if (people.length < settings.minGroup) throw new HttpError(422, 'AUDIENCE_TOO_SMALL', `An anonymous survey needs at least ${settings.minGroup} people, so no one can be singled out.`, { minGroup: settings.minGroup, audience: people.length });
  }
  await tx.surveyInvite.createMany({ data: people.map((p) => ({ tenantId: a.tenantId, surveyId: id, userId: p.id })), skipDuplicates: true });
  await tx.survey.update({ where: { id }, data: { publishedAt: now, opensAt: now, minGroup: settings.minGroup } });
  await notify(tx, a.tenantId, people.map((p) => ({ userId: p.id, type: 'survey_open', params: { title: s.title, surveyId: id }, link: `/surveys?s=${id}` })));
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'survey.publish', entity: 'Survey', entityId: id, after: { invited: people.length, minGroup: settings.minGroup } });
  // Live: the people asked see it on their Today screen at once.
  await announceChangeTo(tx, a.tenantId, 'surveys', people.map((p) => p.id));
  return { invited: people.length };
}

/** Surveys waiting for this person (and the ones they've answered, while open). */
export async function mySurveys(tx: Tx, userId: string, now = new Date()) {
  const invites = await tx.surveyInvite.findMany({ where: { userId } });
  const surveys = await tx.survey.findMany({ where: { id: { in: invites.map((i) => i.surveyId) }, publishedAt: { not: null }, closedAt: null, closesAt: { gt: now } }, orderBy: { closesAt: 'asc' } });
  return surveys.map((s) => ({
    id: s.id,
    kind: s.kind,
    /** Who it comes from: HR (whole organization) or a manager (limited to their departments). */
    from: s.departmentIds.length ? ('manager' as const) : ('hr' as const),
    title: s.title,
    intro: s.intro,
    anonymous: s.anonymous,
    minGroup: s.minGroup,
    closesAt: s.closesAt,
    responded: invites.find((i) => i.surveyId === s.id)!.responded,
    questions: questionsOf(s),
  }));
}

/**
 * One answer per person. The invitation is marked answered and the answers are stored in the same
 * transaction, but in separate tables, the answers without the person or a time.
 */
export async function respond(tx: Tx, a: AuthContext, id: string, raw: Record<string, unknown>, now = new Date()) {
  const s = await tx.survey.findUnique({ where: { id } });
  if (!s || !s.publishedAt) throw notFound('Survey');
  const invite = await tx.surveyInvite.findUnique({ where: { surveyId_userId: { surveyId: id, userId: a.userId } } });
  if (!invite) throw notFound('Survey');
  if (isClosed(s, now)) throw conflict('SURVEY_CLOSED', 'This survey has closed.');
  const v = validateAnswers(questionsOf(s), raw);
  if (!v.ok) throw badRequest(v.message, { questionId: v.questionId });
  const claimed = await tx.surveyInvite.updateMany({ where: { id: invite.id, responded: false }, data: { responded: true } });
  if (!claimed.count) throw conflict('ALREADY_ANSWERED', 'You’ve already answered this survey.');
  let departmentId: string | null = null;
  let positionId: string | null = null;
  if (s.anonymous) {
    // The respondent's group, kept only where enough people were asked from it.
    const invited = new Set((await tx.surveyInvite.findMany({ where: { surveyId: id }, select: { userId: true } })).map((i) => i.userId));
    const all = (await audiencePeople(tx, audienceOf(s), s.departmentIds)).filter((p) => invited.has(p.id));
    const me = all.find((p) => p.id === a.userId);
    if (me) {
      if (me.departmentId && all.filter((p) => p.departmentId === me.departmentId).length >= s.minGroup) departmentId = me.departmentId;
      if (me.positionId && all.filter((p) => p.positionId === me.positionId).length >= s.minGroup) positionId = me.positionId;
    }
  }
  await tx.surveyResponse.create({ data: { tenantId: a.tenantId, surveyId: id, userId: s.anonymous ? null : a.userId, departmentId, positionId, answers: v.answers as Prisma.InputJsonValue } });
  // Clears the "survey waiting" notification; it says nothing about the answers.
  await tx.notification.updateMany({ where: { userId: a.userId, type: { in: ['survey_open', 'survey_reminder'] }, readAt: null, params: { path: ['surveyId'], equals: id } }, data: { readAt: now } });
  await announceChangeTo(tx, a.tenantId, 'surveys', [a.userId]);
}

/** For HR and the manager who made it: counts only, never who. */
export async function listSurveys(tx: Tx, a: AuthContext) {
  const where: Prisma.SurveyWhereInput = a.permissions.has('surveys.manage') ? {} : { createdById: a.userId };
  const rows = await tx.survey.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  const ids = rows.map((r) => r.id);
  const [invited, answered] = await Promise.all([
    tx.surveyInvite.groupBy({ by: ['surveyId'], where: { surveyId: { in: ids } }, _count: { _all: true } }),
    tx.surveyInvite.groupBy({ by: ['surveyId'], where: { surveyId: { in: ids }, responded: true }, _count: { _all: true } }),
  ]);
  const subjects = await tx.user.findMany({ where: { id: { in: rows.map((r) => r.subjectUserId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } });
  const now = new Date();
  return rows.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    intro: s.intro,
    anonymous: s.anonymous,
    seriesId: s.seriesId,
    questions: questionsOf(s),
    audience: audienceOf(s),
    closesAt: s.closesAt,
    publishedAt: s.publishedAt,
    status: !s.publishedAt ? 'DRAFT' : isClosed(s, now) ? 'CLOSED' : 'OPEN',
    invited: invited.find((x) => x.surveyId === s.id)?._count._all ?? 0,
    answered: answered.find((x) => x.surveyId === s.id)?._count._all ?? 0,
    remindersSent: s.remindersSent,
    minGroup: s.minGroup,
    subject: s.subjectUserId ? (subjects.find((u) => u.id === s.subjectUserId) ?? null) : null,
    offboardingId: s.offboardingId,
    mine: s.createdById === a.userId,
  }));
}

export async function closeSurvey(tx: Tx, a: AuthContext, id: string) {
  const s = await ownSurvey(tx, a, id);
  if (!s.publishedAt || isClosed(s)) throw conflict('SURVEY_CLOSED', 'This survey isn’t open.');
  await tx.survey.update({ where: { id }, data: { closedAt: new Date() } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'survey.close', entity: 'Survey', entityId: id });
  await announceChange(tx, a.tenantId, 'surveys');
}

export async function deleteDraft(tx: Tx, a: AuthContext, id: string) {
  const s = await ownSurvey(tx, a, id);
  if (s.publishedAt) throw conflict('SURVEY_SENT', 'A sent survey stays until its retention period ends.');
  await tx.survey.delete({ where: { id } });
}

/** A reminder to those who haven't answered: at most two per survey, never once it's closed. */
export async function remind(tx: Tx, tenantId: string, s: Survey, actorId: string | null, now = new Date()): Promise<number> {
  if (!s.publishedAt || isClosed(s, now)) throw conflict('SURVEY_CLOSED', 'Reminders stop when a survey closes.');
  if (s.remindersSent >= MAX_REMINDERS) throw conflict('REMINDERS_USED', 'This survey has had its two reminders.');
  const waiting = await tx.surveyInvite.findMany({ where: { surveyId: s.id, responded: false }, select: { userId: true } });
  await tx.survey.update({ where: { id: s.id }, data: { remindersSent: { increment: 1 } } });
  await notify(tx, tenantId, waiting.map((w) => ({ userId: w.userId, type: 'survey_reminder', params: { title: s.title, surveyId: s.id, closesAt: s.closesAt.toISOString() }, link: `/surveys?s=${s.id}` })));
  await audit(tx, { tenantId, actorId, action: 'survey.remind', entity: 'Survey', entityId: s.id, after: { sent: waiting.length } });
  return waiting.length;
}

/** Hourly (worker): one automatic reminder a day before a survey closes, if none was sent yet. */
export async function surveyReminders(tx: Tx, now = new Date()): Promise<number> {
  const due = await tx.survey.findMany({ where: { publishedAt: { not: null, lt: new Date(now.getTime() - 24 * 3_600_000) }, closedAt: null, remindersSent: 0, closesAt: { gt: now, lt: new Date(now.getTime() + 24 * 3_600_000) } } });
  let n = 0;
  for (const s of due) n += await remind(tx, s.tenantId, s, null, now);
  return n;
}

/** Results as the person asking may see them. Anonymous: ./results.ts rules. Named (exit): each answer with the name. */
export async function surveyResults(tx: Tx, a: AuthContext, id: string, now = new Date()): Promise<Results & { named?: Array<{ name: string; answers: Answers }>; questionsAsked: Question[]; title: string; invited: number; answered: number }> {
  const s = await ownSurvey(tx, a, id);
  const questions = questionsOf(s);
  const [invited, answered] = await Promise.all([tx.surveyInvite.count({ where: { surveyId: id } }), tx.surveyInvite.count({ where: { surveyId: id, responded: true } })]);
  const base = { questionsAsked: questions, title: s.title, invited, answered };
  // Ordered by the random id: never by when they came in.
  const responses = await tx.surveyResponse.findMany({ where: { surveyId: id }, orderBy: { id: 'asc' } });
  if (!s.anonymous) {
    if (!a.permissions.has('surveys.manage')) throw notFound('Survey');
    const people = await tx.user.findMany({ where: { id: { in: responses.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } });
    await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'survey.read_named', entity: 'Survey', entityId: id });
    return { ...base, total: responses.length, minGroup: s.minGroup, shown: true, named: responses.map((r) => ({ name: (() => { const p = people.find((x) => x.id === r.userId); return p ? `${p.firstName} ${p.lastName}` : ''; })(), answers: r.answers as Answers })) };
  }
  return { ...base, ...anonymousResults(questions, responses.map((r) => ({ answers: r.answers as Answers, departmentId: r.departmentId, positionId: r.positionId })), s.minGroup, isClosed(s, now)) };
}

/** A repeated pulse's trend: each closed survey's average per rating question, where it reached the minimum group. */
export async function trend(tx: Tx, a: AuthContext, seriesId: string) {
  const where: Prisma.SurveyWhereInput = { seriesId, publishedAt: { not: null }, ...(a.permissions.has('surveys.manage') ? {} : { createdById: a.userId }) };
  const surveys = (await tx.survey.findMany({ where, orderBy: { opensAt: 'asc' } })).filter((s) => isClosed(s));
  const out = [];
  for (const s of surveys) {
    const responses = await tx.surveyResponse.findMany({ where: { surveyId: s.id }, select: { answers: true } });
    const ok = responses.length >= s.minGroup;
    const points = questionsOf(s)
      .filter((q) => q.type === 'RATING')
      .map((q) => {
        const vals = responses.map((r) => (r.answers as Answers)[q.id]).filter((v): v is number => typeof v === 'number');
        return { text: q.text, average: ok && vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10 : null };
      });
    out.push({ id: s.id, title: s.title, opensAt: s.opensAt, responses: ok ? responses.length : null, points });
  }
  return out;
}

/** Open offboardings HR can send an exit survey for. */
export async function offboardingsForExit(tx: Tx) {
  const rows = await tx.offboarding.findMany({ where: { completedAt: null }, orderBy: { lastDay: 'asc' } });
  const people = await tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, firstName: true, lastName: true } });
  const sent = await tx.survey.findMany({ where: { offboardingId: { in: rows.map((r) => r.id) } }, select: { offboardingId: true } });
  return rows.map((r) => ({ id: r.id, lastDay: r.lastDay, name: (() => { const p = people.find((x) => x.id === r.userId); return p ? `${p.firstName} ${p.lastName}` : ''; })(), hasSurvey: sent.some((x) => x.offboardingId === r.id) }));
}

// ------------------------------------------------------------------ Privacy

/** Retention: a survey closed longer than the period goes, with who was asked and every answer. */
export async function applySurveyRetention(tx: Tx, days: number, now = new Date()): Promise<number> {
  const cut = new Date(now.getTime() - days * 86_400_000);
  const old = await tx.survey.findMany({ where: { OR: [{ closedAt: { lt: cut } }, { closedAt: null, closesAt: { lt: cut } }] }, select: { id: true }, take: 500 });
  const ids = old.map((s) => s.id);
  if (!ids.length) return 0;
  await tx.surveyResponse.deleteMany({ where: { surveyId: { in: ids } } });
  await tx.surveyInvite.deleteMany({ where: { surveyId: { in: ids } } });
  return (await tx.survey.deleteMany({ where: { id: { in: ids } } })).count;
}

/** Anonymization: their invitations and named answers go. Anonymous answers were never linked to them and stay. */
export async function forgetSurveys(tx: Tx, userId: string): Promise<void> {
  await tx.surveyResponse.deleteMany({ where: { userId } });
  await tx.surveyInvite.deleteMany({ where: { userId } });
}

/** Records export: surveys they were asked, whether they answered, and their named answers. */
export async function surveyRecords(tx: Tx, userId: string) {
  const invites = await tx.surveyInvite.findMany({ where: { userId } });
  const surveys = await tx.survey.findMany({ where: { id: { in: invites.map((i) => i.surveyId) } }, select: { id: true, title: true, kind: true, anonymous: true, closesAt: true } });
  const named = await tx.surveyResponse.findMany({ where: { userId }, select: { surveyId: true, answers: true } });
  return {
    asked: invites.map((i) => ({ ...surveys.find((s) => s.id === i.surveyId), answered: i.responded })),
    namedAnswers: named,
  };
}
