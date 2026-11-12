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

describe('website analytics: opt-in consent', () => {
  const store = (v: string | null) => ({ localStorage: { getItem: () => v, setItem: () => {} } });
  it('Global Privacy Control or Do Not Track turns it off', () => {
    expect(privacySignal({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignal({ doNotTrack: '1' })).toBe(true);
    expect(privacySignal({ doNotTrack: null })).toBe(false);
    expect(analyticsState({ globalPrivacyControl: true }, store('on'))).toBe('signal');
  });
  it('off until the visitor allows it (Law 25 s. 8.1); the choice is remembered; blocked storage counts nothing', () => {
    expect(analyticsState({}, store(null))).toBe('unset');
    expect(analyticsState({}, store('off'))).toBe('off');
    expect(analyticsState({}, store('on'))).toBe('on');
    expect(analyticsState({}, { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => {} } })).toBe('unset');
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
  it('sends Formspree’s honeypot field (_gotcha) and doesn’t call the client-side consent line a CASL record', () => {
    expect(form).toMatch(/name="_gotcha"/);
    expect(form).toMatch(/_gotcha: trap/);
    expect(form).not.toMatch(/CASL: a record/);
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

describe('legal pages', () => {
  const DOCS = ['privacy', 'terms', 'cookies', 'refunds', 'accessibility', 'copyright'] as const;
  it.each(DOCS)('%s: a page that renders this document, in the footer and sitemap, with a version and date in both languages', (d) => {
    expect(readFileSync(join(REPO, `apps/site/src/app/[lang]/${d}/page.tsx`), 'utf8')).toContain(`<LegalPage doc="${d}"`);
    expect(readFileSync(join(REPO, 'apps/site/src/components/SiteFooter.tsx'), 'utf8')).toContain(`/${d}/`);
    expect(readFileSync(join(REPO, 'apps/site/src/lib/seo.ts'), 'utf8')).toContain(`'${d}/'`);
    for (const lang of ['en', 'fr'] as const) {
      const doc = legalDoc(d, lang);
      expect(doc.version).toMatch(/^\d+\.\d+$/);
      expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.version).toBe(legalDoc(d, 'en').version);
      expect(doc.sections.length).toBe(legalDoc(d, 'en').sections.length);
    }
  });

  it.each(['en', 'fr'] as const)('%s privacy policy covers what the owner asked for', (lang) => {
    const all = legalDoc('privacy', lang).sections.map((s) => [s.heading, ...s.body].join(' ')).join(' ');
    const must = lang === 'en'
      ? ['service provider', 'Social Insurance Number', 'Working alone', 'kiosk', 'Text alerts', 'push', 'Error reports', 'ca-central-1'.replace('ca-central-1', 'Canada Central'), 'planned', 'outside Canada', 'portability', 'de-indexed', 'Commission d’accès à l’information', 'Privacy Commissioner of Canada', 'real risk of significant harm', 'exclusively by automated processing', '12.1', 'Children', 'Changes']
      : ['fournisseur de services', 'numéro d’assurance sociale', 'Travail en solitaire', 'borne', 'Textos', 'notifications', 'Rapports d’erreur', 'Canada (Centre)', 'prévu', 'extérieur du Canada', 'portabilité', 'désindexé', 'Commission d’accès à l’information', 'Commissariat à la protection de la vie privée du Canada', 'risque réel de préjudice grave', 'exclusivement sur un traitement automatisé', '12.1', 'Enfants', 'Modifications'];
    for (const m of must) expect(all, m).toContain(m);
  });

  it('company facts come from config: placeholders until set, never invented', () => {
    for (const v of [COMPANY.legalName, COMPANY.mailingAddress, COMPANY.email, COMPANY.privacyOfficer.name, COMPANY.privacyOfficer.email, COMPANY.governingProvince.en, COMPANY.copyrightContact.address]) {
      if (isPlaceholder(v)) expect(v).toMatch(/set |to be|à choisir|to be chosen/);
    }
    const terms = legalDoc('terms', 'en').sections.map((s) => s.body.join(' ')).join(' ');
    expect(terms).toContain(COMPANY.governingProvince.en);
    expect(terms).not.toMatch(/\b\d{2}(\.\d+)?\s?% (uptime|availability)/i);
  });

  it('refund policy matches the renewal note: no partial-period refunds, changes from the next invoice', () => {
    const r = legalDoc('refunds', 'en').sections.map((s) => s.body.join(' ')).join(' ');
    expect(r).toContain('not refunded for part of a period');
    expect(r).toContain('from the next invoice');
    expect(copy('en').plans.renewalShort).toBeTruthy();
  });

  it('the cookie page lists every storage key the code sets', () => {
    const code = files(join(REPO, 'apps'), /\.(tsx?)$/).filter((f) => /apps\/(web|site)\/src\//.test(f) && !/\.test\.tsx?$/.test(f) && !/demo(Api|Back)/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
    const keys = new Set([...code.matchAll(/(?:const|export const) [A-Z_]+ = '((?:fh|fc)[-_.][a-z0-9-]+)'/g)].map((m) => m[1]!));
    keys.delete('fh-demo-back');
    // In-page event names, not storage.
    for (const k of [...keys]) if (/(-choice|-motion)$/.test(k)) keys.delete(k);
    const page = ['en', 'fr'].map((l) => legalDoc('cookies', l as 'en').sections.map((s) => s.body.join(' ')).join(' '));
    expect(keys.size).toBeGreaterThan(8);
    for (const k of keys) for (const p of page) expect(p, k).toContain(k);
  });
});

describe('legal text matches the code (verification, November 2026)', () => {
  const text = (d: Parameters<typeof legalDoc>[0], lang: 'en' | 'fr') => { const x = legalDoc(d, lang); return [x.intro, ...x.sections.flatMap((s) => [s.heading, ...s.body])].join(' '); };
  it.each(['en', 'fr'] as const)('%s: taxes name every provincial tax billing charges (PST in BC/SK, RST in MB, QST in QC)', (lang) => {
    const api = readFileSync(join(REPO, 'apps/api/src/services/billing/tax.ts'), 'utf8');
    for (const t of ['PST', 'RST', 'QST']) expect(api).toContain(`'${t}'`);
    const words = lang === 'en' ? ['PST', 'RST', 'QST'] : ['TVP', 'TVD', 'TVQ'];
    for (const s of [text('terms', lang), text('refunds', lang), copy(lang).plans.renewalShort, copy(lang).plans.taxes]) for (const w of words) expect(s, w).toContain(w);
  });
  it.each(['en', 'fr'] as const)('%s: no response-time promise without a documented commitment; AODA cited for WCAG 2.0', (lang) => {
    const a = text('accessibility', lang);
    expect(a).not.toMatch(/business days|jours ouvrables/);
    expect(a).toContain('WCAG 2.0');
  });
  it.each(['en', 'fr'] as const)('%s: offline queues are not said to be wiped at sign-out (only rosters and cached pages are)', (lang) => {
    const c = text('cookies', lang);
    expect(c).not.toMatch(/cleared at sign-out\. Necessary|effacés à la déconnexion\. Nécessaire/);
    const api = readFileSync(join(REPO, 'apps/web/src/lib/api.ts'), 'utf8');
    expect(api).toContain("localStorage.removeItem('fh-lessons-cache')");
  });
  it.each(['en', 'fr'] as const)('%s: privacy policy cites s. 27 for portability and s. 28.1 for de-indexing, mentions booking requests and the unchosen email provider', (lang) => {
    const p = text('privacy', lang);
    expect(p).toMatch(lang === 'en' ? /portability, Law 25, s\. 27/ : /portabilité, Loi 25, art\. 27/);
    expect(p).toMatch(/28\.1/);
    expect(p).toMatch(lang === 'en' ? /booking requests/ : /demandes de réservation/i);
    expect(p).toMatch(lang === 'en' ? /not yet chosen/ : /pas encore choisi/);
    expect(p).toMatch(lang === 'en' ? /planned production hosting, at rest/ : /hébergement de production prévu, au repos/);
  });
});

describe('claims about FH staff access match the Dev console', () => {
  it.each(['en', 'fr'] as const)('%s: the FAQ does not say FH never sees employee records (the Dev console shows signed agreements with names and emails)', (lang) => {
    const api = readFileSync(join(REPO, 'apps/api/src/routes/platform/consents.ts'), 'utf8');
    expect(api).toMatch(/firstName: true, lastName: true, email: true/);
    const all = JSON.stringify(copy(lang));
    expect(all).not.toMatch(/never employee records|jamais les dossiers des employés/);
    expect(all).toMatch(lang === 'en' ? /signed information agreement/ : /entente d’information signée/);
    expect(all).not.toMatch(/prix garantis|prices guaranteed/i);
  });
});

describe('business details before launch', () => {
  it('every company setting the site reads is in the list a production build requires', async () => {
    const { REQUIRED_BUSINESS_ENV } = await import('../lib/site');
    const src = readFileSync(join(__dirname, '../lib/site.ts'), 'utf8');
    const read = [...src.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z_]+) \|\| '\[/g)].map((m) => m[1]);
    expect(read.length).toBeGreaterThan(5);
    expect([...REQUIRED_BUSINESS_ENV].sort()).toEqual([...new Set(read)].sort());
  });

  it('a production build goes out with placeholders, listing what is missing in its log', async () => {
    const { execFileSync } = await import('node:child_process');
    const cfg = join(__dirname, '../../next.config.mjs');
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NEXT_PUBLIC_') && k !== 'VERCEL_ENV' && k !== 'SITE_LAUNCH'));
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(`file://${cfg}`)})`], { env: { ...clean, VERCEL_ENV: 'production' } as unknown as NodeJS.ProcessEnv, stdio: 'pipe' });
    expect(String(out)).toBe('');
  });

  it('placeholders never show configuration variable names to visitors', () => {
    for (const v of [COMPANY.legalName, COMPANY.mailingAddress, COMPANY.email, COMPANY.privacyOfficer.name, COMPANY.privacyOfficer.email, COMPANY.copyrightContact.name, COMPANY.copyrightContact.address, COMPANY.copyrightContact.email]) {
      expect(v).not.toMatch(/NEXT_PUBLIC_/);
    }
  });
});
