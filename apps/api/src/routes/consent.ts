/** The first-sign-in information and consent agreement: read it, sign it. */
import { Router } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { badRequest, conflict } from '../lib/errors.js';
import { CONSENT_VERSION, agreementFor, canonicalText, sha256 } from '../services/privacy/consent.js';
import { h } from './context.js';

export const consentRouter = Router();
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Whether this person still has to sign the current version. FH support visits never do. */
export async function consentRequired(tx: Parameters<Parameters<typeof withTenant>[1]>[0], userId: string): Promise<boolean> {
  return !(await tx.consentRecord.findFirst({ where: { userId, version: CONSENT_VERSION }, select: { id: true } }));
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
    res.status(201).json({ id: rec.id, signedAt: rec.signedAt, textSha256 });
  }),
);
