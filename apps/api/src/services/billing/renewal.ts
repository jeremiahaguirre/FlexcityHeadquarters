/**
 * Renewal reminders: 30 days before a committed term ends, the billing contact gets an email saying
 * the term renews automatically month to month (terms.ts: same rates, no commitment discount), the
 * price, and how and by when to cancel. Transactional, not marketing. A courtesy for business
 * customers that follows Ontario (Consumer Protection Act) and Quebec (Consumer Protection Act)
 * renewal-notice norms for consumer contracts; counsel to confirm (docs/COMPLIANCE.md).
 *
 * Runs hourly from the worker; sends once per term end (an earlier reminder in the outbox for the
 * same organization within the window means it was sent).
 */
import type { PrismaClient } from '@prisma/client';
import { appUrl } from '../../auth/authTokens.js';
import { billingContact } from '../../config.js';
import { db, withTenant } from '../../lib/db.js';
import { estimate } from './invoices.js';

export const RENEWAL_NOTICE_DAYS = 30;
const DAY = 86_400_000;

/** The term's last day (YYYY-MM-DD), or null for month to month. */
export function termEndOf(a: { termStart: Date | null; termMonths: number | null }): string | null {
  if (!a.termStart || !a.termMonths) return null;
  const s = a.termStart;
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + a.termMonths, s.getUTCDate()) - DAY).toISOString().slice(0, 10);
}

/** Due when the term ends within the next 30 days (and hasn't ended). */
export function reminderDue(termEnd: string | null, now: Date): boolean {
  if (!termEnd) return false;
  const left = (Date.parse(`${termEnd}T23:59:59Z`) - now.getTime()) / DAY;
  return left >= 0 && left <= RENEWAL_NOTICE_DAYS;
}

export async function sendRenewalReminders(prisma: PrismaClient = db(), now = new Date()): Promise<number> {
  const accounts = await prisma.billingAccount.findMany({ where: { termStart: { not: null }, termMonths: { not: null } } });
  let sent = 0;
  for (const a of accounts) {
    const termEnd = termEndOf(a);
    if (!reminderDue(termEnd, now)) continue;
    const windowStart = new Date(Date.parse(`${termEnd}T00:00:00Z`) - (RENEWAL_NOTICE_DAYS + 5) * DAY);
    const est = await estimate(a.tenantId, now.toISOString().slice(0, 7));
    sent += await withTenant(a.tenantId, async (tx) => {
      if (await tx.emailOutbox.count({ where: { template: 'renewal_reminder', createdAt: { gte: windowStart } } })) return 0;
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { defaultLocale: true, subdomain: true } });
      const fr = t.defaultLocale.startsWith('fr');
      const years = a.termMonths! % 12 === 0 ? a.termMonths! / 12 : null;
      const money = (c: number) => new Intl.NumberFormat(t.defaultLocale, { style: 'currency', currency: 'CAD' }).format(c / 100);
      await tx.emailOutbox.create({
        data: {
          tenantId: a.tenantId,
          toEmail: a.email,
          template: 'renewal_reminder',
          locale: t.defaultLocale,
          params: {
            organization: a.legalName,
            termEnd,
            termLength: years ? (fr ? `${years} an${years > 1 ? 's' : ''}` : `${years}-year`) : fr ? `${a.termMonths} mois` : `${a.termMonths}-month`,
            discount: est?.term?.discountPercent ?? 0,
            monthly: money(est?.term?.monthlyFixedCents ?? 0),
            contact: billingContact() ?? '',
            url: appUrl(t.subdomain, '/manage/billing'),
          },
        },
      });
      return 1;
    }, { prisma });
  }
  return sent;
}
