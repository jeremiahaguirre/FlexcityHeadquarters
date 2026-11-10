/** Saved reports emailed each week or month, run with the owner's access at the time. */
import { accessOf } from '../../auth/middleware.js';
import type { Tx } from '../../lib/db.js';
import { canRun, runReport, windowFor } from './catalog.js';

const DAY = 86_400_000;
/** Weekly: due a week after the last one. Monthly: once in each calendar month, from the 1st. */
export function due(schedule: 'WEEKLY' | 'MONTHLY', lastSentAt: Date | null, now = new Date()) {
  if (!lastSentAt) return true;
  if (schedule === 'WEEKLY') return now.getTime() - lastSentAt.getTime() >= 7 * DAY - 3_600_000;
  return lastSentAt.getUTCFullYear() !== now.getUTCFullYear() || lastSentAt.getUTCMonth() !== now.getUTCMonth();
}

export async function sendScheduledReports(tx: Tx, now = new Date()): Promise<number> {
  const saved = await tx.savedReport.findMany({ where: { schedule: { in: ['WEEKLY', 'MONTHLY'] } } });
  let sent = 0;
  for (const r of saved) {
    const schedule = r.schedule as 'WEEKLY' | 'MONTHLY';
    if (!due(schedule, r.lastSentAt, now)) continue;
    const owner = await tx.user.findUnique({ where: { id: r.ownerId }, select: { roles: true, email: true, locale: true, status: true } });
    const a = owner && owner.status === 'ACTIVE' ? await accessOf(r.tenantId, r.ownerId, owner.roles) : null;
    // Someone who lost access to a report stops getting it.
    if (!a || !canRun(a, r.reportKey)) {
      await tx.savedReport.update({ where: { id: r.id }, data: { schedule: 'NONE' } });
      continue;
    }
    const w = windowFor(schedule, now);
    const days = Number((r.params as { days?: number }).days ?? 30);
    const out = await runReport(tx, a, r.reportKey, { ...w, days });
    const preview = out.rows.slice(0, 15).map((row) => out.columns.map((c) => row[c] ?? '').join(' · ')).join('\n') + (out.rows.length > 15 ? `\n… (+${out.rows.length - 15})` : '');
    await tx.emailOutbox.create({ data: { tenantId: r.tenantId, toEmail: owner!.email, template: 'report_ready', locale: owner!.locale, params: { name: r.name, from: w.from, to: w.to, count: out.rows.length, preview } } });
    await tx.savedReport.update({ where: { id: r.id }, data: { lastSentAt: now } });
    sent++;
  }
  return sent;
}
