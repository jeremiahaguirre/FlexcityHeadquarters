/**
 * Retries for reads when the service is briefly unavailable: a traffic spike (the API answers 503
 * BUSY with Retry-After), a deployment or a database failover (the load balancer answers 502/503/504),
 * or a dropped connection. Only reads: repeating a change could apply it twice (punches have their
 * own offline queue for that, lib/offlinePunches.ts).
 *
 * Two more tries at most, about 0.5 s and 1.5 s apart (or what Retry-After asks, up to 5 s), each
 * with random jitter so phones that failed together don't all come back at the same instant.
 */
const RETRY_STATUS = new Set([502, 503, 504]);
const BASE_MS = [500, 1500];
const MAX_WAIT_MS = 5000;

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  online?: () => boolean;
}

/** Seconds from a Retry-After header (the HTTP-date form is not used by this API), or null. */
export function retryAfterMs(res: Response): number | null {
  const v = res.headers.get('retry-after');
  if (!v || !/^\d+$/.test(v.trim())) return null;
  return Number(v) * 1000;
}

export async function fetchRead(doFetch: () => Promise<Response>, deps: RetryDeps = {}): Promise<Response> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const online = deps.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= BASE_MS.length;
    let res: Response;
    try {
      res = await doFetch();
    } catch (e) {
      // No connection at all: say so at once rather than spin.
      if (last || !online()) throw e;
      await sleep(BASE_MS[attempt]! * (0.5 + random() * 0.5));
      continue;
    }
    const after = retryAfterMs(res);
    const retryable = RETRY_STATUS.has(res.status) || (res.status === 429 && after !== null && after <= MAX_WAIT_MS);
    if (!retryable || last) return res;
    const wait = after !== null ? Math.min(after, MAX_WAIT_MS) : BASE_MS[attempt]!;
    await sleep(wait * (0.5 + random() * 0.5));
  }
}
