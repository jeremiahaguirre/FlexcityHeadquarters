/** Onboarding: the catalogue, per-position requirements, people's checklists and the employee's own. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { MINORS_SET, checklist, ensureDefaults, recordItem } from '../services/people/onboarding.js';
import { h } from './context.js';
import { peopleWhere } from '../services/people/scope.js';
import { allOf, departmentFilter, departmentQuery } from '../services/people/departmentAdmin.js';

export const onboardingRouter = Router();
onboardingRouter.use(['/onboarding', '/me/onboarding'], requireFeature('onboarding'));
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const perms = (a: ReturnType<typeof authOf>) => ({ hr: a.permissions.has('onboarding.hr'), lead: a.permissions.has('onboarding.lead') });
const anyOnboarding = (a: ReturnType<typeof authOf>) => {
  if (!a.permissions.has('onboarding.hr') && !a.permissions.has('onboarding.lead') && !a.permissions.has('onboarding.configure')) throw forbidden();
};

/** The catalogue with the positions each item is switched on for. */
onboardingRouter.get(
  '/onboarding/items',
  h(async (req, res) => {
    const a = authOf(req);
    anyOnboarding(a);
    const out = await withTenant(a.tenantId, async (tx) => {
      await ensureDefaults(tx, a.tenantId);
      const [items, positions] = await Promise.all([
        tx.onboardingItem.findMany({ where: req.query.all === '1' ? {} : { archivedAt: null }, include: { positions: { select: { positionId: true } } }, orderBy: [{ owner: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
        tx.position.findMany({ select: { id: true, name: true, nameFr: true }, orderBy: { name: 'asc' } }),
      ]);
      return { items: items.map(({ positions: p, ...i }) => ({ ...i, positionIds: p.map((x) => x.positionId) })), positions, minorsSet: MINORS_SET };
    });
    res.json(out);
  }),
);

const itemBody = z.object({
  name: z.string().trim().min(2).max(120),
  nameFr: z.string().trim().max(120).nullable().default(null),
  description: z.string().trim().max(500).nullable().default(null),
  owner: z.enum(['HR', 'SUPERVISOR', 'EMPLOYEE']),
  kind: z.enum(['CHECK', 'TRAINING', 'ACKNOWLEDGEMENT', 'DOCUMENT', 'TASK']),
  allStaff: z.boolean().default(false),
  blocksScheduling: z.boolean().default(false),
  validityMonths: z.number().int().min(1).max(120).nullable().default(null),
  policyText: z.string().trim().max(8000).nullable().default(null),
});

onboardingRouter.post(
  '/onboarding/items',
  requirePermission('onboarding.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = itemBody.parse(req.body);
    const item = await withTenant(a.tenantId, async (tx) => {
      const created = await tx.onboardingItem.create({ data: { ...body, tenantId: a.tenantId, sortOrder: 100 } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'onboarding.item.create', entity: 'OnboardingItem', entityId: created.id, after: body });
      return created;
    });
    res.status(201).json(item);
  }),
);

onboardingRouter.patch(
  '/onboarding/items/:id',
  requirePermission('onboarding.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const body = itemBody.partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.onboardingItem.findUnique({ where: { id } });
      if (!before) throw notFound('Onboarding item');
      const { archived, ...rest } = body;
      await tx.onboardingItem.update({ where: { id }, data: { ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'onboarding.item.update', entity: 'OnboardingItem', entityId: id, before, after: body });
    });
    res.json({ ok: true });
  }),
);

/** The per-position switch: does this position need this item? */
onboardingRouter.put(
  '/onboarding/positions/:positionId',
  requirePermission('onboarding.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const positionId = uuid.parse(req.params.positionId);
    const body = z.object({ itemIds: z.array(uuid).min(1).max(50), required: z.boolean() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.position.findUnique({ where: { id: positionId } }))) throw notFound('Position');
      if (body.required) {
        await tx.positionOnboarding.createMany({ data: body.itemIds.map((itemId) => ({ tenantId: a.tenantId, positionId, itemId })), skipDuplicates: true });
      } else {
        await tx.positionOnboarding.deleteMany({ where: { positionId, itemId: { in: body.itemIds } } });
      }
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'onboarding.position', entity: 'Position', entityId: positionId, after: body });
      if (!body.required) return 0;
      // How many people in this position can no longer be scheduled until HR records the new item(s).
      const blocking = await tx.onboardingItem.findMany({ where: { id: { in: body.itemIds }, blocksScheduling: true }, select: { id: true } });
      if (!blocking.length) return 0;
      const people = await tx.userPosition.findMany({ where: { positionId, user: { status: 'ACTIVE', anonymizedAt: null } }, select: { userId: true } });
      let affected = 0;
      for (const { userId } of people) {
        for (const { id } of blocking) {
          const latest = await tx.onboardingRecord.findFirst({ where: { userId, itemId: id }, orderBy: { recordedAt: 'desc' } });
          if (!latest || (latest.status === 'COMPLETE' && latest.expiresOn && latest.expiresOn < new Date())) {
            affected++;
            break;
          }
        }
      }
      return affected;
    }).then((affected) => res.json({ ok: true, affected }));
    return;
  }),
);

