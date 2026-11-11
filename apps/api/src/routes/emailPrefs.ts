/**
 * Unsubscribing from FH commercial email (CASL s. 11), with no sign-in: the link in each message
 * carries a signed token naming the address (services/marketing/casl.ts).
 *
 * - GET  /api/email/unsubscribe?token=…  what the landing page shows (address masked, current state)
 * - POST /api/email/unsubscribe?token=…  unsubscribe now; also the RFC 8058 one-click target that mail
 *   apps POST to with "List-Unsubscribe=One-Click" (form-encoded), so it accepts that body too.
 */
import express, { Router } from 'express';
import { allow } from '../auth/rateLimit.js';
import { HttpError } from '../lib/errors.js';
import { maskEmail } from '../lib/log.js';
import { consentFor, recordUnsubscribe, verifyUnsubscribeToken } from '../services/marketing/casl.js';
import { h } from './context.js';

export const emailPrefsRouter = Router();
emailPrefsRouter.use('/email/unsubscribe', express.urlencoded({ extended: false, limit: '2kb' }), express.json({ limit: '2kb' }));

function emailOf(req: express.Request): string {
  const token = String(req.query.token ?? (req.body as { token?: string } | undefined)?.token ?? '');
  const email = verifyUnsubscribeToken(token);
  if (!email) throw new HttpError(400, 'BAD_TOKEN', 'This unsubscribe link isn’t valid. Use the link from the email, or contact us.');
  return email;
}

emailPrefsRouter.get(
  '/email/unsubscribe',
  h(async (req, res) => {
    const email = emailOf(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ email: maskEmail(email), unsubscribed: (await consentFor(email)).state === 'WITHDRAWN' });
  }),
);

emailPrefsRouter.post(
  '/email/unsubscribe',
  h(async (req, res) => {
    if (!(await allow(`unsub:${req.ip}`, 30, 60 * 60_000))) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many requests. Try again later.');
    const email = emailOf(req);
    const oneClick = (req.body as Record<string, string> | undefined)?.['List-Unsubscribe'] === 'One-Click';
    const locale = (req.body as { locale?: string } | undefined)?.locale === 'fr-CA' ? 'fr-CA' : 'en-CA';
    await recordUnsubscribe(email, oneClick ? 'one-click' : 'link', locale);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ email: maskEmail(email), unsubscribed: true });
  }),
);
