// Run inside the VPC by ops/deploy/deploy.sh, as a one-off task from the web task definition
// (`node -e`, so no import or require): checks the API's /readyz?strict=1 (database, outbox, worker
// heartbeat) every 30 s (INTERVAL_MS). WATCH_MS=0: exits 0 as soon as it passes once. Otherwise keeps checking
// for WATCH_MS and exits 0 if it still passes then. Three failures in a row: exits 1 (rollback).
const url = `${process.env.API_URL}/readyz?strict=1`;
const watchMs = Number(process.env.WATCH_MS || 0);
const intervalMs = Number(process.env.INTERVAL_MS || 30000);
const until = Date.now() + watchMs;
let failures = 0;
(async () => {
  for (;;) {
    let ok = false;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      ok = r.ok;
      console.log(`readyz ${r.status} ${(await r.text()).slice(0, 300)}`);
    } catch (e) {
      console.log(`readyz unreachable: ${e && e.message}`);
    }
    failures = ok ? 0 : failures + 1;
    if (failures >= 3) process.exit(1);
    if (ok && Date.now() >= until) process.exit(0);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
})();
