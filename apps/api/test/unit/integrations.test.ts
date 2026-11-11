import { describe, expect, it } from 'vitest';
import { hashKey, ipAllowed, keyUsable, looksLikeKey, newKey, parseIpEntry } from '../../src/services/integrations/apiKeys.js';
import { hmac, parseSignature, signatureHeader, verifySignature } from '../../src/services/integrations/signing.js';
import { webhookBackoffMs } from '../../src/services/integrations/webhooks.js';

describe('webhook signatures', () => {
  const body = JSON.stringify({ id: 'e1', type: 'person.updated', data: { id: 'p1', changed: ['first_name'] } });
  const t = 1_800_000_000;

  it('signs "<t>.<body>" with HMAC-SHA256, Stripe-style', () => {
    const h = signatureHeader(['whsec_a'], body, t);
    expect(h).toBe(`t=${t},v1=${hmac('whsec_a', t, body)}`);
    expect(hmac('whsec_a', t, body)).toMatch(/^[0-9a-f]{64}$/);
    expect(parseSignature(h)).toEqual({ t, v1: [hmac('whsec_a', t, body)] });
  });

  it('verifies the right secret within the tolerance only', () => {
    const h = signatureHeader(['whsec_a'], body, t);
    expect(verifySignature(h, body, 'whsec_a', { now: t + 10 })).toBe(true);
    expect(verifySignature(h, body, 'whsec_b', { now: t + 10 })).toBe(false);
    expect(verifySignature(h, `${body} `, 'whsec_a', { now: t + 10 })).toBe(false);
    // A replay later than five minutes, or a timestamp from the future, is refused.
    expect(verifySignature(h, body, 'whsec_a', { now: t + 301 })).toBe(false);
    expect(verifySignature(h, body, 'whsec_a', { now: t - 301 })).toBe(false);
    // Changing the timestamp breaks the signature.
    expect(verifySignature(h.replace(`t=${t}`, `t=${t + 5}`), body, 'whsec_a', { now: t + 5 })).toBe(false);
  });

  it('during a rotation, either secret verifies', () => {
    const h = signatureHeader(['whsec_new', 'whsec_old'], body, t);
    expect(h.split(',')).toHaveLength(3);
    expect(verifySignature(h, body, 'whsec_new', { now: t })).toBe(true);
    expect(verifySignature(h, body, 'whsec_old', { now: t })).toBe(true);
  });

  it('refuses malformed headers', () => {
    for (const h of ['', 't=,v1=', 'v1=abc', `t=${t}`, `t=abc,v1=${'0'.repeat(64)}`]) expect(verifySignature(h, body, 'whsec_a', { now: t })).toBe(false);
  });
});

describe('API keys', () => {
  it('look like fh_live_<id>_<secret>, and only the hash identifies them', () => {
    const k = newKey();
    expect(looksLikeKey(k.key)).toBe(true);
    expect(k.key.startsWith(`${k.prefix}_`)).toBe(true);
    expect(k.hash).toBe(hashKey(k.key));
    expect(k.hash).not.toContain(k.key.slice(17));
    expect(newKey().key).not.toBe(k.key);
    expect(looksLikeKey('fh_live_short_x')).toBe(false);
  });

  it('parses allow-list entries', () => {
    expect(parseIpEntry('203.0.113.7')).toBe('203.0.113.7');
    expect(parseIpEntry(' 203.0.113.0/24 ')).toBe('203.0.113.0/24');
    expect(parseIpEntry('2001:DB8::/32')).toBe('2001:db8::/32');
    for (const bad of ['203.0.113.0/33', 'example.com', '1.2.3', '10.0.0.0/8/1', '::/129']) expect(parseIpEntry(bad), bad).toBeNull();
  });

  it('checks addresses against the allow list (IPv4-mapped too)', () => {
    expect(ipAllowed([], '8.8.8.8')).toBe(true);
    expect(ipAllowed(['203.0.113.0/24'], '203.0.113.9')).toBe(true);
    expect(ipAllowed(['203.0.113.0/24'], '::ffff:203.0.113.9')).toBe(true);
    expect(ipAllowed(['203.0.113.0/24'], '198.51.100.1')).toBe(false);
    expect(ipAllowed(['2001:db8::/32'], '2001:db8::5')).toBe(true);
    expect(ipAllowed(['203.0.113.7'], undefined)).toBe(false);
  });

  it('a revoked or expired key is unusable', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    expect(keyUsable({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(keyUsable({ revokedAt: now, expiresAt: null }, now)).toBe(false);
    expect(keyUsable({ revokedAt: null, expiresAt: new Date('2026-11-11T11:59:59Z') }, now)).toBe(false);
  });
});

describe('webhook retries', () => {
  it('back off from a minute to a day', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(webhookBackoffMs)).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000, 86_400_000]);
  });
});
