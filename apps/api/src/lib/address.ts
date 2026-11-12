/**
 * Keys for per-address controls (docs/ARCHITECTURE.md, "Brute-force and credential stuffing").
 *
 * One IPv6 customer usually holds a whole /64 (often far more), so keying an IPv6 limit by the full
 * address lets anyone rotate through 2^64 "addresses" for free. Every per-address control (the
 * per-process token bucket, sign-in limits, the address block, kiosk pairing) keys by addressKey():
 * the IPv4 address itself, or the IPv6 /64. Per-account sign-in failures are tracked per source
 * network (networkKey(): IPv4 /24, IPv6 /64), so an attacker elsewhere can't lock out a person's own
 * network.
 */
import { isIP } from 'node:net';

/** The 8 groups of an IPv6 address (with an embedded IPv4 tail), or null if it isn't one. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const p = tail[1]!.split('.').map(Number);
    s = `${s.slice(0, -tail[1]!.length)}${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const all = [...head, ...Array<string>(Math.max(0, fill)).fill('0'), ...rest];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/** An IPv4-mapped IPv6 address (::ffff:192.0.2.1) as plain IPv4; anything else unchanged. */
function unmapped(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1]! : ip;
}

function v6Prefix64(ip: string): string | null {
  const g = v6Groups(ip);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return null; // mapped IPv4, handled by the caller
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/** The key for a per-address limit: the IPv4 address, or the IPv6 /64 it is in. */
export function addressKey(ip: string | undefined | null): string {
  if (!ip) return 'unknown';
  const a = unmapped(ip);
  if (isIP(a) === 4) return a;
  if (isIP(a) === 6) {
    const g = v6Groups(a);
    if (g && g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
    return v6Prefix64(a) ?? a;
  }
  return a;
}

/** The source network for per-account sign-in failures: the IPv4 /24, or the IPv6 /64. */
export function networkKey(ip: string | undefined | null): string {
  const a = addressKey(ip);
  if (isIP(a) === 4) return `${a.split('.').slice(0, 3).join('.')}.0/24`;
  return a;
}
