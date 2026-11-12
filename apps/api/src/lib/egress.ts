/**
 * Outbound connections to addresses a city typed in (its SSO provider, its bank's SFTP server)
 * must reach the public internet only, never FH's own network: no loopback, private ranges,
 * link-local (cloud metadata at 169.254.169.254), carrier-grade NAT, multicast or IPv6
 * equivalents. The name is resolved first and every address it resolves to is checked.
 * In development and tests, localhost is allowed so a local identity provider works.
 */
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
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
  // The same IPv4-mapped address written in hex, as URL parsing normalizes it ([::ffff:10.0.0.1] → ::ffff:a00:1).
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return v4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8');
}

export const blockedAddress = (ip: string) => (isIP(ip) === 4 ? v4Blocked(ip) : isIP(ip) === 6 ? v6Blocked(ip) : true);

const localOk = () => config().NODE_ENV !== 'production';
const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '::1';

export interface EgressOptions {
  /** Allow localhost (default: outside production). Webhooks pass false unless a test opts in. */
  allowLocal?: boolean;
}

/** Resolves `host` and returns an address that's safe to connect to, or refuses. */
export async function publicAddress(host: string, what: string, opts: EgressOptions = {}): Promise<string> {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (isLocal(h) && (opts.allowLocal ?? localOk())) return h === 'localhost' ? '127.0.0.1' : h;
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
export async function assertPublicUrl(url: string, what: string, opts: EgressOptions = {}): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, 'BAD_URL', `${what} isn’t a web address.`);
  }
  const local = opts.allowLocal ?? localOk();
  if (u.protocol !== 'https:' && !(local && isLocal(u.hostname.replace(/^\[|\]$/g, '')) && u.protocol === 'http:')) throw new HttpError(400, 'BAD_URL', `${what} must use https.`);
  if (u.username || u.password) throw new HttpError(400, 'BAD_URL', `${what} can’t contain a user name or password.`);
  return publicAddress(u.hostname, what, opts);
}

export interface GetResult {
  status: number;
  body: string;
}

export interface PublicGetOptions extends EgressOptions {
  timeoutMs?: number;
  /** Larger answers are refused (default 2 MB). */
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface PublicRequestOptions extends PublicGetOptions {
  method?: 'GET' | 'POST';
  body?: string;
}

/**
 * GET from a public https address: the name is checked first (publicAddress) and the connection
 * goes to the checked address, so a DNS answer can't be swapped in between. Redirects aren't
 * followed. Rejects on a timeout, a network error or an answer over `maxBytes`.
 */
export async function publicGet(url: string, what: string, opts: PublicGetOptions = {}): Promise<GetResult> {
  return publicRequest(url, what, opts);
}

/** publicGet, for any method (e.g. a POST of a form to a sign-in provider's token endpoint). */
export async function publicRequest(url: string, what: string, opts: PublicRequestOptions = {}): Promise<GetResult> {
  const address = await assertPublicUrl(url, what, opts);
  const u = new URL(url);
  const secure = u.protocol === 'https:';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const body = opts.body === undefined ? undefined : Buffer.from(opts.body);
  return new Promise<GetResult>((resolve, reject) => {
    let done = false;
    const fail = (e: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    };
    const req = (secure ? https : http).request(
      {
        host: address,
        port: u.port || (secure ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: opts.method ?? 'GET',
        ...(secure && !isIP(host) ? { servername: host } : {}),
        headers: { accept: 'application/json', 'user-agent': 'FlexcityHeadquarters/1.0', ...opts.headers, ...(body ? { 'content-length': String(body.length) } : {}), host: u.host },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            fail(new Error(`${what}: answer too large`));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', (e) => fail(e));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      fail(new Error(`${what}: no answer within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    req.on('error', (e) => fail(e));
    req.end(body);
  });
}
