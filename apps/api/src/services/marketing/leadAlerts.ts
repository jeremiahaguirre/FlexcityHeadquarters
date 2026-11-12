/**
 * Website enquiry alerts: one short email per new enquiry to FH's own inbox (LEADS_ALERT_EMAIL, a
 * deployment setting never shown on the site), so a sales or demo request isn't missed between visits
 * to the Dev console.
 *
 * The alert says only what kind of enquiry arrived and when, with a link to the Dev console: the
 * enquirer's name, email, organization and message stay in FH's database in Canada and are not copied
 * into the inbox. Sent before it is marked, so a failed send is retried on the next round (at least
 * once; the worker's job lock keeps two workers from sending the same alert). Unset = nothing is sent
 * and nothing is marked, so alerts start with the enquiries that arrive after it is set (the migration
 * marked earlier ones as alerted, and enquiries older than a week are marked without an email).
 */
import type { PrismaClient } from '@prisma/client';
import { config } from '../../config.js';
import { maskEmail } from '../../lib/log.js';
import type { Mailer } from '../notifications/mailer.js';

const KIND: Record<string, { en: string; fr: string }> = {
  SALES: { en: 'Sales', fr: 'Ventes' },
  DEMO: { en: 'Demo', fr: 'Démonstration' },
  SUPPORT: { en: 'Support', fr: 'Soutien' },
};
const STALE_MS = 7 * 86_400_000;
const CONSOLE = () => (process.env.PLATFORM_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Emails an alert for each enquiry not yet alerted. Returns how many were sent. */
export async function sendLeadAlerts(p: PrismaClient, mailer: Mailer, opts: { to?: string; now?: Date } = {}): Promise<number> {
  const to = opts.to ?? config().LEADS_ALERT_EMAIL;
  if (!to) return 0;
  const now = opts.now ?? new Date();
  // A backlog (e.g. the inbox was unset for a while) is not worth a burst of email: the Dev console lists it.
  await p.lead.updateMany({ where: { alertedAt: null, createdAt: { lt: new Date(now.getTime() - STALE_MS) } }, data: { alertedAt: now } });
  const leads = await p.lead.findMany({ where: { alertedAt: null }, orderBy: { createdAt: 'asc' }, take: 50, select: { id: true, kind: true, createdAt: true } });
  let sent = 0;
  for (const l of leads) {
    const k = KIND[l.kind] ?? { en: l.kind, fr: l.kind };
    const when = l.createdAt.toISOString().replace('T', ' ').slice(0, 16);
    try {
      await mailer.send({
        to,
        subject: `[FH] New website enquiry: ${k.en} / Nouvelle demande : ${k.fr}`,
        text: `A new ${k.en.toLowerCase()} enquiry arrived from the website (${when} UTC).\nUne nouvelle demande (${k.fr.toLowerCase()}) est arrivée du site Web (${when} UTC).\n\nRead it in the Dev console / Lisez-la dans la console : ${CONSOLE()}/platform/enquiries\n`,
      });
    } catch (err) {
      console.warn(`[leads] alert to ${maskEmail(to)} failed; retried next round`, err instanceof Error ? err.name : '');
      break;
    }
    await p.lead.update({ where: { id: l.id }, data: { alertedAt: new Date() } });
    sent++;
  }
  return sent;
}
