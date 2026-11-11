import { describe, expect, it } from 'vitest';
import { isPlaceholderContact, realContact } from '../../src/config.js';
import { renderEmail } from '../../src/services/notifications/mailer.js';
import { agreementTerms } from '../../src/services/billing/pad.js';

describe('placeholder contact addresses never reach customers', () => {
  it('recognizes empty and example-domain addresses', () => {
    for (const v of ['', ' ', null, undefined, 'billing@flexcityhq.example', 'mailto:support@flexcityhq.example', 'x@example.com', 'X@MAIL.EXAMPLE.ORG']) expect(isPlaceholderContact(v)).toBe(true);
    for (const v of ['billing@flexcityhq.ca', 'help@examples.ca', 'ops@myexample.com']) expect(isPlaceholderContact(v)).toBe(false);
    expect(realContact('billing@flexcityhq.example')).toBeNull();
  });

  it('emails leave the contact line out, or say to reply, when there is no real address', () => {
    const invoice = { number: 'FH-1', organization: 'Town', period: 'a – b', total: '$1', dueDate: 'd', remittance: 'Pay by EFT.', contact: '' };
    for (const l of ['en-CA', 'fr-CA']) {
      expect(renderEmail('invoice', l, invoice).text).not.toMatch(/Questions/);
      expect(renderEmail('invoice', l, { ...invoice, contact: 'billing@fh.ca' }).text).toContain('billing@fh.ca');
      expect(renderEmail('renewal_reminder', l, { organization: 'Town', termLength: '1-year', termEnd: 'e', discount: 5, monthly: '$1', url: 'u', contact: '' }).text).toMatch(/reply to this email|répondez à ce courriel/);
      expect(renderEmail('pad_confirmation', l, { payor: 'Town', payee: 'FH', signer: 's', date: 'd', account: 'a', terms: 't', contact: '' }).text).toMatch(/reply to this email|répondez à ce courriel/);
    }
  });

  it('debit terms name the payee when no address is on file', () => {
    expect(agreementTerms('en-CA', 'FH Inc.', null).join(' ')).toContain('by writing to FH Inc.');
    expect(agreementTerms('fr-CA', 'FH Inc.', 'billing@fh.ca').join(' ')).toContain('en écrivant à billing@fh.ca');
    expect(agreementTerms('en-CA').join(' ')).not.toMatch(/\.example/);
  });
});
