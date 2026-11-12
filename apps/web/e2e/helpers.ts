import { type Page, expect } from '@playwright/test';

/** Demo roles, as the marketing site links into them (/login?as=ROLE). */
export type DemoRole = 'STAFF' | 'AQUATIC_SUPERVISOR' | 'HR_ADMIN' | 'FRONT_DESK' | 'UNION_STEWARD' | 'EMPLOYEE';

/** Signs in as a demo role and waits for the app to open. */
export async function signInAs(page: Page, role: DemoRole) {
  await page.goto(`/login/?as=${role}`);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await expect(page.locator('main h1').first()).toBeVisible();
}

/** Opens an app screen in the same tab (the demo keeps its session per tab) and waits for its heading. */
export async function open(page: Page, path: string) {
  const [route, query] = path.split('?');
  await page.goto(`${route!.endsWith('/') ? route : `${route}/`}${query ? `?${query}` : ''}`);
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

export const tabBar = (page: Page) => page.locator('nav.fh-tabbar');

/** How far the page is wider than the screen (0 or less: no sideways scrolling). */
export const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Collects uncaught errors and React hydration errors for the rest of the test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /hydrat|#418|#423|#425|Minified React error/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Shows the app in Canadian French (set before signing in). */
export async function inFrench(page: Page, baseURL: string | undefined) {
  await page.context().addCookies([{ name: 'fc_locale', value: 'fr-CA', url: baseURL! }]);
}
