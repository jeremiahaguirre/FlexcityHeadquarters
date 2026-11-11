/**
 * Legal-risk guards (docs/COMPLIANCE.md): fonts are self-hosted, no session replay, renewal terms
 * beside every quote button, the analytics opt-out, the contact form's consent, and the copyright
 * notice page (Canada's notice-and-notice regime only).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copy } from './copy';
import { legalDoc } from './legal';
import { COMPANY, isPlaceholder } from '../lib/site';
import { ANALYTICS_KEY, analyticsState, beforeSend, privacySignal } from '../lib/analyticsConsent';

const REPO = resolve(__dirname, '../../../..');
const SKIP = new Set(['node_modules', '.next', 'out', 'test-results', '.git', 'dist', 'coverage', 'playwright-report']);

function files(dir: string, exts: RegExp, skip = SKIP): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) return files(p, exts, skip);
    return exts.test(name) && st.size < 3_000_000 ? [p] : [];
  });
}
const SOURCE = /\.(tsx?|jsx?|mjs|cjs|css|html|json)$/;
const sources = ['apps/site/src', 'apps/web/src', 'apps/api/src', 'apps/site/public', 'apps/web/public'].flatMap((d) => files(join(REPO, d), SOURCE));
const GOOGLE_FONTS = /fonts\.(googleapis|gstatic)\.com|next\/font\/google/;

describe('fonts are self-hosted (no request to Google Fonts)', () => {
  it('no source file links to Google Fonts or uses next/font/google', () => {
    expect(sources.length).toBeGreaterThan(100);
    // This test file names the pattern, so it is the one allowed hit.
    expect(sources.filter((f) => !f.endsWith('compliance.test.ts') && GOOGLE_FONTS.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('built output (when present) has no Google Fonts URL', () => {
    const built = [join(REPO, 'apps/site/out'), join(REPO, 'apps/web/.next/static'), join(REPO, 'apps/web/out')].flatMap((d) => files(d, /\.(html|css|js)$/, new Set(['node_modules'])));
    expect(built.filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('the site’s Content-Security-Policy only allows its own fonts', () => {
    const v = JSON.parse(readFileSync(join(REPO, 'apps/site/vercel.json'), 'utf8')) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
    const csp = v.headers[0]!.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toContain("font-src 'self'");
    expect(readFileSync(join(REPO, 'apps/web/src/middleware.live.ts'), 'utf8')).toContain(`"font-src 'self'"`);
  });
});

/**
 * Session replay records what people see and type. None is used. Adding one needs, in the same
 * change: a consent switch (opt-in, Law 25), input masking on by default, an entry in
 * docs/SUBPROCESSORS.md and the privacy notice, and then an update to this allow-list.
 */
const REPLAY = ['@sentry/replay', 'replayIntegration', 'logrocket', 'hotjar', '@fullstory', 'fullstory', 'posthog', '@microsoft/clarity', 'clarity.ms', 'rrweb', 'smartlook', 'mouseflow', 'inspectlet', 'heap-analytics', 'openreplay'];
const REPLAY_ALLOWED_WITH_CONSENT_AND_MASKING: string[] = [];

