/**
 * Shares one load among callers who miss a cache for the same key at the same moment.
 *
 * When a phone opens Today it sends several requests at once; each checks the person's access
 * (custom roles, still active, managed departments, organization settings). Without this, all of
 * them miss the cache together and each runs the same queries: at a shift change that multiplies
 * the database work by the number of requests per screen.
 *
 * Only loads in progress are shared; finished results are cached by the caller as before.
 * forget() drops loads in progress too, so a caller arriving after a change (a person
 * terminated, a role removed) never joins a load that started before it. It also moves the
 * generation on: a caller caches a result only if no forget() happened while it was loading
 * (`fresh(gen)`), so a load that read the old data is never kept for the cache's lifetime.
 */
export function singleFlight<V>() {
  const inflight = new Map<string, Promise<V>>();
  let generation = 0;
  return {
    /** Take before loading; pass to fresh() before caching the result. */
    get generation() {
      return generation;
    },
    fresh(gen: number): boolean {
      return gen === generation;
    },
    run(key: string, load: () => Promise<V>): Promise<V> {
      const running = inflight.get(key);
      if (running) return running;
      const p = load().finally(() => {
        if (inflight.get(key) === p) inflight.delete(key);
      });
      inflight.set(key, p);
      return p;
    },
    /** Forget one key, keys matching a test, or everything. */
    forget(match?: string | ((key: string) => boolean)): void {
      generation++;
      if (match === undefined) return inflight.clear();
      for (const k of [...inflight.keys()]) if (typeof match === 'string' ? k === match : match(k)) inflight.delete(k);
    },
    get size() {
      return inflight.size;
    },
  };
}
