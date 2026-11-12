/** API entry point: checks the database role, then serves createApp() on one or more processes. */
import cluster from 'node:cluster';
import { createApp } from './app.js';
import { config } from './config.js';
import { attachCacheBus } from './lib/cacheBus.js';
import { sharedListener } from './lib/listen.js';
import { enableInlineDispatch } from './lib/outbox.js';
import { startLiveHub } from './services/notifications/liveHub.js';
import { ConsoleMailer } from './services/notifications/mailer.js';
import { type SmsSender, smsSender } from './services/notifications/sms.js';
import { enableInlineUrgent } from './services/notifications/urgent.js';
import { logError } from './lib/log.js';
import { assertLeastPrivilege } from './lib/dbRole.js';
import { installProcessHandlers } from './lib/errorReporter.js';
import { gracefulServer, setLiveServer } from './lib/shutdown.js';

const cfg = config();
// Unhandled rejections and uncaught exceptions are reported (lib/errorReporter.ts).
installProcessHandlers();
// Node serves requests on one core: WEB_CONCURRENCY runs that many worker processes on the same
// port (each with its own DB_POOL_SIZE connections, plus one LISTEN connection). Containers can
// also be scaled out instead. Processes share nothing in memory: events go through the outbox,
// live notifications and cache invalidation through pg_notify, rate limits through Postgres, and
// scheduled jobs run in the worker under advisory locks. See docs/ARCHITECTURE.md, "Process model".
const workers = cfg.WEB_CONCURRENCY;

if (workers > 1 && cluster.isPrimary) {
  await assertLeastPrivilege('APP_DATABASE_URL', cfg.APP_DATABASE_URL, cfg.NODE_ENV === 'production');
  for (let i = 0; i < workers; i++) cluster.fork();
  let stopping = false;
  cluster.on('exit', (w, code) => {
    if (stopping) {
      if (!Object.keys(cluster.workers ?? {}).length) process.exit(0);
      return;
    }
    logError(`API worker ${w.process.pid} stopped (${code}); starting another`, new Error('worker exit'));
    cluster.fork();
  });
  // Pass ECS's SIGTERM on to the workers, which stop gracefully; exit once they all have.
  process.once('SIGTERM', () => {
    stopping = true;
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill('SIGTERM');
  });
  console.log(`FlexcityHeadquarters API: ${workers} workers on :${cfg.PORT}`);
} else {
  // A subverted query can do no more than the connection's role allows: refuse a powerful one.
  if (workers <= 1) await assertLeastPrivilege('APP_DATABASE_URL', cfg.APP_DATABASE_URL, cfg.NODE_ENV === 'production');

  // Domain events are recorded in the outbox with their change (lib/events.ts); this process
  // delivers its own straight after each commit, and the worker picks up anything left over.
  enableInlineDispatch();
  // Texts, calls and urgent pushes (working alone, help, call-outs) go out straight after the
  // commit that queued them, from this process (services/notifications/urgent.ts); the worker hears
  // a pg_notify too and is the backstop. A text provider set up wrong leaves texts to the worker.
  let sms: SmsSender | null = null;
  try {
    sms = smsSender();
  } catch (err) {
    logError('Texts are left to the worker: the text provider is not set up here', err);
  }
  enableInlineUrgent({ sms, mailer: new ConsoleMailer() });

  // One LISTEN connection per process (lib/listen.ts): live notifications for the browsers whose
  // stream is open here, and cache invalidation from the other processes and instances.
  const listenUrl = cfg.LISTEN_DATABASE_URL ?? cfg.APP_DATABASE_URL;
  attachCacheBus(sharedListener(listenUrl));
  await startLiveHub(listenUrl);

  const server = createApp().listen(cfg.PORT, () => {
    console.log(`FlexcityHeadquarters API listening on :${cfg.PORT}${cluster.isWorker ? ` (worker ${process.pid})` : ''}`);
  });
  // ECS sends SIGTERM when it replaces this task: finish what's in flight, then exit (lib/shutdown.ts).
  const graceful = gracefulServer(server);
  setLiveServer(graceful);
  process.once('SIGTERM', () => {
    console.log(`FlexcityHeadquarters API stopping (SIGTERM)${cluster.isWorker ? ` (worker ${process.pid})` : ''}`);
    void graceful.stop().then(() => process.exit(0));
  });
}
