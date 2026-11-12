/**
 * Staff survey routes (services/surveys): answering, creating and sending, reminders, results,
 * the CSV, the trend across repeated pulses, and the organization's survey settings.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, forbidden } from '../lib/errors.js';
import { allow } from '../auth/rateLimit.js';
import { csvCell } from '../services/payroll/export.js';
import { BREAKDOWNS, MIN_GROUP_CEILING, MIN_GROUP_FLOOR, normalizeQuestions, questionInput, resultsCsv } from '../services/surveys/results.js';
import { SURVEY_DEFAULTS, authorScope, closeSurvey, surveySettings, deleteDraft, listSurveys, mySurveys, offboardingsForExit, ownSurvey, publish, readSurveySettings, remind, respond, saveDraft, surveyResults, trend } from '../services/surveys/surveys.js';
import { h } from './context.js';

export const surveysRouter = Router();
surveysRouter.use(['/surveys', '/me/surveys', '/surveys-admin'], requireFeature('surveys'));
const uuid = z.string().uuid();
const author = (req: Parameters<typeof authOf>[0], _res: unknown, next: (e?: unknown) => void) => {
  const a = authOf(req);
  next(a.permissions.has('surveys.manage') || a.permissions.has('surveys.department') ? undefined : forbidden());
};

surveysRouter.get(
  '/me/surveys',
  requirePermission('surveys.respond'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => mySurveys(tx, a.userId)));
  }),
);

surveysRouter.post(
  '/me/surveys/:id/answers',
  requirePermission('surveys.respond'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ answers: z.record(z.string(), z.unknown()) }).parse(req.body);
    // One answer per invitation already; this stops hammering (30 submissions an hour per person).
    if (!(await allow(`survey-answer:${a.userId}`, 30, 3_600_000))) throw new HttpError(429, 'TOO_MANY', 'Too many answers sent. Try again in a while.');
    await withTenant(a.tenantId, (tx) => respond(tx, a, uuid.parse(req.params.id), b.answers));
    res.status(201).json({ ok: true });
  }),
);

const draftBody = z.object({
  kind: z.enum(['PULSE', 'EXIT']),
  title: z.string().trim().min(3).max(120),
  intro: z.string().trim().max(1000).nullable().optional(),
  questions: z.array(questionInput).min(1).max(20),
  audience: z.object({ departmentIds: z.array(uuid).max(100).default([]), positionIds: z.array(uuid).max(200).default([]) }).default({ departmentIds: [], positionIds: [] }),
  closesAt: z.coerce.date(),
  /** The one breakdown its results may offer (fixed once sent). */
  breakdown: z.enum(BREAKDOWNS).default('DEPARTMENT'),
  offboardingId: uuid.nullable().optional(),
  repeatOf: uuid.nullable().optional(),
});

surveysRouter.get(
  '/surveys',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => listSurveys(tx, a)));
  }),
);

surveysRouter.post(
  '/surveys',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    const b = draftBody.parse(req.body);
    const s = await withTenant(a.tenantId, (tx) => saveDraft(tx, a, { ...b, questions: normalizeQuestions(b.questions) }));
    res.status(201).json({ id: s.id });
  }),
);

surveysRouter.put(
  '/surveys/:id',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    const b = draftBody.parse(req.body);
    await withTenant(a.tenantId, (tx) => saveDraft(tx, a, { ...b, questions: normalizeQuestions(b.questions) }, uuid.parse(req.params.id)));
    res.json({ ok: true });
  }),
);

surveysRouter.delete(
  '/surveys/:id',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    await withTenant(a.tenantId, (tx) => deleteDraft(tx, a, uuid.parse(req.params.id)));
    res.json({ ok: true });
  }),
);

surveysRouter.post(
  '/surveys/:id/publish',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => publish(tx, a, uuid.parse(req.params.id))));
  }),
);

surveysRouter.post(
  '/surveys/:id/close',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    await withTenant(a.tenantId, (tx) => closeSurvey(tx, a, uuid.parse(req.params.id)));
    res.json({ ok: true });
  }),
);

surveysRouter.post(
  '/surveys/:id/remind',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    const sent = await withTenant(a.tenantId, async (tx) => remind(tx, a.tenantId, await ownSurvey(tx, a, uuid.parse(req.params.id)), a.userId));
    res.json({ sent });
  }),
);

surveysRouter.get(
  '/surveys/:id/results',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => surveyResults(tx, a, uuid.parse(req.params.id))));
  }),
);

surveysRouter.get(
  '/surveys/:id/results.csv',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const csv = await withTenant(a.tenantId, async (tx) => {
      const r = await surveyResults(tx, a, id);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'survey.export', entity: 'Survey', entityId: id });
      if (r.named) {
        const q = r.questionsAsked;
        return [['name', ...q.map((x) => x.text)], ...r.named.map((n) => [n.name, ...q.map((x) => [n.answers[x.id] ?? ''].flat().join('; '))])].map((row) => row.map((c) => csvCell(String(c))).join(',')).join('\r\n') + '\r\n';
      }
      const ids = r.breakdown?.groups.map((g) => g.id) ?? [];
      const names = r.breakdown?.by === 'POSITION' ? await tx.position.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : await tx.department.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      return resultsCsv(r.title, r, csvCell, (gid) => names.find((n) => n.id === gid)?.name ?? gid);
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="survey-results.csv"');
    res.send(`﻿${csv}`);
  }),
);

surveysRouter.get(
  '/surveys/series/:id/trend',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => trend(tx, a, uuid.parse(req.params.id))));
  }),
);

/** Departments and positions this author may send to (a manager: their departments only). */
surveysRouter.get(
  '/surveys-admin/choices',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const scope = await authorScope(tx, a).catch(() => ({ hr: false, departments: [] as string[] }));
        const where = scope.hr ? {} : { id: { in: scope.departments } };
        const [departments, positions, settings] = await Promise.all([
          tx.department.findMany({ where, select: { id: true, name: true, nameFr: true }, orderBy: { name: 'asc' } }),
          tx.position.findMany({ where: scope.hr ? {} : { departmentId: { in: scope.departments } }, select: { id: true, name: true, nameFr: true, departmentId: true }, orderBy: { name: 'asc' } }),
          surveySettings(tx),
        ]);
        return { canCreate: scope.hr || scope.departments.length > 0, hr: scope.hr, departments, positions, minGroup: settings.minGroup };
      }),
    );
  }),
);

surveysRouter.get(
  '/surveys-admin/offboardings',
  requirePermission('surveys.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => offboardingsForExit(tx)));
  }),
);

surveysRouter.get(
  '/surveys-admin/settings',
  author,
  h(async (req, res) => {
    const a = authOf(req);
    const t = await withTenant(a.tenantId, (tx) => tx.tenant.findFirstOrThrow({ select: { surveySettings: true } }));
    res.json({ ...readSurveySettings(t.surveySettings), defaults: SURVEY_DEFAULTS, limits: [MIN_GROUP_FLOOR, MIN_GROUP_CEILING] });
  }),
);

surveysRouter.put(
  '/surveys-admin/settings',
  requirePermission('surveys.manage'),
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ minGroup: z.number().int().min(MIN_GROUP_FLOOR).max(MIN_GROUP_CEILING), managersCreate: z.boolean() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.tenant.findFirstOrThrow({ select: { surveySettings: true } });
      await tx.tenant.update({ where: { id: a.tenantId }, data: { surveySettings: b } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'settings.surveys', entity: 'Tenant', entityId: a.tenantId, before: readSurveySettings(before.surveySettings), after: b });
    });
    res.json(b);
  }),
);
