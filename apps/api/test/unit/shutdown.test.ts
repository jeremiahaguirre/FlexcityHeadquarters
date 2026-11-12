import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { gracefulServer } from '../../src/lib/shutdown.js';

// ECS replaces a task with SIGTERM: the request in flight must still get its answer, the live
// stream must end (so the browser reconnects elsewhere), and the server must close.
describe('gracefulServer', () => {
  it('finishes the request in flight, ends event streams and closes', async () => {
    let g!: ReturnType<typeof gracefulServer>;
    const server = http.createServer((req, res) => {
      if (req.url === '/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: ready\n\n');
        g.track(res);
        return;
      }
      setTimeout(() => res.end('done'), 300);
    });
    g = gracefulServer(server, 5000);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const stream = await fetch(`http://127.0.0.1:${port}/stream`);
    const streamDone = stream.text();
    const slow = fetch(`http://127.0.0.1:${port}/slow`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    await g.stop();
    expect(await slow).toBe('done');
    expect(await streamDone).toContain('event: ready');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(server.listening).toBe(false);
  });

  it('cuts what is still open after the grace period', async () => {
    const server = http.createServer(() => undefined); // never answers
    const g = gracefulServer(server, 200);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const hung = fetch(`http://127.0.0.1:${port}/`).catch(() => 'cut');
    await new Promise((r) => setTimeout(r, 50));
    await g.stop();
    expect(await hung).toBe('cut');
  });
});
