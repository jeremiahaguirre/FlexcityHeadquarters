import { describe, expect, it } from 'vitest';
import { codeMatches, codeOptions, hashCode, maskedEmail, maskedPhone, newCode } from '../../src/services/auth/mfaCodes.js';
import { renderEmail } from '../../src/services/notifications/mailer.js';
import { renderSms } from '../../src/services/notifications/sms.js';

process.env.JWT_SECRET ??= 'unit-test-secret-unit-test-secret-000';

describe('sign-in code destinations are masked', () => {
  it('shows the first letter and the domain of an email', () => {
    expect(maskedEmail('jordan.reid@kelowna.ca')).toBe('j•••@kelowna.ca');
    expect(maskedEmail(' J@Kelowna.CA ')).toBe('j•••@kelowna.ca');
    expect(maskedEmail('not-an-email')).toBe('•••');
  });

  it('shows only the last four digits of a phone number', () => {
    expect(maskedPhone('+12505554267')).toBe('•••-•••-4267');
    expect(maskedPhone('+1 (250) 555-0042')).toBe('•••-•••-0042');
    expect(maskedPhone('')).toBe('•••');
    expect(maskedPhone('+12505554267')).not.toContain('555');
  });

  it('offers a text only to a confirmed number where text alerts are on', () => {
    const u = { email: 'a@b.ca', smsPhone: '+12505554267', smsVerifiedAt: new Date() };
    expect(codeOptions(u, true).map((o) => o.channel)).toEqual(['email', 'sms']);
    expect(codeOptions(u, false).map((o) => o.channel)).toEqual(['email']);
    expect(codeOptions({ ...u, smsVerifiedAt: null }, true).map((o) => o.channel)).toEqual(['email']);
  });
});

describe('sign-in codes', () => {
  it('are six digits', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it('are stored as a keyed hash bound to the row and the person', () => {
    const h = hashCode('row-1', 'user-1', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(codeMatches(h, 'row-1', 'user-1', '123456')).toBe(true);
    expect(codeMatches(h, 'row-1', 'user-1', '123457')).toBe(false);
    expect(codeMatches(h, 'row-2', 'user-1', '123456')).toBe(false);
    expect(codeMatches(h, 'row-1', 'user-2', '123456')).toBe(false);
    expect(codeMatches('abcd', 'row-1', 'user-1', '123456')).toBe(false);
  });

  it('say who they’re for, the expiry and what to do if it wasn’t you, in English and French', () => {
    const p = { code: '042067', name: 'Jordan Reid', organization: 'City of Kelowna' };
    const en = renderEmail('mfa_code', 'en-CA', p).text;
    expect(en).toContain('042067');
    expect(en).toContain('Jordan Reid');
    expect(en).toMatch(/expires in 10 minutes/);
    expect(en).toMatch(/If this wasn't you.*change it now/s);
    const fr = renderEmail('mfa_code', 'fr-CA', p).text;
    expect(fr).toContain('042067');
    expect(fr).toMatch(/expire dans 10 minutes/);
    expect(fr).toMatch(/Si ce n’était pas vous.*changez-le maintenant/s);
    expect(renderSms('mfa_code', 'en-CA', p)).toMatch(/042067 is your sign-in code for City of Kelowna\. It expires in 10 minutes/);
    expect(renderSms('mfa_code', 'fr-CA', p)).toMatch(/042067 est votre code de connexion/);
  });
});
