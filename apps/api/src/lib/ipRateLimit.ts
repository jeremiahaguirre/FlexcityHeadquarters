/**
 * The API's own per-address limit, in front of every route: a cheap in-memory token bucket per
 * process. AWS WAF's rate-based rule on the load balancer is the fleet-wide control
 * (ops/terraform/edge.tf); this one catches what gets past it, per API process, without a database.
 *
 * - Requests carrying a credential (a Bearer token or API key, a session/kiosk/support cookie, a
 *   calendar-feed or unsubscribe link, a Stripe signature) share a generous bucket per address
 *   (GLOBAL_RATE_LIMIT_AUTH, default 1200 a minute): an office behind one address, or a calendar
 *   service fetching many people's feeds, fits.
 * - Everything else (sign-in pages, public job boards, enquiry forms) gets a smaller one
 *   (GLOBAL_RATE_LIMIT_ANON, default 120 a minute).
 * - Endpoints that take no credential (sign-in, password reset, public job boards, sign-up, the
 *   enquiry form…) always use the smaller bucket, whatever headers or cookies come with them: a
 *   made-up cookie doesn't buy the bigger one.
 * - Sending a made-up credential doesn't buy the bigger bucket for long: every 401 answer to an
 *   address also draws from its failure bucket (GLOBAL_RATE_LIMIT_FAILURES, default 120 a minute);
 *   once that is empty, the address's credentialed requests are refused too until it refills. An
 *   access token that is genuine but expired (res.locals.credentialExpired, set by requireAuth)
 *   isn't a failure: phones refresh it and carry on.
 * - Keyed by address: the IPv4 address, or the IPv6 /64 (lib/address.ts), so rotating through
 *   one customer's IPv6 range doesn't make fresh buckets.
 * - /healthz, /readyz and /metrics (which has its own token) are never limited. The live
 *   notification stream counts once per connection, so a reconnect is one request.
 * - Over a limit: 429 RATE_LIMITED with Retry-After (seconds until a request would be allowed).
 *
 * On by default in production; GLOBAL_RATE_LIMIT=on|off overrides (off in development and tests,
 * so local tools and the test suite, all from 127.0.0.1, aren't throttled).
 */
import type { NextFunction, Request, Response } from 'express';
import { addressKey } from './address.js';
import { rateLimited } from './metrics.js';

export interface LimiterOptions {
  authPerMinute: number;
  anonPerMinute: number;
  failuresPerMinute: number;
  /** Most addresses tracked per process before idle (full) buckets are forgotten. */
  maxAddresses?: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

/** A token bucket per key: `perMinute` requests a minute, bursts up to `perMinute`. */
export class TokenBuckets {
  private buckets = new Map<string, Bucket>();
  constructor(readonly perMinute: number, private readonly max = 100_000) {}
  private refill(key: string, now: number): Bucket {
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, at: now };
    this.buckets.delete(key); // re-set by the caller: most recently used last
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    return b;
  }
  /** Takes one token; returns 0 if allowed, else the seconds until one is available. */
  take(key: string, now = Date.now()): number {
    const b = this.refill(key, now);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      if (this.buckets.size > this.max) this.sweep(now);
      return 0;
    }
    this.buckets.set(key, b);
    return Math.max(1, Math.ceil(((1 - b.tokens) * 60) / this.perMinute));
  }
  /** Seconds until this key has a token, without taking one (0 = it has one now). */
  peek(key: string, now = Date.now()): number {
    if (!this.buckets.has(key)) return 0;
    const b = this.refill(key, now);
    this.buckets.set(key, b);
    return b.tokens >= 1 ? 0 : Math.max(1, Math.ceil(((1 - b.tokens) * 60) / this.perMinute));
  }
  /** Draws one token without refusing (a failure being counted); the bucket may go empty. */
  drain(key: string, now = Date.now()): void {
    const b = this.refill(key, now);
    b.tokens = Math.max(0, b.tokens - 1);
    this.buckets.set(key, b);
    if (this.buckets.size > this.max) this.sweep(now);
  }
  /**
   * Past the cap: forget full (idle) buckets, then, if a flood of distinct addresses keeps them all
   * busy, the least recently used ones, down to 90% of the cap, so memory stays bounded and a sweep
   * runs once per tenth of the cap, not on every request.
   */
  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (b.tokens + ((now - b.at) / 60_000) * this.perMinute >= this.perMinute) this.buckets.delete(k);
    const target = Math.floor(this.max * 0.9);
    if (this.buckets.size <= target) return;
    for (const k of this.buckets.keys()) {
      if (this.buckets.size <= target) break;
      this.buckets.delete(k);
    }
  }
  get size() {
    return this.buckets.size;
  }
}

