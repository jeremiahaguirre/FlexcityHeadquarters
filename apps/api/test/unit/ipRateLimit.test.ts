import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { TokenBuckets, enabled, hasCredential, ipRateLimit } from '../../src/lib/ipRateLimit.js';
import { rateLimited } from '../../src/lib/metrics.js';

function app(opts = { authPerMinute: 10, anonPerMinute: 3, failuresPerMinute: 2 }) {
  const a = express();
  a.set('trust proxy', 1);
  a.use(ipRateLimit({ ...opts, force: true }));
  a.get('/healthz', (_q, r) => r.json({ ok: true }));
  a.get('/open', (_q, r) => r.json({ ok: true }));
  a.get('/me', (q, r) => (q.headers.authorization === 'Bearer good' ? r.json({ ok: true }) : r.status(401).json({ code: 'UNAUTHENTICATED' })));
  return a;
}

describe('token buckets', () => {
  it('allow a burst of the per-minute limit, then refill steadily', () => {
    const b = new TokenBuckets(60);
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) expect(b.take('ip', t0)).toBe(0);
    expect(b.take('ip', t0)).toBe(1); // one a second
    expect(b.take('ip', t0 + 1000)).toBe(0);
    expect(b.take('ip2', t0)).toBe(0);
  });
  it('forget idle addresses past the cap', () => {
    const b = new TokenBuckets(10, 100);
    for (let i = 0; i < 150; i++) b.take(`ip${i}`, 0);
    b.take('late', 10 * 60_000);
    expect(b.size).toBeLessThan(150);
  });
});

describe('global per-address limit', () => {
  it('answers 429 RATE_LIMITED with Retry-After past the anonymous budget, per address', async () => {
    const a = app();
    const before = rateLimited.get({ layer: 'global_anon' });
    for (let i = 0; i < 3; i++) expect((await request(a).get('/open').set('X-Forwarded-For', '192.0.2.5')).status).toBe(200);
    const over = await request(a).get('/open').set('X-Forwarded-For', '192.0.2.5');
    expect(over.status).toBe(429);
    expect(over.body.code).toBe('RATE_LIMITED');
    expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(rateLimited.get({ layer: 'global_anon' })).toBe(before + 1);
    expect((await request(a).get('/open').set('X-Forwarded-For', '192.0.2.6')).status).toBe(200);
    expect((await request(a).get('/healthz').set('X-Forwarded-For', '192.0.2.5')).status).toBe(200);
  });

  it('a credential gets the larger budget, until its 401s use up the failure budget', async () => {
    const a = app();
    for (let i = 0; i < 8; i++) expect((await request(a).get('/me').set('X-Forwarded-For', '192.0.2.7').set('Authorization', 'Bearer good')).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await request(a).get('/me').set('X-Forwarded-For', '192.0.2.8').set('Authorization', 'Bearer made-up')).status).toBe(401);
    expect((await request(a).get('/me').set('X-Forwarded-For', '192.0.2.8').set('Authorization', 'Bearer made-up')).status).toBe(429);
  });

  it('is off unless production or GLOBAL_RATE_LIMIT=on', () => {
    const saved = { g: process.env.GLOBAL_RATE_LIMIT, n: process.env.NODE_ENV };
    delete process.env.GLOBAL_RATE_LIMIT;
    process.env.NODE_ENV = 'test';
    expect(enabled()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(enabled()).toBe(true);
    process.env.GLOBAL_RATE_LIMIT = 'off';
    expect(enabled()).toBe(false);
    process.env.NODE_ENV = saved.n;
    if (saved.g === undefined) delete process.env.GLOBAL_RATE_LIMIT;
    else process.env.GLOBAL_RATE_LIMIT = saved.g;
  });

  it('counts calendar feeds, unsubscribe links, kiosk and session cookies as credentialed', () => {
    const req = (path: string, headers: Record<string, string> = {}) => ({ path, headers }) as unknown as express.Request;
    expect(hasCredential(req('/api/calendar/x/y.ics'))).toBe(true);
    expect(hasCredential(req('/api/email/unsubscribe'))).toBe(true);
    expect(hasCredential(req('/api/kiosk', { cookie: 'a=1; fh_kiosk=abc' }))).toBe(true);
    expect(hasCredential(req('/api/auth/refresh', { cookie: 'fc_refresh=abc' }))).toBe(true);
    expect(hasCredential(req('/api/public/jobs', { cookie: 'not_fc_refresh=1' }))).toBe(false);
    expect(hasCredential(req('/api/auth/login'))).toBe(false);
  });
});
