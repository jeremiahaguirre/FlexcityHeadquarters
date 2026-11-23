import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A process that can't bind its port must stop, not stay up serving nothing (server.ts). Express 5
 * hands the bind error to the listen callback; with WEB_CONCURRENCY > 1 the primary must not re-fork
 * a worker that failed that way, or the task never exits.
 */
let taken: Server;
let port = 0;

beforeAll(async () => {
  taken = createServer();
  await new Promise<void>((r) => taken.listen(0, r)); // every interface, like the API
  port = (taken.address() as AddressInfo).port;
});
afterAll(() => taken.close());

function start(workers: number): Promise<{ code: number | null; output: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, PORT: String(port), WEB_CONCURRENCY: String(workers) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, output });
    }, 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe('the port is already taken', () => {
  it.each([1, 2])('WEB_CONCURRENCY=%i: the API says so and exits 1, never "listening"', async (workers) => {
    const { code, output } = await start(workers);
    expect(code, output).toBe(1);
    expect(output).toContain(`could not listen on :${port}`);
    expect(output).not.toContain('listening on');
    // A worker that failed to bind isn't started again (each one would fail the same way).
    expect(output).not.toContain('starting another');
  }, 30_000);
});
