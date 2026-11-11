/** The schedule builder's manual planner: board, batch eligibility, and the writes a drag and drop makes. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { withTenant } from '../lib/db.js';
import { dispatchSoon, withEvents } from '../lib/events.js';
import { ALL_DEPARTMENTS, NO_DEPARTMENT } from '../services/scheduling/fillRun.js';
import { plannerAssignMany, plannerBoard, plannerCancel, plannerCopy, plannerCreate, plannerEligibility, plannerMove } from '../services/scheduling/planner.js';
import { h } from './context.js';

export const plannerRouter = Router();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const department = z.union([uuid, z.literal(NO_DEPARTMENT), z.literal(ALL_DEPARTMENTS)]);
const range = z.object({ departmentId: department, from: isoDate, to: isoDate, facilityIds: z.array(uuid).max(30).optional() });

plannerRouter.use('/schedule/planner', requirePermission('schedule.write'));

plannerRouter.get(
  '/schedule/planner',
  h(async (req, res) => {
    const a = authOf(req);
    const ids = typeof req.query.facilityIds === 'string' && req.query.facilityIds ? req.query.facilityIds.split(',') : undefined;
    const q = range.parse({ ...req.query, facilityIds: ids });
    res.json(await withTenant(a.tenantId, (tx) => plannerBoard(tx, a, q)));
  }),
);

plannerRouter.post(
  '/schedule/planner/eligibility',
  h(async (req, res) => {
    const a = authOf(req);
    const q = range.extend({ userIds: z.array(uuid).max(400).optional(), shiftIds: z.array(uuid).max(3000).optional(), days: z.boolean().default(false) }).parse(req.body);
    res.json(await withTenant(a.tenantId, (tx) => plannerEligibility(tx, a, q)));
  }),
);

const shiftType = z.enum(['STANDARD', 'CUSTOM', 'MANDATORY']);

plannerRouter.post(
  '/schedule/planner/shifts',
  h(async (req, res) => {
    const a = authOf(req);
    const b = z
      .object({
        facilityId: uuid,
        positionId: uuid,
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        shiftType: shiftType.optional(),
        customTitle: z.string().trim().max(120).nullable().optional(),
        userIds: z.array(uuid).max(30).default([]),
        acknowledgeOvertime: z.boolean().default(false),
      })
      .parse(req.body);
    const out = await withTenant(a.tenantId, (tx) => withEvents(tx, plannerCreate(tx, a, b)));
    dispatchSoon(a.tenantId);
    res.status(201).json({ ids: out.ids });
  }),
);

plannerRouter.post(
  '/schedule/planner/shifts/:id/move',
  h(async (req, res) => {
    const a = authOf(req);
    const b = z
      .object({
        expectedVersion: z.number().int().min(0),
        startsAt: z.coerce.date().optional(),
        endsAt: z.coerce.date().optional(),
        positionId: uuid.optional(),
        facilityId: uuid.optional(),
        userId: uuid.nullable().optional(),
        copy: z.boolean().default(false),
        acknowledgeOvertime: z.boolean().default(false),
      })
      .parse(req.body);
    const out = await withTenant(a.tenantId, (tx) => withEvents(tx, plannerMove(tx, a, uuid.parse(req.params.id), b)));
    dispatchSoon(a.tenantId);
    res.json({ id: out.id, created: out.created });
  }),
);

plannerRouter.post(
  '/schedule/planner/shifts/:id/assign-many',
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ expectedVersion: z.number().int().min(0), userIds: z.array(uuid).min(1).max(30), acknowledgeOvertime: z.boolean().default(false) }).parse(req.body);
    const out = await withTenant(a.tenantId, (tx) => withEvents(tx, plannerAssignMany(tx, a, uuid.parse(req.params.id), b.expectedVersion, b.userIds, b.acknowledgeOvertime)));
    dispatchSoon(a.tenantId);
    res.json({ results: out.results });
  }),
);

plannerRouter.post(
  '/schedule/planner/copy',
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ departmentId: department, facilityIds: z.array(uuid).max(30).optional(), from: isoDate, to: isoDate, days: z.union([z.literal(1), z.literal(7)]), withPeople: z.boolean().default(true) }).parse(req.body);
    res.json(await withTenant(a.tenantId, (tx) => plannerCopy(tx, a, b)));
  }),
);

plannerRouter.post(
  '/schedule/planner/cancel',
  h(async (req, res) => {
    const a = authOf(req);
    const { shiftIds } = z.object({ shiftIds: z.array(uuid).min(1).max(500) }).parse(req.body);
    const out = await withTenant(a.tenantId, (tx) => plannerCancel(tx, a, shiftIds));
    res.json({ cancelled: out.cancelled, kept: out.kept });
  }),
);
