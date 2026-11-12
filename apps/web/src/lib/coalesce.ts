/**
 * Runs `run(key)` at most once per `ms` for each key: the first call schedules it, calls for the same
 * key until it runs are folded into it. The live stream uses it so a burst of "messages changed"
 * signals (a busy conversation: sends and read receipts arriving together) costs one refetch per
 * screen, not one per signal. Returns the scheduling function.
 */
export function coalescer(ms: number, run: (key: string) => void, timer: (fn: () => void, ms: number) => unknown = setTimeout): (key: string) => void {
  const pending = new Set<string>();
  return (key) => {
    if (pending.has(key)) return;
    pending.add(key);
    timer(() => {
      pending.delete(key);
      run(key);
    }, ms);
  };
}
