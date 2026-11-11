/**
 * Canada's Anti-Spam Legislation (CASL) for FH's own commercial email (product news, follow-ups to
 * website enquiries, trial nurture). Transactional messages (invites, password resets, notifications,
 * invoices, payroll documents, safety alerts, renewal reminders) are not commercial electronic
 * messages and go through the outbox (notifications/mailer.ts).
 *
 * Every commercial message goes through sendCommercialEmail(), which:
 * - refuses in production until COMPANY_LEGAL_NAME and COMPANY_MAILING_ADDRESS are set (s. 6(2)(b),
 *   CRTC Electronic Commerce Protection Regulations s. 2: name, mailing address and one other contact);
 * - checks consent (s. 6(1)(a), s. 10): express consent from the website form's unticked box, or
 *   implied consent for six months after an enquiry (s. 10(10)(b)); an unsubscribe withdraws both
 *   until the person opts in again;
 * - adds the identification and a one-click unsubscribe link (s. 11: works for 60 days after sending,
 *   honoured within 10 business days; here it takes effect immediately), plus the List-Unsubscribe and
 *   List-Unsubscribe-Post headers (RFC 2369 / RFC 8058) that mail apps show as "Unsubscribe".
 *
 * The consent ledger is the Lead table (no separate table): enquiries carry their consent wording and
 * date; an unsubscribe is stored as a Lead row of kind UNSUBSCRIBE (never shown as an enquiry).
 * A dedicated EmailSuppression table would be cleaner: see docs/COMPLIANCE.md (CASL).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, realContact } from '../../config.js';
import { db } from '../../lib/db.js';
import type { Mailer } from '../notifications/mailer.js';

export const UNSUBSCRIBE_KIND = 'UNSUBSCRIBE';
export const ENQUIRY_KINDS = ['SALES', 'DEMO', 'SUPPORT'];
/** CASL s. 10(10)(b): an inquiry or application gives implied consent for six months. */
export const IMPLIED_MONTHS = 6;

const PLACEHOLDER_NAME = '[Company legal name — set COMPANY_LEGAL_NAME]';
const PLACEHOLDER_ADDRESS = '[Company mailing address — set COMPANY_MAILING_ADDRESS]';

export function senderIdentity() {
  const c = config();
  return {
    legalName: c.COMPANY_LEGAL_NAME.trim() || PLACEHOLDER_NAME,
    mailingAddress: c.COMPANY_MAILING_ADDRESS.trim() || PLACEHOLDER_ADDRESS,
    email: realContact(c.COMPANY_CONTACT_EMAIL) ?? realContact(c.BILLING_EMAIL),
    configured: !!c.COMPANY_LEGAL_NAME.trim() && !!c.COMPANY_MAILING_ADDRESS.trim(),
  };
}

/** Commercial email can't go out of production without a real sender identity. */
export function assertCommercialSendingConfigured(): void {
  if (config().NODE_ENV === 'production' && !senderIdentity().configured) {
    throw new Error('Commercial email is disabled: set COMPANY_LEGAL_NAME and COMPANY_MAILING_ADDRESS (CASL sender identification).');
  }
}

