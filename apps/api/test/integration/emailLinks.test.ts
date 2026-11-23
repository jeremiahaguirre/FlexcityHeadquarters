import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsoleMailer, deliverEmailTenant } from '../../src/services/notifications/mailer.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const SUB = 'mailinks';
let t: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('links in sent emails', () => {
  it('point at the organization’s own address, never at a {subdomain} placeholder', async () => {
    const to = 'guard0@mailinks.test';
    for (const [template, locale] of [['shift_assigned', 'en-CA'], ['time_off_decided', 'fr-CA'], ['lonework_escalated', 'en-CA']] as const) {
      await owner.emailOutbox.create({ data: { tenantId: t.tenant.id, toEmail: to, template, locale, params: { status: 'APPROVED', name: 'Guard0', facility: 'Rec Centre' } } });
    }
    const mailer = new ConsoleMailer(true);
    const r = await deliverEmailTenant(t.tenant.id, mailer);
    expect(r).toMatchObject({ sent: 3, failed: 0 });
    for (const m of mailer.sent) {
      expect(m.text).not.toContain('{subdomain}');
      expect(m.html ?? '').not.toContain('{subdomain}');
    }
    expect(mailer.sent.find((m) => m.subject.includes('shift'))!.text).toContain(`http://${SUB}.localhost:3000/schedule`);
  });
});
