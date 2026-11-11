import { describe, expect, it } from 'vitest';
import { fetchRead } from './retry';

const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : '{}', { status, headers });

function run(answers: Array<Response | Error>, deps: { online?: boolean } = {}) {
  const waits: number[] = [];
  let calls = 0;
  const p = fetchRead(
    async () => {
      const a = answers[Math.min(calls++, answers.length - 1)]!;
      if (a instanceof Error) throw a;
      return a;
    },
    { sleep: async (ms) => void waits.push(ms), random: () => 1, online: () => deps.online ?? true },
  );
  return { p, waits, calls: () => calls };
}

describe('fetchRead', () => {
  it('returns at once when the answer is fine or a plain client error', async () => {
    for (const status of [200, 204, 400, 401, 403, 404, 409, 500]) {
      const r = run([res(status)]);
      expect((await r.p).status).toBe(status);
      expect(r.calls()).toBe(1);
    }
  });

  it('rides out a brief overload: 503, then 502, then the answer', async () => {
    const r = run([res(503), res(502), res(200)]);
    expect((await r.p).status).toBe(200);
    expect(r.waits).toEqual([500, 1500]);
  });

  it('honours Retry-After up to 5 seconds', async () => {
    const r = run([res(503, { 'retry-after': '2' }), res(200)]);
    expect((await r.p).status).toBe(200);
    expect(r.waits).toEqual([2000]);
    const long = run([res(503, { 'retry-after': '60' }), res(200)]);
    await long.p;
    expect(long.waits).toEqual([5000]);
  });

  it('gives up after two more tries and returns the last answer', async () => {
    const r = run([res(504), res(504), res(504), res(200)]);
    expect((await r.p).status).toBe(504);
    expect(r.calls()).toBe(3);
  });

  it('retries a 429 only when asked to wait a few seconds', async () => {
    const short = run([res(429, { 'retry-after': '1' }), res(200)]);
    expect((await short.p).status).toBe(200);
    const long = run([res(429, { 'retry-after': '3600' })]);
    expect((await long.p).status).toBe(429);
    expect(long.calls()).toBe(1);
    const none = run([res(429)]);
    expect((await none.p).status).toBe(429);
  });

  it('retries a dropped connection, but fails at once when the phone is offline', async () => {
    const r = run([new TypeError('Failed to fetch'), res(200)]);
    expect((await r.p).status).toBe(200);
    const offline = run([new TypeError('Failed to fetch')], { online: false });
    await expect(offline.p).rejects.toThrow('Failed to fetch');
    expect(offline.calls()).toBe(1);
  });

  it('spreads retries with jitter (between half and all of the base wait)', async () => {
    const waits: number[] = [];
    await fetchRead(async () => (waits.length ? res(200) : res(503)), { sleep: async (ms) => void waits.push(ms), random: () => 0 });
    expect(waits).toEqual([250]);
  });
});
