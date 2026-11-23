import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_KIND, renderEmail } from '../../src/services/notifications/mailer.js';
import { SesMailer } from '../../src/services/notifications/sesMailer.js';

// As in production: the app address is a template with the organization's subdomain in it.
process.env.PUBLIC_APP_URL = 'https://{subdomain}.flexcityhq.example';

// Every parameter a template might read: a plain value (dates, names and counts alike).
const anyParams = new Proxy({} as Record<string, unknown>, { get: (_t, k) => (typeof k === 'string' && k.startsWith('_') ? undefined : '3') });

describe('links in emails', () => {
  const templates = Object.keys(EMAIL_KIND);

  it('found the templates', () => {
    expect(templates.length).toBeGreaterThan(30);
  });

  it.each(templates)('%s: no {subdomain} placeholder, in either language', (template) => {
    for (const locale of ['en-CA', 'fr-CA']) {
      for (const orgUrl of ['https://lakeview.flexcityhq.example', undefined]) {
        const m = renderEmail(template, locale, anyParams, orgUrl);
        expect(`${m.subject}\n${m.text}`).not.toContain('{subdomain}');
      }
    }
  });

  it('links go to the organization’s own address', () => {
    const m = renderEmail('shift_assigned', 'en-CA', {}, 'https://lakeview.flexcityhq.example');
    expect(m.text).toContain('https://lakeview.flexcityhq.example/schedule');
  });
});

describe('Amazon SES mailer', () => {
  const sent: SendEmailCommand[] = [];
  const client = { send: async (c: SendEmailCommand) => (sent.push(c), { MessageId: 'm-1' }) };

  it('sends text and HTML from the configured sender, with headers and the configuration set', async () => {
    const mailer = new SesMailer(client, 'FlexcityHeadquarters <notices@example.ca>', 'fh-events');
    await mailer.send({ to: 'person@example.ca', subject: 'Votre horaire', text: 'Bonjour', html: '<p>Bonjour</p>', headers: { 'List-Unsubscribe': '<https://example.ca/u>' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.input).toEqual({
      FromEmailAddress: 'FlexcityHeadquarters <notices@example.ca>',
      Destination: { ToAddresses: ['person@example.ca'] },
      Content: {
        Simple: {
          Subject: { Data: 'Votre horaire', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Bonjour', Charset: 'UTF-8' }, Html: { Data: '<p>Bonjour</p>', Charset: 'UTF-8' } },
          Headers: [{ Name: 'List-Unsubscribe', Value: '<https://example.ca/u>' }],
        },
      },
      ConfigurationSetName: 'fh-events',
    });
  });

  it('leaves out what isn’t there (no HTML, no headers, no configuration set)', () => {
    const input = new SesMailer(client, 'notices@example.ca').input({ to: 'a@example.ca', subject: 's', text: 't' });
    expect(input.Content!.Simple!.Body).toEqual({ Text: { Data: 't', Charset: 'UTF-8' } });
    expect(input.Content!.Simple!.Headers).toBeUndefined();
    expect(input.ConfigurationSetName).toBeUndefined();
  });
});

describe('choosing the mailer from the environment', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });
  const load = async (env: Record<string, string>) => {
    vi.resetModules();
    Object.assign(process.env, env);
    return (await import('../../src/services/notifications/sesMailer.js')).mailerFromEnv();
  };

  it('the console mailer by default (development and tests)', async () => {
    delete process.env.MAIL_PROVIDER;
    expect((await load({})).constructor.name).toBe('ConsoleMailer');
  });

  it('SES when asked, in ca-central-1 unless told otherwise; it needs a sender', async () => {
    await expect(load({ MAIL_PROVIDER: 'ses', MAIL_FROM: '' })).rejects.toThrow(/MAIL_FROM/);
    const m = await load({ MAIL_PROVIDER: 'ses', MAIL_FROM: 'notices@example.ca' });
    expect(m.constructor.name).toBe('SesMailer');
    expect(await (m as unknown as { client: { config: { region: () => Promise<string> } } }).client.config.region()).toBe('ca-central-1');
  });
});
