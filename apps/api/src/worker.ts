/**
 * Background worker: run alongside the API (one or more instances).
 *   node dist/worker.js
 * Each job takes a Postgres advisory lock, so two workers never run the same job at once. Session
 * advisory locks are re-entrant, so a job still running when its next round starts in this same
 * process is skipped here too (`running`), not run twice.
 *
 * Domain events (lib/outbox.ts) are delivered every few seconds without a lock: claiming with
 * SKIP LOCKED already keeps any number of workers and API processes from delivering one twice.
 */
import pg from 'pg';
import { computeBenchmarks } from './services/platform/benchmarks.js';
import { config } from './config.js';
import { db, tenantIds, withTenant } from './lib/db.js';
import { anonymizeDue, certificationReminders, accommodationReviews, detectNoShows, flagForReview, forgottenClockOuts, onboardingReminders, rotationAlerts, recomputeReliability } from './services/jobs/daily.js';
import { loneWorkChecks } from './services/safety/loneWork.js';
import { callOutTimeouts } from './services/winter/callOuts.js';
import { patrolReminders } from './services/winter/patrols.js';
import { coverageAlerts } from './services/coverage/gaps.js';
import { injuryReminders } from './routes/injury.js';
import { ConsoleMailer, deliverOutbox } from './services/notifications/mailer.js';
import { deliverSms, smsSender } from './services/notifications/sms.js';
import { sendScheduledReports } from './services/reports/scheduled.js';
import { captureError, installProcessHandlers } from './lib/errorReporter.js';
import { WORKER_APP_NAME, workerBeatName } from './lib/health.js';
import { applyRetention } from './services/privacy/retention.js';
import { deliverPush } from './services/notifications/push.js';
import { dispatchAll } from './lib/outbox.js';

const cfg = config();
installProcessHandlers();
// The connection's application_name doubles as the worker's heartbeat (lib/health.ts, /readyz).
const lockClient = new pg.Client({ connectionString: cfg.APP_DATABASE_URL, application_name: `${WORKER_APP_NAME} starting` });
await lockClient.connect();

/** After each round of jobs: "fh-worker beat=<unix seconds>", which /readyz and /metrics read. */
async function heartbeat() {
  await lockClient.query("SELECT set_config('application_name', $1, false)", [workerBeatName()]).catch((err) => captureError(err, { source: 'job', tags: { job: 'heartbeat' } }));
}
const mailer = new ConsoleMailer();
const sms = smsSender();

const running = new Set<string>();

async function exclusive(name: string, fn: () => Promise<unknown>) {
  if (running.has(name)) return;
  running.add(name);
  try {
    await locked(name, fn);
  } finally {
    running.delete(name);
  }
}

async function locked(name: string, fn: () => Promise<unknown>) {
  const { rows } = await lockClient.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [`fh-job:${name}`]);
  if (!rows[0]?.ok) return;
  const started = Date.now();
  try {
    const result = await fn();
    // Counts only: a job's result could otherwise carry people's details into the log.
    const counts = typeof result === 'number' ? result : result && typeof result === 'object' ? Object.fromEntries(Object.entries(result).filter(([, v]) => typeof v === 'number')) : '';
    console.log(`[job] ${name} ok in ${Date.now() - started}ms`, counts);
  } catch (err) {
    captureError(err, { source: 'job', tags: { job: name } });
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [`fh-job:${name}`]);
  }
}

async function perTenant(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<number>) {
  let total = 0;
  for (const id of await tenantIds()) total += await withTenant(id, fn, { prisma: db() });
  return total;
}

const minutely = async () => {
  await exclusive('lone-work', () => perTenant((tx) => loneWorkChecks(tx)));
  await exclusive('call-outs', () => perTenant((tx) => callOutTimeouts(tx)));
  await exclusive('rotation-alerts', () => perTenant((tx) => rotationAlerts(tx)));
  await exclusive('email', () => deliverOutbox(db(), mailer));
  await exclusive('sms', () => deliverSms(db(), sms));
  await exclusive('push', () => perTenant((tx) => deliverPush(tx)));
};
const hourly = async () => {
  await exclusive('patrols', () => perTenant((tx) => patrolReminders(tx)));
  await exclusive('coverage', () => perTenant((tx) => coverageAlerts(tx)));
  await exclusive('injury-reports', () => perTenant((tx) => injuryReminders(tx)));
  await exclusive('clock-out', () => perTenant((tx) => forgottenClockOuts(tx)));
  await exclusive('cert-reminders', () => perTenant((tx) => certificationReminders(tx)));
  await exclusive('onboarding-reminders', () => perTenant((tx) => onboardingReminders(tx)));
  await exclusive('accommodation-reviews', () => perTenant((tx) => accommodationReviews(tx)));
  await exclusive('no-shows', () => perTenant((tx) => detectNoShows(tx)));
  await exclusive('reliability', () => perTenant((tx) => recomputeReliability(tx)));
  await exclusive('people-review', () => perTenant((tx) => flagForReview(tx)));
  await exclusive('anonymize', () => perTenant((tx) => anonymizeDue(tx)));
  await exclusive('retention', () => perTenant((tx) => applyRetention(tx)));
  await exclusive('scheduled-reports', () => perTenant((tx) => sendScheduledReports(tx)));
  await exclusive('benchmarks', () => computeBenchmarks(db()));
};

/** Events their API process didn't deliver (it stopped, or delivery failed and is due again). */
let dispatching = false;
const events = async () => {
  if (dispatching) return;
  dispatching = true;
  try {
    const r = await dispatchAll();
    if (r.delivered || r.retried || r.dead) console.log('[job] events', r);
  } catch (err) {
    captureError(err, { source: 'job', tags: { job: 'events' } });
  } finally {
    dispatching = false;
  }
};

await events();
await minutely();
await heartbeat();
await hourly();
setInterval(() => void events(), 5_000);
setInterval(() => void minutely().then(heartbeat), 60_000);
setInterval(() => void hourly(), 60 * 60_000);
console.log('FlexcityHeadquarters worker running');
