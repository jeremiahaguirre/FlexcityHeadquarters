/**
 * Leave types (services/people/leaveTypes.ts): everyone signed in reads the organization's list (to
 * request time off); HR (leave.manage) adds and changes the organization's own. System types can be
 * renamed or given a pay code, never removed or changed in how they work.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, notFound } from '../lib/errors.js';
import { chainOf, leaveTypes } from '../services/people/leaveTypes.js';
import { h } from './context.js';

export const leaveTypesRouter = Router();
const uuid = z.string().uuid();

export const leaveTypeOut = (t: Awaited<ReturnType<typeof leaveTypes>>[number]) => ({
  id: t.id,
  code: t.code,
  system: t.system,
  name: t.name,
  nameFr: t.nameFr,
  paid: t.paid,
  hasBalance: t.hasBalance,
  yearlyHours: t.yearlyHours === null ? null : Number(t.yearlyHours),
  carryOverMaxHours: t.carryOverMaxHours === null ? null : Number(t.carryOverMaxHours),
  protectedLeave: t.protectedLeave,
  approvalChain: chainOf(t),
  payCode: t.payCode,
  sortOrder: t.sortOrder,
  archived: !!t.archivedAt,
});

const hours = z.number().min(0).max(2000).nullable();
const editable = z.object({
  name: z.string().trim().min(2).max(80),
  nameFr: z.string().trim().min(2).max(80),
  paid: z.boolean(),
  hasBalance: z.boolean(),
  yearlyHours: hours.default(null),
  carryOverMaxHours: hours.default(null),
  protectedLeave: z.boolean().default(false),
  approvalChain: z.array(z.enum(['MANAGER', 'HR'])).max(2).default([]),
  payCode: z.string().trim().min(1).max(30).nullable().default(null),
  sortOrder: z.number().int().min(0).max(1000).default(100),
  archived: z.boolean().default(false),
});
const codeOf = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'LEAVE';

function checkChain(chain: string[]) {
  if (new Set(chain).size !== chain.length) throw new HttpError(400, 'LEAVE_CHAIN_REPEATS', 'Each approver appears once in the chain.');
}

leaveTypesRouter.get(
  '/leave-types',
  requireFeature('timeOff'),
  h(async (req, res) => {
    const a = authOf(req);
    const all = a.permissions.has('leave.manage') && req.query.archived === 'true';
    const rows = await withTenant(a.tenantId, (tx) => leaveTypes(tx, a.tenantId, { archived: all }));
    res.json({ types: rows.map(leaveTypeOut) });
  }),
);

leaveTypesRouter.post(
  '/settings/leave-types',
  requireFeature('timeOff'),
  requirePermission('leave.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = editable.parse(req.body);
    checkChain(b.approvalChain);
    const row = await withTenant(a.tenantId, async (tx) => {
      const existing = await leaveTypes(tx, a.tenantId, { archived: true });
      if (existing.filter((t) => !t.system).length >= 40) throw new HttpError(400, 'TOO_MANY_LEAVE_TYPES', 'An organization can add up to 40 kinds of leave.');
      let code = codeOf(b.name);
      for (let i = 2; existing.some((t) => t.code === code); i++) code = `${codeOf(b.name).slice(0, 27)}_${i}`;
      const { archived, ...rest } = b;
      const r = await tx.leaveType.create({ data: { ...rest, tenantId: a.tenantId, code, archivedAt: archived ? new Date() : null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'leavetype.create', entity: 'LeaveType', entityId: r.id, after: { code, ...b } });
      return r;
    });
    res.status(201).json({ id: row.id, code: row.code });
  }),
);

/** A system type keeps how it works (paid, balance, protection, approvals): only its names, pay code and order change. */
leaveTypesRouter.patch(
  '/settings/leave-types/:id',
  requireFeature('timeOff'),
  requirePermission('leave.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = editable.parse(req.body);
    checkChain(b.approvalChain);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.leaveType.findUnique({ where: { id } });
      if (!before) throw notFound('Leave type');
      const { archived, ...rest } = b;
      const data = before.system
        ? { name: b.name, nameFr: b.nameFr, payCode: b.payCode, sortOrder: b.sortOrder }
        : { ...rest, archivedAt: archived ? (before.archivedAt ?? new Date()) : null };
      if (before.system && (archived || b.paid !== before.paid || b.hasBalance !== before.hasBalance || b.protectedLeave !== before.protectedLeave || b.approvalChain.length)) {
        throw new HttpError(400, 'LEAVE_TYPE_SYSTEM', 'A built-in kind of leave keeps how it works: change its names, pay code or order only.');
      }
      await tx.leaveType.update({ where: { id }, data });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'leavetype.update', entity: 'LeaveType', entityId: id, before: leaveTypeOut(before), after: b });
    });
    res.json({ ok: true });
  }),
);
