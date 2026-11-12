/**
 * Optional breached-password check (OFF by default; PASSWORD_BREACH_CHECK=on turns it on).
 *
 * Asks Have I Been Pwned's Pwned Passwords range API (api.pwnedpasswords.com, served through
 * Cloudflare) whether a new password appears in known breaches, by k-anonymity: only the first 5
 * hexadecimal characters of the password's SHA-1 leave the server; HIBP answers with every suffix
 * sharing that prefix, and the match is made here. The `Add-Padding` header pads the answer so its
 * size doesn't hint at the prefix. The password, its full hash and who is setting it never leave.
 *
 * Turning it on makes HIBP a service the API server calls (a subprocessor-like dependency the owner
 * decides on: docs/SECURITY-LEGAL-AUDIT.md). It fails open: a timeout (2 s), a network error or an
 * unexpected answer lets the password through, so sign-up and resets never depend on HIBP.
 */
import { createHash } from 'node:crypto';
import { HttpError } from '../lib/errors.js';

export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 2000;

export const breachCheckOn = () => process.env.PASSWORD_BREACH_CHECK === 'on';

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

/** How many times the password appears in known breaches (0 = not found, or the check couldn't run). */
export async function breachCount(password: string, fetchImpl: Fetch = fetch as unknown as Fetch): Promise<number> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const r = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'FlexcityHeadquarters-password-check' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return 0;
    for (const line of (await r.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      // Padding lines carry a count of 0.
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch {
    return 0; // fail open
  }
}

/** Refuses a password found in breaches, when the check is on. */
export async function refuseBreached(password: string, fetchImpl?: Fetch): Promise<void> {
  if (!breachCheckOn()) return;
  if ((await breachCount(password, fetchImpl)) > 0) throw new HttpError(400, 'PASSWORD_BREACHED', 'This password has appeared in a data breach elsewhere. Choose a different one.');
}
