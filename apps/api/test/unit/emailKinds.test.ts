import { describe, expect, it } from 'vitest';
import { EMAIL_KIND, renderEmail } from '../../src/services/notifications/mailer.js';

/**
 * CASL: every outbox template is transactional (account, safety, payroll, billing, bookings), so it
 * names the sender and carries no unsubscribe link. Commercial email can only go through
 * services/marketing/casl.ts (consent, identification, unsubscribe). A new template that is
 * promotional must not be added here.
 */
describe('email templates', () => {
  it.each(Object.keys(EMAIL_KIND))('%s is transactional and names the sender, in English and French', (k) => {
    expect(EMAIL_KIND[k]).toBe('transactional');
    const params = new Proxy({}, { get: (_t, p) => (p === 'status' ? 'APPROVED' : 'x') });
    expect(renderEmail(k, 'en-CA', params).text).toMatch(/Service message sent by FlexcityHeadquarters/);
    expect(renderEmail(k, 'fr-CA', params).text).toMatch(/Message de service envoyé par FlexcityHeadquarters/);
  });
  it('no template looks promotional', () => {
    const params = new Proxy({}, { get: () => 'x' });
    for (const k of Object.keys(EMAIL_KIND)) expect(renderEmail(k, 'en-CA', params).subject).not.toMatch(/\b(offer|promo|discount|newsletter|upgrade now|sale)\b/i);
  });
});
