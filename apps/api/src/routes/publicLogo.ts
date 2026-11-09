import { Router } from 'express';
import { withTenant } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { h } from './context.js';

/** The organization's uploaded logo (sign-in page, app header). No sign-in needed. */
export const publicLogoRouter = Router();
publicLogoRouter.get(
  '/public/logo',
  h(async (req, res) => {
    const logo = await withTenant(req.tenantId!, (tx) => tx.tenantLogo.findUnique({ where: { tenantId: req.tenantId! } }));
    if (!logo) throw notFound('Logo');
    // The URL carries the content hash (?v=…), so it can be cached for a long time.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.send(Buffer.from(logo.bytes));
  }),
);
