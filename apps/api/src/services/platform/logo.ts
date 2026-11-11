/**
 * Uploaded organization logos. PNG, JPEG or WebP only: SVG can carry script,
 * so it isn't accepted. The bytes are checked, not just the declared type.
 */
import { createHash } from 'node:crypto';
import { badRequest } from '../../lib/errors.js';
import { sniff } from '../../lib/files.js';

export const MAX_LOGO_BYTES = 512 * 1024;

export function parseLogo(dataUrl: string): { contentType: string; bytes: Buffer; sha256: string } {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw badRequest('Upload a PNG, JPEG or WebP image.');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) throw badRequest('The logo must be 512 KB or smaller.');
  if (sniff(bytes) !== m[1]) throw badRequest('That file is not a valid PNG, JPEG or WebP image.');
  return { contentType: m[1]!, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** By organization id (public), so a plain <img> works on any host; the hash busts caches. */
export const logoUrlFor = (tenantId: string, sha256: string) => `/api/public/logo/${tenantId}?v=${sha256.slice(0, 12)}`;
