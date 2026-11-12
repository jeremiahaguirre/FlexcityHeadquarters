import { afterEach, describe, expect, it, vi } from 'vitest';
import { coalescer } from './coalesce';

describe('coalescer', () => {
  afterEach(() => vi.useRealTimers());

  it('folds a burst for one key into one run after the window, and keeps keys apart', () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    const emit = coalescer(250, (k) => runs.push(k));
    for (let i = 0; i < 50; i++) emit('messages');
    emit('receipts');
    expect(runs).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(runs).toEqual(['messages', 'receipts']);
  });

  it('a signal after the run schedules another (nothing is lost)', () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    const emit = coalescer(250, (k) => runs.push(k));
    emit('messages');
    vi.advanceTimersByTime(250);
    emit('messages');
    vi.advanceTimersByTime(100);
    expect(runs).toEqual(['messages']);
    vi.advanceTimersByTime(150);
    expect(runs).toEqual(['messages', 'messages']);
  });
});
