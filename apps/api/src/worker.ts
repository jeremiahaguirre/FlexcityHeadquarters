/**
 * Background worker: run alongside the API (one or more instances).
 *   node dist/worker.js
 * Each job takes a Postgres advisory lock, so two workers never run the same job at once.
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
import { logError } from './lib/log.js';
import { applyRetention } from './services/privacy/retention.js';
import { deliverPush } from './services/notifications/push.js';

const cfg = config();
const lockClient = new pg.Client({ connectionString: cfg.APP_DATABASE_URL });
await lockClient.connect();
const mailer = new ConsoleMailer();

async function exclusive(name: string, fn: () => Promise<unknown>) {
  const { rows } = await lockClient.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [`fh-job:${name}`]);
  if (!rows[0]?.ok) return;
  const started = Date.now();
  try {
    const result = await fn();
    // Counts only: a job's result could otherwise carry people's details into the log.
    const counts = typeof result === 'number' ? result : result && typeof result === 'object' ? Object.fromEntries(Object.entries(result).filter(([, v]) => typeof v === 'number')) : '';
    console.log(`[job] ${name} ok in ${Date.now() - started}ms`, counts);
  } catch (err) {
    logError(`job ${name} failed`, err);
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
  await exclusive('benchmarks', () => computeBenchmarks(db()));
};

await minutely();
await hourly();
setInterval(() => void minutely(), 60_000);
setInterval(() => void hourly(), 60 * 60_000);
console.log('FlexcityHeadquarters worker running');
