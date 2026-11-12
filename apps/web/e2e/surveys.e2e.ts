import { type Page, expect, test } from '@playwright/test';
import { inFrench, open, sideways, signInAs, watchErrors } from './helpers';

/** Answers the sample pulse ("Fall check-in"): two ratings, one choice, the optional text left out. */
async function answer(page: Page, words: { week: string; safe: string; load: string; right: string }) {
  await page.getByRole('radiogroup', { name: words.week }).getByText('4', { exact: true }).tap();
  await page.getByRole('radiogroup', { name: words.safe }).getByText('5', { exact: true }).tap();
  await page.getByRole('group', { name: new RegExp(words.load) }).getByRole('radio', { name: words.right }).check();
}

/** Staff surveys: the Today card, the anonymity promise before any question, answering once, HR's results. */
test.describe('surveys on a phone', () => {
  test('Today’s card opens the survey; the promise comes before the questions; answer it once', async ({ page }) => {
    const errors = watchErrors(page);
    await signInAs(page, 'STAFF');
    await open(page, '/today');
    const card = page.getByRole('region', { name: 'A short survey from HR' });
    await expect(card).toContainText('Fall check-in');
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await card.getByRole('link', { name: 'Answer' }).tap();
    await expect(page).toHaveURL(/\/surveys\/?\?s=/);
    await expect(page.getByRole('heading', { name: 'Fall check-in' })).toBeVisible();

    // Before any question: what happens to the answers.
    await expect(page.getByText('Your answers are anonymous')).toBeVisible();
    await expect(page.getByText(/only if at least 5 people answered/)).toBeVisible();
    await expect(page.getByRole('group', { name: /How was your work week\?/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Start (4 questions)' }).tap();

    // Sending with nothing answered points at what's missing.
    await page.getByRole('button', { name: 'Send my answers' }).tap();
    await expect(page.getByRole('alert').filter({ hasText: 'This question needs an answer.' })).toHaveCount(3);
    await answer(page, { week: 'How was your work week?', safe: 'I feel safe raising concerns with my supervisor.', load: 'Your workload', right: 'About right' });
    await page.getByRole('button', { name: 'Send my answers' }).tap();
    await expect(page.getByText('Thank you. Your answers are in.').first()).toBeVisible();
    await expect(page.getByText('Answered', { exact: true })).toBeVisible();
    await expect(page.getByText(/Thanks, you’ve answered this one\./)).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    // Answered: Today doesn't ask again.
    await open(page, '/today');
    await expect(page.getByRole('region', { name: 'A short survey from HR' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the Today card can be hidden for now', async ({ page }) => {
    await signInAs(page, 'STAFF');
    await open(page, '/today');
    const card = page.getByRole('region', { name: 'A short survey from HR' });
    await card.getByRole('button', { name: 'Hide for now' }).tap();
    await expect(card).toHaveCount(0);
    await open(page, '/today');
    await expect(page.getByRole('region', { name: 'A short survey from HR' })).toHaveCount(0);
  });

  test('HR results: nothing while open, totals once closed, and small groups stay hidden', async ({ page }) => {
    const errors = watchErrors(page);
    await signInAs(page, 'HR_ADMIN');
    await open(page, '/manage/surveys');
    await expect(page.getByText(/Results show once a survey closes, for at least 5 responses\./)).toBeVisible();
    const row = (title: string) => page.getByRole('heading', { name: title }).locator('xpath=ancestor::div[contains(@class,"shadow-card")][1]');

    await row('Fall check-in').getByRole('button', { name: 'Results' }).tap();
    let sheet = page.locator('dialog[open]');
    await expect(sheet.getByText('Results show when the survey closes')).toBeVisible();
    await expect(sheet.getByText(/average/)).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Close' }).tap();

    await row('Summer check-in').getByRole('button', { name: 'Results' }).tap();
    sheet = page.locator('dialog[open]');
    await expect(sheet.getByText('7 of 9 answered')).toBeVisible();
    await expect(sheet.getByText(/average 3\.9 \/ 5/)).toBeVisible();
    // By department: every department is under the minimum group, so none is shown.
    await sheet.getByRole('radio', { name: 'By department' }).tap();
    await expect(sheet.getByText('No group is big enough to show on its own.')).toBeVisible();
    await expect(sheet.getByText(/Groups under 5 responses are hidden.*Hidden here: 7\./)).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Aquatics' })).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('en français : la promesse d’anonymat, puis répondre', async ({ page, baseURL }) => {
    const errors = watchErrors(page);
    await inFrench(page, baseURL);
    await signInAs(page, 'STAFF');
    await open(page, '/today');
    await page.getByRole('region', { name: 'Un court sondage des RH' }).getByRole('link', { name: 'Répondre' }).tap();
    await expect(page.getByText('Vos réponses sont anonymes')).toBeVisible();
    await page.getByRole('button', { name: 'Commencer (4 questions)' }).tap();
    // The questions are the organization's own words (written in English in the sample city).
    await answer(page, { week: 'How was your work week?', safe: 'I feel safe raising concerns with my supervisor.', load: 'Your workload', right: 'About right' });
    await page.getByRole('button', { name: 'Envoyer mes réponses' }).tap();
    await expect(page.getByText('Merci. Vos réponses sont enregistrées.').first()).toBeVisible();
    await expect(page.getByText('Répondu', { exact: true })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('en français : résultats RH, groupes trop petits masqués', async ({ page, baseURL }) => {
    await inFrench(page, baseURL);
    await signInAs(page, 'HR_ADMIN');
    await open(page, '/manage/surveys');
    await page.getByRole('heading', { name: 'Summer check-in' }).locator('xpath=ancestor::div[contains(@class,"shadow-card")][1]').getByRole('button', { name: 'Résultats' }).tap();
    const sheet = page.locator('dialog[open]');
    await expect(sheet.getByText(/moyenne 3,9/)).toBeVisible();
    await sheet.getByRole('radio', { name: 'Par service' }).tap();
    await expect(sheet.getByText('Aucun groupe n’est assez grand pour être affiché seul.')).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});
