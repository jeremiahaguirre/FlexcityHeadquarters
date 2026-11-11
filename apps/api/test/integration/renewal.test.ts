import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderEmail } from '../../src/services/notifications/mailer.js';
import { reminderDue, sendRenewalReminders, termEndOf } from '../../src/services/billing/renewal.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

let t: Awaited<ReturnType<typeof seedTenant>>;
const DAY = 86_400_000;

beforeAll(async () => {
  t = await seedTenant('renewal', 1);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('renewal reminders', () => {
  it('the term end and the 30-day window', () => {
    expect(termEndOf({ termStart: new Date('2024-01-01'), termMonths: 36 })).toBe('2026-12-31');
    expect(termEndOf({ termStart: null, termMonths: 12 })).toBeNull();
    expect(reminderDue('2026-12-31', new Date('2026-12-02T00:00:00Z'))).toBe(true);
    expect(reminderDue('2026-12-31', new Date('2026-11-20T00:00:00Z'))).toBe(false);
    expect(reminderDue('2026-12-31', new Date('2027-01-01T00:00:00Z'))).toBe(false);
    expect(reminderDue(null, new Date())).toBe(false);
  });

  it('emails the billing contact once, 30 days before the term ends, with the renewal price and how to cancel', async () => {
    const now = new Date();
    // A 12-month term that ends in about 20 days.
    const end = new Date(now.getTime() + 20 * DAY);
    const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate() + 1));
    await owner.billingAccount.create({ data: { tenantId: t.tenant.id, legalName: 'Renewal Town', email: 'billing@renewal.test', province: 'BC', billingCycle: 'ANNUAL', termMonths: 12, termStart: start } });
    expect(await sendRenewalReminders(owner, now)).toBeGreaterThanOrEqual(1);
    expect(await sendRenewalReminders(owner, now)).toBe(0);
    const rows = await owner.emailOutbox.findMany({ where: { tenantId: t.tenant.id, template: 'renewal_reminder' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.toEmail).toBe('billing@renewal.test');
    for (const locale of ['en-CA', 'fr-CA']) {
      const m = renderEmail('renewal_reminder', locale, rows[0]!.params as Record<string, unknown>);
      expect(m.text).toMatch(locale === 'en-CA' ? /renews automatically month to month.*before tax/s : /renouvelle ensuite automatiquement au mois.*avant taxes/s);
      expect(m.text).toContain(String((rows[0]!.params as { termEnd: string }).termEnd));
      expect(m.text).toMatch(/Service message|Message de service/);
      expect(m.text).not.toMatch(/unsubscribe|désabonner/i);
    }
  });
});
