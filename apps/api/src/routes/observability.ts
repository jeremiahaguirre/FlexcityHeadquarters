/**
 * Operations endpoints, outside /api and without a session:
 *   GET /healthz  liveness: the process answers. Touches nothing else, so it's cheap enough to poll every second.
 *   GET /readyz   readiness: the database answers, the outboxes are moving, the worker reports in (lib/health.ts).
 *   GET /metrics  Prometheus metrics, with `Authorization: Bearer <METRICS_TOKEN>`; 404 when no token is configured.
 * And, for the web app:
 *   POST /api/client-errors  a browser's error report (window errors, unhandled rejections, error
 *   boundaries), scrubbed and passed to the same reporter. Limited per IP address.
 */
import { addressKey } from '../lib/address.js';
import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { allow } from '../auth/rateLimit.js';
import { config } from '../config.js';
import { captureError } from '../lib/errorReporter.js';
import { HttpError } from '../lib/errors.js';
import { outboxBacklog, readiness, workerHeartbeatAge } from '../lib/health.js';
import { renderMetrics, type Gauge } from '../lib/metrics.js';
import { lookupTenant, subdomainOf } from './context.js';

export const opsRouter = Router();

opsRouter.get('/healthz', (_req, res) => res.json({ ok: true }));

opsRouter.get('/readyz', async (req, res, next) => {
  try {
    const result = await readiness({ strict: req.query.strict === '1' ? true : undefined });
    res.status(result.ready ? 200 : 503).json(result);
  } catch (e) {
    next(e);
  }
});

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

opsRouter.get('/metrics', async (req, res, next) => {
  try {
    const token = config().METRICS_TOKEN;
    if (!token) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    const header = req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ') || !tokenMatches(header.slice(7), token)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
      throw new HttpError(401, 'UNAUTHENTICATED', 'Metrics need the metrics token');
    }
    // Read at scrape time; when the database is down the gauges are left out rather than failing the scrape.
    const extra: Gauge[] = [];
    const [backlog, worker] = await Promise.allSettled([outboxBacklog(), workerHeartbeatAge()]);
    extra.push({ name: 'fh_database_up', help: 'Whether the outbox and worker queries answered (1) or not (0).', samples: [{ value: backlog.status === 'fulfilled' ? 1 : 0 }] });
    if (backlog.status === 'fulfilled') {
      extra.push(
        { name: 'fh_outbox_pending', help: 'Emails and texts waiting to be sent.', samples: backlog.value.map((r) => ({ labels: { channel: r.channel }, value: r.pending })) },
        { name: 'fh_outbox_failed', help: 'Emails and texts that gave up after 5 attempts and are still unsent.', samples: backlog.value.map((r) => ({ labels: { channel: r.channel }, value: r.failed })) },
        { name: 'fh_outbox_oldest_age_seconds', help: 'How long the oldest waiting email or text has waited.', samples: backlog.value.map((r) => ({ labels: { channel: r.channel }, value: r.pending ? r.oldestAgeS : 0 })) },
      );
    }
    if (worker.status === 'fulfilled') {
      extra.push({ name: 'fh_worker_connected', help: 'Whether a background worker is connected to the database.', samples: [{ value: worker.value === null ? 0 : 1 }] });
      if (worker.value !== null) extra.push({ name: 'fh_worker_heartbeat_age_seconds', help: 'Seconds since a background worker last finished a round of jobs.', samples: [{ value: worker.value }] });
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(renderMetrics(extra));
  } catch (e) {
    next(e);
  }
});

const clientError = z.object({
  /** window.onerror, an unhandled promise rejection, or a React error boundary. */
  kind: z.enum(['error', 'unhandledrejection', 'boundary']),
  name: z.string().max(100).optional(),
  message: z.string().max(1000),
  stack: z.string().max(8000).optional(),
  /** The page's path (the browser sends it with ids already replaced; it's scrubbed again here). */
  route: z.string().max(300).optional(),
  release: z.string().max(100).optional(),
  /** Next.js's digest for server-rendered errors. */
  digest: z.string().max(100).optional(),
});

export const clientErrorsRouter = Router();

clientErrorsRouter.post('/client-errors', async (req, res, next) => {
  try {
    // Per address: 20 a minute is plenty for a browser in trouble, and keeps anyone from flooding the reporter.
    if (!(await allow(`client-error:${addressKey(req.ip)}`, 20, 60_000))) {
      res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many reports', requestId: req.id });
      return;
    }
    const body = clientError.parse(req.body);
    // The organization's id when the page was one of theirs (the Dev console has none). No user: the report carries no session.
    const sub = subdomainOf(req);
    const tenant = sub ? await lookupTenant(sub).catch(() => null) : null;
    const err = Object.assign(new Error(body.message), { name: body.name || 'Error' });
    captureError(err, {
      source: 'client',
      route: body.route,
      requestId: req.id,
      tenantId: tenant?.id,
      stack: body.stack ?? '',
      tags: { kind: body.kind, ...(body.release ? { release: body.release } : {}), ...(body.digest && /^[\w-]+$/.test(body.digest) ? { digest: body.digest } : {}) },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
