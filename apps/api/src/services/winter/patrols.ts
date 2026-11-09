/** Patrol routes and whether each is due, during the city's winter season. */
import type { Tx } from '../../lib/db.js';
import { notify, usersWithPermission } from '../notifications/notifier.js';
import { inSeason, parseWinter, winterSettings } from './settings.js';

export async function routeStatus(tx: Tx, now = new Date()) {
  const [routes, settings, facility] = await Promise.all([tx.patrolRoute.findMany({ orderBy: { name: 'asc' } }), winterSettings(tx), tx.facility.findFirst({ select: { timezone: true } })]);
  const season = inSeason(now, settings.season, facility?.timezone);
  const last = await Promise.all(routes.map((r) => tx.patrolRecord.findFirst({ where: { routeId: r.id, endedAt: { not: null } }, orderBy: { endedAt: 'desc' } })));
  return routes.map((r, i) => {
    const l = last[i];
    const due = l?.endedAt ? new Date(l.endedAt.getTime() + r.intervalHours * 3_600_000) : null;
    return { id: r.id, name: r.name, roadClass: r.roadClass, intervalHours: r.intervalHours, active: r.active, lastPatrolAt: l?.endedAt ?? null, dueAt: due, overdue: season && r.active && (!due || due.getTime() + settings.patrols.graceMinutes * 60_000 < now.getTime()), inSeason: season };
  });
}

/** Hourly: tell the people who keep the records which routes are overdue, once per due time. */
export async function patrolReminders(tx: Tx, now = new Date()): Promise<number> {
  const t = await tx.tenant.findFirst({ select: { id: true, features: true, winterSettings: true } });
  if (!t || (t.features as Record<string, unknown>)?.patrols !== true) return 0;
  parseWinter(t.winterSettings);
  const overdue = (await routeStatus(tx, now)).filter((r) => r.overdue);
  if (!overdue.length) return 0;
  const to = await usersWithPermission(tx, t.id, 'winter.records');
  // Once per route per due time: skip routes already reported since they fell due.
  const fresh = [];
  for (const r of overdue) {
    const since = r.dueAt ?? new Date(now.getTime() - 24 * 3_600_000);
    const told = await tx.notification.count({ where: { type: 'patrol_overdue', createdAt: { gte: since }, params: { path: ['route'], equals: r.name } } });
    if (!told) fresh.push(r);
  }
  for (const r of fresh) await notify(tx, t.id, to.map((userId) => ({ userId, type: 'patrol_overdue', params: { route: r.name }, link: '/manage/winter' })));
  return fresh.length;
}
