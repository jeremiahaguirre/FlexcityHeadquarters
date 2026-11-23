/**
 * The worker's timetable (worker.ts). Kept apart so the order can be tested.
 *
 * The minute timer (lone-work check-ins, call-outs, urgent texts) is registered before anything
 * slow runs, and the first hourly round starts without being awaited. Before, startup awaited a
 * full hourly round (15+ jobs looping over every organization) before registering any timer, so
 * after each deploy the lone-work checks paused for as long as that round took, a window that
 * grows with every city (ARCHITECTURE-REVIEW A4).
 */
export interface WorkerRounds {
  /** Domain events and the webhooks they queue (safety net behind LISTEN). */
  events: () => Promise<void>;
  /** Urgent texts due for retry, and the overdue-safety alert. */
  urgentSweep: () => Promise<void>;
  /** Lone-work checks, call-outs, outboxes: every minute. */
  minutely: () => Promise<void>;
  /** The worker's heartbeat for /readyz, after each minute round. */
  heartbeat: () => Promise<void>;
  /** Reminders, retention, reports: every hour. */
  hourly: () => Promise<void>;
  /** Trust tests: every five minutes, the first a minute after start. */
  trust: () => Promise<void>;
}

export interface Clock {
  setInterval: (fn: () => void, ms: number) => unknown;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

export const MINUTE = 60_000;

/**
 * Registers every timer, runs the first events and minute rounds (so lone-work checks start at
 * once), then starts the first hourly round in the background. Resolves once the minute round is
 * done; `firstHourly` settles when the hourly round does.
 */
export async function startSchedule(r: WorkerRounds, clock: Clock = globalThis): Promise<{ firstHourly: Promise<void> }> {
  // Safety nets only: new events and urgent texts arrive by LISTEN. These catch retries that come
  // due (backoff) and anything announced while the LISTEN connection was reconnecting.
  clock.setInterval(() => void r.events(), 30_000);
  clock.setInterval(() => void r.urgentSweep(), 30_000);
  clock.setInterval(() => void r.minutely().then(r.heartbeat), MINUTE);
  clock.setInterval(() => void r.hourly(), 60 * MINUTE);
  // Trust tests check every few minutes; the first round waits a minute so readiness sees this worker's heartbeat.
  clock.setTimeout(() => void r.trust(), MINUTE);
  clock.setInterval(() => void r.trust(), 5 * MINUTE);

  await r.events();
  await r.minutely();
  await r.heartbeat();
  // Not awaited: the minute timer above keeps running while this round loops over every organization.
  const firstHourly = r.hourly();
  return { firstHourly };
}
