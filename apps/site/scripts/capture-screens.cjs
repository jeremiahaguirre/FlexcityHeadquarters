/**
 * Captures the website's app screenshots (apps/site/public/screens/*.webp) from the static demo
 * build of the app: the fictional "City of Lakeview (demo)" with invented people, nothing real.
 *
 *   1. Build the demo:   cd apps/web && NEXT_PUBLIC_DEMO=1 npx next build        (writes apps/web/out)
 *      (a build made with NEXT_BASE_PATH works too: pass the same path in DEMO_BASE below)
 *   2. Serve it:         node apps/web/e2e/serve-demo.cjs 3310
 *   3. Capture:          NODE_PATH=/opt/node-tools/node_modules node apps/site/scripts/capture-screens.cjs
 *      env DEMO_BASE (default http://localhost:3310), ONLY=phone-board,laptop-hr to redo some.
 *
 * Phones: 390×844 at 2×, saved at 585×1266. Laptops: 1440×900 at 2×, saved at 1440×900.
 * English and French, light and dark. The demo banner is hidden. Look at every new image
 * before committing: no real names, no real crests, no spinners, no empty lists.
 */
const { chromium } = require('playwright');
const sharp = require('sharp');
const { join } = require('node:path');

const BASE = (process.env.DEMO_BASE ?? 'http://localhost:3310').replace(/\/$/, '');
const OUT = join(__dirname, '../public/screens');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
// A fixed mid-afternoon on a weekday. The demo's open punch is labelled in Mountain time,
// so phones use that zone and "worked" agrees with "since".
const NOW = new Date('2026-11-10T22:10:00Z');

const T = {
  en: { plus: 'One more', calendar: 'Add my shifts to my phone’s calendar' },
  fr: { plus: 'Un de plus', calendar: 'Ajouter mes quarts à l’agenda de mon téléphone' },
};

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1440, height: 900 };

/** name → [role, size, how to stage the screen] */
const SHOTS = {
  'phone-board': ['STAFF', PHONE, async (p) => go(p, '/board/')],
  'phone-count': ['STAFF', PHONE, async (p, t) => {
    await go(p, '/headcount/');
    for (let i = 0; i < 7; i++) { await p.getByRole('button', { name: t.plus }).click(); await p.waitForTimeout(80); }
  }],
  'phone-schedule': ['STAFF', PHONE, async (p, t) => {
    await go(p, '/schedule/');
    // Past the trade requests (their notes are free text, in English) to the shifts themselves.
    const link = p.getByText(t.calendar).first();
    await link.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 76));
  }],
  'phone-pay': ['STAFF', PHONE, async (p) => go(p, '/pay/')],
  'phone-timeoff': ['STAFF', PHONE, async (p) => go(p, '/time-off/')],
  'laptop-hr': ['HR_ADMIN', LAPTOP, async (p) => go(p, '/manage/hr/')],
  'laptop-casefile': ['HR_ADMIN', LAPTOP, async (p) => {
    await go(p, '/manage/people/');
    await p.locator('main a[href*="person"]').first().click();
    const cf = p.locator('#case-file');
    await cf.waitFor();
    await p.waitForTimeout(800);
    await cf.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 88));
  }],
  'laptop-orgchart': ['HR_ADMIN', LAPTOP, async (p) => go(p, '/manage/org-chart/')],
  'laptop-coverage': ['AQUATIC_SUPERVISOR', LAPTOP, async (p) => go(p, '/manage/coverage/')],
  'laptop-overtime': ['AQUATIC_SUPERVISOR', LAPTOP, async (p) => go(p, '/manage/overtime/')],
  'laptop-onboarding': ['HR_ADMIN', LAPTOP, async (p) => go(p, '/manage/onboarding/')],
};

async function go(p, path) {
  await p.goto(`${BASE}${path}`);
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(1200);
}

(async () => {
  const b = await chromium.launch();
  for (const [name, [role, vp, stage]] of Object.entries(SHOTS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    for (const lang of ['en', 'fr']) for (const scheme of ['light', 'dark']) {
      const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: vp === PHONE ? 'America/Edmonton' : 'America/Vancouver', locale: lang === 'fr' ? 'fr-CA' : 'en-CA' });
      await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        // No demo banner, no scrollbars, no blinking caret.
        st.textContent = '[data-demo-banner]{display:none!important} ::-webkit-scrollbar{display:none} *{scrollbar-width:none;caret-color:transparent!important}';
        document.head.appendChild(st);
      }));
      const p = await ctx.newPage();
      await p.clock.install({ time: NOW });
      await p.goto(`${BASE}/login/?as=${role}&lang=${lang}`);
      await p.waitForURL((u) => !u.pathname.includes('/login'));
      await p.waitForTimeout(1000);
      await stage(p, T[lang]);
      await p.mouse.move(vp.width - 2, vp.height - 2);
      await p.waitForTimeout(900);
      const png = await p.screenshot();
      const file = join(OUT, `${name}-${lang}-${scheme}.webp`);
      const w = vp === PHONE ? 585 : 1440;
      const info = await sharp(png).resize({ width: w }).webp({ quality: vp === PHONE ? 80 : 78, effort: 6 }).toFile(file);
      console.log(file, `${Math.round(info.size / 1024)} KB`);
      await ctx.close();
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