const EXEMPT = new Set(['/healthz', '/readyz', '/metrics']);
const CREDENTIAL_COOKIE = /(?:^|;\s*)(fc_refresh|fh_platform|fh_kiosk|fh_support)=/;

/** Endpoints that take no credential: anonymous whatever the request carries. */
export const PUBLIC_PATH = /^\/api\/(?:auth\/(?:login|forgot|reset|passkey(?:\/options)?|sso\/.*)|public\/.*|marketing(?:\/.*)?|client-errors|version|platform\/auth\/(?:login|passkey(?:\/options)?))\/?$/;

/** Whether the request carries something that identifies a session, a key, a device or a signed link. */
export function hasCredential(req: Request): boolean {
  if (PUBLIC_PATH.test(req.path)) return false;
  if (req.headers.authorization || req.headers['x-kiosk-token'] || req.headers['stripe-signature']) return true;
  if (CREDENTIAL_COOKIE.test(req.headers.cookie ?? '')) return true;
  const path = req.path;
  return path.startsWith('/api/calendar/') || path === '/api/email/unsubscribe';
}

export function enabled(): boolean {
  const v = process.env.GLOBAL_RATE_LIMIT;
  if (v === 'on' || v === 'off') return v === 'on';
  return process.env.NODE_ENV === 'production';
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const defaultOptions = (): LimiterOptions => ({
  authPerMinute: num(process.env.GLOBAL_RATE_LIMIT_AUTH, 1200),
  anonPerMinute: num(process.env.GLOBAL_RATE_LIMIT_ANON, 120),
  failuresPerMinute: num(process.env.GLOBAL_RATE_LIMIT_FAILURES, 120),
});

/** The middleware. `opts` fixed for tests; otherwise read from the environment once. */
export function ipRateLimit(opts?: LimiterOptions & { force?: boolean }) {
  let state: { auth: TokenBuckets; anon: TokenBuckets; failures: TokenBuckets } | null = null;
  const buckets = () => {
    if (!state) {
      const o = opts ?? defaultOptions();
      state = { auth: new TokenBuckets(o.authPerMinute, o.maxAddresses), anon: new TokenBuckets(o.anonPerMinute, o.maxAddresses), failures: new TokenBuckets(o.failuresPerMinute, o.maxAddresses) };
    }
    return state;
  };
  return function globalRateLimit(req: Request, res: Response, next: NextFunction) {
    if (!(opts?.force ?? enabled()) || EXEMPT.has(req.path)) return next();
    const ip = addressKey(req.ip);
    const b = buckets();
    const credentialed = hasCredential(req);
    let wait: number;
    let layer: string;
    if (credentialed) {
      wait = b.failures.peek(ip);
      layer = 'global_failures';
      if (!wait) {
        wait = b.auth.take(ip);
        layer = 'global_auth';
      }
    } else {
      wait = b.anon.take(ip);
      layer = 'global_anon';
    }
    if (wait) {
      rateLimited.inc({ layer });
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests from this address. Wait a moment and try again.', requestId: req.id });
      return;
    }
    res.once('finish', () => {
      if (res.statusCode === 401 && !res.locals.credentialExpired) b.failures.drain(ip);
    });
    next();
  };
}
