/**
 * Fonts stay within the app (docs/ASSET-LICENCES.md): the only web font is the Plus Jakarta Sans
 * woff2 committed in src/fonts, loaded with next/font/local and served from our own origin. Nothing
 * is downloaded at build time and no page asks another host for a font.
 *
 * The build checks run on whatever build is present (.next and the static demo in out/); CI runs this
 * file again after `npm run build:demo` so they always run there.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = resolve(__dirname, '../..');
const FONT = join(APP, 'src/fonts/plus-jakarta-sans-latin-wght-normal.woff2');
const SKIP = new Set(['node_modules', 'cache', 'server', 'types']);
const walk = (dir: string, ext: RegExp): string[] =>
  !existsSync(dir)
    ? []
    : readdirSync(dir).flatMap((n) => {
        if (SKIP.has(n)) return [];
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p, ext) : ext.test(n) ? [p] : [];
      });
// Font CDNs and the general CDNs a font could come from.
const REMOTE_FONT_HOST = /fonts\.(googleapis|gstatic)\.com|(use|p)\.typekit\.net|fonts\.bunny\.net|fonts\.cdnfonts|fontawesome|fontshare|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/i;
// System families allowed after the brand font in a stack.
const SYSTEM = new Set(['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'ui-sans-serif', 'SFMono-Regular', 'Menlo', 'Consolas']);

describe('fonts in the source', () => {
  const src = walk(join(APP, 'src'), /\.(tsx?|css)$/).filter((f) => !f.endsWith('.test.ts'));

  it('every next/font import is next/font/local and points at a file in src/fonts', () => {
    const users = src.filter((f) => /from 'next\/font/.test(readFileSync(f, 'utf8')));
    expect(users.length).toBeGreaterThan(0);
    for (const f of users) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/next\/font\/google/);
      for (const m of s.matchAll(/localFont\(\{\s*src:\s*'([^']+)'/g)) expect(existsSync(resolve(f, '..', m[1]!)), m[1]).toBe(true);
    }
    expect(existsSync(FONT)).toBe(true);
    expect(readFileSync(join(APP, 'src/fonts/OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('no @font-face, @import or font URL outside next/font, and no remote font host', () => {
    for (const f of src) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(REMOTE_FONT_HOST);
      // The localFont({ src: … }) call is the one place a font file is named.
      expect(s.replace(/localFont\(\{[^}]*\}\)/g, ''), f).not.toMatch(/@font-face|@import\s+url\(|\.(woff2?|[ot]tf)['")]/);
    }
  });

  it('the Tailwind font stacks are the brand font then system fonts only', () => {
    const tw = readFileSync(join(APP, 'tailwind.config.ts'), 'utf8');
    const families = /fontFamily:\s*\{([^}]*)\}/.exec(tw)?.[1] ?? '';
    const stacks = [...families.matchAll(/[\w'-]+:\s*\[([^\]]+)\]/g)].map((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
    expect(stacks.length).toBeGreaterThan(0);
    for (const [first, ...rest] of stacks) {
      expect(first).toBe('var(--font-sans)');
      for (const fam of rest) expect(SYSTEM.has(fam), fam).toBe(true);
    }
  });

  it('the Content-Security-Policy allows fonts from our own origin only', () => {
    expect(readFileSync(join(APP, 'src/middleware.live.ts'), 'utf8')).toContain(`"font-src 'self'"`);
    expect(readFileSync(join(APP, 'next.config.mjs'), 'utf8')).toMatch(/Content-Security-Policy', value: "font-src 'self';/);
    expect(readFileSync(join(APP, 'src/app/layout.tsx'), 'utf8')).toContain(`content="font-src 'self'"`);
  });
});

const BUILDS = [join(APP, '.next/static'), join(APP, 'out')].filter((d) => existsSync(d));

describe.skipIf(BUILDS.length === 0)('fonts in the build', () => {
  it('every @font-face loads the committed woff2 from our own origin (or a local system font)', () => {
    const font = readFileSync(FONT);
    for (const dir of BUILDS) {
      const css = walk(dir, /\.css$/);
      expect(css.length, dir).toBeGreaterThan(0);
      const faces = css.flatMap((f) => readFileSync(f, 'utf8').match(/@font-face\{[^}]*\}/g) ?? []);
      expect(faces.length, dir).toBeGreaterThan(0);
      for (const face of faces)
        for (const [, url] of face.matchAll(/url\(([^)]+)\)/g)) {
          const path = url!.replace(/^["']|["']$/g, '');
          // Same origin, with or without the demo's base path; never a full URL or protocol-relative one.
          expect(path, face).toMatch(/^(\/[\w.-]+)*\/_next\/static\/media\/[\w.-]+\.woff2$/);
          const file = join(dir.endsWith('static') ? dir : join(dir, '_next/static'), 'media', path.split('/').pop()!);
          expect(existsSync(file), file).toBe(true);
          expect(readFileSync(file).equals(font), `${file} is the file in src/fonts`).toBe(true);
        }
    }
  });

  it('no built page, stylesheet or script names a remote font host', () => {
    const hits = BUILDS.flatMap((d) => walk(d, /\.(html|css|js)$/)).filter((f) => REMOTE_FONT_HOST.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
