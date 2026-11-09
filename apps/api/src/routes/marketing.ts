/**
 * Enquiries from the marketing website. Public and unauthenticated, so: an
 * origin allow-list, a per-address rate limit, a honeypot field, size limits,
 * and nothing returned but an acknowledgement.
 */
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { allow } from '../auth/rateLimit.js';
import { config } from '../config.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { h } from './context.js';

export const marketingRouter = Router();

function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.header('origin');
  const allowed = config().MARKETING_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (origin && !allowed.includes(origin)) return next(new HttpError(403, 'FORBIDDEN', 'Origin not allowed'));
  next();
}

export const CONSENT_TEXT = {
  'en-CA': 'Yes, FlexcityHeadquarters may email me product news and offers. I can unsubscribe at any time.',
  'fr-CA': 'Oui, FlexcityHeadquarters peut m’envoyer par courriel des nouvelles et des offres. Je peux me désabonner en tout temps.',
} as const;

const leadBody = z.object({
  kind: z.enum(['SALES', 'DEMO', 'SUPPORT']),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  organization: z.string().trim().max(160).nullable().optional(),
  role: z.string().trim().max(120).nullable().optional(),
  province: z.enum(['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU']).nullable().optional(),
  facilities: z.number().int().min(0).max(500).nullable().optional(),
  message: z.string().trim().min(5).max(4000),
  locale: z.enum(['en-CA', 'fr-CA']).default('en-CA'),
  marketingConsent: z.boolean().default(false),
  /** Honeypot: people never see or fill this. */
  website: z.string().max(0).optional(),
});

marketingRouter.use('/marketing', cors, express.json({ limit: '20kb' }));
marketingRouter.post(
  '/marketing/leads',
  h(async (req, res) => {
    if (!await allow(`lead:${req.ip}`, 5, 60 * 60_000)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Thanks! We already have your message. Please try again later.');
    const parsed = leadBody.safeParse(req.body);
    // Bots that fill the honeypot get the same answer as people, and nothing is stored.
    if (!parsed.success && (req.body?.website ?? '') !== '') return res.status(201).json({ ok: true });
    const b = leadBody.parse(req.body);
    await db().lead.create({
      data: {
        kind: b.kind,
        name: b.name,
        email: b.email.toLowerCase(),
        organization: b.organization ?? null,
        role: b.role ?? null,
        province: b.province ?? null,
        facilities: b.facilities ?? null,
        message: b.message,
        locale: b.locale,
        marketingConsent: b.marketingConsent,
        consentText: b.marketingConsent ? CONSENT_TEXT[b.locale] : null,
      },
    });
    res.status(201).json({ ok: true });
  }),
);
