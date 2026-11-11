/**
 * Uploaded files: the one list of accepted types, how a file's real type is found, the name it is
 * kept and downloaded under, and the headers every file answer carries.
 *
 * Files never touch a disk: they are encrypted into the database (or, for logos, kept as bytes in it)
 * and only ever sent back through these headers, so nothing uploaded can run on our side or in a browser.
 */
import type { Response } from 'express';

/** Every type any upload accepts. Each upload narrows this further (a résumé is PDF only, a logo is an image). */
export const FILE_TYPES = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
export type FileType = keyof typeof FILE_TYPES;

/** The file's real type from its first bytes, never the name or the browser's claim. Null = not accepted. */
export function sniff(b: Buffer): FileType | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * The name a file is kept and downloaded under: the person's name for it, reduced to plain letters,
 * digits and a few marks, with whatever extension they gave replaced by the one for its real type.
 * "payslip.pdf.html" holding a PDF becomes "payslip.pdf.pdf"; it can never come back as .html or .exe.
 * (Files are stored by a random id; this is only the label.)
 */
export function storedName(original: string, type: FileType): string {
  const ext = FILE_TYPES[type];
  const base = original
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^.*[/\\]/, '') // a path's last part only
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s_-]+|[.\s_-]+$/g, '')
    .slice(0, 120);
  return `${base || 'file'}.${ext}`;
}

/** Nothing in an answer carrying a file may run: no scripts, no plug-ins, no forms, not framed. */
export const FILE_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";

/** Headers for sending a stored file back: a download (never shown in the page), its real type, nothing runnable. */
export function sendFile(res: Response, file: Buffer, opts: { type: FileType; name: string }) {
  res.setHeader('Content-Type', opts.type);
  res.setHeader('Content-Disposition', `attachment; filename="${storedName(opts.name, opts.type)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', FILE_CSP);
  res.send(file);
}
