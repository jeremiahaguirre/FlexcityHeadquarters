/**
 * People review: case files, the review list, and the facts behind them
 * (recorded attendance events, excused events, conduct notes).
 * Everything here informs a decision; nothing makes one.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../services/notifications/notifier.js';
import { loadCaseFile } from '../services/people/caseFile.js';
import { reviewList } from '../services/people/reviewList.js';
import { h } from './context.js';
import { peopleInScope } from '../services/people/scope.js';
import { departmentFilter, departmentQuery } from '../services/people/departmentAdmin.js';
import { assertUserInScope, hrRecordsBy } from '../services/people/scope.js';

export const peopleRouter = Router();
const uuid = z.string().uuid();
const when = z.string().datetime({ offset: true });

/** HR / supervisor view of one person's file. Every view is logged. */
peopleRouter.get(
  '/users/:id/case-file',
  requirePermission('reliability.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const file = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true, anonymizedAt: true } });
      if (!u || u.anonymizedAt) throw notFound('Staff member');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'casefile.view', entity: 'User', entityId: userId });
      return loadCaseFile(tx, userId, new Date(), hrRecordsBy(a));
    });
    res.json(file);
  }),
);

/** Everyone can see their own file, exactly as a manager sees it. */
peopleRouter.get(
  '/me/case-file',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => loadCaseFile(tx, a.userId)));
  }),
);

/** Who may need attention, and why. Flags first, then lowest score. */
peopleRouter.get(
  '/people/review',
  requirePermission('reliability.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, async (tx) => {
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'people.review.view', entity: 'Tenant', entityId: a.tenantId });
      const department = departmentQuery.parse(req.query.department);
      const [rows, people, inDepartment] = await Promise.all([
        reviewList(tx, new Date(), hrRecordsBy(a)),
        peopleInScope(tx, a.scope),
        department ? tx.user.findMany({ where: departmentFilter(department), select: { id: true } }).then((u) => new Set(u.map((x) => x.id))) : null,
      ]);
      return rows.filter((r) => (!people || people.has(r.id)) && (!inDepartment || inDepartment.has(r.id)));
    });
    res.json(rows);
  }),
);

/** A supervisor records what the timeclock can't see: a missed in-service, or a no-show on an unscheduled call-in. */
peopleRouter.post(
  '/users/:id/reliability/events',
  requirePermission('reliability.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    if (userId === a.userId) throw forbidden('You cannot record events about yourself.');
    const body = z.object({ type: z.enum(['NO_SHOW', 'MISSED_IN_SERVICE']), occurredAt: when, note: z.string().trim().min(5).max(1000) }).parse(req.body);
    const at = new Date(body.occurredAt);
    if (at.getTime() > Date.now() + 60_000) throw badRequest('That date is in the future.');
    const id = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId } });
      if (!u || u.anonymizedAt) throw notFound('Staff member');
      const e = await tx.reliabilityEvent.create({ data: { tenantId: a.tenantId, userId, type: body.type, occurredAt: at, note: body.note, recordedById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'reliability.record', entity: 'ReliabilityEvent', entityId: e.id, after: body });
      await notify(tx, a.tenantId, [{ userId, type: 'attendance_recorded', link: '/profile' }]);
      return e.id;
    });
    res.status(201).json({ id });
  }),
);

/** Excuse an event (a doctor's note, a family emergency, a mistake). It stays visible with the reason. */
peopleRouter.post(
  '/reliability-events/:id/excuse',
  requirePermission('reliability.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const e = await tx.reliabilityEvent.findUnique({ where: { id } });
      if (!e) throw notFound('Event');
      // Not your own record, and only for people in your department.
      if (e.userId === a.userId) throw forbidden('You can’t excuse your own record.');
      await assertUserInScope(tx, a, e.userId);
      if (e.excludedReason) throw conflict('ALREADY_EXCUSED', 'This event is already excused.');
      await tx.reliabilityEvent.update({ where: { id }, data: { excludedReason: reason, excusedById: a.userId, excusedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'reliability.excuse', entity: 'ReliabilityEvent', entityId: id, after: { reason } });
    });
    res.json({ ok: true });
  }),
);

/** A factual note about conduct or performance (or a commendation), optionally from an incident. */
peopleRouter.post(
  '/users/:id/conduct-notes',
  requirePermission('reliability.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    if (userId === a.userId) throw forbidden('You cannot write a note about yourself.');
    const body = z
      .object({
        category: z.enum(['SAFETY_PROCEDURE', 'POLICY', 'CONDUCT', 'PERFORMANCE', 'COMMENDATION']),
        summary: z.string().trim().min(10).max(2000),
        occurredAt: when,
        incidentId: uuid.nullable().default(null),
      })
      .parse(req.body);
    const id = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId } });
      if (!u || u.anonymizedAt) throw notFound('Staff member');
      if (body.incidentId && !(await tx.incidentReport.findUnique({ where: { id: body.incidentId }, select: { id: true } }))) throw notFound('Incident');
      const n = await tx.conductNote.create({
        data: { tenantId: a.tenantId, userId, recordedById: a.userId, category: body.category, summary: body.summary, occurredAt: new Date(body.occurredAt), incidentId: body.incidentId },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'conduct.note', entity: 'ConductNote', entityId: n.id, after: { category: body.category, incidentId: body.incidentId } });
      await notify(tx, a.tenantId, [{ userId, type: body.category === 'COMMENDATION' ? 'commendation_added' : 'conduct_note_added', link: '/profile' }]);
      return n.id;
    });
    res.status(201).json({ id });
  }),
);

/** Notes are never deleted: a retracted note stays on file with the reason, and stops counting. */
peopleRouter.post(
  '/conduct-notes/:id/retract',
  requirePermission('reliability.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const n = await tx.conductNote.findUnique({ where: { id } });
      if (!n) throw notFound('Note');
      // Not a note about you; outside HR, only notes you wrote yourself.
      if (n.userId === a.userId) throw forbidden('You can’t retract a note about yourself.');
      const by = hrRecordsBy(a);
      if (by && n.recordedById !== by) throw forbidden('Only HR, or whoever wrote the note, can retract it.');
      await assertUserInScope(tx, a, n.userId);
      if (n.retractedAt) throw conflict('ALREADY_RETRACTED', 'This note is already retracted.');
      await tx.conductNote.update({ where: { id }, data: { retractedAt: new Date(), retractedReason: reason } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'conduct.retract', entity: 'ConductNote', entityId: id, after: { reason } });
    });
    res.json({ ok: true });
  }),
);
