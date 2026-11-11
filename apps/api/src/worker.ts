/**
 * Background worker: run alongside the API (one or more instances).
 *   node dist/worker.js
 * Each job takes a Postgres advisory lock, so two workers never run the same job at once. Session
 * advisory locks are re-entrant, so a job still running when its next round starts in this same
 * process is skipped here too (`running`), not run twice.
 *
 * Domain events (lib/outbox.ts), then the webhooks they queue (services/integrations/webhooks.ts),
 * are delivered every few seconds without a lock: claiming with
 * SKIP LOCKED already keeps any number of workers and API processes from delivering one twice.
 *
 * Urgent texts, calls and pushes (services/notifications/urgent.ts) go out within a second or two:
 * this process LISTENs on fh_urgent (sent when a transaction that queued one commits, in any API
 * process), delivers after its own jobs' commits, sweeps every few seconds for due retries, and
 * alerts on safety texts still unsent after SAFETY_SMS_ALERT_S. The minute jobs stay as the backstop.
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
import { deliverAllWebhooks } from './services/integrations/webhooks.js';
import { refreshWeather } from './services/ops/weather.js';
import { sharedListener } from './lib/listen.js';
import { runMonitors, pruneTrustHistory } from './services/trust/monitors.js';
import { snapshot } from './services/trust/posture.js';
import { deliverTrustAlerts, runReminders } from './services/trust/reminders.js';
import { sendRenewalReminders } from './services/billing/renewal.js';
import { ensureTrustSeeded } from './services/trust/seed.js';
import { checkOverdueSafety, enableInlineUrgent, kickUrgent, tenantsWithDueSms, URGENT_CHANNEL } from './services/notifications/urgent.js';

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

// Urgent delivery: after this process's own commits (the lone-work and call-out jobs), and on
// every fh_urgent NOTIFY from any API process. Claimed with SKIP LOCKED, so racing the API is safe.
enableInlineUrgent({ sms, mailer });
/** Organizations with texts due (retries, a NOTIFY lost while LISTEN was reconnecting), then the overdue-safety alert. */
let sweeping = false;
const urgentSweep = async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const id of await tenantsWithDueSms()) kickUrgent(id);
    await checkOverdueSafety();
  } catch (err) {
    captureError(err, { source: 'job', tags: { job: 'urgent-sweep' } });
  } finally {
    sweeping = false;
  }
};
const urgentListener = sharedListener(cfg.LISTEN_DATABASE_URL ?? cfg.APP_DATABASE_URL);
urgentListener.on(URGENT_CHANNEL, (tenantId) => kickUrgent(tenantId));
urgentListener.onReconnect(() => void urgentSweep());
// Without LISTEN the sweep still delivers within a few seconds. Once connected, the listener
// reconnects on its own; a first connection that fails is tried again every 30 s.
const listen = (): Promise<void> =>
  urgentListener.start().catch(async (err) => {
    captureError(err, { source: 'job', tags: { job: 'urgent-listen' } });
    await urgentListener.stop();
    setTimeout(() => void listen(), 30_000).unref();
  });
await listen();

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
  // When each job last ran and finished (WorkerJobRun), for the Trust tests. Never fatal.
  const note = (data: { lastStartedAt?: Date; lastOkAt?: Date; lastErrorAt?: Date; lastDurationMs?: number }) =>
    db().workerJobRun.upsert({ where: { name }, create: { name, ...data }, update: data }).catch(() => undefined);
  await note({ lastStartedAt: new Date(started) });
  try {
    const result = await fn();
    await note({ lastOkAt: new Date(), lastDurationMs: Date.now() - started });
    // Counts only: a job's result could otherwise carry people's details into the log.
    const counts = typeof result === 'number' ? result : result && typeof result === 'object' ? Object.fromEntries(Object.entries(result).filter(([, v]) => typeof v === 'number')) : '';
    console.log(`[job] ${name} ok in ${Date.now() - started}ms`, counts);
  } catch (err) {
    await note({ lastErrorAt: new Date(), lastDurationMs: Date.now() - started });
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
  await exclusive('renewal-reminders', () => sendRenewalReminders(db()));
  await exclusive('benchmarks', () => computeBenchmarks(db()));
  await exclusive('trust-reminders', () => runReminders(db()));
  await exclusive('trust-prune', () => pruneTrustHistory(db()));
  // Each distinct forecast site every WEATHER_REFRESH_HOURS (3 by default); failures are recorded, never fatal.
  await exclusive('weather', () => refreshWeather());
};

/** Events their API process didn't deliver (it stopped, or delivery failed and is due again). */
let dispatching = false;
const events = async () => {
  if (dispatching) return;
  dispatching = true;
  try {
    const r = await dispatchAll();
    if (r.delivered || r.retried || r.dead) console.log('[job] events', r);
    // Then the webhooks those events queued (and retries that are due). Claimed with SKIP LOCKED.
    const w = await deliverAllWebhooks();
    if (w.sent || w.failed) console.log('[job] webhooks', w);
  } catch (err) {
    captureError(err, { source: 'job', tags: { job: 'events' } });
  } finally {
    dispatching = false;
  }
};

/** Trust tests (each on its own frequency), an hourly posture snapshot, then any new alert emails. */
const trust = async () => {
  await exclusive('trust-tests', async () => {
    const ran = await runMonitors();
    await snapshot(db());
    return ran.length;
  });
  await exclusive('trust-alerts', () => deliverTrustAlerts(db(), mailer));
};

await ensureTrustSeeded(db()).catch((err) => captureError(err, { source: 'job', tags: { job: 'trust-seed' } }));
await events();
await minutely();
await heartbeat();
await hourly();
setInterval(() => void events(), 5_000);
setInterval(() => void urgentSweep(), 5_000);
setInterval(() => void minutely().then(heartbeat), 60_000);
setInterval(() => void hourly(), 60 * 60_000);
// Trust tests check every few minutes; the first round waits a minute so readiness sees this worker's heartbeat.
setTimeout(() => void trust(), 60_000);
setInterval(() => void trust(), 5 * 60_000);
console.log('FlexcityHeadquarters worker running');
