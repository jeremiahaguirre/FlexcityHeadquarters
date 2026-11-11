import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { scrubPath, scrubText, scrubValue } from '../../src/lib/scrub.js';
import { Counter, Histogram, renderMetrics, routePattern, statusClass } from '../../src/lib/metrics.js';
import { REQUEST_ID, currentRequestId, installLogContext, withRequestId } from '../../src/lib/requestContext.js';

// Unit tests have no .env: just enough for config() to parse.
process.env.APP_DATABASE_URL ??= 'postgresql://a@localhost/x';
process.env.JWT_SECRET ??= 'x'.repeat(32);

describe('scrubbing personal information', () => {
  it('replaces emails, SIN-like and card numbers, phones and tokens', () => {
    const out = scrubText(
      'User avery.tremblay@city.ca with SIN 046 454 286 (or 046-454-286), card 4111 1111 1111 1111, phone (250) 555-0100 and 2505550100, ' +
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U, link ?token=abcdef123456 password=hunter2 ' +
        'Authorization: Bearer abc.def.ghi-12345678 key AKIAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    for (const leak of ['avery', 'city.ca', '046', '4111', '555-0100', '2505550100', 'eyJ', 'abcdef123456', 'hunter2', 'abc.def', 'AKIA']) expect(out, leak).not.toContain(leak);
    expect(out).toContain('[email]');
    expect(out).toContain('[number]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[redacted]');
  });

  it('keeps record ids, line numbers and ordinary words', () => {
    const id = '5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6';
    expect(scrubText(`Shift ${id} not found at app.ts:120:15 on 2026-11-11`)).toBe(`Shift ${id} not found at app.ts:120:15 on 2026-11-11`);
  });

  it('drops secret-sounding keys from objects, deeply', () => {
    const out = scrubValue({ headers: { Authorization: 'Bearer x', cookie: 'a=b', accept: 'json' }, user: { email: 'a@b.ca', firstName: 'Avery', role: 'GUARD' }, note: 'call 250-555-0100' });
    expect(out).toEqual({ headers: { Authorization: '[redacted]', cookie: '[redacted]', accept: 'json' }, user: { email: '[redacted]', firstName: '[redacted]', role: 'GUARD' }, note: 'call [phone]' });
  });

  it('turns page paths into patterns without ids or query strings', () => {
    expect(scrubPath('/manage/staff/person?id=5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6&q=avery')).toBe('/manage/staff/person');
    expect(scrubPath('/manage/people/5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6/edit')).toBe('/manage/people/:id/edit');
    expect(scrubPath('/r/avery%40city.ca/2026')).toBe('/r/:id/:id');
  });
});

describe('metrics', () => {
  it('renders counters and histograms in Prometheus text format', () => {
    const c = new Counter('t_requests_total', 'Test requests.');
    c.inc({ route: '/api/a"b', status: '2xx' });
    c.inc({ route: '/api/a"b', status: '2xx' });
    const h = new Histogram('t_duration_seconds', 'Test durations.', [0.1, 1]);
    h.observe({ route: '/x' }, 0.05);
    h.observe({ route: '/x' }, 0.5);
    h.observe({ route: '/x' }, 5);
    expect(c.render()).toBe('# HELP t_requests_total Test requests.\n# TYPE t_requests_total counter\nt_requests_total{route="/api/a\\"b",status="2xx"} 2');
    const text = h.render();
    expect(text).toContain('t_duration_seconds_bucket{route="/x",le="0.1"} 1');
    expect(text).toContain('t_duration_seconds_bucket{route="/x",le="1"} 2');
    expect(text).toContain('t_duration_seconds_bucket{route="/x",le="+Inf"} 3');
    expect(text).toContain('t_duration_seconds_count{route="/x"} 3');
    expect(text).toContain('t_duration_seconds_sum{route="/x"} 5.55');
  });

  it('caps the number of label sets so ids can never blow up the series count', () => {
    const c = new Counter('t_capped_total', 'Capped.');
    for (let i = 0; i < 2100; i++) c.inc({ route: `/r/${i}` });
    expect(c.get({ route: 'other' })).toBe(100);
  });

  it('labels requests by route pattern, never the URL', () => {
    expect(routePattern({ baseUrl: '/api', route: { path: '/users/:id' } } as never)).toBe('/api/users/:id');
    expect(routePattern({ baseUrl: '', url: '/api/nope/123' } as never)).toBe('unmatched');
    // After an error left the router (baseUrl reset): rebuilt from the URL, without ids.
    expect(routePattern({ baseUrl: '', originalUrl: '/api/users/5f0c2a8e/notes/9?x=1', route: { path: '/users/:id/notes/:noteId' } } as never)).toBe('/api/users/:id/notes/:noteId');
    expect(routePattern({ baseUrl: '', originalUrl: '/api/platform/x', route: { path: '/x' } } as never)).toBe('/api/platform/x');
    expect(statusClass(404)).toBe('4xx');
  });

  it('includes process memory and event-loop delay', () => {
    const text = renderMetrics([{ name: 'fh_test_gauge', help: 'A gauge.', samples: [{ labels: { channel: 'email' }, value: 3 }] }]);
    expect(text).toMatch(/^fh_process_resident_memory_bytes \d+$/m);
    expect(text).toMatch(/^fh_event_loop_delay_seconds\{quantile="0.99"\} [\d.e-]+$/m);
    expect(text).toContain('# TYPE fh_test_gauge gauge\nfh_test_gauge{channel="email"} 3');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('request ids in logs', () => {
  it('accepts only well-formed incoming ids', () => {
    expect(REQUEST_ID.test('5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6')).toBe(true);
    expect(REQUEST_ID.test('Root=1-67891233-abcdef012345678912345678')).toBe(false);
    expect(REQUEST_ID.test('abc')).toBe(false);
    expect(REQUEST_ID.test('a\nfake log line'.padEnd(20, 'x'))).toBe(false);
  });

  it('prefixes every console line logged during a request with its id', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    // installLogContext wraps whatever console.error is now (here, the spy).
    installLogContext();
    withRequestId('req-12345678', () => {
      expect(currentRequestId()).toBe('req-12345678');
      console.error('inside', 42);
    });
    console.error('outside');
    spy.mockRestore();
    expect(lines).toContain('[req req-12345678] inside 42');
    expect(lines).toContain('outside');
  });
});

describe('error reporter', () => {
  let server: ReturnType<typeof createServer>;
  const received: Array<{ headers: IncomingMessage['headers']; body: string; url: string }> = [];
  let rep: typeof import('../../src/lib/errorReporter.js');

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body, url: req.url ?? '' });
        res.writeHead(200).end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${(server.address() as AddressInfo).port}/42`;
    vi.resetModules();
    rep = await import('../../src/lib/errorReporter.js');
  });
  afterEach(() => rep.resetErrorReporter());
  afterAll(async () => {
    delete process.env.SENTRY_DSN;
    vi.resetModules();
    await new Promise((r) => server.close(r));
  });

  it('parses a DSN into the envelope address', () => {
    expect(rep.parseDsn('https://abc@o1.ingest.example.ca/7')).toMatchObject({ envelopeUrl: 'https://o1.ingest.example.ca/api/7/envelope/', publicKey: 'abc' });
    expect(rep.parseDsn('https://errors.example.ca/glitch/12')).toBeNull();
    expect(rep.parseDsn('not a url')).toBeNull();
  });

  it('builds a scrubbed report with request id, route, tenant id and a hashed user id', () => {
    const err = Object.assign(new Error('Unique constraint failed for avery@city.ca\n{ data: { firstName: "Avery" } }'), { code: 'P2002' });
    const r = rep.buildReport(err, { source: 'request', requestId: 'req-12345678', route: '/api/users/:id', method: 'PATCH', tenantId: '5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', userId: '11111111-2222-4333-8444-555555555555' });
    const text = JSON.stringify(r);
    expect(text).not.toContain('avery');
    expect(text).not.toContain('Avery');
    expect(text).not.toContain('11111111-2222');
    expect(r.exception.values[0]).toMatchObject({ type: 'Error', value: 'Unique constraint failed for [email]' });
    expect(r.tags).toMatchObject({ source: 'request', request_id: 'req-12345678', route: '/api/users/:id', method: 'PATCH', tenant_id: '5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', code: 'P2002' });
    expect(r.user).toEqual({ id: rep.hashUserId('11111111-2222-4333-8444-555555555555') });
    expect(r.exception.values[0]!.stacktrace!.frames.length).toBeGreaterThan(0);
  });

  it('scrubs raw paths and ignores tenant ids that aren’t ids', () => {
    const r = rep.buildReport(new Error('x'), { source: 'client', route: '/manage/people/5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6?q=avery', tenantId: 'kelowna' });
    expect(r.tags.route).toBe('/manage/people/:id');
    expect(r.tags.tenant_id).toBeUndefined();
  });

  it('sends a Sentry envelope, and holds back identical errors for a minute', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = rep.captureError(new Error('boom for avery@city.ca'), { source: 'job', tags: { job: 'email' } });
    const second = rep.captureError(new Error('boom for avery@city.ca'), { source: 'job', tags: { job: 'email' } });
    const other = rep.captureError(new Error('a different failure'), { source: 'job', tags: { job: 'sms' } });
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toBeUndefined();
    expect(other).toMatch(/^[0-9a-f]{32}$/);
    await vi.waitFor(() => expect(received.length).toBe(2));
    const env = received[0]!;
    expect(env.url).toBe('/api/42/envelope/');
    expect(env.headers['content-type']).toBe('application/x-sentry-envelope');
    expect(env.headers['x-sentry-auth']).toContain('sentry_key=publickey');
    const [header, item, event] = env.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(header.event_id).toBe(first);
    expect(item).toEqual({ type: 'event' });
    expect(event.exception.values[0].value).toBe('boom for [email]');
    expect(event.tags).toMatchObject({ source: 'job', job: 'email' });
    expect(env.body).not.toContain('avery');
    vi.restoreAllMocks();
  });
});
