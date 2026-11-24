/**
 * Whether a request may send a large body (document uploads, message attachments, signed
 * agreements): only with a valid access token, checked before the body is read (SECURITY-AUDIT
 * SEC-47). The route still runs requireAuth for the full checks (organization, account status).
 */
import type { Request, Response } from 'express';
import { verifyAccessToken } from '../auth/tokens.js';

export async function largeBodyAllowed(req: Request, res: Response): Promise<boolean> {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return false;
  try {
    await verifyAccessToken(header.slice(7));
    return true;
  } catch (e) {
    // Genuine but expired: the app refreshes and retries, as for any other 401 (lib/ipRateLimit.ts).
    if ((e as { code?: unknown })?.code === 'ERR_JWT_EXPIRED') res.locals.credentialExpired = true;
    return false;
  }
}
