/** The first-sign-in information and consent agreement: read it, sign it. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import type { NextFunction, Request, Response } from 'express';
import { HttpError, badRequest, conflict } from '../lib/errors.js';
import { CONSENT_VERSION, agreementFor, canonicalText, sha256 } from '../services/privacy/consent.js';
import { h } from './context.js';

export const consentRouter = Router();
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Whether this person still has to sign the current version. FH support visits never do. */
export async function consentRequired(tx: Parameters<Parameters<typeof withTenant>[1]>[0], userId: string): Promise<boolean> {
  return !(await tx.consentRecord.findFirst({ where: { userId, version: CONSENT_VERSION }, select: { id: true } }));
}

/**
 * Until the current agreement is signed, the API answers only what's needed to read and sign it,
 * sign in safely, and exercise privacy rights: everything else is 428 CONSENT_REQUIRED.
 * A worker's call for help during a working-alone session is never blocked.
 */
const OPEN = [
  /^\/me$/,
  /^\/me\/consent$/,
  /^\/me\/(passkeys|password|push)(\/|$)/,
  /^\/push\/key$/,
  // Safety never waits on paperwork: working-alone check-ins, help, and the people monitoring them.
  /^\/(me\/)?lone-work(\/|$)/,
  /^\/data-export(\/|$)/,
];
/** People known to have signed the current version, so most requests skip the lookup. */
const signedCache = new Map<string, number>();
const CACHE_MS = 10 * 60_000;
export const rememberSigned = (userId: string) => signedCache.set(`${CONSENT_VERSION}:${userId}`, Date.now() + CACHE_MS);

/** Only the integration suite may switch this off (for tests about something else). */
const enforced = () => !(process.env.NODE_ENV === 'test' && process.env.CONSENT_ENFORCEMENT === 'off');

export function requireConsent(req: Request, _res: Response, next: NextFunction) {
  const a = authOf(req);
  if (!enforced() || a.support || OPEN.some((r) => r.test(req.path))) return next();
  const key = `${CONSENT_VERSION}:${a.userId}`;
  if ((signedCache.get(key) ?? 0) > Date.now()) return next();
  withTenant(a.tenantId, (tx) => consentRequired(tx, a.userId))
    .then((required) => {
      if (required) return next(new HttpError(428, 'CONSENT_REQUIRED', 'Read and sign the information and consent agreement first.'));
      rememberSigned(a.userId);
      next();
    })
    .catch(next);
}

consentRouter.get(
  '/me/consent',
  h(async (req, res) => {
    const a = authOf(req);
    const lang = z.enum(['en-CA', 'fr-CA']).catch('en-CA').parse(req.query.lang);
    const [required, signed] = await withTenant(a.tenantId, async (tx) => [
      a.support ? false : await consentRequired(tx, a.userId),
      await tx.consentRecord.findFirst({ where: { userId: a.userId }, orderBy: { signedAt: 'desc' }, select: { version: true, signedAt: true, signedName: true, choices: true } }),
    ] as const);
    res.json({ required, version: CONSENT_VERSION, locale: lang, agreement: agreementFor(lang), lastSigned: signed });
  }),
);

const choice = z.enum(['granted', 'denied', 'skipped', 'unsupported']);

consentRouter.post(
  '/me/consent',
  h(async (req, res) => {
    const a = authOf(req);
    if (a.support) throw conflict('SUPPORT_READ_ONLY', 'FH support can look, not sign for someone.');
    const b = z
      .object({
        version: z.string(),
        locale: z.enum(['en-CA', 'fr-CA']),
        name: z.string().trim().min(2).max(120),
        signature: z.string().startsWith('data:image/png;base64,').max(300_000),
        choices: z.object({ notifications: choice, location: choice }),
      })
      .parse(req.body);
    // Signing a version other than the current one would record agreement to text no one was shown.
    if (b.version !== CONSENT_VERSION) throw conflict('CONSENT_OUTDATED', 'The agreement was updated. Read the new version and sign again.');
    const png = Buffer.from(b.signature.slice('data:image/png;base64,'.length), 'base64');
    if (png.length < 100 || png.length > 220_000 || !png.subarray(0, 8).equals(PNG_MAGIC)) throw badRequest('The signature could not be read. Sign again.');
    const textSha256 = sha256(canonicalText(CONSENT_VERSION, agreementFor(b.locale)));
    const rec = await withTenant(a.tenantId, async (tx) => {
      const r = await tx.consentRecord.create({
        data: {
          tenantId: a.tenantId,
          userId: a.userId,
          version: CONSENT_VERSION,
          locale: b.locale,
          textSha256,
          agreement: JSON.parse(JSON.stringify(agreementFor(b.locale))),
          signedName: b.name,
          signature: png,
          signatureSha256: sha256(png),
          choices: b.choices,
          ipAddress: req.ip ?? null,
          userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
        },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'consent.signed', entity: 'ConsentRecord', entityId: r.id, after: { version: CONSENT_VERSION, textSha256, choices: b.choices } });
      return r;
    });
    rememberSigned(a.userId);
    res.status(201).json({ id: rec.id, signedAt: rec.signedAt, textSha256 });
  }),
);
