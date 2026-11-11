import cluster from 'node:cluster';
import { createApp } from './app.js';
import { config } from './config.js';
import { subscribe } from './lib/events.js';
import { startLiveHub } from './services/notifications/liveHub.js';
import { handleEvent } from './services/notifications/notifier.js';
import { logError } from './lib/log.js';
import { assertLeastPrivilege } from './lib/dbRole.js';
import { captureError, installProcessHandlers } from './lib/errorReporter.js';

const cfg = config();
// Unhandled rejections and uncaught exceptions are reported (lib/errorReporter.ts).
installProcessHandlers();
// Node serves requests on one core: WEB_CONCURRENCY runs that many worker processes on the same
// port (each with its own DB_POOL_SIZE connections). Containers can also be scaled out instead.
const workers = cfg.WEB_CONCURRENCY;

if (workers > 1 && cluster.isPrimary) {
  await assertLeastPrivilege('APP_DATABASE_URL', cfg.APP_DATABASE_URL, cfg.NODE_ENV === 'production');
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on('exit', (w, code) => {
    logError(`API worker ${w.process.pid} stopped (${code}); starting another`, new Error('worker exit'));
    cluster.fork();
  });
  console.log(`FlexcityHeadquarters API: ${workers} workers on :${cfg.PORT}`);
} else {
  // A subverted query can do no more than the connection's role allows: refuse a powerful one.
  if (workers <= 1) await assertLeastPrivilege('APP_DATABASE_URL', cfg.APP_DATABASE_URL, cfg.NODE_ENV === 'production');

  // Domain events → stored notifications (+ queued emails).
  subscribe((e) => {
    handleEvent(e).catch((err) => captureError(err, { source: 'other', tags: { task: `notify:${e.type}` } }));
  });

  // Each process relays live notifications to its own browsers (pg LISTEN), so this works across workers and instances.
  await startLiveHub(cfg.APP_DATABASE_URL);

  createApp().listen(cfg.PORT, () => {
    console.log(`FlexcityHeadquarters API listening on :${cfg.PORT}${cluster.isWorker ? ` (worker ${process.pid})` : ''}`);
  });
}
