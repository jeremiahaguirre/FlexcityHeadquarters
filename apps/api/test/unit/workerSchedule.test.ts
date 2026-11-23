import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINUTE, startSchedule, type WorkerRounds } from '../../src/lib/workerSchedule.js';

/** Rounds that count their calls; the hourly round takes `hourlyMs` (a long round over many cities). */
function rounds(hourlyMs: number) {
  const calls = { events: 0, urgentSweep: 0, minutely: 0, heartbeat: 0, hourly: 0, trust: 0 };
  const r: WorkerRounds = {
    events: async () => void calls.events++,
    urgentSweep: async () => void calls.urgentSweep++,
    minutely: async () => void calls.minutely++,
    heartbeat: async () => void calls.heartbeat++,
    hourly: () => {
      calls.hourly++;
      return new Promise((resolve) => setTimeout(resolve, hourlyMs));
    },
    trust: async () => void calls.trust++,
  };
  return { r, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('worker timetable (ARCHITECTURE-REVIEW A4)', () => {
  it('keeps lone-work checks running every minute while the first hourly round is still going', async () => {
    const { r, calls } = rounds(20 * MINUTE);
    void startSchedule(r);
    await vi.advanceTimersByTimeAsync(5 * MINUTE + 1);
    expect(calls.hourly).toBe(1);
    // The first round at start, then one per minute: the slow hourly round blocks none of them.
    expect(calls.minutely).toBe(6);
    expect(calls.heartbeat).toBe(6);
    expect(calls.urgentSweep).toBe(10);
    expect(calls.trust).toBe(2);
  });

  it('runs the first minute round before starting the hourly round, and does not wait for it', async () => {
    const order: string[] = [];
    const { r } = rounds(60 * MINUTE);
    const hourly = r.hourly;
    const s = await startSchedule({
      ...r,
      minutely: async () => void order.push('minutely'),
      hourly: () => (order.push('hourly'), hourly()),
    });
    expect(order).toEqual(['minutely', 'hourly']);
    let settled = false;
    void s.firstHourly.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(settled).toBe(false);
  });

  it('still runs an hourly round every hour', async () => {
    const { r, calls } = rounds(1);
    void startSchedule(r);
    await vi.advanceTimersByTimeAsync(2 * 60 * MINUTE + 1);
    expect(calls.hourly).toBe(3);
  });
});
