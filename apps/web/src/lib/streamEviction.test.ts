/** A live stream the API closed for being one too many waits before reconnecting (review of #67). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVICTED_WAIT_MS, streamNotifications } from './api';

const sse = (text: string, end: boolean) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        if (end) c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

describe('live stream eviction', () => {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'hidden' as 'hidden' | 'visible',
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  };
  let streams = 0;
  /** How each successive stream goes: closed with `evicted`, closed plainly, or left open. */
  let endings: Array<'evicted' | 'end' | 'open'> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    streams = 0;
    listeners.clear();
    doc.visibilityState = 'hidden';
    vi.stubGlobal('window', { location: { hostname: 'lakeview.example.ca' } });
    vi.stubGlobal('document', doc);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/refresh') return new Response(JSON.stringify({ accessToken: 't' }), { status: 200 });
        if (url === '/api/notifications/stream') {
          const how = endings[streams] ?? 'open';
          streams++;
          return sse(how === 'evicted' ? 'event: ready\ndata: {}\n\nevent: evicted\ndata: {}\n\n' : 'event: ready\ndata: {}\n\n', how !== 'open');
        }
        return new Response('{}', { status: 404 });
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('an evicted hidden tab doesn’t reconnect for 5 minutes, then only once it is visible', async () => {
    endings = ['evicted', 'open'];
    const stop = streamNotifications(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    expect(streams).toBe(1);
    // A plain disconnect would reconnect within 2 s; an evicted stream waits.
    await vi.advanceTimersByTimeAsync(EVICTED_WAIT_MS - 1000);
    expect(streams).toBe(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(streams).toBe(1);
    doc.visibilityState = 'visible';
    for (const fn of [...listeners]) fn();
    await vi.advanceTimersByTimeAsync(10);
    expect(streams).toBe(2);
    stop();
  });

  it('a visible evicted tab still waits out the 5 minutes', async () => {
    endings = ['evicted', 'open'];
    doc.visibilityState = 'visible';
    const stop = streamNotifications(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    expect(streams).toBe(1);
    await vi.advanceTimersByTimeAsync(EVICTED_WAIT_MS - 1000);
    expect(streams).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(streams).toBe(2);
    stop();
  });

  it('a stream that just ends (a deployment, a network change) still reconnects within seconds', async () => {
    endings = ['end', 'open'];
    const stop = streamNotifications(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    expect(streams).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(streams).toBe(2);
    stop();
  });
});
