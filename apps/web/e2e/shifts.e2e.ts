import { type Page, expect, test } from '@playwright/test';
import { inFrench, open, sideways, signInAs, watchErrors } from './helpers';

/** The card under a heading (Card, as the shared component draws it). */
const card = (page: Page, title: string) => page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::div[contains(@class,"shadow-card")][1]');

/** Shift preferences, bidding and weekly templates on a phone. */
test.describe('shift preferences on a phone', () => {
  test('add a shift to avoid and a weekly maximum, save, and find them saved', async ({ page }) => {
    const errors = watchErrors(page);
    await signInAs(page, 'STAFF');
    await open(page, '/preferences');
    const prefer = card(page, 'I’d like to work');
    const avoid = card(page, 'I’d rather not work');
    await expect(prefer.getByLabel('Note (optional)')).toHaveValue('Mornings work with my classes');
    await expect(avoid.getByLabel('Note (optional)')).toHaveValue('Family day');
    const save = page.getByRole('button', { name: 'Save preferences' });
    await expect(save).toBeDisabled();

    await avoid.getByRole('button', { name: 'Add shifts to avoid' }).tap();
    const rows = avoid.locator('ul > li');
    await expect(rows).toHaveCount(2);
    await rows.nth(1).getByLabel('Any time of day').uncheck();
    await expect(rows.nth(1).getByLabel('Starting from')).toBeVisible();
    await rows.nth(1).getByLabel('Note (optional)').fill('Evening class on Tuesdays');
    await page.getByLabel('Hours a week, at most').fill('24');
    await expect(save).toBeEnabled();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await save.tap();
    await expect(page.getByText('Preferences saved.').first()).toBeVisible();

    // The demo keeps them for this visit.
    await open(page, '/preferences');
    await expect(card(page, 'I’d rather not work').locator('ul > li')).toHaveCount(2);
    await expect(card(page, 'I’d rather not work').getByLabel('Note (optional)').nth(1)).toHaveValue('Evening class on Tuesdays');
    await expect(page.getByLabel('Hours a week, at most')).toHaveValue('24');
    await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('a weekly maximum outside 1 to 80 hours can’t be saved', async ({ page }) => {
    await signInAs(page, 'STAFF');
    await open(page, '/preferences');
    await page.getByLabel('Hours a week, at most').fill('90');
    await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
    await page.getByLabel('Hours a week, at most').fill('');
    await expect(page.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
  });

  test('en français : ajouter des quarts souhaités et enregistrer', async ({ page, baseURL }) => {
    const errors = watchErrors(page);
    await inFrench(page, baseURL);
    await signInAs(page, 'STAFF');
    await open(page, '/preferences');
    const prefer = card(page, 'J’aimerais travailler');
    await prefer.getByRole('button', { name: 'Ajouter des quarts souhaités' }).tap();
    await expect(prefer.locator('ul > li')).toHaveCount(2);
    await page.getByLabel('Heures par semaine, au plus').fill('30');
    await page.getByRole('button', { name: 'Enregistrer mes préférences' }).tap();
    await expect(page.getByText('Préférences enregistrées.').first()).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});

test.describe('shift bidding on a phone', () => {
  const ranking = (page: Page) => card(page, 'Summer lines').getByRole('region', { name: 'My ranking' }).locator('ol > li');

  test('rank a line, move it up, save, and find the order kept', async ({ page }) => {
    const errors = watchErrors(page);
    await signInAs(page, 'STAFF');
    await open(page, '/bids');
    // The closed round waits for review; the open one takes a ranking.
    await expect(card(page, 'December weekday shifts').getByText('In review')).toBeVisible();
    const summer = card(page, 'Summer lines');
    await expect(summer.getByText(/^You’re \d+\w* of \d+ in seniority\./)).toBeVisible();
    await expect(ranking(page)).toHaveCount(3);
    const toRank = summer.getByRole('region', { name: 'Lines to rank' }).locator('li');
    // The line's position, place and dates.
    const pick = (await toRank.first().locator('span.text-small').first().innerText()).trim();
    await toRank.first().getByRole('button', { name: 'Add' }).tap();
    await expect(ranking(page)).toHaveCount(4);
    await expect(ranking(page).nth(3)).toContainText(pick);
    await summer.getByRole('button', { name: 'Move choice 4 up' }).tap();
    await expect(ranking(page).nth(2)).toContainText(pick);
    await expect(summer.getByRole('button', { name: 'Move choice 1 up' })).toBeDisabled();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    const order = await ranking(page).allInnerTexts();
    await summer.getByRole('button', { name: 'Save my ranking' }).tap();
    await expect(page.getByText('Ranking saved.').first()).toBeVisible();

    await open(page, '/bids');
    await expect(ranking(page)).toHaveCount(4);
    expect(await ranking(page).allInnerTexts()).toEqual(order);
    expect(errors).toEqual([]);
  });

  test('take a line out of the ranking', async ({ page }) => {
    await signInAs(page, 'STAFF');
    await open(page, '/bids');
    const rest = (await ranking(page).allInnerTexts()).slice(1);
    await card(page, 'Summer lines').getByRole('button', { name: 'Remove choice 1' }).tap();
    await expect(ranking(page)).toHaveCount(2);
    // Renumbered: what was second is now first.
    expect((await ranking(page).allInnerTexts()).map((x) => x.replace(/^\d+\s*/, ''))).toEqual(rest.map((x) => x.replace(/^\d+\s*/, '')));
    await expect(card(page, 'Summer lines').getByRole('button', { name: 'Save my ranking' })).toBeEnabled();
  });

  test('supervisor: the rounds, open and in review', async ({ page }) => {
    const errors = watchErrors(page);
    await signInAs(page, 'AQUATIC_SUPERVISOR');
    await open(page, '/manage/bids');
    await expect(page.getByRole('button', { name: 'New bid round' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Summer lines.*Open/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /December weekday shifts.*In review/ })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('supervisor: tap a round for its detail and back, then the new-round form', async ({ page }) => {
    const errors = watchErrors(page);
    await signInAs(page, 'AQUATIC_SUPERVISOR');
    await open(page, '/manage/bids');
    await page.getByRole('button', { name: /December weekday shifts.*In review/ }).tap();
    await expect(page.getByRole('heading', { name: 'December weekday shifts', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Seniority order and outcomes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm awards' })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'All rounds' }).tap();
    await page.getByRole('button', { name: /Summer lines.*Open/ }).tap();
    await expect(page.getByRole('heading', { name: 'Summer lines', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'On offer' })).toBeVisible();
    await page.getByRole('button', { name: 'All rounds' }).tap();
    await page.getByRole('button', { name: 'New bid round' }).tap();
    const form = page.locator('dialog[open]');
    await expect(form.getByLabel('Template')).toBeVisible();
    await expect(form.getByLabel('Template').locator('option', { hasText: 'Summer' })).toHaveCount(1);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('union steward: closed rounds, read-only', async ({ page }) => {
    await signInAs(page, 'UNION_STEWARD');
    await open(page, '/union/bids');
    await expect(page.getByRole('heading', { name: 'Bid awards' })).toBeVisible();
    await expect(page.getByRole('button', { name: /December weekday shifts.*In review/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New bid round' })).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    // A round's outcomes, read-only.
    await page.getByRole('button', { name: /December weekday shifts.*In review/ }).tap();
    await expect(page.getByText(/^Read-only for union stewards/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Seniority order and outcomes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm awards' })).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('en français : classer et enregistrer', async ({ page, baseURL }) => {
    const errors = watchErrors(page);
    await inFrench(page, baseURL);
    await signInAs(page, 'STAFF');
    await open(page, '/bids');
    const summer = card(page, 'Summer lines');
    await expect(summer.getByRole('region', { name: 'Mon classement' }).locator('ol > li')).toHaveCount(3);
    await summer.getByRole('button', { name: 'Monter le choix 2' }).tap();
    await summer.getByRole('button', { name: 'Enregistrer mon classement' }).tap();
    await expect(page.getByText('Classement enregistré.').first()).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});

test.describe('weekly shift templates on a phone', () => {
  test('the list, a template opened, and a preview before making drafts', async ({ page }) => {
    const errors = watchErrors(page);
    await signInAs(page, 'AQUATIC_SUPERVISOR');
    await open(page, '/manage/shift-templates');
    const school = card(page, 'School year');
    await expect(card(page, 'Summer')).toBeVisible();
    await expect(school.locator('ul').first().locator('> li')).toHaveCount(4);
    await expect(school.getByText(/^23 shifts a week · /)).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    await school.getByRole('button', { name: 'Edit', exact: true }).tap();
    let sheet = page.locator('dialog[open]');
    await expect(sheet.getByRole('heading', { name: 'Edit template' })).toBeVisible();
    await expect(sheet.getByLabel('Name', { exact: true })).toHaveValue('School year');
    await expect(sheet.getByRole('group', { name: /^Shift \d+$/ })).toHaveCount(4);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await sheet.getByRole('button', { name: 'Close' }).tap();

    await school.getByRole('button', { name: 'Apply to weeks…' }).tap();
    sheet = page.locator('dialog[open]');
    await expect(sheet.getByRole('heading', { name: 'Apply “School year”' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Preview' }).tap();
    await expect(sheet.getByText('23 draft shifts will be created.')).toBeVisible();
    await sheet.getByLabel('For', { exact: true }).selectOption('2');
    await expect(sheet.getByText('23 draft shifts will be created.')).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Preview' }).tap();
    await expect(sheet.getByText('46 draft shifts will be created.')).toBeVisible();
    await sheet.getByRole('button', { name: 'Create drafts' }).tap();
    await expect(sheet.getByText('46 drafts created.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Undo' })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('en français : aperçu avant de créer les provisoires', async ({ page, baseURL }) => {
    const errors = watchErrors(page);
    await inFrench(page, baseURL);
    await signInAs(page, 'AQUATIC_SUPERVISOR');
    await open(page, '/manage/shift-templates');
    await card(page, 'School year').getByRole('button', { name: 'Appliquer aux semaines…' }).tap();
    const sheet = page.locator('dialog[open]');
    await sheet.getByRole('button', { name: 'Aperçu' }).tap();
    await expect(sheet.getByText('23 quarts provisoires seront créés.')).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
