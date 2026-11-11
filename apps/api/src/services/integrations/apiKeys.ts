/**
 * API keys for a city's own systems (docs/PUBLIC-API.md).
 *
 * - A key looks like `fh_live_ab12cd34_<43 random characters>`. The first part (the prefix) tells
 *   keys apart on screens and in logs; the rest is the secret. Only a SHA-256 of the whole key is
 *   stored, and the key is shown once, when it's made or rotated.
 * - Each key has scopes (read-only in this version), an optional IP allow list and an optional
 *   expiry. Revoking is immediate; rotating makes a new key and lets the old one work for a day.
 * - Someone can only give a key the access they hold themselves (SCOPE_PERMISSIONS).
 */
import { createHash, randomBytes } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { Permission } from '../../auth/permissions.js';
import type { FeatureKey } from '../platform/features.js';

export const SCOPES = ['people:read', 'departments:read', 'positions:read', 'facilities:read', 'schedule:read', 'timesheets:read', 'timeoff:read', 'payroll:read'] as const;
export type ApiScope = (typeof SCOPES)[number];

/** What the person making the key must hold to give it each scope (any one). */
export const SCOPE_PERMISSIONS: Record<ApiScope, Permission[]> = {
  'people:read': ['users.read'],
  'departments:read': ['users.read'],
  'positions:read': ['users.read'],
  'facilities:read': ['users.read'],
  'schedule:read': ['schedule.read'],
  'timesheets:read': ['timeclock.review'],
  'timeoff:read': ['leave.manage', 'timeoff.approve'],
  'payroll:read': ['payroll.export'],
};

/** A scope's data is unavailable while its feature is switched off for the organization. */
export const SCOPE_FEATURES: Partial<Record<ApiScope, FeatureKey>> = {
  'timesheets:read': 'timeclock',
  'timeoff:read': 'timeOff',
  'payroll:read': 'payroll',
};

export const KEY_PREFIX = 'fh_live_';
const KEY_RE = /^fh_live_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** A new key: the full key (shown once), its prefix and its hash. */
export function newKey(): { key: string; prefix: string; hash: string } {
  const id = Array.from(randomBytes(8), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const key = `${KEY_PREFIX}${id}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix: `${KEY_PREFIX}${id}`, hash: hashKey(key) };
}

export const looksLikeKey = (s: string) => KEY_RE.test(s);

/** An allow-list entry: an IPv4 or IPv6 address, or a CIDR range. Returns it normalized, or null. */
export function parseIpEntry(raw: string): string | null {
  const s = raw.trim();
  const [addr, bits, extra] = s.split('/');
  if (extra !== undefined || !addr) return null;
  const v = isIP(addr);
  if (!v) return null;
  if (bits === undefined) return addr.toLowerCase();
  if (!/^\d{1,3}$/.test(bits)) return null;
  const n = Number(bits);
  if (n > (v === 4 ? 32 : 128)) return null;
  return `${addr.toLowerCase()}/${n}`;
}

const unmapped = (ip: string) => (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip) ? ip.slice(7) : ip);

/** Whether `ip` is in the allow list (an empty list allows any address). */
export function ipAllowed(list: readonly string[], ip: string | undefined): boolean {
  if (!list.length) return true;
  if (!ip) return false;
  const addr = unmapped(ip);
  const v = isIP(addr);
  if (!v) return false;
  const bl = new BlockList();
  for (const e of list) {
    const [a, bits] = e.split('/');
    const av = isIP(a!);
    if (!av) continue;
    const type = av === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) bl.addAddress(a!, type);
    else bl.addSubnet(a!, Number(bits), type);
  }
  return bl.check(addr, v === 4 ? 'ipv4' : 'ipv6');
}

/** Whether a key in this state may be used now. */
export function keyUsable(k: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): boolean {
  return !k.revokedAt && (!k.expiresAt || k.expiresAt > now);
}
