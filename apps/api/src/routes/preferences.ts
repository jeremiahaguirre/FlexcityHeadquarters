/**
 * Shift preferences: each person states theirs (prefer/avoid windows, the most hours or days a week
 * they'd like); the schedulers of their department read them. Nobody else, HR included, sees them here.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { userInScope } from '../services/people/scope.js';
import { preferencesBody, readPreferences, replacePreferences } from '../services/scheduling/preferences.js';
import { h } from './context.js';

export const preferencesRouter = Router();
preferencesRouter.use(['/me/preferences', '/users/:id/preferences'], requireFeature('shiftPreferences'));

/** Mine, with the positions I hold and the facilities to choose from. */
preferencesRouter.get(
  '/me/preferences',
  requirePermission('preferences.self'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const [mine, positions, facilities] = await Promise.all([
          readPreferences(tx, a.userId),
          tx.userPosition.findMany({ where: { userId: a.userId }, select: { position: { select: { id: true, name: true, nameFr: true } } } }),
          tx.facility.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        ]);
        return { ...mine, positions: positions.map((p) => p.position), facilities };
      }),
    );
  }),
);

preferencesRouter.put(
  '/me/preferences',
  requirePermission('preferences.self'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = preferencesBody.parse(req.body);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const out = await replacePreferences(tx, a.tenantId, a.userId, body);
        // Counts only: the wishes themselves stay out of the audit log.
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'preferences.update', entity: 'User', entityId: a.userId, after: { prefer: body.preferences.filter((p) => p.kind === 'PREFER').length, avoid: body.preferences.filter((p) => p.kind === 'AVOID').length, maxWeeklyHours: body.maxWeeklyHours !== null, maxDaysPerWeek: body.maxDaysPerWeek !== null } });
        return out;
      }),
    );
  }),
);

/** A person's preferences, for the schedulers of their department (department scope; others read "not found"). */
preferencesRouter.get(
  '/users/:id/preferences',
  requirePermission('schedule.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = z.string().uuid().parse(req.params.id);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        if (!(await userInScope(tx, a.scope, id))) throw notFound('Person');
        if (!(await tx.user.count({ where: { id, anonymizedAt: null } }))) throw notFound('Person');
        return readPreferences(tx, id);
      }),
    );
  }),
);
