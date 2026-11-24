import { expect, test } from '@playwright/test';
import { type DemoRole, inFrench, open, sideways, signInAs, tabBar } from './helpers';

test.describe('phone layout', () => {
  test('the tab bar hides while typing in a field and comes back after', async ({ page }) => {
    await signInAs(page, 'STAFF');
    await open(page, '/time-off');
    await expect(tabBar(page)).toBeVisible();
    await page.getByRole('button', { name: 'Request time off' }).first().click();
    const note = page.locator('dialog[open] textarea[name="note"]');
    await note.tap();
    await expect(page.locator('html')).toHaveAttribute('data-kb', 'open');
    await expect(tabBar(page)).toBeHidden();
    await note.fill('Family wedding');
    await page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-kb', 'open');
    await expect(tabBar(page)).toBeVisible();
  });

  test('a bottom sheet keeps the focused field in view when the screen gets short', async ({ page }) => {
    await signInAs(page, 'STAFF');
    await open(page, '/time-off');
    await page.getByRole('button', { name: 'Request time off' }).first().click();
    const note = page.locator('dialog[open] textarea[name="note"]');
    await note.tap();
    // About what's left above an iPhone keyboard.
    await page.setViewportSize({ width: 390, height: 360 });
    await expect
      .poll(async () => {
        const r = await note.boundingBox();
        const h = await page.evaluate(() => window.visualViewport?.height ?? window.innerHeight);
        return !!r && r.y >= 0 && r.y + Math.min(r.height, 40) <= h;
      })
      .toBe(true);
    await expect(note).toBeFocused();
  });

  test('a menu screen the role can’t use says so', async ({ page }) => {
    await signInAs(page, 'STAFF');
    await page.goto('/manage/payroll/');
    await expect(page.getByRole('heading', { name: 'This screen isn’t part of your access' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Today' })).toBeVisible();
  });

  const KEY_PAGES: Record<string, string[]> = {
    STAFF: ['/today', '/schedule', '/time-off', '/expenses', '/profile'],
    AQUATIC_SUPERVISOR: ['/today', '/schedule', '/manage/forecast', '/manage/approvals'],
    HR_ADMIN: ['/manage/hr', '/manage/staff', '/expenses', '/manage/payroll'],
  };

  for (const [role, pages] of Object.entries(KEY_PAGES)) {
    test(`no sideways scrolling at 390 px (${role})`, async ({ page }) => {
      await signInAs(page, role as DemoRole);
      for (const path of pages) {
        await open(page, path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} is wider than the screen`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('text fields are at least 16 px, so iPhones don’t zoom in', async ({ page }) => {
    await signInAs(page, 'STAFF');
    const small: string[] = [];
    let checked = 0;
    const check = async (where: string) => {
      const fields = await page.evaluate(() =>
        [...document.querySelectorAll('input, select, textarea')]
          .filter((el) => {
            const i = el as HTMLInputElement;
            if (['checkbox', 'radio', 'hidden', 'range', 'file', 'button', 'submit', 'color'].includes(i.type)) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => ({ name: `${el.tagName.toLowerCase()}[name=${(el as HTMLInputElement).name || '?'}]`, size: parseFloat(getComputedStyle(el).fontSize) })),
      );
      checked += fields.length;
      small.push(...fields.filter((f) => f.size < 16).map((f) => `${where}: ${f.name} ${f.size}px`));
    };
    for (const path of ['/time-off', '/expenses', '/availability', '/profile']) {
      await open(page, path);
      await check(path);
    }
    await open(page, '/time-off');
    await page.getByRole('button', { name: 'Request time off' }).first().click();
    await check('/time-off (request)');
    await page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();
    await open(page, '/expenses');
    await page.getByRole('button', { name: /new claim/i }).first().click();
    await check('/expenses (new claim)');
    expect(checked).toBeGreaterThan(5);
    expect(small).toEqual([]);
  });

  test('pages hydrate without React errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /hydrat|#418|#423|#425/i.test(m.text())) errors.push(m.text());
    });
    // The race this guards against (React error #418) showed on roughly a third of loads.
    for (let i = 0; i < 10; i++) {
      await page.goto('/login/');
      await expect(page.getByRole('heading').first()).toBeVisible();
    }
    await signInAs(page, 'FRONT_DESK');
    for (const path of ['/today', '/expenses', '/today', '/expenses']) await open(page, path);
    expect(errors).toEqual([]);
  });

  for (const role of ['STAFF', 'AQUATIC_SUPERVISOR', 'HR_ADMIN', 'FRONT_DESK'] as DemoRole[]) {
    test(`French tab labels fit (${role})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'fc_locale', value: 'fr-CA', url: baseURL! }]);
      await signInAs(page, role);
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
      const labels = tabBar(page).locator('li > a > span:last-child, li > button');
      await expect(labels.first()).toBeVisible();
      const cut = await labels.evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent));
      expect(cut, 'tab labels cut off').toEqual([]);
    });
  }

  for (const lang of ['en-CA', 'fr-CA'] as const) {
    test(`the timeclock’s buttons for other shifts fit at 390 px (${lang})`, async ({ page, context, baseURL }) => {
      // 4 a.m. in Vancouver, before the water plant's 7:00 shift: it's offered as its own button
      // ("Clock in · 7:00 a.m.–3:30 p.m. · Water Treatment Plant") instead of being suggested.
      const now = new Date();
      await page.clock.setFixedTime(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0)));
      if (lang === 'fr-CA') await context.addCookies([{ name: 'fc_locale', value: 'fr-CA', url: baseURL! }]);
      await signInAs(page, 'EMPLOYEE');
      await open(page, '/timeclock');
      const shift = page.getByRole('button', { name: lang === 'fr-CA' ? /Pointer l’arrivée ·/ : /Clock in ·/ }).first();
      await expect(shift).toBeVisible();
      expect(await sideways(page), 'the timeclock is wider than the screen').toBeLessThanOrEqual(0);
      const cut = await page.locator('main button').evaluateAll((els) =>
        els.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > document.documentElement.clientWidth).map((el) => el.textContent),
      );
      expect(cut, 'buttons cut off or past the edge').toEqual([]);
    });
  }

  test('the demo’s open punch started a few hours ago', async ({ page }) => {
    await signInAs(page, 'STAFF');
    const clock = page.getByRole('button', { name: /^On the clock for \d+:\d\d/ }).first();
    await expect(clock).toBeVisible();
    const hours = Number(/for (\d+):/.exec((await clock.getAttribute('aria-label')) ?? '')?.[1]);
    expect(hours).toBeGreaterThanOrEqual(1);
    expect(hours).toBeLessThan(6);
  });

  test('the supervisor’s Lone workers screen has someone on it, in French on a French screen', async ({ page, baseURL }) => {
    await inFrench(page, baseURL);
    await signInAs(page, 'AQUATIC_SUPERVISOR');
    await open(page, '/manage/lone-work');
    await expect(page.getByText('Salle mécanique de la piscine', { exact: false })).toBeVisible();
    await expect(page.getByText(/Pool mechanical room|Chlorine feed/)).toHaveCount(0);
  });
});
