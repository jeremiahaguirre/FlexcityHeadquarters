/**
 * Outbound connections to addresses a city typed in (its SSO provider, its bank's SFTP server)
 * must reach the public internet only, never FH's own network: no loopback, private ranges,
 * link-local (cloud metadata at 169.254.169.254), carrier-grade NAT, multicast or IPv6
 * equivalents. The name is resolved first and every address it resolves to is checked.
 * In development and tests, localhost is allowed so a local identity provider works.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.js';
import { HttpError } from './errors.js';

function v4Blocked(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && ip.startsWith('192.0.0.')) || (b === 0 && ip.startsWith('192.0.2.')))) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && ip.startsWith('198.51.100.')) ||
    (a === 203 && b === 0 && ip.startsWith('203.0.113.'))
  );
}

function v6Blocked(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (mapped) return v4Blocked(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8');
}

export const blockedAddress = (ip: string) => (isIP(ip) === 4 ? v4Blocked(ip) : isIP(ip) === 6 ? v6Blocked(ip) : true);

const localOk = () => config().NODE_ENV !== 'production';
const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '::1';

/** Resolves `host` and returns an address that's safe to connect to, or refuses. */
export async function publicAddress(host: string, what: string): Promise<string> {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (isLocal(h) && localOk()) return h === 'localhost' ? '127.0.0.1' : h;
  let addrs: Array<{ address: string }>;
  try {
    addrs = isIP(h) ? [{ address: h }] : await lookup(h, { all: true, verbatim: true });
  } catch {
    throw new HttpError(400, 'HOST_UNKNOWN', `${what}: that server name can’t be found.`);
  }
  if (!addrs.length || addrs.some((a) => blockedAddress(a.address))) {
    throw new HttpError(400, 'HOST_NOT_PUBLIC', `${what} must be on the public internet.`);
  }
  return addrs[0]!.address;
}

/** The same check for a URL (https only outside development). */
export async function assertPublicUrl(url: string, what: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, 'BAD_URL', `${what} isn’t a web address.`);
  }
  if (u.protocol !== 'https:' && !(localOk() && isLocal(u.hostname) && u.protocol === 'http:')) throw new HttpError(400, 'BAD_URL', `${what} must use https.`);
  await publicAddress(u.hostname, what);
}
