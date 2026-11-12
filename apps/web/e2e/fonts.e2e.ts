import { type Page, expect, test } from '@playwright/test';
import { type DemoRole, open, signInAs } from './helpers';

/**
 * Fonts stay within the app: every font comes from our own origin (the woff2 in src/fonts), the brand
 * font actually renders, and no page asks any other host for anything (external requests are aborted
 * and fail the test).
 */
function watch(page: Page) {
  const external: string[] = [];
  const fonts: string[] = [];
  const origin = new URL(test.info().project.use.baseURL!).origin;
  void page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.resourceType() === 'font' || /\.(woff2?|ttf|otf|eot)$/.test(url.pathname)) fonts.push(req.url());
    if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {
      external.push(req.url());
      return route.abort();
    }
    return route.continue();
  });
  return { external, fonts, origin };
}

async function expectBrandFont(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  expect(faces).toContain('jakarta');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('main h1') ?? document.body).fontFamily)).toMatch(/^jakarta,/);
}

test.describe('fonts are our own', () => {
  test('public pages (sign-in, jobs, program sign-up, kiosk) in English and French', async ({ page, context }) => {
    const w = watch(page);
    for (const locale of ['en-CA', 'fr-CA']) {
      await context.addCookies([{ name: 'fc_locale', value: locale, url: w.origin }]);
      for (const path of ['/login/', '/jobs/', '/signup/', '/kiosk/']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expectBrandFont(page);
      }
    }
    expect(w.external).toEqual([]);
    expect(w.fonts.length).toBeGreaterThan(0);
    for (const f of w.fonts) expect(f.startsWith(`${w.origin}/`), f).toBe(true);
  });

  const screens: Array<[DemoRole, string[]]> = [
    ['STAFF', ['/today', '/timeclock', '/pay']],
    ['AQUATIC_SUPERVISOR', ['/manage/schedule']],
    ['HR_ADMIN', ['/manage/payroll']],
    ['UNION_STEWARD', ['/union']],
  ];
  for (const [role, paths] of screens)
    test(`signed-in screens for ${role}`, async ({ page }) => {
      const w = watch(page);
      await signInAs(page, role);
      for (const path of paths) {
        await open(page, path);
        await expectBrandFont(page);
      }
      expect(w.external).toEqual([]);
      for (const f of w.fonts) expect(f.startsWith(`${w.origin}/`), f).toBe(true);
    });
});
