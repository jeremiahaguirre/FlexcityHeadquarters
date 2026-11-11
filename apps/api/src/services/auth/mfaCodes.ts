/**
 * One-time sign-in codes, by email or text, as a second factor (routes/mfaCodes.ts).
 *
 * A code is 6 random digits (crypto.randomInt), lasts 10 minutes, and a newer one supersedes it.
 * Only an HMAC-SHA256 of it is stored, keyed with the server secret and bound to the row and the
 * person, so a database reader can't brute-force the million possibilities offline, and a hash
 * can't be replayed on another row. Five wrong tries end a code.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { maskEmail } from '../../lib/log.js';
import { maskPhone } from '../notifications/sms.js';

export const CODE_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
/** The web app offers "send a new code" after this long. */
export const RESEND_SECONDS = 30;

export type CodeChannel = 'EMAIL' | 'SMS';

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export const hashCode = (rowId: string, userId: string, code: string) => createHmac('sha256', config().JWT_SECRET).update(`mfa-code:${rowId}:${userId}:${code}`).digest('hex');

/** Constant-time: the comparison takes as long whether the first digit or the last one is wrong. */
export function codeMatches(stored: string, rowId: string, userId: string, code: string): boolean {
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(hashCode(rowId, userId, code), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "j•••@kelowna.ca": enough for the person to recognise their address, not to learn it. */
export function maskedEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!e.includes('@')) return '•••';
  return maskEmail(e);
}

/** "•••-•••-4267", as on the profile's text alerts card. */
export function maskedPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  return digits.length >= 4 ? maskPhone(digits) : '•••';
}

export interface CodeOption {
  channel: 'email' | 'sms';
  destination: string;
}

/** Email always; a text only to a number the person confirmed, where the organization sends texts. */
export function codeOptions(u: { email: string; smsPhone: string | null; smsVerifiedAt: Date | null }, textAlerts: boolean): CodeOption[] {
  const out: CodeOption[] = [{ channel: 'email', destination: maskedEmail(u.email) }];
  if (textAlerts && u.smsPhone && u.smsVerifiedAt) out.push({ channel: 'sms', destination: maskedPhone(u.smsPhone) });
  return out;
}
