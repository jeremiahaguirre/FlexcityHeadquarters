/**
 * Readiness: can this API server do its work right now?
 *
 *  - database: `SELECT 1` answers within READY_DB_TIMEOUT_MS. Failing it always means 503.
 *  - outbox: the oldest email or text still waiting to go out (outbox_backlog() in db/rls.sql:
 *    counts and an age across organizations, no addresses or ids).
 *  - worker: the background worker's last heartbeat. The worker is its own process; after each
 *    round of jobs it sets its database connection's application_name to "fh-worker beat=<unix s>",
 *    which pg_stat_activity shows to the same role. No table, nothing to clean up, and the beat
 *    disappears when the worker stops.
 *
 * Outbox and worker problems are reported in the body as "warn" but fail the check (503) only in
 * strict mode (READY_STRICT=on, or ?strict=1), because a load balancer using /readyz would
 * otherwise pull every API server out of service when only the worker is down.
 *
 * The answer names checks and reasons only: no hostnames, connection strings, tenant data or errors.
 */
import { config } from '../config.js';
import { db } from './db.js';

export const WORKER_APP_NAME = 'fh-worker';

/** The application_name the worker sets after each round: "fh-worker beat=1731300000". */
export const workerBeatName = (now = Date.now()) => `${WORKER_APP_NAME} beat=${Math.floor(now / 1000)}`;

type Status = 'ok' | 'warn' | 'fail';
export interface Check {
  status: Status;
  reason?: string;
  [k: string]: unknown;
}
export interface Readiness {
  ready: boolean;
  checks: { database: Check; outbox: Check; worker: Check };
}

export interface Backlog {
  channel: string;
  pending: number;
  failed: number;
  oldestAgeS: number;
}

interface Probe {
  ping(): Promise<void>;
  backlog(): Promise<Backlog[]>;
  /** Seconds since the newest worker heartbeat, or null when no worker is connected. */
  workerAge(): Promise<number | null>;
}

const prismaProbe: Probe = {
  async ping() {
    await db().$queryRaw`SELECT 1`;
  },
  async backlog() {
    const rows = await db().$queryRaw<Array<{ channel: string; pending: bigint; failed: bigint; oldest_age_s: number }>>`SELECT * FROM outbox_backlog()`;
    return rows.map((r) => ({ channel: r.channel, pending: Number(r.pending), failed: Number(r.failed), oldestAgeS: Math.round(Number(r.oldest_age_s)) }));
  },
  async workerAge() {
    const rows = await db().$queryRaw<Array<{ beat: bigint | null }>>`
      SELECT max(substring(application_name FROM 'beat=([0-9]+)')::bigint) AS beat
        FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE ${`${WORKER_APP_NAME} %`}`;
    const beat = rows[0]?.beat;
    return beat == null ? null : Math.max(0, Math.round(Date.now() / 1000 - Number(beat)));
  },
};

let probe: Probe = prismaProbe;
/** Tests swap in a probe that simulates a database outage. */
export function setProbe(p: Probe | null): void {
  probe = p ?? prismaProbe;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

const reasonOf = (e: unknown) => (e instanceof Error && e.message === 'timeout' ? 'timed out' : 'unreachable');

/** The last outbox reading, for /metrics (which shouldn't add a query per scrape when /readyz just ran). */
let lastBacklog: { at: number; rows: Backlog[] } | undefined;

export async function outboxBacklog(maxAgeMs = 10_000): Promise<Backlog[]> {
  if (lastBacklog && Date.now() - lastBacklog.at < maxAgeMs) return lastBacklog.rows;
  const rows = await withTimeout(probe.backlog(), config().READY_DB_TIMEOUT_MS);
  lastBacklog = { at: Date.now(), rows };
  return rows;
}

export async function workerHeartbeatAge(): Promise<number | null> {
  return withTimeout(probe.workerAge(), config().READY_DB_TIMEOUT_MS);
}

export async function readiness(opts: { strict?: boolean } = {}): Promise<Readiness> {
  const cfg = config();
  const strict = opts.strict ?? cfg.READY_STRICT === 'on';
  const soft: Status = strict ? 'fail' : 'warn';
  const started = Date.now();

  let database: Check;
  try {
    await withTimeout(probe.ping(), cfg.READY_DB_TIMEOUT_MS);
    database = { status: 'ok', latencyMs: Date.now() - started };
  } catch (e) {
    database = { status: 'fail', reason: `database ${reasonOf(e)}` };
  }

  let outbox: Check;
  let worker: Check;
  if (database.status !== 'ok') {
    outbox = { status: soft, reason: 'not checked: database unavailable' };
    worker = { status: soft, reason: 'not checked: database unavailable' };
  } else {
    const [b, w] = await Promise.allSettled([outboxBacklog(0), workerHeartbeatAge()]);
    if (b.status === 'fulfilled') {
      const oldest = Math.max(0, ...b.value.map((r) => (r.pending ? r.oldestAgeS : 0)));
      const late = b.value.filter((r) => r.pending && r.oldestAgeS > cfg.READY_OUTBOX_MAX_AGE_S).map((r) => r.channel);
      const counts = Object.fromEntries(b.value.map((r) => [r.channel, { pending: r.pending, failed: r.failed, oldestAgeS: r.pending ? r.oldestAgeS : 0 }]));
      outbox = late.length ? { status: soft, reason: `${late.join(' and ')} waiting longer than ${cfg.READY_OUTBOX_MAX_AGE_S}s`, oldestAgeS: oldest, ...counts } : { status: 'ok', oldestAgeS: oldest, ...counts };
    } else {
      outbox = { status: soft, reason: `outbox backlog ${reasonOf(b.reason)}` };
    }
    if (w.status === 'fulfilled') {
      const age = w.value;
      worker =
        age === null
          ? { status: soft, reason: 'no background worker connected' }
          : age > cfg.READY_WORKER_MAX_AGE_S
            ? { status: soft, reason: `worker last reported ${age}s ago`, lastBeatAgeS: age }
            : { status: 'ok', lastBeatAgeS: age };
    } else {
      worker = { status: soft, reason: `worker heartbeat ${reasonOf(w.reason)}` };
    }
  }

  const checks = { database, outbox, worker };
  return { ready: Object.values(checks).every((c) => c.status !== 'fail'), checks };
}
