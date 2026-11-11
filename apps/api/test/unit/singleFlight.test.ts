import { describe, expect, it } from 'vitest';
import { singleFlight } from '../../src/lib/singleFlight.js';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

describe('singleFlight', () => {
  it('callers who miss at the same moment share one load; later callers start a new one', async () => {
    const f = singleFlight<number>();
    let loads = 0;
    const d = deferred<number>();
    const load = () => (loads++, d.promise);
    const all = Promise.all([f.run('a', load), f.run('a', load), f.run('a', load), f.run('a', load)]);
    expect(loads).toBe(1);
    d.resolve(7);
    expect(await all).toEqual([7, 7, 7, 7]);
    expect(f.size).toBe(0);
    await f.run('a', async () => (loads++, 8));
    expect(loads).toBe(2);
  });

  it('different keys load separately', async () => {
    const f = singleFlight<string>();
    const [a, b] = await Promise.all([f.run('a', async () => 'A'), f.run('b', async () => 'B')]);
    expect([a, b]).toEqual(['A', 'B']);
  });

  it('a failed load fails every waiting caller and is not kept', async () => {
    const f = singleFlight<number>();
    const d = deferred<number>();
    const p1 = f.run('a', () => d.promise);
    const p2 = f.run('a', () => Promise.resolve(1));
    d.reject(new Error('db down'));
    await expect(p1).rejects.toThrow('db down');
    await expect(p2).rejects.toThrow('db down');
    expect(await f.run('a', async () => 2)).toBe(2);
  });

  it('after forget(), a new caller starts its own load instead of joining the old one', async () => {
    const f = singleFlight<string>();
    const old = deferred<string>();
    const p1 = f.run('user', () => old.promise);
    f.forget('user');
    const p2 = f.run('user', async () => 'after the change');
    old.resolve('before the change');
    expect(await p1).toBe('before the change');
    expect(await p2).toBe('after the change');
  });

  it('forget() by test or everything; the generation tells a loader not to cache a stale result', () => {
    const f = singleFlight<number>();
    void f.run('t1:a', () => new Promise(() => {}));
    void f.run('t1:b', () => new Promise(() => {}));
    void f.run('t2:a', () => new Promise(() => {}));
    const gen = f.generation;
    expect(f.fresh(gen)).toBe(true);
    f.forget((k) => k.startsWith('t1:'));
    expect(f.size).toBe(1);
    expect(f.fresh(gen)).toBe(false);
    f.forget();
    expect(f.size).toBe(0);
  });
});
