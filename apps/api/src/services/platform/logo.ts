/**
 * Uploaded organization logos. PNG, JPEG or WebP only: SVG can carry script,
 * so it isn't accepted. The bytes are checked, not just the declared type.
 */
import { createHash } from 'node:crypto';
import { badRequest } from '../../lib/errors.js';

export const MAX_LOGO_BYTES = 512 * 1024;
const TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

export function parseLogo(dataUrl: string): { contentType: string; bytes: Buffer; sha256: string } {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw badRequest('Upload a PNG, JPEG or WebP image.');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) throw badRequest('The logo must be 512 KB or smaller.');
  if (!TYPES[m[1]!]!(bytes)) throw badRequest('That file is not a valid PNG, JPEG or WebP image.');
  return { contentType: m[1]!, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** By organization id (public), so a plain <img> works on any host; the hash busts caches. */
export const logoUrlFor = (tenantId: string, sha256: string) => `/api/public/logo/${tenantId}?v=${sha256.slice(0, 12)}`;
