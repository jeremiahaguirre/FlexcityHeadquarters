/**
 * Captures the hi-res product assets the hook cut pushes in on (render/assets/), from the static demo
 * build: the fictional "City of Lakeview (demo)" with invented people, nothing real.
 *
 *   1. Build and serve the demo as in ../README.md ("Retaking the screenshots"), on port 3310.
 *   2. node marketing/google-flow-ad/render/capture-assets.cjs      (env DEMO_BASE, CHROMIUM)
 *   3. python3 marketing/google-flow-ad/render/pack-assets.py        (PNG -> lossless WebP, deletes the PNGs)
 *
 * Desktop pages are 1280x800 CSS px at 3x, phone screens 405x720 at 8/3x (1080x1920), and the phone
 * close-ups (the slide-to-clock-in control, the sign-in header) at 6x, so the stage can push in tight
 * and stay sharp. The slide control is captured mid-drag with a real pointer, one frame per position.
 * Light mode, demo banner hidden, fixed clock. Look at every image before committing.
 */
const { chromium } = require('playwright');
const { join } = require('node:path');
const { mkdirSync } = require('node:fs');

const BASE = (process.env.DEMO_BASE ?? 'http://localhost:3310').replace(/\/$/, '');
const OUT = join(__dirname, 'assets');
const EXE = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const NOW = new Date('2026-11-11T22:10:00Z');
const SLIDE_STEPS = 24;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;   // e.g. ONLY=slide,signin
const want = (k) => !ONLY || ONLY.includes(k);
mkdirSync(OUT, { recursive: true });

const T = {
  en: { slideIn: 'Slide to clock in', calendar: 'Add my shifts to my phone’s calendar', week: 'Week', hidePeople: 'Hide the people list', runs: 'Pay runs' },
  fr: { slideIn: 'Glisser pour pointer', calendar: 'Ajouter mes quarts à l’agenda de mon téléphone', week: 'Semaine', hidePeople: 'Masquer la liste des personnes', runs: 'Paies' },
};

