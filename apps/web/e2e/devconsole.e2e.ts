import { type Page, expect, test } from '@playwright/test';

/**
 * The FH Dev console in the static demo: reached from the demo's sign-in page (not from the website),
 * signed in with the demo password and no passkey step, every main screen answered from recordings.
 */

const SCREENS: Array<[path: string, heading: RegExp]> = [
  ['/platform', /Cities/],
  ['/platform/billing', /Billing/],
  ['/platform/debits', /Pre-authorized debits/],
  ['/platform/books', /FH books/],
  ['/platform/enquiries', /Website enquiries/],
  ['/platform/payroll-tax', /Payroll tax tables/],
  ['/platform/account', /Your account/],
  ['/platform/trust', /Security and compliance/],
  ['/platform/trust/frameworks', /Frameworks/],
  ['/platform/trust/controls', /Controls/],
  ['/platform/trust/tests', /Tests/],
  ['/platform/trust/evidence', /Evidence/],
  ['/platform/trust/policies', /Policies/],
  ['/platform/trust/risks', /Risks/],
  ['/platform/trust/vendors', /Vendors/],
  ['/platform/trust/commitments', /Commitments/],
  ['/platform/trust/questionnaires', /Questionnaires/],
  ['/platform/trust/present', /security posture/i],
];

/** Page errors, and demo answers that weren't recorded (the console asks /api/platform/… only outside the demo). */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${new URL(r.url()).pathname}`));
  return problems;
}

async function signInToConsole(page: Page) {
  await page.goto('/login/');
  const section = page.getByRole('region', { name: 'FH Dev console (demo)' });
  await expect(section).toBeVisible();
  await expect(section).toContainText('dev@flexcity.dev');
  await section.getByRole('button', { name: 'Open the Dev console' }).click();
  await page.waitForURL((u) => /\/platform\/?$/.test(u.pathname));
  await expect(page.locator('main h1').first()).toHaveText(/Cities/);
}

async function openScreen(page: Page, path: string, heading: RegExp) {
  await page.goto(`${path}/`);
  await expect(page.locator('main h1').first()).toHaveText(heading);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Something went wrong', { exact: false })).toHaveCount(0);
  await expect(page.getByText('not available in the demo', { exact: false })).toHaveCount(0);
}

for (const [name, viewport] of [['phone', null], ['desktop', { width: 1440, height: 900 }]] as const) {
  test.describe(`Dev console in the demo (${name})`, () => {
    if (viewport) test.use({ viewport, isMobile: false, hasTouch: false });

    test('the demo sign-in page offers the Dev console apart from the roles, with a demo note instead of a passkey', async ({ page }) => {
      const problems = watch(page);
      await page.goto('/platform/login/');
      await expect(page.getByText('there’s no passkey step here')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toHaveCount(0);
      // Signing in on the console's own page with the demo password works too.
      await page.getByLabel('Email').fill('dev@flexcity.dev');
      await page.getByLabel('Password').fill('flexcity-dev');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL((u) => /\/platform\/?$/.test(u.pathname));
      await page.getByRole('button', { name: 'Sign out' }).first().click();
      await page.waitForURL((u) => u.pathname.includes('/platform/login'));
      await signInToConsole(page);
      expect(problems).toEqual([]);
    });

    test('every main screen opens with recorded data and no errors', async ({ page }) => {
      test.setTimeout(120_000);
      const problems = watch(page);
      await signInToConsole(page);
      // An organization, and each of its tabs.
      const city = page.locator('main a[href*="/platform/city"]').first();
      await expect(city).toBeVisible();
      await city.click();
      await expect(page.locator('main h1').first()).toHaveText(/Lakeview/);
      for (const tab of ['facilities', 'positions', 'features', 'access', 'integrations', 'billing', 'payroll', 'lifecycle', 'consents']) {
        await page.goto(`${new URL(page.url()).pathname}?id=${new URL(page.url()).searchParams.get('id')}&tab=${tab}`);
        await expect(page.locator('main h1').first()).toHaveText(/Lakeview/);
        await page.waitForLoadState('networkidle');
        await expect(page.getByText('Something went wrong', { exact: false }), tab).toHaveCount(0);
      }
      for (const [path, heading] of SCREENS) await openScreen(page, path, heading);
      // An invoice from the billing list.
      await openScreen(page, '/platform/billing', /Billing/);
      await page.locator('main a[href*="/platform/invoice"]:visible').first().click();
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect(page.getByText('Something went wrong', { exact: false })).toHaveCount(0);
      // Recorded lists aren't empty.
      await openScreen(page, '/platform/enquiries', /Website enquiries/);
      await page.getByRole('radio', { name: 'All' }).click();
      await expect(page.locator('main article').first()).toBeVisible();
      await openScreen(page, '/platform/trust/controls', /Controls/);
      await expect(page.locator('main').getByText('Dev console needs a passkey').locator('visible=true').first()).toBeVisible();
      if (name === 'phone') {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'Trust › Controls is wider than the screen').toBeLessThanOrEqual(0);
      }
      expect(problems).toEqual([]);
    });

    test('a change looks saved, like the rest of the demo', async ({ page }) => {
      const problems = watch(page);
      await signInToConsole(page);
      await openScreen(page, '/platform/enquiries', /Website enquiries/);
      await page.locator('main article button[aria-expanded]').first().click();
      await page.getByLabel('Notes').first().fill('Called back, demo booked for Tuesday.');
      await page.getByRole('button', { name: 'Save notes' }).first().click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
      await expect(page.getByText('nothing you do here is saved', { exact: false })).toBeVisible();
      expect(problems).toEqual([]);
    });
  });
}