describe('no session replay', () => {
  it('no replay SDK in any package.json or the lockfile', () => {
    const manifests = ['package.json', 'package-lock.json', ...['site', 'web', 'api'].map((a) => `apps/${a}/package.json`)];
    for (const m of manifests) {
      const deps = JSON.stringify(JSON.parse(readFileSync(join(REPO, m), 'utf8'))).toLowerCase();
      for (const r of REPLAY) if (!REPLAY_ALLOWED_WITH_CONSENT_AND_MASKING.includes(r)) expect(deps.includes(`"${r}`) || deps.includes(`/${r}"`) || deps.includes(`node_modules/${r}`), `${r} in ${m}`).toBe(false);
    }
  });

  it('no replay script or import in the code', () => {
    const hits = sources.filter((f) => !f.endsWith('compliance.test.ts') && /(from\s+['"](@sentry\/replay|logrocket|posthog-js|rrweb|@fullstory\/browser|@microsoft\/clarity)['"])|static\.hotjar\.com|clarity\.ms\/tag|replayIntegration\(/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});

describe('website analytics opt-out', () => {
  const store = (v: string | null) => ({ localStorage: { getItem: () => v, setItem: () => {} } });
  it('Global Privacy Control or Do Not Track turns it off', () => {
    expect(privacySignal({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignal({ doNotTrack: '1' })).toBe(true);
    expect(privacySignal({ doNotTrack: null })).toBe(false);
    expect(analyticsState({ globalPrivacyControl: true }, store('on'))).toBe('signal');
  });
  it('the footer switch is remembered; blocked storage still counts as on', () => {
    expect(analyticsState({}, store('off'))).toBe('off');
    expect(analyticsState({}, store(null))).toBe('on');
    expect(analyticsState({}, { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => {} } })).toBe('on');
    expect(ANALYTICS_KEY).toBe('fh-analytics');
  });
  it('nothing is sent outside a browser', () => {
    expect(beforeSend({ type: 'pageview', url: '/' })).toBeNull();
  });
  it('every page uses the wrapper that honours the opt-out, never <Analytics /> directly', () => {
    const layouts = files(join(REPO, 'apps/site/src/app'), /layout\.tsx$/).map((f) => readFileSync(f, 'utf8'));
    expect(layouts.some((l) => l.includes('<SiteAnalytics />'))).toBe(true);
    for (const l of layouts) expect(l).not.toContain('@vercel/analytics');
  });
});

describe('renewal terms beside every quote button', () => {
  it.each(['plans', 'private-sector'])('%s: one renewal note per “Get a quote” button', (page) => {
    const src = readFileSync(join(REPO, `apps/site/src/app/[lang]/${page}/page.tsx`), 'utf8');
    const buttons = src.match(/\{c\.cta\}/g)?.length ?? 0;
    expect(buttons).toBeGreaterThan(0);
    expect(src.match(/<RenewalNote /g)?.length).toBe(buttons);
  });
  it.each(['en', 'fr'] as const)('%s: the note says tax, quote, automatic renewal and price, how to cancel and the reminder', (lang) => {
    const n = copy(lang).plans.renewalShort;
    const words = lang === 'en' ? ['tax', 'quote', 'renew automatically', 'same rates', 'cancel in writing before the term ends', '30 days'] : ['taxes', 'soumission', 'renouvelle automatiquement', 'mêmes tarifs', 'résiliez par écrit avant la fin', '30 jours'];
    for (const w of words) expect(n).toContain(w);
    const terms = legalDoc('terms', lang).sections.map((s) => s.body.join(' ')).join(' ');
    expect(terms).toContain(lang === 'en' ? 'renews automatically' : 'renouvelle automatiquement');
  });
});

describe('contact form: organizations only, CASL consent', () => {
  const form = readFileSync(join(REPO, 'apps/site/src/components/LeadForm.tsx'), 'utf8');
  it('the marketing consent box is separate and never ticked in advance', () => {
    expect(form).toMatch(/type="checkbox" name="consent"/);
    expect(form).not.toMatch(/name="consent"[^>]*(defaultChecked|checked)/);
    expect(form).toContain('marketingConsent');
  });
  it.each(['en', 'fr'] as const)('%s: says it is for organizations, no children’s data, and who is asking for consent', (lang) => {
    const c = copy(lang).contact;
    expect(c.orgOnly).toMatch(lang === 'en' ? /organizations.*children/ : /organisations.*enfants/);
    expect(c.consentFrom).toContain('{name}');
    expect(c.consentFrom).toContain('{address}');
    expect(form).toContain('c.orgOnly');
    expect(form).toContain('COMPANY.mailingAddress');
  });
});

describe('copyright notices page (Copyright Act notice-and-notice)', () => {
  it.each(['en', 'fr'] as const)('%s: the s. 41.25(2) elements, what we do, invalid notices', (lang) => {
    const d = legalDoc('copyright', lang);
    const all = [d.intro, ...d.sections.flatMap((s) => [s.heading, ...s.body])].join('\n');
    expect(all).toContain('41.25');
    expect(all).toContain('41.25(3)');
    const must = lang === 'en'
      ? ['name and address', 'interest or right', 'location data', 'infringement you claim', 'date and time', 'prescribed by regulation', 'forward it electronically', 'six months', 'one year', 'fee', 'court order', 'offer to settle']
      : ['nom et adresse', 'droits ou intérêts', 'données de localisation', 'violation que vous alléguez', 'date et l’heure', 'prévu par règlement', 'par voie électronique', 'six mois', 'un an', 'droits pour ce faire', 'ordonnance du tribunal', 'offre de règlement'];
    for (const m of must) expect(all, m).toContain(m);
    // Contact from config: placeholders until set, never invented.
    expect(all).toContain(COMPANY.copyrightContact.email);
    if (!process.env.NEXT_PUBLIC_COPYRIGHT_CONTACT_EMAIL) expect(isPlaceholder(COMPANY.copyrightContact.email)).toBe(true);
    expect(copy(lang).footer.copyright).toBe(copy(lang).legal.copyrightTitle);
  });

  it('Canadian regime only: no DMCA or US designated-agent content anywhere on the site', () => {
    const site = files(join(REPO, 'apps/site/src'), /\.(tsx?|json)$/).filter((f) => !f.endsWith('compliance.test.ts'));
    expect(site.filter((f) => /DMCA|Digital Millennium|designated agent|agent désigné/i.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('linked from the footer and listed in the sitemap', () => {
    expect(readFileSync(join(REPO, 'apps/site/src/components/SiteFooter.tsx'), 'utf8')).toContain('/copyright/');
    expect(readFileSync(join(REPO, 'apps/site/src/lib/seo.ts'), 'utf8')).toContain("'copyright/'");
  });
});
