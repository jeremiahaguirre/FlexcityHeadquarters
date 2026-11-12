/**
 * Fonts stay within the app (docs/ASSET-LICENCES.md): emails name system fonts only, PDFs use
 * PDFKit's built-in base-14 fonts (metrics shipped in the pdfkit package, nothing fetched) or a
 * font file committed in this repo, and nothing in the API points at a remote font host.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMAIL_FONT_STACK, emailHtml } from '../../src/services/notifications/emailHtml.js';
import { EMAIL_KIND, renderEmail } from '../../src/services/notifications/mailer.js';

const SRC = resolve(__dirname, '../../src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(n) ? [p] : [];
  });
const REMOTE_FONT = /fonts\.(googleapis|gstatic)\.com|use\.typekit|p\.typekit|fonts\.bunny|fontawesome|cdnjs\.cloudflare|cdn\.jsdelivr|unpkg\.com|@font-face|\.woff2?\b|\.[ot]tf\b/i;

describe('email fonts', () => {
  it('every template, EN and FR, uses only the system font stack and loads no font', () => {
    const kinds = Object.keys(EMAIL_KIND);
    expect(kinds.length).toBeGreaterThan(5);
    for (const kind of kinds)
      for (const locale of ['en-CA', 'fr-CA']) {
        const r = renderEmail(kind, locale, { name: 'Sam', url: 'https://example.ca/x' });
        const html = emailHtml(r.subject, r.text, locale);
        expect(html, kind).not.toMatch(REMOTE_FONT);
        expect(html, kind).not.toMatch(/<link|<style|url\(/i);
        expect([...html.matchAll(/font-family:([^;"]+)/g)].map((m) => m[1])).toEqual([EMAIL_FONT_STACK]);
      }
    expect(EMAIL_FONT_STACK).not.toMatch(/jakarta/i);
    expect(EMAIL_FONT_STACK.endsWith('sans-serif')).toBe(true);
  });
});

describe('PDF fonts', () => {
  const BASE14 = new Set(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Symbol', 'ZapfDingbats']);
  const pdfFiles = files(SRC).filter((f) => /from 'pdfkit'/.test(readFileSync(f, 'utf8')));

  it('every PDF generator uses base-14 fonts or a font file in the repo, never a URL', () => {
    expect(pdfFiles.length).toBeGreaterThanOrEqual(3);
    for (const f of pdfFiles) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\.(?:font|registerFont)\(([^)]*)\)/g)) {
        const arg = m[1]!.trim();
        const name = /^'([^']+)'$/.exec(arg)?.[1];
        expect(name && BASE14.has(name), `${f}: .font(${arg})`).toBe(true);
      }
      expect(src, f).not.toMatch(/https?:\/\/[^'"`\s]*\.(woff2?|ttf|otf)/i);
    }
  });

  it('PDFKit’s base-14 font metrics ship inside the installed package (nothing to download)', () => {
    const req = createRequire(__filename);
    const data = join(dirname(req.resolve('pdfkit')), 'data');
    for (const f of ['Helvetica.afm', 'Helvetica-Bold.afm', 'Courier.afm']) expect(existsSync(join(data, f)), f).toBe(true);
    // PDFKit 0.20+ loads generated metric modules (pdfkit/standard-fonts/*) at run time; those ship in the package too.
    for (const f of ['Helvetica', 'HelveticaBold', 'Courier']) expect(existsSync(req.resolve(`pdfkit/standard-fonts/${f}`)), f).toBe(true);
  });
});

describe('API source', () => {
  it('names no remote font host', () => {
    const hits = files(SRC).filter((f) => /fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny/i.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
