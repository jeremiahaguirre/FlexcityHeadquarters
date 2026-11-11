/**
 * Webhook signatures, Stripe-style: `FH-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`.
 *
 * The signed text is `<t>.<raw body>`, so a receiver that checks the signature and that `t` is
 * recent (5 minutes by default) refuses both a forged body and a replayed one. While a rotated
 * secret is still in its overlap window, a second `v1=` signed with the old secret is added.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'FH-Signature';
export const DEFAULT_TOLERANCE_S = 300;

export const hmac = (secret: string, t: number, body: string) => createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

/** The header value for a body, signed with each secret given (current first). */
export function signatureHeader(secrets: string[], body: string, t = Math.floor(Date.now() / 1000)): string {
  return [`t=${t}`, ...secrets.map((s) => `v1=${hmac(s, t, body)}`)].join(',');
}

export function parseSignature(header: string): { t: number; v1: string[] } | null {
  let t = NaN;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't' && v && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && v && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  return Number.isFinite(t) && v1.length ? { t, v1 } : null;
}

/**
 * What a receiver does (and what our docs show): true only when one v1 matches the body under the
 * secret and the timestamp is within the tolerance. Constant-time comparison.
 */
export function verifySignature(header: string, body: string, secret: string, opts: { toleranceS?: number; now?: number } = {}): boolean {
  const p = parseSignature(header);
  if (!p) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - p.t) > (opts.toleranceS ?? DEFAULT_TOLERANCE_S)) return false;
  const want = Buffer.from(hmac(secret, p.t, body), 'hex');
  return p.v1.some((v) => {
    const got = Buffer.from(v, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
