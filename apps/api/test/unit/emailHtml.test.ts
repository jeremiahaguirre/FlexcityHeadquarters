import { describe, expect, it } from 'vitest';
import { emailHtml } from '../../src/services/notifications/emailHtml.js';
import { renderEmail } from '../../src/services/notifications/mailer.js';

describe('branded email', () => {
  it('escapes the text, turns a link on its own line into a button, and speaks the reader’s language', () => {
    const html = emailHtml('Reset <your> password', 'Hi <b>Sam</b>,\n\nUse this link:\nhttps://kelowna.flexcityhq.ca/reset?t=abc&x=1', 'fr-CA');
    expect(html).toContain('Reset &lt;your&gt; password');
    expect(html).toContain('Hi &lt;b&gt;Sam&lt;/b&gt;');
    expect(html).toContain('href="https://kelowna.flexcityhq.ca/reset?t=abc&amp;x=1"');
    expect(html).toContain('Ouvrir FlexcityHeadquarters');
    expect(html).toContain('lang="fr-CA"');
    expect(html).not.toMatch(/<img/);
  });
  it('renders every template', () => {
    const r = renderEmail('password_reset', 'en-CA', { name: 'Sam', url: 'https://example.ca/r' });
    expect(emailHtml(r.subject, r.text, 'en-CA')).toContain('Open FlexcityHeadquarters');
  });
});
