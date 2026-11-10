import { createApp } from './app.js';
import { config } from './config.js';
import { subscribe } from './lib/events.js';
import { startLiveHub } from './services/notifications/liveHub.js';
import { handleEvent } from './services/notifications/notifier.js';
import { logError } from './lib/log.js';

const cfg = config();

// Domain events → stored notifications (+ queued emails).
subscribe((e) => {
  handleEvent(e).catch((err) => logError(`notification fan-out failed for ${e.type}`, err));
});

await startLiveHub(cfg.APP_DATABASE_URL);

createApp().listen(cfg.PORT, () => {
  console.log(`FlexcityHeadquarters API listening on :${cfg.PORT}`);
});
