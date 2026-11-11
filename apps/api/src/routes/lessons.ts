/** Swim lessons: instructors' sessions and attendance, and classes with their enrolments. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { listSessions, recordAttendance } from '../services/lessons/lessons.js';
import { assertShiftInScope, placeWhere, shiftInScope } from '../services/people/scope.js';
import { h } from './context.js';

export const lessonsRouter = Router();
lessonsRouter.use(['/lessons', '/me/lessons'], requireFeature('lessons'));
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.object({ from: isoDate, to: isoDate }).refine((r) => r.to >= r.from, 'to must be on or after from');
const MAX_DAYS = 31;
const days = (r: { from: string; to: string }) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000;

/** The sessions I'm teaching, with full rosters — the app caches these for offline use. */
lessonsRouter.get(
  '/me/lessons',
  h(async (req, res) => {
    const a = authOf(req);
    const q = range.parse(req.query);
    if (days(q) > MAX_DAYS) throw badRequest(`Choose up to ${MAX_DAYS} days.`);
    res.json(await withTenant(a.tenantId, (tx) => listSessions(tx, q.from, q.to, a.userId)));
  }),
);

lessonsRouter.get(
  '/lessons/sessions',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const q = range.parse(req.query);
    if (days(q) > MAX_DAYS) throw badRequest(`Choose up to ${MAX_DAYS} days.`);
    res.json(await withTenant(a.tenantId, (tx) => listSessions(tx, q.from, q.to, undefined, a.scope)));
  }),
);

lessonsRouter.post(
  '/lessons/attendance',
  h(async (req, res) => {
    const a = authOf(req);
    const records = z
      .array(
        z.object({
          clientId: z.string().min(8).max(64),
          enrollmentId: uuid,
          sessionDate: isoDate,
          status: z.enum(['PRESENT', 'ABSENT', 'EXCUSED']),
          recordedAt: z.coerce.date(),
        }),
      )
      .min(1)
      .max(300)
      .parse(req.body);
    const out = await withTenant(a.tenantId, (tx) => recordAttendance(tx, { userId: a.userId, tenantId: a.tenantId, canManage: a.permissions.has('schedule.write'), scope: a.scope }, records));
    res.json({ results: out });
  }),
);

lessonsRouter.get(
  '/lessons/classes',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) =>
      tx.lessonClass.findMany({ where: placeWhere(a.scope), include: { _count: { select: { enrollments: { where: { active: true } } } } }, orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] }),
    );
    res.json(rows.map((c) => ({ ...c, startsOn: c.startsOn.toISOString().slice(0, 10), endsOn: c.endsOn.toISOString().slice(0, 10), enrolled: c._count.enrollments })));
  }),
);

lessonsRouter.post(
  '/lessons/classes',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = z
      .object({
        facilityId: uuid,
        positionId: uuid,
        name: z.string().min(2).max(80),
        level: z.string().max(40).nullable().optional(),
        dayOfWeek: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(1).max(1440),
        startsOn: isoDate,
        endsOn: isoDate,
        maxSwimmers: z.number().int().min(1).max(40).default(8),
      })
      .parse(req.body);
    assertShiftInScope(a, body);
    if (body.endMinute <= body.startMinute) throw badRequest('A class must end after it starts.');
    if (body.endsOn < body.startsOn) throw badRequest('The last date must be after the first.');
    const c = await withTenant(a.tenantId, (tx) =>
      tx.lessonClass.create({ data: { ...body, level: body.level ?? null, tenantId: a.tenantId, startsOn: new Date(body.startsOn), endsOn: new Date(body.endsOn) } }),
    );
    res.status(201).json({ id: c.id });
  }),
);

lessonsRouter.post(
  '/lessons/classes/:id/enrollments',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const classId = uuid.parse(req.params.id);
    const body = z.object({ swimmerName: z.string().trim().min(2).max(80), safetyNote: z.string().max(200).nullable().optional() }).parse(req.body);
    const e = await withTenant(a.tenantId, async (tx) => {
      const cls = await tx.lessonClass.findUnique({ where: { id: classId }, include: { _count: { select: { enrollments: { where: { active: true } } } } } });
      if (!cls || !shiftInScope(a.scope, cls)) throw notFound('Class');
      if (cls._count.enrollments >= cls.maxSwimmers) throw conflict('CLASS_FULL', `This class is full (${cls.maxSwimmers} swimmers).`);
      const created = await tx.lessonEnrollment.create({ data: { tenantId: a.tenantId, classId, swimmerName: body.swimmerName, safetyNote: body.safetyNote ?? null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'lesson.enroll', entity: 'LessonEnrollment', entityId: created.id });
      return created;
    });
    res.status(201).json({ id: e.id });
  }),
);
