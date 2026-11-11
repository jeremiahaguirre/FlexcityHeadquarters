import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { FILE_CSP } from '../lib/files.js';
import { h } from './context.js';

/**
 * The organization's uploaded logo, shown beside the FH logo (sign-in page,
 * app header, careers page). Public, by organization id, no sign-in needed.
 */
export const publicLogoRouter = Router();
publicLogoRouter.get(
  '/public/logo/:tenantId',
  h(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.tenantId);
    if (!id.success) throw notFound('Logo');
    const logo = await withTenant(id.data, (tx) => tx.tenantLogo.findUnique({ where: { tenantId: id.data } }));
    if (!logo) throw notFound('Logo');
    // The URL carries the content hash (?v=…), so it can be cached for a long time.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Content-Security-Policy', FILE_CSP);
    res.send(Buffer.from(logo.bytes));
  }),
);
