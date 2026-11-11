/** Weekly shift templates: define a department's standard week, apply it to weeks as drafts, undo an application. */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { announceChange } from '../lib/changes.js';
import { audit, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parseSolverSettings, withSolverSettings } from '../services/scheduling/solverSettings.js';
import { MAX_APPLY_DAYS, applicationView, applyTemplate, assertTemplateInScope, saveTemplate, templateBody, templateView, undoApplication, visibleTemplates } from '../services/scheduling/shiftTemplates.js';
import { h } from './context.js';

export const shiftTemplatesRouter = Router();
shiftTemplatesRouter.use('/schedule/templates', requireFeature('shiftTemplates'), requirePermission('schedule.templates'));
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The templates this person may use (every line in their department scope), recent applications, the org's automatic-drafts switch. */
shiftTemplatesRouter.get(
  '/schedule/templates',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const templates = await visibleTemplates(tx, a);
        const [apps, tenant] = await Promise.all([
          tx.shiftTemplateApplication.findMany({ where: { templateId: { in: templates.map((t) => t.id) } }, orderBy: { createdAt: 'desc' }, take: 60 }),
          tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true } }),
        ]);
        return {
          templates: templates.map(templateView),
          applications: apps.map(applicationView),
          autoCreate: parseSolverSettings(tenant.overtimePolicy).templateAutoCreate,
          canConfigure: a.permissions.has('tenant.configure'),
          maxDays: MAX_APPLY_DAYS,
        };
      }),
    );
  }),
);

/** The organization's switch: the worker keeps templates' next weeks drafted (each template's own number of weeks). */
shiftTemplatesRouter.put(
  '/schedule/templates/settings',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('tenant.configure')) throw forbidden();
    const { autoCreate } = z.object({ autoCreate: z.boolean() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true } });
      const s = parseSolverSettings(t.overtimePolicy);
      await tx.tenant.update({ where: { id: a.tenantId }, data: { overtimePolicy: withSolverSettings(t.overtimePolicy, { ...s, templateAutoCreate: autoCreate }) as Prisma.InputJsonValue } });
      await announceChange(tx, a.tenantId, 'templates');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'shift_template.settings', entity: 'Tenant', entityId: a.tenantId, before: { autoCreate: s.templateAutoCreate }, after: { autoCreate } });
    });
    res.json({ autoCreate });
  }),
);

shiftTemplatesRouter.post(
  '/schedule/templates',
  h(async (req, res) => {
    const a = authOf(req);
    const b = templateBody.parse(req.body);
    res.status(201).json(await withTenant(a.tenantId, async (tx) => {
      const t = await saveTemplate(tx, a, b, null);
      await announceChange(tx, a.tenantId, 'templates');
      return templateView(t);
    }));
  }),
);

shiftTemplatesRouter.put(
  '/schedule/templates/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = templateBody.parse(req.body);
    res.json(await withTenant(a.tenantId, async (tx) => {
      const t = await saveTemplate(tx, a, b, id);
      await announceChange(tx, a.tenantId, 'templates');
      return templateView(t);
    }));
  }),
);

/** Deletes a template. The drafts it made stay (they're ordinary drafts); its applications can no longer be undone. */
shiftTemplatesRouter.delete(
  '/schedule/templates/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const t = await tx.shiftTemplate.findUnique({ where: { id }, include: { slots: true } });
      if (!t) throw notFound('Template');
      await assertTemplateInScope(tx, a, t);
      await tx.shift.updateMany({ where: { templateSlotId: { in: t.slots.map((s) => s.id) } }, data: { templateSlotId: null, templateApplicationId: null } });
      await tx.shiftTemplate.delete({ where: { id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'shift_template.delete', entity: 'ShiftTemplate', entityId: id, before: templateView(t) });
      await announceChange(tx, a.tenantId, 'templates');
    });
    res.json({ ok: true });
  }),
);

/** Applies a template to [from, to) as DRAFT shifts (dryRun = preview counts, nothing written). */
shiftTemplatesRouter.post(
  '/schedule/templates/:id/apply',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ from: isoDate, to: isoDate, dryRun: z.boolean().default(false) }).parse(req.body);
    const r = await withTenant(a.tenantId, async (tx) => {
      const out = await applyTemplate(tx, a, a.tenantId, id, b.from, b.to, { dryRun: b.dryRun });
      if (out.applicationId) await announceChange(tx, a.tenantId, 'templates');
      return out;
    });
    res.json({ ...r, shiftIds: undefined });
  }),
);

/** Undoes a whole application: its drafts still in draft are cancelled; published ones are kept. */
shiftTemplatesRouter.post(
  '/schedule/templates/applications/:id/undo',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, async (tx) => {
      const out = await undoApplication(tx, a, uuid.parse(req.params.id));
      await announceChange(tx, a.tenantId, 'templates');
      return out;
    }));
  }),
);