async function open(b, { vp, scale, lang, role, path }) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: scale, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'America/Vancouver', locale: lang === 'fr' ? 'fr-CA' : 'en-CA' });
  await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '[data-demo-banner]{display:none!important} ::-webkit-scrollbar{display:none} *{scrollbar-width:none;caret-color:transparent!important}';
    document.head.appendChild(st);
  }));
  const p = await ctx.newPage();
  await p.clock.install({ time: NOW });
  if (role) {
    await p.goto(`${BASE}/login/?as=${role}&lang=${lang}`);
    await p.waitForURL((u) => !u.pathname.includes('/login'));
    await p.waitForTimeout(800);
  } else {
    await p.goto(`${BASE}/login/?lang=${lang}`);
  }
  if (path) await p.goto(`${BASE}${path}`);
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(1500);
  return { p, ctx };
}
const shot = async (p, name, clip) => { await p.mouse.move(2, 2); await p.waitForTimeout(400); await p.screenshot({ path: join(OUT, name + '.png'), clip }); console.log(name); };
const pad = (r, n) => ({ x: Math.max(0, r.x - n), y: Math.max(0, r.y - n), width: r.width + 2 * n, height: r.height + 2 * n });

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  for (const lang of ['en', 'fr']) {
    const t = T[lang], sfx = lang === 'fr' ? '-fr' : '';
    const DESK = { vp: { width: 1280, height: 800 }, scale: 3, lang };
    const PHONE = { vp: { width: 405, height: 720 }, scale: 8 / 3, lang };

    // Schedule builder, week view, people list hidden (the grid the "Scheduling" beat pushes in on).
    if (want('schedule')) { const { p, ctx } = await open(b, { ...DESK, role: 'AQUATIC_SUPERVISOR', path: '/manage/schedule/' });
      const week = p.getByRole('radio', { name: t.week, exact: true });
      await week.click();
      await p.locator('section [data-drop^="shift|"]').first().waitFor({ state: 'attached' });
      await p.getByRole('button', { name: t.hidePeople }).click();
      await p.waitForTimeout(1500);
      await week.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
      await shot(p, `schedule-grid${sfx}`);
      await ctx.close(); }

    // Payroll, pay runs table.
    if (want('payroll')) { const { p, ctx } = await open(b, { ...DESK, role: 'HR_ADMIN', path: '/manage/payroll/' });
      await shot(p, `payroll${sfx}`);
      await ctx.close(); }

    // Slide to clock in: the Clock in card at 6x, the thumb dragged across with a real pointer.
    if (want('slide')) { const { p, ctx } = await open(b, { vp: PHONE.vp, scale: 6, lang, role: 'EMPLOYEE', path: '/today/' });
      const thumb = p.getByRole('button', { name: t.slideIn });
      await thumb.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 170));
      await p.waitForTimeout(800);
      const card = await thumb.evaluate((el) => {
        const tr = el.parentElement.getBoundingClientRect();
        let n = el.parentElement;
        while (n.parentElement && n.getBoundingClientRect().height < tr.height + 40) n = n.parentElement;
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const clip = pad(card, 10);
      const tb = await thumb.boundingBox(), track = await thumb.evaluate((el) => { const r = el.parentElement.getBoundingClientRect(); return { x: r.x, width: r.width }; });
      const x0 = tb.x + tb.width / 2, y0 = tb.y + tb.height / 2, run = track.width - tb.width - 8;
      await shot(p, `slide${sfx}-00`, clip);
      await p.mouse.move(x0, y0); await p.mouse.down();
      for (let i = 1; i <= SLIDE_STEPS; i++) {
        await p.mouse.move(x0 + (run * i) / SLIDE_STEPS, y0, { steps: 2 });
        await p.waitForTimeout(120);
        await p.screenshot({ path: join(OUT, `slide${sfx}-${String(i).padStart(2, '0')}.png`), clip });
      }
      // Released at the end: the thumb shows its tick for a moment, before the clock-in sheet opens.
      // The sheet that follows is hidden here, so the tick is shown on the undimmed card.
      await p.addStyleTag({ content: 'dialog,[role="dialog"],[role="alertdialog"],.fixed.inset-0,::backdrop{display:none!important;opacity:0!important}' });
      await p.mouse.up();
      await p.waitForTimeout(60);
      await p.screenshot({ path: join(OUT, `slide${sfx}-done.png`), clip });
      console.log(`slide${sfx} x${SLIDE_STEPS}`);
      await ctx.close(); }

    // Sign-in header (logo, motto, the city, "Sign in"), phone width at 6x; the language switch is top right.
    if (want('signin')) { const { p, ctx } = await open(b, { vp: PHONE.vp, scale: 6, lang });
      const tryAs = await p.getByText(lang === 'fr' ? 'Essayez en tant que' : 'Try it as', { exact: false }).first().boundingBox();
      await shot(p, `signin${sfx}`, { x: 0, y: 0, width: 405, height: Math.round(tryAs.y - 14) });
      await ctx.close(); }

    // Three full phone screens for "On any phone".
    if (want('phones')) { const { p, ctx } = await open(b, { ...PHONE, role: 'EMPLOYEE', path: '/today/' });
      await shot(p, `phone-today${sfx}`); await ctx.close(); }
    if (want('phones')) { const { p, ctx } = await open(b, { ...PHONE, role: 'STAFF', path: '/schedule/' });
      const link = p.getByText(t.calendar).first();
      await link.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 76));
      await shot(p, `phone-schedule${sfx}`); await ctx.close(); }
    if (want('phones')) { const { p, ctx } = await open(b, { ...PHONE, role: 'STAFF', path: '/pay/' });
      await shot(p, `phone-pay${sfx}`); await ctx.close(); }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
