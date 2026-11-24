// node --test ops/deploy/   (no dependencies)
// The post-deploy check that decides whether a release stays or is rolled back.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = readFileSync(new URL('./readyz-watch.js', import.meta.url), 'utf8');

/** A fake API whose /readyz answers the given statuses in turn (the last one repeats). */
async function fakeApi(statuses) {
  let i = 0;
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.url);
    res.statusCode = statuses[Math.min(i++, statuses.length - 1)];
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

/** Runs the check as deploy.sh does (`node -e`), returning its exit code. */
function watch(apiUrl, watchMs) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', script], { env: { API_URL: apiUrl, WATCH_MS: String(watchMs), INTERVAL_MS: '20' }, stdio: 'ignore' });
    p.on('exit', (code) => resolve(code));
  });
}

test('staging smoke test: passes as soon as /readyz?strict=1 answers 200', async () => {
  const api = await fakeApi([503, 200]);
  assert.equal(await watch(api.url, 0), 0);
  assert.deepEqual(api.seen, ['/readyz?strict=1', '/readyz?strict=1']);
  api.close();
});

test('fails (and the deployment is rolled back) after three failures in a row', async () => {
  const api = await fakeApi([200, 503, 503, 503]);
  assert.equal(await watch(api.url, 60_000), 1);
  api.close();
});

test('a single failure during the watch is tolerated; it passes if still healthy at the end', async () => {
  const api = await fakeApi([200, 503, 200]);
  assert.equal(await watch(api.url, 200), 0);
  api.close();
});

test('an unreachable API counts as a failure', async () => {
  assert.equal(await watch('http://127.0.0.1:9', 0), 1);
});
