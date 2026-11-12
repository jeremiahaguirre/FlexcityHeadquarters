import { expect, test } from '@playwright/test';
import { open, signInAs } from './helpers';

/** Scheduling by hand on a phone: no dragging, tap a shift for a ranked list or pick a person first. */
test.describe('schedule builder on a phone', () => {
  test('tap a shift, then a person who can work it, to assign', async ({ page }) => {
    await signInAs(page, 'AQUATIC_SUPERVISOR');
    await open(page, '/manage/schedule');
    await page.getByRole('radio', { name: 'Week', exact: true }).tap();
    const shift = page.locator('section [data-drop^="shift|"]').first();
    await shift.tap();
    const sheet = page.locator('dialog[open]');
    await expect(sheet.getByRole('heading', { name: 'Who can work it' })).toBeVisible();
    const assign = sheet.getByRole('button', { name: /^Assign / }).first();
    await expect(assign).toBeVisible();
    const name = ((await assign.getAttribute('aria-label')) ?? '').replace(/^Assign /, '');
    await assign.tap();
    await expect(page.getByText(`${name} assigned`).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('pick a person, then a day, for a new shift; the day view scrolls inside its own box', async ({ page }) => {
    await signInAs(page, 'AQUATIC_SUPERVISOR');
    await open(page, '/manage/schedule');
    await page.getByRole('radio', { name: 'Week', exact: true }).tap();
    // On phones the people list sits in the More actions sheet with the less-used actions.
    await page.getByRole('button', { name: 'More actions' }).tap();
    await page.locator('dialog[open]').getByRole('button', { name: /^People \(\d+\)$/ }).tap();
    const person = page.locator('dialog[open] [role=listitem] button[aria-pressed]').first();
    const name = ((await person.getAttribute('aria-label')) ?? '').split('.')[0]!;
    await person.tap();
    await expect(page.getByText(`Scheduling ${name}:`)).toBeVisible();
    const theirs = page.locator('section [data-drop^="shift|"]', { hasText: name });
    const before = await theirs.count();
    await page.getByRole('button', { name: /^New shift on / }).nth(2).tap();
    const sheet = page.locator('dialog[open]');
    await expect(sheet.getByRole('heading', { name: `New shift for ${name}` })).toBeVisible();
    await sheet.getByRole('button', { name: 'Create draft' }).tap();
    await expect(page.getByText(`Draft shift made for ${name}.`).first()).toBeVisible();
    // The demo keeps the draft for this visit: it's on the week with the others.
    await expect(theirs).toHaveCount(before + 1);

    await page.getByRole('radio', { name: 'Day', exact: true }).tap();
    const timeline = page.getByRole('region', { name: 'Day timeline' });
    await expect(timeline).toBeVisible();
    const sizes = await timeline.evaluate((el) => ({ inner: el.scrollWidth, box: el.clientWidth }));
    expect(sizes.inner).toBeGreaterThan(sizes.box);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a real week to work with; Fill the schedule proposes and its drafts land on the week', async ({ page }) => {
    await signInAs(page, 'AQUATIC_SUPERVISOR');
    await open(page, '/manage/schedule');
    await page.getByRole('radio', { name: 'Week', exact: true }).tap();
    const shifts = page.locator('section [data-drop^="shift|"]');
    await expect.poll(() => shifts.count()).toBeGreaterThan(20);
    // Next week is only partly staffed.
    await page.getByRole('button', { name: 'Next', exact: true }).tap();
    const unstaffed = page.locator('section [data-drop^="shift|"]', { hasText: 'Open' });
    await expect.poll(() => unstaffed.count()).toBeGreaterThan(3);
    const openBefore = await unstaffed.count();
    await page.getByRole('button', { name: 'More actions' }).tap();
    await page.locator('dialog[open]').getByRole('button', { name: 'Fill the schedule' }).tap();
    const fill = page.locator('dialog[open]');
    await fill.getByRole('button', { name: 'Next', exact: true }).tap();
    await fill.getByRole('button', { name: 'Fill the schedule', exact: true }).tap();
    await expect(fill.getByRole('heading', { name: 'Review the proposals' })).toBeVisible();
    await fill.getByRole('button', { name: /^Accept (all )?\d+$/ }).tap();
    await expect(page.getByText(/added as drafts?\./).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => unstaffed.count()).toBeLessThan(openBefore);
  });
});