/** FH's own pages (unsubscribe), at the root of the app address: "http://{subdomain}.x" → "http://x". */
export function platformUrl(path: string): string {
  return config().PUBLIC_APP_URL.replace('{subdomain}.', '').replace('{subdomain}', '') + path;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (email: string) => createHmac('sha256', config().JWT_SECRET).update(`unsubscribe:v1:${email}`).digest('base64url');

/** A signed, non-expiring token naming the address (CASL: the link must keep working for at least 60 days). */
export function unsubscribeToken(email: string): string {
  const e = email.trim().toLowerCase();
  return `${b64(e)}.${sign(e)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [p, sig] = String(token ?? '').split('.');
  if (!p || !sig || p.length > 400) return null;
  let email: string;
  try {
    email = Buffer.from(p, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  const want = Buffer.from(sign(email));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? email : null;
}

export const unsubscribeUrl = (email: string) => platformUrl(`/unsubscribe?token=${encodeURIComponent(unsubscribeToken(email))}`);
/** The one-click POST target (RFC 8058), straight to the API. */
export const oneClickUrl = (email: string) => platformUrl(`/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(email))}`);

export type ConsentState = 'EXPRESS' | 'IMPLIED' | 'WITHDRAWN' | 'NONE';
export interface Consent { state: ConsentState; since: Date | null; expires: Date | null; text: string | null }

const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

/** Consent from a set of ledger rows for one address (pure, for the Dev console list too). */
export function consentFrom(rows: Array<{ kind: string; marketingConsent: boolean; consentText: string | null; createdAt: Date }>, now = new Date()): Consent {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const unsub = sorted.find((r) => r.kind === UNSUBSCRIBE_KIND);
  const after = (r: { createdAt: Date }) => !unsub || r.createdAt > unsub.createdAt;
  const express = sorted.find((r) => r.kind !== UNSUBSCRIBE_KIND && r.marketingConsent && after(r));
  if (express) return { state: 'EXPRESS', since: express.createdAt, expires: null, text: express.consentText };
  if (unsub) return { state: 'WITHDRAWN', since: unsub.createdAt, expires: null, text: null };
  const enquiry = sorted.find((r) => ENQUIRY_KINDS.includes(r.kind));
  if (enquiry && addMonths(enquiry.createdAt, IMPLIED_MONTHS) > now) return { state: 'IMPLIED', since: enquiry.createdAt, expires: addMonths(enquiry.createdAt, IMPLIED_MONTHS), text: null };
  return { state: 'NONE', since: null, expires: null, text: null };
}

export async function consentFor(email: string, now = new Date()): Promise<Consent> {
  const rows = await db().lead.findMany({ where: { email: email.trim().toLowerCase() }, select: { kind: true, marketingConsent: true, consentText: true, createdAt: true } });
  return consentFrom(rows, now);
}

/** Records an unsubscribe; takes effect at once (CASL allows up to 10 business days). Idempotent. */
export async function recordUnsubscribe(email: string, source: 'link' | 'one-click' | 'admin', locale = 'en-CA'): Promise<void> {
  const e = email.trim().toLowerCase();
  if ((await consentFor(e)).state === 'WITHDRAWN') return;
  await db().lead.create({
    data: { kind: UNSUBSCRIBE_KIND, name: '(unsubscribe)', email: e, message: `Unsubscribed from FH commercial email (${source}).`, locale, marketingConsent: false, consentText: null, status: 'CLOSED' },
  });
}

const FOOTER = {
  'en-CA': (id: ReturnType<typeof senderIdentity>, url: string) =>
    `—\nThis message is from ${id.legalName}, ${id.mailingAddress}.${id.email ? ` Contact us: ${id.email}.` : ''}\nUnsubscribe (one click, takes effect immediately): ${url}`,
  'fr-CA': (id: ReturnType<typeof senderIdentity>, url: string) =>
    `—\nCe message provient de ${id.legalName}, ${id.mailingAddress}.${id.email ? ` Nous joindre : ${id.email}.` : ''}\nVous désabonner (un clic, effet immédiat) : ${url}`,
};

/** The message as sent: body, identification footer, unsubscribe link and headers. */
export function buildCommercialEmail(m: { to: string; locale: string; subject: string; text: string }) {
  const id = senderIdentity();
  const locale = m.locale.startsWith('fr') ? 'fr-CA' : 'en-CA';
  const url = unsubscribeUrl(m.to);
  return {
    to: m.to,
    subject: m.subject,
    text: `${m.text.trim()}\n\n${FOOTER[locale](id, url)}`,
    headers: { 'List-Unsubscribe': `<${oneClickUrl(m.to)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

/**
 * The only way to send FH commercial email. Returns why it didn't send instead of throwing for
 * consent; throws when the sender identity isn't configured in production.
 */
export async function sendCommercialEmail(mailer: Mailer, m: { to: string; locale: string; subject: string; text: string }): Promise<{ sent: true } | { sent: false; reason: 'WITHDRAWN' | 'NO_CONSENT' }> {
  assertCommercialSendingConfigured();
  const consent = await consentFor(m.to);
  if (consent.state === 'WITHDRAWN') return { sent: false, reason: 'WITHDRAWN' };
  if (consent.state === 'NONE') return { sent: false, reason: 'NO_CONSENT' };
  await mailer.send(buildCommercialEmail(m));
  return { sent: true };
}

/**
 * Website enquiries are kept two years after the last exchange (the privacy policy says so), unless
 * the enquiry led to a customer (WON); then their personal details are removed (the app role may
 * update leads but not delete them, so the row stays as an empty count). Unsubscribe records are kept:
 * they are what stops us emailing someone again. Runs hourly from the worker.
 */
export const ENQUIRY_RETENTION_MONTHS = 24;
export const REMOVED = '(removed)';
export async function purgeOldEnquiries(now = new Date()): Promise<number> {
  const cutoff = addMonths(now, -ENQUIRY_RETENTION_MONTHS);
  const r = await db().lead.updateMany({
    where: { kind: { in: ENQUIRY_KINDS }, status: { not: 'WON' }, updatedAt: { lt: cutoff }, name: { not: REMOVED } },
    data: { name: REMOVED, email: '', organization: null, role: null, province: null, facilities: null, message: REMOVED, notes: null, marketingConsent: false, consentText: null, status: 'CLOSED' },
  });
  return r.count;
}
