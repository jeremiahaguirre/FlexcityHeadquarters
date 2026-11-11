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
  await page.goto(path.endsWith('/') ? path : `${path}/`);
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

export const tabBar = (page: Page) => page.locator('nav.fh-tabbar');
