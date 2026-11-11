import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, errorHandler } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { config } from '../../src/config.js';
import { resetErrorReporter, sent } from '../../src/lib/errorReporter.js';
import { setProbe, workerBeatName } from '../../src/lib/health.js';
import { httpRequests } from '../../src/lib/metrics.js';
import { currentRequestId, requestIdMiddleware } from '../../src/lib/requestContext.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const TOKEN = 'metrics-token-for-tests-0123456789';
let t: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  t = await seedTenant('obsvty', 1);
});
afterEach(() => {
  setProbe(null);
  config().METRICS_TOKEN = undefined;
  resetErrorReporter();
  resetLimits();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('request ids', () => {
  it('gives every request an id, and keeps a well-formed incoming one', async () => {
    const fresh = await request(server).get('/healthz');
    expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await request(server).get('/healthz').set('X-Request-Id', 'lb-trace-0001-abcdef');
    expect(kept.headers['x-request-id']).toBe('lb-trace-0001-abcdef');
    const replaced = await request(server).get('/healthz').set('X-Request-Id', 'bad id <script>');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('puts the request id in error bodies', async () => {
    const r = await request(server).get('/api/public/logo/5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6').set('X-Request-Id', 'support-lookup-123');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'NOT_FOUND', requestId: 'support-lookup-123' });
    const v = await request(server).post('/api/client-errors').send({ kind: 'nope' });
    expect(v.status).toBe(400);
    expect(v.body.requestId).toBe(v.headers['x-request-id']);
  });

  it('reports unexpected errors with the request id, route pattern and no request data, and logs with the id', async () => {
    // The console prefixes lines with the id in context (unit-tested in observability.test.ts): check the error was logged in that context.
    const ids: Array<string | undefined> = [];
    vi.spyOn(console, 'error').mockImplementation(() => void ids.push(currentRequestId()));
    const app = express();
    app.use(requestIdMiddleware, express.json());
    app.post('/api/things/:id', () => {
      throw new Error('could not save for avery@city.ca');
    });
    app.use(errorHandler);
    const r = await request(app).post('/api/things/5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6?q=avery').set('X-Request-Id', 'req-500-abcdefgh').send({ firstName: 'Avery' });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ code: 'INTERNAL', message: 'Something went wrong', requestId: 'req-500-abcdefgh' });
    const report = sent.at(-1)!;
    expect(report.tags).toMatchObject({ source: 'request', request_id: 'req-500-abcdefgh', route: '/api/things/:id', method: 'POST' });
    expect(report.exception.values[0]!.value).toBe('could not save for [email]');
    expect(JSON.stringify(report)).not.toMatch(/avery|Avery|5f0c2a8e/);
    expect(ids).toContain('req-500-abcdefgh');
  });

  it('answers a malformed JSON body as the client’s mistake, not a server error', async () => {
    const r = await request(server).post('/api/client-errors').set('content-type', 'application/json').send('{not json');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BAD_REQUEST');
  });
});

