/**
 * Prometheus metrics, hand-rolled (text exposition format 0.0.4): a few counters and histograms are
 * all the API needs, and no dependency is worth it for that.
 *
 * Labels are kept to small, fixed sets: the route *pattern* ("/api/users/:id"), never the URL, so
 * ids and search terms never reach the metrics store and the series count stays bounded.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;
import type { NextFunction, Request, Response } from 'express';

type Labels = Record<string, string>;

const escapeLabel = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labelText = (l: Labels) => {
  const keys = Object.keys(l);
  return keys.length ? `{${keys.map((k) => `${k}="${escapeLabel(l[k]!)}"`).join(',')}}` : '';
};
const key = (l: Labels) => JSON.stringify(Object.entries(l).sort(([a], [b]) => a.localeCompare(b)));
const num = (n: number) => (Number.isFinite(n) ? String(n) : n > 0 ? '+Inf' : n < 0 ? '-Inf' : 'NaN');

/** No metric grows past this many label sets: anything new after that is counted under "other". */
const MAX_SERIES = 2000;
function capped(seen: Map<string, unknown>, labels: Labels): [string, Labels] {
  const k = key(labels);
  if (seen.has(k) || seen.size < MAX_SERIES) return [k, labels];
  const other = Object.fromEntries(Object.keys(labels).map((n) => [n, 'other']));
  return [key(other), other];
}

export class Counter {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(readonly name: string, readonly help: string) {}
  inc(given: Labels = {}, by = 1): void {
    const [k, labels] = capped(this.values, given);
    const v = this.values.get(k) ?? { labels, value: 0 };
    v.value += by;
    this.values.set(k, v);
  }
  get(labels: Labels = {}): number {
    return this.values.get(key(labels))?.value ?? 0;
  }
  reset(): void {
    this.values.clear();
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) lines.push(`${this.name}${labelText(labels)} ${num(value)}`);
    return lines.join('\n');
  }
}

export class Histogram {
  private values = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();
  constructor(readonly name: string, readonly help: string, readonly buckets: number[]) {}
  observe(given: Labels, value: number): void {
    const [k, labels] = capped(this.values, given);
    const v = this.values.get(k) ?? { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
    this.buckets.forEach((b, i) => {
      if (value <= b) v.counts[i]!++;
    });
    v.sum += value;
    v.count++;
    this.values.set(k, v);
  }
  count(labels: Labels = {}): number {
    return this.values.get(key(labels))?.count ?? 0;
  }
  reset(): void {
    this.values.clear();
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, count } of this.values.values()) {
      this.buckets.forEach((b, i) => lines.push(`${this.name}_bucket${labelText({ ...labels, le: num(b) })} ${counts[i]}`));
      lines.push(`${this.name}_bucket${labelText({ ...labels, le: '+Inf' })} ${count}`);
      lines.push(`${this.name}_sum${labelText(labels)} ${num(sum)}`);
      lines.push(`${this.name}_count${labelText(labels)} ${count}`);
    }
    return lines.join('\n');
  }
}

/** A value read when Prometheus scrapes. */
export interface Gauge {
  name: string;
  help: string;
  samples: Array<{ labels?: Labels; value: number }>;
}
const renderGauge = (g: Gauge) =>
  [`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`, ...g.samples.map((s) => `${g.name}${labelText(s.labels ?? {})} ${num(s.value)}`)].join('\n');

const SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequests = new Counter('fh_http_requests_total', 'HTTP requests answered, by method, route pattern and status class.');
export const httpDuration = new Histogram('fh_http_request_duration_seconds', 'Time to answer HTTP requests, by method, route pattern and status class.', SECONDS);
export const errorsTotal = new Counter('fh_errors_total', 'Errors captured by the error reporter, by where they came from.');
export const publicApiRequests = new Counter('fh_public_api_requests_total', 'Public API (/api/v1) requests, by route pattern and status class (never the key or the organization).');
export const webhookDeliveries = new Counter('fh_webhook_deliveries_total', 'Webhook delivery attempts, by event type and outcome.');
export const dbQueryDuration = new Histogram('fh_db_query_duration_seconds', 'Time the database took per query (Prisma).', [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);

let loopDelay: IntervalHistogram | undefined;
function eventLoop(): IntervalHistogram {
  if (!loopDelay) {
    loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
  }
  return loopDelay;
}

/** Starts sampling event-loop delay now, so the first scrape has something to show. */
export function startProcessMetrics(): void {
  eventLoop();
}

function processGauges(): Gauge[] {
  const mem = process.memoryUsage();
  const loop = eventLoop();
  const gauges: Gauge[] = [
    { name: 'fh_process_resident_memory_bytes', help: 'Resident set size of this process.', samples: [{ value: mem.rss }] },
    { name: 'fh_process_heap_used_bytes', help: 'V8 heap in use.', samples: [{ value: mem.heapUsed }] },
    { name: 'fh_process_heap_total_bytes', help: 'V8 heap allocated.', samples: [{ value: mem.heapTotal }] },
    { name: 'fh_process_uptime_seconds', help: 'How long this process has been running.', samples: [{ value: Math.round(process.uptime()) }] },
    {
      name: 'fh_event_loop_delay_seconds',
      help: 'Event-loop delay since the last scrape (p50, p99, max).',
      samples: [
        { labels: { quantile: '0.5' }, value: loop.percentile(50) / 1e9 },
        { labels: { quantile: '0.99' }, value: loop.percentile(99) / 1e9 },
        { labels: { quantile: '1' }, value: loop.max / 1e9 },
      ],
    },
  ];
  loop.reset();
  return gauges;
}

/** Everything, in Prometheus text format. `extra` are gauges read at scrape time (the outbox backlog). */
export function renderMetrics(extra: Gauge[] = []): string {
  return [httpRequests.render(), httpDuration.render(), errorsTotal.render(), publicApiRequests.render(), webhookDeliveries.render(), dbQueryDuration.render(), ...processGauges().map(renderGauge), ...extra.map(renderGauge)].join('\n\n') + '\n';
}

const pathText = (p: unknown) => (Array.isArray(p) ? p.map(String).join('|') : String(p));
const segments = (p: string) => p.split('/').filter(Boolean);

/**
 * The route pattern a request matched: the mount path plus the route's path ("/api" + "/users/:id").
 * Requests no route matched (404s, refusals before routing) are "unmatched", never their URL.
 *
 * Express restores req.baseUrl as an error leaves a router, so when the answer goes out after an
 * error the mount path is rebuilt from the URL: the segments in front of the ones the route's own
 * path matched. Mount paths here are fixed words ("/api", "/api/platform"); anything that looks
 * like an id is replaced all the same.
 */
export function routePattern(req: Request): string {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  if (!route || route.path === undefined) return 'unmatched';
  const path = pathText(route.path);
  if (req.baseUrl) return `${req.baseUrl}${path}`;
  const url = segments((req.originalUrl ?? req.url ?? '').split('?')[0]!);
  const own = typeof route.path === 'string' && !/[*?(]/.test(path) ? segments(path).length : -1;
  if (own < 0 || own > url.length) return path || '/';
  const mount = url.slice(0, url.length - own).map((s) => (/^[a-z][a-z-]*$/.test(s) ? s : ':param'));
  return `${mount.length ? `/${mount.join('/')}` : ''}${path}` || '/';
}

export const statusClass = (status: number) => `${Math.floor(status / 100)}xx`;

/** Counts and times every request once its answer is sent. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.once('finish', () => {
    const labels = { method: req.method, route: routePattern(req), status: statusClass(res.statusCode) };
    httpRequests.inc(labels);
    httpDuration.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
}
