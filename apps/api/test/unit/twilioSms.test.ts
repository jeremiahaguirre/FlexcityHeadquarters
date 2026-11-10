import { describe, expect, it } from 'vitest';
import { TwilioSms } from '../../src/services/notifications/sms.js';

describe('Twilio sender', () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status: 201 });
  }) as unknown as typeof fetch;
  const tw = new TwilioSms('AC123', 'secret', '+12505550100', fake);

  it('texts through the Messages API with basic auth', async () => {
    await tw.text('+12505550101', 'Hello & bye');
    const c = calls.at(-1)!;
    expect(c.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect((c.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(String(c.init.body)))).toEqual({ To: '+12505550101', From: '+12505550100', Body: 'Hello & bye' });
  });

  it('calls in the person’s language, reading the message twice, with the words escaped', async () => {
    await tw.call('+12505550101', 'Help <now> at "Pool"', 'fr-CA');
    const form = Object.fromEntries(new URLSearchParams(String(calls.at(-1)!.init.body)));
    expect(calls.at(-1)!.url.endsWith('/Calls.json')).toBe(true);
    expect(form.Twiml!.match(/<Say language="fr-CA">Help &lt;now&gt; at &quot;Pool&quot;<\/Say>/g)).toHaveLength(2);
  });

  it('reports a refusal', async () => {
    const bad = new TwilioSms('AC1', 't', '+1', (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch);
    await expect(bad.text('+12505550101', 'x')).rejects.toThrow(/401/);
  });
});
