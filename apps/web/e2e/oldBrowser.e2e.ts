import { expect, test } from '@playwright/test';
import { signInAs, watchErrors } from './helpers';

/**
 * The "please update your browser" notice (src/lib/browserCheck.ts, components/OldBrowser.tsx): never on
 * a supported browser, and the only thing on screen when the check fails. Old browsers can't be run here,
 * so the failing cases take away the feature the check looks for before the page loads.
 */
const notice = '#fh-old-browser';

test.describe('unsupported-browser notice', () => {
  test('stays hidden on a supported browser: sign-in, kiosk and a signed-in screen work as usual', async ({ page }) => {
    const errors = watchErrors(page);
    for (const path of ['/login/', '/kiosk/']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('html')).not.toHaveAttribute('data-old-browser');
      await expect(page.locator(notice)).toBeHidden();
      await expect(page.getByText('Please update your browser')).toBeHidden();
    }
    // The three features the check looks for are really there in this browser.
    expect(
      await page.evaluate(() => {
        let lookbehind = true;
        try {
          new RegExp('(?<=a)b');
        } catch {
          lookbehind = false;
        }
        return [lookbehind, CSS.supports('width', 'calc(1px * sin(1rad))'), CSS.supports('container-type', 'inline-size')];
      }),
    ).toEqual([true, true, true]);
    await signInAs(page, 'STAFF');
    await expect(page.locator(notice)).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('replaces the page in English and French when the browser is too old (Chrome/Firefox check)', async ({ page }) => {
    await page.addInitScript(() => {
      CSS.supports = () => false;
    });
    await page.goto('/login/');
    await expect(page.locator('html')).toHaveAttribute('data-old-browser', '');
    await expect(page.locator(notice)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Please update your browser' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Veuillez mettre à jour votre navigateur' })).toBeVisible();
    await expect(page.locator(`${notice} [lang="en-CA"]`)).toContainText('Chrome, Edge or Firefox 111 or newer, or Safari 16.4 or newer');
    await expect(page.locator(`${notice} [lang="fr-CA"]`)).toContainText('Chrome, Edge ou Firefox 111 ou plus récent, ou Safari 16.4 ou plus récent');
    await expect(page.locator(`${notice} .fh-ob-update`).first()).toBeVisible();
    await expect(page.locator(`${notice} .fh-ob-kiosk`).first()).toBeHidden();
    // The frozen page underneath is gone.
    await expect(page.locator('main')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  });

  test('on the kiosk, tells staff to ask their supervisor (Safari check)', async ({ page }) => {
    await page.addInitScript(() => {
      const Native = RegExp;
      // Safari before 16.4: lookbehind is a syntax error.
      window.RegExp = function (pattern: string | RegExp, flags?: string) {
        if (typeof pattern === 'string' && pattern.startsWith('(?<=')) throw new SyntaxError('Invalid regular expression: invalid group specifier name');
        return new Native(pattern, flags);
      } as unknown as RegExpConstructor;
    });
    await page.goto('/kiosk/');
    await expect(page.locator('html')).toHaveAttribute('data-old-browser', 'kiosk');
    await expect(page.locator(notice)).toBeVisible();
    await expect(page.locator(`${notice} [lang="en-CA"] .fh-ob-kiosk`)).toContainText('ask your supervisor to update it');
    await expect(page.locator(`${notice} [lang="fr-CA"] .fh-ob-kiosk`)).toContainText('demandez à votre superviseur de la mettre à jour');
    await expect(page.locator(`${notice} .fh-ob-update`).first()).toBeHidden();
  });
});
