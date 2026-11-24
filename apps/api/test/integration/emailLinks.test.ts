import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsoleMailer, deliverEmailTenant, deliverOutbox, type Mailer } from '../../src/services/notifications/mailer.js';
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

describe('a slow mail service', () => {
  it('a send that outlasts a database transaction is recorded once, not sent again, and other organizations still get their email', async () => {
    const other = await seedTenant('mailinks2', 1);
    await owner.emailOutbox.create({ data: { tenantId: t.tenant.id, toEmail: 'slow@mailinks.test', template: 'shift_assigned', locale: 'en-CA', params: { name: 'Guard0', facility: 'Rec Centre' } } });
    await owner.emailOutbox.create({ data: { tenantId: other.tenant.id, toEmail: 'quick@mailinks2.test', template: 'shift_assigned', locale: 'en-CA', params: { name: 'Guard0', facility: 'Rec Centre' } } });
    const sent: string[] = [];
    // Longer than the 30-second transaction an email used to be sent inside.
    const mailer: Mailer = { send: async (m) => { if (m.to === 'slow@mailinks.test') await new Promise((r) => setTimeout(r, 31_000)); sent.push(m.to); } };
    await expect(deliverOutbox(owner, mailer)).resolves.toBeDefined();
    expect(sent).toEqual(expect.arrayContaining(['slow@mailinks.test', 'quick@mailinks2.test']));
    const slow = await owner.emailOutbox.findFirstOrThrow({ where: { toEmail: 'slow@mailinks.test' } });
    expect(slow).toMatchObject({ attempts: 1, lastError: null, params: {} });
    expect(slow.sentAt).not.toBeNull();
    // The next run (a minute later) doesn't send it again.
    await deliverOutbox(owner, mailer);
    expect(sent.filter((x) => x === 'slow@mailinks.test')).toHaveLength(1);
  }, 120_000);
});