describe('health', () => {
  it('liveness answers without the database', async () => {
    setProbe({ ping: () => Promise.reject(new Error('down')), backlog: () => Promise.reject(new Error('down')), workerAge: () => Promise.reject(new Error('down')) });
    const r = await request(server).get('/healthz');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it('readiness checks the database, the outboxes and the worker', async () => {
    const r = await request(server).get('/readyz');
    expect(r.status).toBe(200);
    expect(r.body.ready).toBe(true);
    expect(r.body.checks.database).toMatchObject({ status: 'ok' });
    expect(r.body.checks.outbox).toMatchObject({ status: 'ok', email: { pending: expect.any(Number), failed: expect.any(Number) }, sms: { pending: expect.any(Number) } });
    // No worker runs during tests: reported, but not fatal unless strict.
    expect(r.body.checks.worker).toMatchObject({ status: 'warn', reason: 'no background worker connected' });
    const strict = await request(server).get('/readyz?strict=1');
    expect(strict.status).toBe(503);
    expect(strict.body.checks.worker.status).toBe('fail');
  });

  it('sees the worker’s heartbeat', async () => {
    const worker = new pg.Client({ connectionString: process.env.APP_DATABASE_URL, application_name: workerBeatName(Date.now() - 30_000) });
    await worker.connect();
    try {
      const r = await request(server).get('/readyz?strict=1');
      expect(r.body.checks.worker).toMatchObject({ status: 'ok' });
      expect(r.body.checks.worker.lastBeatAgeS).toBeGreaterThanOrEqual(29);
      await worker.query("SELECT set_config('application_name', $1, false)", [workerBeatName(Date.now() - 3_600_000)]);
      const stale = await request(server).get('/readyz?strict=1');
      expect(stale.status).toBe(503);
      expect(stale.body.checks.worker.reason).toMatch(/^worker last reported \d+s ago$/);
    } finally {
      await worker.end();
    }
  });

  it('flags an email that has waited too long', async () => {
    const old = await owner.emailOutbox.create({ data: { tenantId: t.tenant.id, toEmail: 'late@obsvty.test', template: 'x', createdAt: new Date(Date.now() - 2 * 3600_000) } });
    try {
      const r = await request(server).get('/readyz');
      expect(r.status).toBe(200);
      expect(r.body.checks.outbox).toMatchObject({ status: 'warn', reason: expect.stringContaining('email waiting longer than') });
      expect(r.body.checks.outbox.oldestAgeS).toBeGreaterThanOrEqual(7200);
      expect(JSON.stringify(r.body)).not.toContain('obsvty');
    } finally {
      await owner.emailOutbox.delete({ where: { id: old.id } });
    }
  });

  it('answers 503 with a reason, and nothing else, when the database is down or slow', async () => {
    setProbe({ ping: () => Promise.reject(new Error('connect ECONNREFUSED postgres://flexcity_app:secret@db:5432')), backlog: () => Promise.reject(new Error('x')), workerAge: () => Promise.reject(new Error('x')) });
    const down = await request(server).get('/readyz');
    expect(down.status).toBe(503);
    expect(down.body).toEqual({
      ready: false,
      checks: {
        database: { status: 'fail', reason: 'database unreachable' },
        outbox: { status: 'warn', reason: 'not checked: database unavailable' },
        worker: { status: 'warn', reason: 'not checked: database unavailable' },
      },
    });
    setProbe({ ping: () => new Promise(() => {}), backlog: () => new Promise(() => {}), workerAge: () => new Promise(() => {}) });
    config().READY_DB_TIMEOUT_MS = 200;
    try {
      const slow = await request(server).get('/readyz');
      expect(slow.status).toBe(503);
      expect(slow.body.checks.database).toEqual({ status: 'fail', reason: 'database timed out' });
    } finally {
      config().READY_DB_TIMEOUT_MS = 1500;
    }
  });
});

describe('metrics', () => {
  it('is off without a token', async () => {
    expect((await request(server).get('/metrics')).status).toBe(404);
  });

  it('needs the bearer token', async () => {
    config().METRICS_TOKEN = TOKEN;
    expect((await request(server).get('/metrics')).status).toBe(401);
    expect((await request(server).get('/metrics').set('Authorization', `Bearer ${TOKEN}x`)).status).toBe(401);
    expect((await request(server).get('/metrics').set('Authorization', TOKEN)).status).toBe(401);
  });

  it('counts requests by route pattern and status class, never by URL', async () => {
    config().METRICS_TOKEN = TOKEN;
    const before = httpRequests.get({ method: 'GET', route: '/api/public/logo/:tenantId', status: '4xx' });
    await request(server).get('/api/public/logo/5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6');
    await request(server).get('/api/public/logo/6f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6');
    await request(server).get('/api/no-such-route/7f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6');
    const r = await request(server).get('/metrics').set('Authorization', `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/plain;.*version=0\.0\.4/);
    expect(httpRequests.get({ method: 'GET', route: '/api/public/logo/:tenantId', status: '4xx' })).toBe(before + 2);
    expect(r.text).toContain('# TYPE fh_http_requests_total counter');
    expect(r.text).toMatch(/fh_http_requests_total\{method="GET",route="\/api\/public\/logo\/:tenantId",status="4xx"\} \d+/);
    expect(r.text).toMatch(/fh_http_request_duration_seconds_bucket\{method="GET",route="\/healthz",status="2xx",le="0.005"\} \d+/);
    expect(r.text).toMatch(/fh_http_requests_total\{method="GET",route="unmatched",status="4xx"\} \d+/);
    expect(r.text).not.toMatch(/[5-7]f0c2a8e/);
    expect(r.text).toMatch(/^fh_outbox_pending\{channel="email"\} \d+$/m);
    expect(r.text).toMatch(/^fh_outbox_oldest_age_seconds\{channel="sms"\} \d+$/m);
    expect(r.text).toMatch(/^fh_worker_connected 0$/m);
    expect(r.text).toMatch(/^fh_process_heap_used_bytes \d+$/m);
    expect(r.text).toMatch(/^fh_event_loop_delay_seconds\{quantile="0.5"\} /m);
    // Every sample line is "name{labels} value".
    for (const line of r.text.split('\n').filter((l) => l && !l.startsWith('#'))) expect(line).toMatch(/^[a-z_]+(\{[^}]*\})? [-+\d.eInfNa]+$/);
  });
});

describe('browser error reports', () => {
  const report = (body: object, ip = '203.0.113.7') => request(server).post('/api/client-errors').set('X-Forwarded-For', ip).set('x-tenant-subdomain', 'obsvty').send(body);

  it('passes a scrubbed report to the reporter, with the organization’s id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await report({
      kind: 'boundary',
      name: 'TypeError',
      message: 'Cannot read properties of undefined (reading avery@city.ca)',
      stack: 'TypeError: x\n    at Profile (https://kelowna.flexcity.ca/_next/static/chunks/app/page-abc.js?token=secretsecret:1:200)',
      route: '/manage/people/5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6',
      release: 'web@1.2.3',
    });
    expect(r.status).toBe(204);
    const sentReport = sent.at(-1)!;
    expect(sentReport).toMatchObject({ platform: 'javascript', logger: 'fh-web', release: 'web@1.2.3', tags: { source: 'client', kind: 'boundary', route: '/manage/people/:id', tenant_id: t.tenant.id } });
    expect(sentReport.exception.values[0]).toMatchObject({ type: 'TypeError', value: 'Cannot read properties of undefined (reading [email])' });
    expect(sentReport.exception.values[0]!.stacktrace!.frames[0]).toMatchObject({ function: 'Profile', filename: 'https://kelowna.flexcity.ca/_next/static/chunks/app/page-abc.js', lineno: 1, colno: 200 });
    expect(JSON.stringify(sentReport)).not.toMatch(/avery|secretsecret|5f0c2a8e/);
  });

  it('limits reports per address', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 20; i++) expect((await report({ kind: 'error', message: `e${i}` }, '198.51.100.9')).status).toBe(204);
    expect((await report({ kind: 'error', message: 'one more' }, '198.51.100.9')).status).toBe(429);
    expect((await report({ kind: 'error', message: 'someone else' }, '198.51.100.10')).status).toBe(204);
  });

  it('refuses oversize or malformed reports', async () => {
    expect((await report({ kind: 'error', message: 'x'.repeat(5000) })).status).toBe(400);
    expect((await report({ message: 'no kind' })).status).toBe(400);
  });
});
