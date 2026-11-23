/**
 * Captures the Google Flow ad's screenshots from the static demo build of the app: the fictional
 * "City of Lakeview (demo)" with invented people, nothing real.
 *
 *   1. npm ci, then (cd apps/api && npx prisma generate), then (cd apps/web && npm run build:demo)
 *   2. node apps/web/e2e/serve-demo.cjs 3310
 *   3. node marketing/google-flow-ad/capture.cjs        (env DEMO_BASE, ONLY=01-punch-in,03-working-alone)
 *
 * 9:16 phone shots: 405×720 viewport at 8/3× = 1080×1920. 16:9 laptop shots: 1280×720 at 1.5× = 1920×1080.
 * Light mode, demo banner hidden, fixed clock. Look at every image before committing.
 */
const { chromium } = require('playwright');
const { join } = require('node:path');

const BASE = (process.env.DEMO_BASE ?? 'http://localhost:3310').replace(/\/$/, '');
const OUT = join(__dirname, 'screenshots');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const EXE = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const NOW = new Date('2026-11-10T22:10:00Z');

const PHONE = { vp: { width: 405, height: 720 }, scale: 8 / 3, tag: '9x16' };
const LAPTOP = { vp: { width: 1280, height: 720 }, scale: 1.5, tag: '16x9' };

const T = {
  en: { slideIn: 'Slide to clock in', calendar: 'Add my shifts to my phone’s calendar', week: 'Week', hidePeople: 'Hide the people list' },
  fr: { slideIn: 'Glisser pour pointer', calendar: 'Ajouter mes quarts à l’agenda de mon téléphone', week: 'Semaine', hidePeople: 'Masquer la liste des personnes' },
};

async function go(p, path) {
  await p.goto(`${BASE}${path}`);
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(1200);
}

/** name → { role (null = signed out), sizes, langs, stage, time } */
const SHOTS = {
  // Today, scrolled to the Clock in card. (The Timeclock page's per-shift buttons overflow on narrow
  // phones, and the demo's sample open punch is 27 hours old, so the clocked-in state isn't shown.)
  '01-punch-in': { role: 'EMPLOYEE', sizes: [PHONE], langs: ['en', 'fr'], stage: async (p, t) => {
    await go(p, '/today/');
    await p.getByRole('button', { name: t.slideIn }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 170));
    await p.waitForTimeout(800);
  } },
  // Past the trade requests (free text) to the shifts themselves.
  '02-schedule': { role: 'STAFF', sizes: [PHONE], langs: ['en', 'fr'], stage: async (p, t) => {
    await go(p, '/schedule/');
    const link = p.getByText(t.calendar).first();
    await link.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 76));
    await p.waitForTimeout(600);
  } },
  '02-schedule-builder': { role: 'AQUATIC_SUPERVISOR', sizes: [LAPTOP], langs: ['en', 'fr'], time: new Date('2026-11-11T22:10:00Z'), stage: async (p, t) => {
    await go(p, '/manage/schedule/');
    const week = p.getByRole('radio', { name: t.week, exact: true });
    await week.click();
    await p.locator('section [data-drop^="shift|"]').first().waitFor({ state: 'attached' });
    await p.getByRole('button', { name: t.hidePeople }).click();
    await p.waitForTimeout(1500);
    await week.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
  } },
  '03-working-alone': { role: 'EMPLOYEE', sizes: [PHONE], langs: ['en', 'fr'], stage: (p) => go(p, '/alone/') },
  '04-approvals': { role: 'AQUATIC_SUPERVISOR', sizes: [LAPTOP, PHONE], langs: ['en'], stage: (p) => go(p, '/manage/approvals/') },
  '05-payroll': { role: 'HR_ADMIN', sizes: [LAPTOP], langs: ['en'], stage: (p) => go(p, '/manage/payroll/') },
  '05-hr-overview': { role: 'HR_ADMIN', sizes: [LAPTOP], langs: ['en'], stage: (p) => go(p, '/manage/hr/') },
  '05-pay-statement': { role: 'STAFF', sizes: [PHONE], langs: ['en'], stage: (p) => go(p, '/pay/') },
  '06-bilingual-sign-in': { role: null, sizes: [PHONE, LAPTOP], langs: ['en', 'fr'], stage: async (p) => { await p.waitForTimeout(2500); } },
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  for (const [name, s] of Object.entries(SHOTS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    for (const size of s.sizes) for (const lang of s.langs) {
      const ctx = await b.newContext({ viewport: size.vp, deviceScaleFactor: size.scale, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'America/Vancouver', locale: lang === 'fr' ? 'fr-CA' : 'en-CA' });
      await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '[data-demo-banner]{display:none!important} ::-webkit-scrollbar{display:none} *{scrollbar-width:none;caret-color:transparent!important}';
        document.head.appendChild(st);
      }));
      const p = await ctx.newPage();
      await p.clock.install({ time: s.time ?? NOW });
      if (s.role) {
        await p.goto(`${BASE}/login/?as=${s.role}&lang=${lang}`);
        await p.waitForURL((u) => !u.pathname.includes('/login'));
        await p.waitForTimeout(1000);
      } else {
        await p.goto(`${BASE}/login/?lang=${lang}`);
        await p.waitForLoadState('networkidle');
      }
      await s.stage(p, T[lang]);
      await p.mouse.move(size.vp.width - 2, size.vp.height - 2);
      await p.waitForTimeout(800);
      const file = join(OUT, `${name}-${size.tag}${lang === 'fr' ? '-fr' : ''}.png`);
      await p.screenshot({ path: file });
      console.log(file);
      await ctx.close();
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
