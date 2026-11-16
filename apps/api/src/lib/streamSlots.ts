/**
 * Bounds on the live notification streams (routes/notifications.ts; SECURITY-AUDIT SEC-70).
 *
 * - Per person: a few tabs and devices are normal; past PER_USER, the oldest stream is closed
 *   (its tab reconnects if it is still open), so one account can't hold thousands open.
 * - Per process: past PER_PROCESS, new streams are refused with 503 and Retry-After, so the
 *   streams of one organization can't exhaust a process every organization shares.
 * - Each stream is closed when the access token that opened it expires: the browser reconnects
 *   with a fresh token, and requireAuth checks the account again (a terminated person stops
 *   receiving anything, instead of keeping the stream for as long as it stays open).
 */
export const PER_USER = 10;
export const PER_PROCESS = 5000;

interface Slot {
  close: () => void;
  gone: boolean;
}

export class StreamSlots {
  private byUser = new Map<string, Slot[]>();
  private total = 0;
  constructor(
    readonly perUser = PER_USER,
    readonly perProcess = PER_PROCESS,
  ) {}

  /**
   * Takes a slot for a stream. `close` ends that stream. Returns the function that frees the slot
   * (call it when the stream ends, however it ends), or null when the process is full.
   */
  admit(userId: string, close: () => void): (() => void) | null {
    if (this.total >= this.perProcess) return null;
    const slot: Slot = { close, gone: false };
    const list = this.byUser.get(userId) ?? [];
    list.push(slot);
    this.byUser.set(userId, list);
    this.total++;
    while (list.length > this.perUser) {
      const oldest = list.shift()!;
      oldest.gone = true;
      this.total--;
      oldest.close();
    }
    return () => {
      if (slot.gone) return;
      slot.gone = true;
      this.total--;
      const l = this.byUser.get(userId);
      const i = l ? l.indexOf(slot) : -1;
      if (l && i >= 0) l.splice(i, 1);
      if (l && !l.length) this.byUser.delete(userId);
    };
  }

  count(userId?: string): number {
    return userId ? (this.byUser.get(userId)?.length ?? 0) : this.total;
  }
}

/** Milliseconds until a token's `exp` (seconds since the epoch), at least 1 s; null when it has none. */
export function msUntilExpiry(exp: number | undefined, now = Date.now()): number | null {
  if (!exp) return null;
  return Math.max(1000, exp * 1000 - now);
}