/** People with anything outstanding (or expiring within 30 days), with progress per owner. */
onboardingRouter.get(
  '/onboarding/people',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('onboarding.hr') && !a.permissions.has('onboarding.lead')) throw forbidden();
    const department = departmentQuery.parse(req.query.department);
    const rows = await withTenant(a.tenantId, async (tx) => {
      await ensureDefaults(tx, a.tenantId);
      const users = await tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null, ...allOf(peopleWhere(a.scope), departmentFilter(department)) }, select: { id: true, firstName: true, lastName: true, roles: true, hireDate: true, createdAt: true }, orderBy: [{ lastName: 'asc' }] });
      const out = [];
      for (const u of users) {
        const list = await checklist(tx, u.id);
        const by = (owner: string) => {
          const mine = list.filter((i) => i.owner === owner);
          return { total: mine.length, done: mine.filter((i) => i.state === 'DONE' || i.state === 'WAIVED' || i.state === 'EXPIRING').length };
        };
        const outstanding = list.filter((i) => i.state === 'PENDING' || i.state === 'EXPIRED').length;
        const expiring = list.filter((i) => i.state === 'EXPIRING').length;
        out.push({ id: u.id, name: `${u.firstName} ${u.lastName}`, roles: u.roles, since: u.hireDate ?? u.createdAt, hr: by('HR'), supervisor: by('SUPERVISOR'), employee: by('EMPLOYEE'), outstanding, expiring, blocked: list.some((i) => i.blocksScheduling && (i.state === 'PENDING' || i.state === 'EXPIRED')) });
      }
      return out;
    });
    res.json(rows.sort((x, y) => y.outstanding + y.expiring - (x.outstanding + x.expiring) || x.name.localeCompare(y.name)));
  }),
);

onboardingRouter.get(
  '/onboarding/people/:userId',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('onboarding.hr') && !a.permissions.has('onboarding.lead')) throw forbidden();
    const userId = uuid.parse(req.params.userId);
    const out = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true, firstName: true, lastName: true, anonymizedAt: true } });
      if (!u || u.anonymizedAt) throw notFound('Staff member');
      await ensureDefaults(tx, a.tenantId);
      const p = perms(a);
      const items = (await checklist(tx, userId)).map((i) => ({ ...i, canComplete: p.hr || (i.owner === 'SUPERVISOR' && p.lead), canWaive: p.hr }));
      return { user: { id: u.id, name: `${u.firstName} ${u.lastName}` }, items };
    });
    res.json(out);
  }),
);

const recordBody = z.object({ action: z.enum(['complete', 'waive']), completedOn: isoDate, note: z.string().trim().max(300).nullable().default(null), reason: z.string().trim().max(300).nullable().default(null) });

onboardingRouter.post(
  '/onboarding/people/:userId/items/:itemId',
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.userId);
    const itemId = uuid.parse(req.params.itemId);
    const body = recordBody.parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const r = await recordItem(tx, a.tenantId, a.userId, userId, itemId, body, { ...perms(a), self: userId === a.userId });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: `onboarding.${body.action}`, entity: 'OnboardingRecord', entityId: r.id, after: { userId, itemId, completedOn: body.completedOn } });
    });
    res.json({ ok: true });
  }),
);

/** The employee's own checklist (what's done, what's needed, and policies to read). */
onboardingRouter.get(
  '/me/onboarding',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, async (tx) => {
      await ensureDefaults(tx, a.tenantId);
      return checklist(tx, a.userId);
    }));
  }),
);

/** Acknowledge a policy by typing your name. */
onboardingRouter.post(
  '/me/onboarding/:itemId/acknowledge',
  h(async (req, res) => {
    const a = authOf(req);
    const itemId = uuid.parse(req.params.itemId);
    const { typedName } = z.object({ typedName: z.string().trim().min(2).max(120) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const r = await recordItem(tx, a.tenantId, a.userId, a.userId, itemId, { action: 'complete', completedOn: new Date().toISOString().slice(0, 10), note: `Acknowledged by typing "${typedName}"` }, { hr: false, lead: false, self: true });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'onboarding.acknowledge', entity: 'OnboardingRecord', entityId: r.id, after: { itemId } });
    });
    res.json({ ok: true });
  }),
);

